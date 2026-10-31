import type { GeneratedPlan } from '../ai'
import type { EventPlan, Expense, Task, Vendor } from '../types'
import { supabase } from './supabase'

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured. Add the public URL and publishable key to your environment.')
  return supabase
}

function ensureUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : crypto.randomUUID()
}

type EventRow = {
  id: string; name: string; event_type: EventPlan['type']; event_date: string; city: string
  budget: number; guests: number; theme: string; food: string; venue: string; requirements: string
  concept: string; created_at: string; updated_at: string
}
type ExpenseRow = { id: string; event_id: string; name: string; planned: number; actual: number; color: string }
type TaskRow = { id: string; event_id: string; name: string; description: string; due_date: string; priority: Task['priority']; status: Task['status'] }
type VendorRow = { id: string; event_id: string; category: string; estimated_cost: number; status: Vendor['status']; contact: string; notes: string }
type AiPlanRow = { event_id: string; plan: GeneratedPlan }

export async function fetchEvents(ownerId: string): Promise<EventPlan[]> {
  const client = requireSupabase()
  const { data: rows, error } = await client.from('events').select('*').eq('owner_id', ownerId).order('event_date')
  if (error) throw error
  const events = (rows ?? []) as EventRow[]
  if (!events.length) return []

  const eventIds = events.map((row) => row.id)
  const [expenseResult, taskResult, vendorResult, planResult] = await Promise.all([
    client.from('event_expenses').select('*').in('event_id', eventIds),
    client.from('event_tasks').select('*').in('event_id', eventIds),
    client.from('event_vendors').select('*').in('event_id', eventIds),
    client.from('ai_plans').select('event_id,plan').in('event_id', eventIds),
  ])
  for (const result of [expenseResult, taskResult, vendorResult, planResult]) {
    if (result.error) throw result.error
  }

  const expensesByEvent = new Map<string, Expense[]>()
  for (const row of (expenseResult.data ?? []) as ExpenseRow[]) {
    expensesByEvent.set(row.event_id, [...(expensesByEvent.get(row.event_id) ?? []), {
      id: row.id, name: row.name, planned: row.planned, actual: row.actual, color: row.color,
    }])
  }
  const tasksByEvent = new Map<string, Task[]>()
  for (const row of (taskResult.data ?? []) as TaskRow[]) {
    tasksByEvent.set(row.event_id, [...(tasksByEvent.get(row.event_id) ?? []), {
      id: row.id, name: row.name, description: row.description, dueDate: row.due_date, priority: row.priority, status: row.status,
    }])
  }
  const vendorsByEvent = new Map<string, Vendor[]>()
  for (const row of (vendorResult.data ?? []) as VendorRow[]) {
    vendorsByEvent.set(row.event_id, [...(vendorsByEvent.get(row.event_id) ?? []), {
      id: row.id, category: row.category, estimatedCost: row.estimated_cost, status: row.status, contact: row.contact, notes: row.notes,
    }])
  }
  const plansByEvent = new Map((planResult.data ?? [] as AiPlanRow[]).map((row) => [row.event_id, row.plan as GeneratedPlan]))

  return events.map((row) => ({
    id: row.id, name: row.name, type: row.event_type, date: row.event_date, city: row.city,
    budget: row.budget, guests: row.guests, theme: row.theme, food: row.food, venue: row.venue,
    requirements: row.requirements, concept: row.concept, created: row.created_at,
    expenses: expensesByEvent.get(row.id) ?? [], tasks: tasksByEvent.get(row.id) ?? [],
    vendors: vendorsByEvent.get(row.id) ?? [], generatedPlan: plansByEvent.get(row.id),
  }))
}

export async function saveEventPlan(ownerId: string, event: EventPlan): Promise<string> {
  const client = requireSupabase()
  const eventId = ensureUuid(event.id)
  const payload = {
    p_event: {
      id: eventId, owner_id: ownerId, name: event.name, event_type: event.type, event_date: event.date,
      city: event.city, budget: event.budget, guests: event.guests, theme: event.theme, food: event.food,
      venue: event.venue, requirements: event.requirements, concept: event.concept,
    },
    p_expenses: event.expenses.map((expense) => ({
      id: ensureUuid(expense.id), event_id: eventId, owner_id: ownerId, name: expense.name,
      planned: expense.planned, actual: expense.actual, color: expense.color,
    })),
    p_tasks: event.tasks.map((task) => ({
      id: ensureUuid(task.id), event_id: eventId, owner_id: ownerId, name: task.name,
      description: task.description, due_date: task.dueDate, priority: task.priority, status: task.status,
    })),
    p_vendors: event.vendors.map((vendor) => ({
      id: ensureUuid(vendor.id), event_id: eventId, owner_id: ownerId, category: vendor.category,
      estimated_cost: vendor.estimatedCost, status: vendor.status, contact: vendor.contact, notes: vendor.notes,
    })),
    p_ai_plan: event.generatedPlan
      ? { event_id: eventId, owner_id: ownerId, plan: event.generatedPlan, provider: 'gemini' }
      : null,
  }
  const { data, error } = await client.rpc('save_event_plan', payload)
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      throw new Error('The save_event_plan database function is missing. Apply the complete HappiXO Supabase migration, then retry.')
    }
    throw error
  }
  return typeof data === 'string' ? data : eventId
}

export async function deleteSavedEvent(eventId: string) {
  const client = requireSupabase()
  const { error } = await client.from('events').delete().eq('id', eventId)
  if (error) throw error
}

export function normalizeEventIds(event: EventPlan): EventPlan {
  return {
    ...event,
    id: ensureUuid(event.id),
    expenses: event.expenses.map((item) => ({ ...item, id: ensureUuid(item.id) })),
    tasks: event.tasks.map((item) => ({ ...item, id: ensureUuid(item.id) })),
    vendors: event.vendors.map((item) => ({ ...item, id: ensureUuid(item.id) })),
  }
}
