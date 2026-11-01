import express from 'express'
import { GoogleGenAI, Type } from '@google/genai'
import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const localEnvironment = dotenv.config({
  path: [path.join(projectRoot, '.env.local'), path.join(projectRoot, '.env')],
  quiet: true,
})
for (const [name, value] of Object.entries(localEnvironment.parsed || {})) {
  if (!process.env[name]?.trim()) process.env[name] = value
}

export const app = express()
const port = Number(process.env.PORT || 8787)
const model = 'gemini-3.8-flash'
const distPath = path.join(projectRoot, 'dist')
const rateBuckets = new Map()
const MAX_REQUESTS_PER_MINUTE = 24
const MAX_BUDGET = 1_000_000_000
const MAX_GUESTS = 100_000
const GUEST_COOKIE = 'happixo_guest_session'
const GUEST_SESSION_MAX_AGE = 60 * 60 * 24 * 365
const guestRateBuckets = new Map()
let databaseClient

const eventSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T12:00:00`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= new Date().toISOString().slice(0, 10)
  }, 'Date must be a real, upcoming calendar date.'),
  city: z.string().trim().min(1).max(120),
  budget: z.number().int().min(10_000).max(MAX_BUDGET),
  guests: z.number().int().min(1).max(MAX_GUESTS),
  theme: z.string().max(300),
  food: z.string().max(300),
  venue: z.string().max(100),
  requirements: z.string().max(2000),
}).strict()

const guestDetailsSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  mobileNumber: z.string().trim().regex(/^\+?[0-9() .-]{7,24}$/).refine((value) => value.replace(/\D/g, '').length >= 7 && value.replace(/\D/g, '').length <= 15),
  website: z.string().max(200).optional(),
}).strict()

const guestTaskSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  priority: z.enum(['High', 'Medium', 'Low']),
  status: z.enum(['To do', 'In progress', 'Done']),
}).strict()

const guestExpenseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  planned: z.number().finite().min(0).max(MAX_BUDGET),
  actual: z.number().finite().min(0).max(MAX_BUDGET),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
}).strict()

const guestVendorSchema = z.object({
  id: z.string().uuid(),
  category: z.string().trim().min(1).max(120),
  estimatedCost: z.number().finite().min(0).max(MAX_BUDGET),
  status: z.enum(['To do', 'Contacted', 'Booked']),
  contact: z.string().max(160),
  notes: z.string().max(2000),
}).strict()

const generatedPlanSchema = z.object({
  eventSummary: z.string().trim().min(1).max(1200),
  theme: z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(600),
    colors: z.array(z.string().trim().min(1).max(40)).min(2).max(6),
  }).strict(),
  budget: z.array(z.object({
    category: z.string().trim().min(1).max(100),
    estimatedCost: z.number().finite().nonnegative().max(MAX_BUDGET),
    reason: z.string().trim().min(1).max(300),
  }).strict()).min(1).max(16),
  timeline: z.array(z.object({
    task: z.string().trim().min(1).max(120),
    daysBeforeEvent: z.number().int().min(0).max(730),
    priority: z.enum(['high', 'medium', 'low']),
    description: z.string().trim().min(1).max(300),
  }).strict()).max(24),
  vendorChecklist: z.array(z.object({
    category: z.string().trim().min(1).max(100),
    estimatedCost: z.number().finite().nonnegative().max(MAX_BUDGET),
    notes: z.string().trim().min(1).max(300),
  }).strict()).max(16),
  foodSuggestions: z.array(z.string().trim().min(1).max(240)).max(12),
  activities: z.array(z.string().trim().min(1).max(240)).max(12),
  savingTips: z.array(z.string().trim().min(1).max(300)).max(12),
  contingencyPlan: z.array(z.string().trim().min(1).max(300)).max(12),
  costsAreEstimates: z.boolean().optional(),
}).strict()

const guestPlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  type: z.enum(['Wedding', 'Birthday', 'College event', 'Community gathering', 'Other']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T12:00:00`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }),
  city: z.string().trim().min(1).max(120),
  budget: z.number().int().min(10_000).max(MAX_BUDGET),
  guests: z.number().int().min(1).max(MAX_GUESTS),
  theme: z.string().max(300),
  food: z.string().max(300),
  venue: z.string().max(100),
  requirements: z.string().max(2000),
  expenses: z.array(guestExpenseSchema).max(64),
  tasks: z.array(guestTaskSchema).max(64),
  vendors: z.array(guestVendorSchema).max(64),
  concept: z.string().max(1200),
  created: z.string().datetime().optional(),
  generatedPlan: generatedPlanSchema.optional(),
}).strict()

