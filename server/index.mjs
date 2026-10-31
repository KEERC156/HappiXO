import 'dotenv/config'
import express from 'express'
import { GoogleGenAI, Type } from '@google/genai'
import { z } from 'zod'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const app = express()
const port = Number(process.env.PORT || 8787)
const model = 'gemini-3.8-flash'
const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const distPath = path.join(projectRoot, 'dist')
const rateBuckets = new Map()
const MAX_REQUESTS_PER_MINUTE = 24
const MAX_BUDGET = 1_000_000_000
const MAX_GUESTS = 100_000

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
    console.error(`Gemini ${context} response did not match the expected schema:`, result.error.flatten())
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

app.disable('x-powered-by')
app.use(express.json({ limit: '32kb', strict: true }))
app.get('/api/ai/status', (_request, response) => {
  response.json({ configured: Boolean(process.env.GEMINI_API_KEY?.trim()), model })
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
  console.error(`Gemini ${context} request failed:`, error)
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
  console.error('Unhandled API error:', error)
  return response.status(500).json({ error: 'The HappiXO server encountered an unexpected error.' })
})

export function createVercelHandler(route) {
  return (request, response) => {
    const query = request.url?.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''
    request.url = `${route}${query}`
    return app(request, response)
  }
}

const host = process.env.HOST || '127.0.0.1'
if (process.env.VERCEL !== '1') {
  app.listen(port, host, () => {
    console.log(`HappiXO API listening on http://${host}:${port}; Gemini ${process.env.GEMINI_API_KEY?.trim() ? 'configured' : 'not configured (demo mode)'}.`)
  })
}
