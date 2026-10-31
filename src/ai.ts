export type EventInput = {
  name: string
  type: string
  date: string
  city: string
  budget: number
  guests: number
  theme: string
  food: string
  venue: string
  requirements: string
}

export type GeneratedPlan = {
  eventSummary: string
  theme: { name: string; description: string; colors: string[] }
  budget: { category: string; estimatedCost: number; reason: string }[]
  timeline: { task: string; daysBeforeEvent: number; priority: 'high' | 'medium' | 'low'; description: string }[]
  vendorChecklist: { category: string; estimatedCost: number; notes: string }[]
  foodSuggestions: string[]
  activities: string[]
  savingTips: string[]
  contingencyPlan: string[]
  costsAreEstimates?: boolean
}

export type ProposedChange = {
  field: 'budget' | 'guests' | 'theme' | 'food' | 'venue' | 'requirements'
  value: string | number
  reason: string
}

export type ChatRequest = {
  event: EventInput & {
    concept?: string
    expenses?: { name: string; planned: number; actual: number }[]
    vendors?: { category: string; status: string; notes: string }[]
  }
  history: { role: 'user' | 'assistant'; text: string }[]
  message: string
}

export type ChatResponse = {
  reply: string
  suggestedChanges: ProposedChange[]
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `HappiXO service request failed (${response.status}).`
    throw new Error(message)
  }
  return payload as T
}

export async function getAIStatus(): Promise<{ configured: boolean; model?: string }> {
  const response = await fetch('/api/ai/status')
  if (!response.ok) throw new Error('HappiXO service status is unavailable.')
  return response.json() as Promise<{ configured: boolean; model?: string }>
}

export function generateAIPlan(event: EventInput): Promise<GeneratedPlan> {
  return post('/api/ai/plan', { event })
}

export function askAI(request: ChatRequest): Promise<ChatResponse> {
  return post('/api/ai/chat', request)
}