const chatRequestSchema = z.object({
  event: eventSchema.extend({
    concept: z.string().max(1200).optional(),
    expenses: z.array(z.object({
      name: z.string().max(100),
      planned: z.number().finite().nonnegative().max(MAX_BUDGET),
      actual: z.number().finite().nonnegative().max(MAX_BUDGET),
    }).strict()).max(32).optional(),
    vendors: z.array(z.object({
      category: z.string().max(100),
      status: z.enum(['To do', 'Contacted', 'Booked']),
      notes: z.string().max(500),
    }).strict()).max(32).optional(),
  }),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().trim().min(1).max(1500),
  }).strict()).max(12),
  message: z.string().trim().min(1).max(1200),
}).strict()

const chatResponseSchema = z.object({
  reply: z.string().trim().min(1).max(1600),
  suggestedChanges: z.array(z.object({
    field: z.enum(['budget', 'guests', 'theme', 'food', 'venue', 'requirements']),
    value: z.union([z.string().trim().min(1).max(500), z.number().int().min(1).max(MAX_BUDGET)]),
    reason: z.string().trim().min(1).max(400),
  }).strict()).max(5),
}).strict()

const planResponseSchema = {
  type: Type.OBJECT,
  properties: {
    eventSummary: { type: Type.STRING },
    theme: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        description: { type: Type.STRING },
        colors: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['name', 'description', 'colors'],
    },
    budget: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { category: { type: Type.STRING }, estimatedCost: { type: Type.INTEGER }, reason: { type: Type.STRING } },
        required: ['category', 'estimatedCost', 'reason'],
      },
    },
    timeline: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          task: { type: Type.STRING }, daysBeforeEvent: { type: Type.INTEGER },
          priority: { type: Type.STRING, enum: ['high', 'medium', 'low'] }, description: { type: Type.STRING },
        },
        required: ['task', 'daysBeforeEvent', 'priority', 'description'],
      },
    },
    vendorChecklist: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { category: { type: Type.STRING }, estimatedCost: { type: Type.INTEGER }, notes: { type: Type.STRING } },
        required: ['category', 'estimatedCost', 'notes'],
      },
    },
    foodSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    activities: { type: Type.ARRAY, items: { type: Type.STRING } },
    savingTips: { type: Type.ARRAY, items: { type: Type.STRING } },
    contingencyPlan: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['eventSummary', 'theme', 'budget', 'timeline', 'vendorChecklist', 'foodSuggestions', 'activities', 'savingTips', 'contingencyPlan'],
}

const chatResponseJsonSchema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    suggestedChanges: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING, enum: ['budget', 'guests', 'theme', 'food', 'venue', 'requirements'] },
          value: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ['field', 'value', 'reason'],
      },
    },
  },
  required: ['reply', 'suggestedChanges'],
}

function getClientAddress(request) {
  return request.socket.remoteAddress || 'unknown'
}

function rateLimit(request, response, next) {
  const now = Date.now()
  const address = getClientAddress(request)
  const bucket = rateBuckets.get(address)
  if (!bucket || now - bucket.startedAt >= 60_000) {
    rateBuckets.set(address, { startedAt: now, count: 1 })
    return next()
  }
  if (bucket.count >= MAX_REQUESTS_PER_MINUTE) {
    return response.status(429).json({ error: 'Too many AI requests. Please wait a minute and try again.' })
  }
  bucket.count += 1
  return next()
}

