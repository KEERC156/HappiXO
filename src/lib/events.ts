import type { EventPlan } from '../types'

const EVENT_REQUEST_TIMEOUT_MS = 20_000

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), EVENT_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `HappiXO event service failed (${response.status}).`
      throw new Error(message)
    }
    return payload as T
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(method === 'POST'
        ? 'Saving your event timed out. Your event details are still here; please retry.'
        : 'HappiXO event request timed out. Please retry.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function ensureUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : crypto.randomUUID()
}

export async function fetchEvents(): Promise<EventPlan[]> {
  const { events } = await request<{ events: EventPlan[] }>('/api/customer/events')
  return events
}

export async function saveEventPlan(event: EventPlan): Promise<string> {
  const eventId = ensureUuid(event.id)
  const { id } = await request<{ id: string }>('/api/customer/events', 'POST', { ...event, id: eventId })
  return id
}

export async function deleteSavedEvent(eventId: string) {
  await request(`/api/customer/events/${encodeURIComponent(eventId)}`, 'DELETE')
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