setInterval(() => {
  const now = Date.now()
  for (const [address, bucket] of rateBuckets) {
    if (now - bucket.startedAt >= 60_000) rateBuckets.delete(address)
  }
}, 60_000).unref()

function validateJsonResponse(text, schema, context) {
  if (!text) throw new Error(`Gemini returned an empty ${context} response.`)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Gemini returned invalid JSON for ${context}.`)
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    console.error(`Gemini ${context} response did not match the expected schema.`)
    throw new Error(`Gemini returned an incomplete ${context} plan. Please try again.`)
  }
  return result.data
}

function normalizePlanCosts(plan, availableBudget, event) {
  const budget = plan.budget.map((item) => ({
    ...item,
    estimatedCost: Math.max(0, Math.round(item.estimatedCost / 100) * 100),
  }))
  const total = budget.reduce((sum, item) => sum + item.estimatedCost, 0)
  if (total > availableBudget && total > 0) {
    const scale = availableBudget / total
    let assigned = 0
    for (const item of budget) {
      item.estimatedCost = Math.floor(item.estimatedCost * scale / 100) * 100
      assigned += item.estimatedCost
    }
    const remaining = Math.max(0, availableBudget - assigned)
    if (budget.length) budget[0].estimatedCost += remaining
  }
  const contingencyPlan = [...plan.contingencyPlan]
  if (event.budget / event.guests < 500) {
    contingencyPlan.unshift('Budget feasibility note: this estimate is under ₹500 per guest. Review venue, catering and service requirements with local vendors before committing.')
  }
  return { ...plan, budget, contingencyPlan, costsAreEstimates: true }
}

function modelClient() {
  if (!process.env.GEMINI_API_KEY?.trim()) return null
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY.trim() })
}

function getDatabaseClient() {
  if (databaseClient) return databaseClient
  const url = process.env.SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceKey) {
    throw new Error('Customer storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.')
  }
  databaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return databaseClient
}

function hashGuestToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function getGuestToken(request) {
  const secureName = `__Host-${GUEST_COOKIE}`
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${GUEST_COOKIE}=`) || part.startsWith(`${secureName}=`))
  const name = cookie?.startsWith(`${secureName}=`) ? secureName : GUEST_COOKIE
  const token = cookie?.slice(name.length + 1)
  return token && /^[A-Za-z0-9_-]{40,60}$/.test(token) ? token : null
}

function setGuestCookie(request, response, token) {
  const secure = process.env.VERCEL === '1' || request.headers['x-forwarded-proto'] === 'https'
  const prefix = secure ? '__Host-' : ''
  response.setHeader('Set-Cookie', `${prefix}${GUEST_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${GUEST_SESSION_MAX_AGE}${secure ? '; Secure' : ''}`)
}

function clearGuestCookie(request, response) {
  const secure = process.env.VERCEL === '1' || request.headers['x-forwarded-proto'] === 'https'
  const prefix = secure ? '__Host-' : ''
  response.setHeader('Set-Cookie', `${prefix}${GUEST_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`)
}

function sameOrigin(request, response, next) {
  const origin = request.get('origin')
  if (!origin) return response.status(403).json({ error: 'Request origin could not be verified.' })
  try {
    const parsedOrigin = new URL(origin)
    if (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname)) return next()
    const forwardedHost = request.get('x-forwarded-host')?.split(',')[0].trim()
    const host = forwardedHost || request.get('host')
    if (!host || parsedOrigin.host !== host) return response.status(403).json({ error: 'Cross-origin request rejected.' })
    return next()
  } catch {
    return response.status(403).json({ error: 'Request origin could not be verified.' })
  }
}

function guestRateLimit(maxRequests, windowMs) {
  return (request, response, next) => {
    const address = getClientAddress(request)
    const now = Date.now()
    let bucket = guestRateBuckets.get(address)
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { startedAt: now, count: 0 }
      guestRateBuckets.set(address, bucket)
    }
    if (bucket.count >= maxRequests) {
      return response.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' })
    }
    bucket.count += 1
    return next()
  }
}

setInterval(() => {
  const now = Date.now()
  for (const [address, bucket] of guestRateBuckets) {
    if (now - bucket.startedAt >= 60_000) guestRateBuckets.delete(address)
  }
}, 60_000).unref()

function respondWithCustomerError(response, error, context) {
  console.error(`HappiXO ${context} failed.`)
  if (['PGRST202', 'PGRST205', '42883', '42P01'].includes(error?.code)) {
    return response.status(503).json({ error: 'The guest-planning SQL migration is missing or incomplete. Apply the latest HappiXO migration and retry.' })
  }
  const status = error?.message?.includes('Customer storage is not configured') ? 503 : 500
  return response.status(status).json({ error: status === 503 ? error.message : `HappiXO could not ${context}. Please try again.` })
}

async function loadGuestLead(request, response, next) {
  try {
    const token = getGuestToken(request)
    if (!token) return response.status(401).json({ error: 'Your guest planning session is missing. Start planning again to create a new session.' })
    const client = getDatabaseClient()
    const { data, error } = await client.from('customer_leads')
      .select('id, full_name, email, mobile_number')
      .eq('guest_session_hash', hashGuestToken(token))
      .maybeSingle()
    if (error) throw error
    if (!data) return response.status(401).json({ error: 'Your guest planning session is no longer available. Start planning again.' })
    request.guestToken = token
    request.guestLead = data
    request.database = client
    response.setHeader('Cache-Control', 'no-store')
    return next()
  } catch (error) {
    return respondWithCustomerError(response, error, 'load your guest session')
  }
}

function guestResponse(lead) {
  return { id: lead.id, fullName: lead.full_name, email: lead.email, mobileNumber: lead.mobile_number }
}

function databaseEvent(event, children) {
  return {
    id: event.id, name: event.name, type: event.event_type, date: event.event_date,
    city: event.city, budget: Number(event.budget), guests: event.guests, theme: event.theme,
    food: event.food, venue: event.venue, requirements: event.requirements,
    concept: event.concept, created: event.created_at,
    expenses: children.expenses.filter((item) => item.event_id === event.id).map((item) => ({
      id: item.id, name: item.name, planned: Number(item.planned), actual: Number(item.actual), color: item.color,
    })),
    tasks: children.tasks.filter((item) => item.event_id === event.id).map((item) => ({
      id: item.id, name: item.name, description: item.description, dueDate: item.due_date,
      priority: item.priority, status: item.status,
    })),
    vendors: children.vendors.filter((item) => item.event_id === event.id).map((item) => ({
      id: item.id, category: item.category, estimatedCost: Number(item.estimated_cost),
      status: item.status, contact: item.contact, notes: item.notes,
    })),
    generatedPlan: children.plans.find((item) => item.event_id === event.id)?.plan,
  }
}

async function fetchGuestEvents(request) {
  const client = request.database
  const leadId = request.guestLead.id
  const { data: events, error: eventError } = await client.from('events')
    .select('*').eq('guest_lead_id', leadId).order('event_date')
  if (eventError) throw eventError
  if (!events?.length) return []
  const eventIds = events.map((event) => event.id)
  const [expenses, tasks, vendors, plans] = await Promise.all([
    client.from('event_expenses').select('*').eq('guest_lead_id', leadId).in('event_id', eventIds),
    client.from('event_tasks').select('*').eq('guest_lead_id', leadId).in('event_id', eventIds),
    client.from('event_vendors').select('*').eq('guest_lead_id', leadId).in('event_id', eventIds),
    client.from('ai_plans').select('event_id,plan').eq('guest_lead_id', leadId).in('event_id', eventIds),
  ])
  for (const result of [expenses, tasks, vendors, plans]) {
    if (result.error) throw result.error
  }
  const children = {
    expenses: expenses.data || [],
    tasks: tasks.data || [],
    vendors: vendors.data || [],
    plans: plans.data || [],
  }
  return events.map((event) => databaseEvent(event, children))
}

async function saveGuestPlan(request, plan) {
  const client = request.database
  const payload = {
    p_guest_lead_id: request.guestLead.id,
    p_session_hash: hashGuestToken(request.guestToken),
    p_event: {
      id: plan.id, name: plan.name, event_type: plan.type, event_date: plan.date, city: plan.city,
      budget: plan.budget, guests: plan.guests, theme: plan.theme, food: plan.food,
      venue: plan.venue, requirements: plan.requirements, concept: plan.concept,
    },
    p_expenses: plan.expenses.map((item) => ({
      id: item.id, name: item.name, planned: item.planned, actual: item.actual, color: item.color,
    })),
    p_tasks: plan.tasks.map((item) => ({
      id: item.id, name: item.name, description: item.description, due_date: item.dueDate,
      priority: item.priority, status: item.status,
    })),
    p_vendors: plan.vendors.map((item) => ({
      id: item.id, category: item.category, estimated_cost: item.estimatedCost,
      status: item.status, contact: item.contact, notes: item.notes,
    })),
    p_ai_plan: plan.generatedPlan || null,
  }
  const { data, error } = await client.rpc('save_guest_event_plan', payload)
  if (error) throw error
  return data
}

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb', strict: true }))
app.get('/api/ai/status', (_request, response) => {
  response.json({ configured: Boolean(process.env.GEMINI_API_KEY?.trim()), model })
})

app.get('/api/customer/session', async (request, response) => {
  const token = getGuestToken(request)
  response.setHeader('Cache-Control', 'no-store')
  if (!token) return response.json({ customer: null })
  try {
    const client = getDatabaseClient()
    const { data, error } = await client.from('customer_leads')
      .select('id, full_name, email, mobile_number')
      .eq('guest_session_hash', hashGuestToken(token))
      .maybeSingle()
    if (error) throw error
    if (!data) {
      clearGuestCookie(request, response)
      return response.json({ customer: null })
    }
    return response.json({ customer: guestResponse(data) })
  } catch (error) {
    return respondWithCustomerError(response, error, 'restore your guest session')
  }
})

app.post('/api/customer/session', sameOrigin, guestRateLimit(6, 60_000), async (request, response) => {
  const parsed = guestDetailsSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ error: 'Enter a valid full name, email address, and mobile number.' })
  }
  if (parsed.data.website) return response.status(400).json({ error: 'Customer details could not be accepted.' })
  const details = {
    full_name: parsed.data.fullName,
    email: parsed.data.email.toLowerCase(),
    mobile_number: parsed.data.mobileNumber,
  }
  try {
    const client = getDatabaseClient()
    const existingToken = getGuestToken(request)
    let lead
    if (existingToken) {
      const { data, error } = await client.from('customer_leads')
        .update(details)
        .eq('guest_session_hash', hashGuestToken(existingToken))
        .select('id, full_name, email, mobile_number')
        .maybeSingle()
      if (error) throw error
      lead = data
    }
    if (!lead) {
      const token = randomBytes(32).toString('base64url')
      const { data, error } = await client.from('customer_leads')
        .insert({ ...details, guest_session_hash: hashGuestToken(token) })
        .select('id, full_name, email, mobile_number')
        .single()
      if (error) throw error
      setGuestCookie(request, response, token)
      lead = data
    } else {
      setGuestCookie(request, response, existingToken)
    }
    response.setHeader('Cache-Control', 'no-store')
    return response.status(201).json({ customer: guestResponse(lead) })
  } catch (error) {
    return respondWithCustomerError(response, error, 'save your customer details')
  }
})

app.put('/api/customer/session', sameOrigin, guestRateLimit(20, 60_000), loadGuestLead, async (request, response) => {
  const parsed = z.object({
    fullName: z.string().trim().min(1).max(120),
    mobileNumber: guestDetailsSchema.shape.mobileNumber,
  }).strict().safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid full name and mobile number.' })
  try {
    const { data, error } = await request.database.from('customer_leads')
      .update({ full_name: parsed.data.fullName, mobile_number: parsed.data.mobileNumber })
      .eq('id', request.guestLead.id)
      .select('id, full_name, email, mobile_number')
      .single()
    if (error) throw error
    return response.json({ customer: guestResponse(data) })
  } catch (error) {
    return respondWithCustomerError(response, error, 'update your customer details')
  }
})

app.delete('/api/customer/session', sameOrigin, guestRateLimit(20, 60_000), (request, response) => {
  clearGuestCookie(request, response)
  return response.status(204).end()
})

app.get('/api/customer/events', guestRateLimit(90, 60_000), loadGuestLead, async (request, response) => {
  try {
    const events = await fetchGuestEvents(request)
    return response.json({ events })
  } catch (error) {
    return respondWithCustomerError(response, error, 'load your saved events')
  }
})

app.post('/api/customer/events', sameOrigin, guestRateLimit(60, 60_000), loadGuestLead, async (request, response) => {
  const parsed = guestPlanSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ error: 'The event plan contains invalid or unsupported fields.', details: parsed.error.flatten() })
  }
  try {
    const id = await saveGuestPlan(request, parsed.data)
    return response.status(200).json({ id })
  } catch (error) {
    return respondWithCustomerError(response, error, 'save your event plan')
  }
})

app.delete('/api/customer/events/:eventId', sameOrigin, guestRateLimit(60, 60_000), loadGuestLead, async (request, response) => {
  if (!z.string().uuid().safeParse(request.params.eventId).success) {
    return response.status(400).json({ error: 'Event ID is invalid.' })
  }
  try {
    const { data, error } = await request.database.from('events')
      .delete()
      .eq('id', request.params.eventId)
      .eq('guest_lead_id', request.guestLead.id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return response.status(404).json({ error: 'That event was not found in your guest session.' })
    return response.status(204).end()
  } catch (error) {
    return respondWithCustomerError(response, error, 'delete your event')
  }
})

app.post('/api/ai/plan', rateLimit, async (request, response) => {
  const parsed = z.object({ event: eventSchema }).strict().safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ error: 'Please provide a valid event name, future date, location, budget and guest count.', details: parsed.error.flatten() })
  }
  const client = modelClient()
  if (!client) return response.status(503).json({ error: 'Gemini is not configured. HappiXO can continue in local demo mode.' })
  const event = parsed.data.event
  try {
    const result = await client.models.generateContent({
      model,
      contents: `Create a thoughtful, personalized event plan in JSON. Treat all costs as estimates in Indian Rupees (INR), not verified vendor prices. Keep budget category estimates at or below the supplied budget in total. Include a 5–10% emergency reserve when appropriate and account for it within the budget. Do not claim vendor availability or bookings. Consider event date when scheduling tasks and keep every daysBeforeEvent a nonnegative integer. Mention feasibility or missing details cautiously in contingencyPlan. Respect these details: ${JSON.stringify(event)}`,
      config: { responseMimeType: 'application/json', responseSchema: planResponseSchema, temperature: 0.7 },
    })
    const plan = validateJsonResponse(result.text, generatedPlanSchema, 'event')
    return response.json(normalizePlanCosts(plan, event.budget, event))
  } catch (error) {
    return sendModelError(response, error, 'event plan')
  }
})

app.post('/api/ai/chat', rateLimit, async (request, response) => {
  const parsed = chatRequestSchema.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ error: 'Please provide valid event details, a message and a short conversation history.', details: parsed.error.flatten() })
  }
  const client = modelClient()
  if (!client) return response.status(503).json({ error: 'Gemini is not configured. HappiXO can continue in local demo mode.' })
  const { event, history, message } = parsed.data
  const historyText = history.slice(-10).map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.text}`).join('\n')
  try {
    const result = await client.models.generateContent({
      model,
      contents: `You are HappiXO, a helpful event-planning companion. Respond using only this JSON structure: {"reply":"...","suggestedChanges":[{"field":"budget|guests|theme|food|venue|requirements","value":"string value; numeric fields must be digits only","reason":"..."}]}. You may suggest up to three concrete changes. Never say that a plan was changed or applied; only the user can apply suggestions in the app. Do not do arithmetic when a numeric suggestion is requested—return the desired numeric value or ask a clarifying question. Keep suggestions relevant to the current event, use INR for prices, and do not claim vendors are available or booked. Current saved event: ${JSON.stringify(event)}\nRecent conversation:\n${historyText || '(No previous messages)'}\nNew user message: ${message}`,
      config: { responseMimeType: 'application/json', responseSchema: chatResponseJsonSchema, temperature: 0.6 },
    })
    const reply = validateJsonResponse(result.text, chatResponseSchema, 'chat')
    const normalizedChanges = reply.suggestedChanges.map((change) => ({
      ...change,
      value: ['budget', 'guests'].includes(change.field) ? Number(change.value) : change.value,
    }))
    const sanitizedChanges = normalizedChanges.filter((change) => {
      if (change.field === 'budget') return typeof change.value === 'number' && change.value >= 10_000 && change.value <= MAX_BUDGET
      if (change.field === 'guests') return typeof change.value === 'number' && change.value <= MAX_GUESTS
      return typeof change.value === 'string'
    })
    return response.json({ ...reply, suggestedChanges: sanitizedChanges })
  } catch (error) {
    return sendModelError(response, error, 'copilot')
  }
})

function sendModelError(response, error, context) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status)
  console.error(`Gemini ${context} request failed.`)
  if (status === 429) return response.status(429).json({ error: 'Gemini is rate-limited right now. Please try again shortly.' })
  if (status === 401 || status === 403) return response.status(502).json({ error: 'Gemini rejected the server credentials. Check GEMINI_API_KEY on the server.' })
  return response.status(502).json({ error: `Gemini could not complete the ${context}. Please try again or continue with the local demo.` })
}

app.use('/api', (_request, response) => response.status(404).json({ error: 'Unknown HappiXO API endpoint.' }))

if (existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath))
  app.get('/{*splat}', (_request, response) => response.sendFile(path.join(distPath, 'index.html')))
}

app.use((error, _request, response, _next) => {
  if (error?.type === 'entity.too.large') return response.status(413).json({ error: 'Request payload is too large.' })
  if (error instanceof SyntaxError && 'body' in error) return response.status(400).json({ error: 'Request body must be valid JSON.' })
  console.error('Unhandled HappiXO API error.')
  return response.status(500).json({ error: 'The HappiXO server encountered an unexpected error.' })
})

export function createVercelHandler(route) {
  return (request, response) => {
    const query = request.url?.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''
    let targetRoute = route
    if (route.includes(':eventId')) {
      const requestPath = request.url?.split('?')[0] || ''
      const pathEventId = requestPath.match(/\/api\/customer\/events\/([^/]+)$/)?.[1]
      const queryEventId = request.query?.eventId
      const eventId = typeof queryEventId === 'string' ? queryEventId : pathEventId?.includes('[') ? '' : pathEventId || ''
      targetRoute = route.replace(':eventId', encodeURIComponent(eventId))
    }
    request.url = `${targetRoute}${query}`
    return app(request, response)
  }
}

const host = process.env.HOST || '127.0.0.1'
if (process.env.VERCEL !== '1') {
  app.listen(port, host, () => {
    console.log(`HappiXO API listening on http://${host}:${port}; Gemini ${process.env.GEMINI_API_KEY?.trim() ? 'configured' : 'not configured (demo mode)'}.`)
  })
}
