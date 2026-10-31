import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useScroll, useTransform, type MotionStyle } from 'framer-motion'
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, ArrowUpRight as OpenIcon,
  BriefcaseBusiness, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  Clock3, CloudSun, Compass, Download, Flower2, Heart, IndianRupee, Lightbulb, LogOut, MapPin,
  Menu, MessageCircle, MoreHorizontal, PartyPopper, Plus, Send, Settings2,
  Sparkles, Trash2, Users, Wallet, X, type LucideIcon,
} from 'lucide-react'
import { askAI, generateAIPlan, getAIStatus, type EventInput, type GeneratedPlan, type ProposedChange } from './ai'
import AuthPage from './AuthPage'
import { deleteSavedEvent, fetchEvents, normalizeEventIds, saveEventPlan } from './lib/events'
import { isSupabaseConfigured, supabase, supabaseConfigurationError } from './lib/supabase'
import type { User } from '@supabase/supabase-js'
import type { Category, EventPlan, Expense, Priority, Task, TaskStatus, Vendor, VendorStatus, WizardData } from './types'
import './App.css'

const BudgetDonut = lazy(() => import('./BudgetDonut'))

type Tab = 'Overview' | 'Budget' | 'Timeline' | 'Checklist' | 'Vendors' | 'HappiXO Copilot' | 'What-if' | 'Theme studio'
type SavingsProposal = {
  targetSavings: number
  targetBudget: number
  changes: { expenseId: string; name: string; from: number; to: number; saving: number }[]
  shortfall: number
}
type ChatMessage = {
  role: 'assistant' | 'user'; text: string
  suggestion?: { type: 'budget' | 'guests' | 'theme'; value: number | string }
  changes?: ProposedChange[]
  savingsProposal?: SavingsProposal
}
type EventDetailsDraft = Pick<EventPlan, 'name' | 'type' | 'date' | 'city' | 'budget' | 'guests' | 'theme' | 'food' | 'venue' | 'requirements'>

function logDatabaseError(message: string, error: unknown) {
  if (import.meta.env.DEV) console.error(message, error)
}

function proposeSavings(event: EventPlan, targetSavings: number, targetBudget = event.budget): SavingsProposal {
  const priority = (name: string) => {
    const lower = name.toLowerCase()
    if (/decor|flower|floral|invitation|extra|favor|entertainment|music/.test(lower)) return 0
    if (/photo|video|transport|rentals|setup/.test(lower)) return 1
    if (/venue|food|cater|meal|emergency|reserve/.test(lower)) return 2
    return 1
  }
  let remaining = Math.max(0, Math.round(targetSavings / 100) * 100)
  const changes: SavingsProposal['changes'] = []
  const expenses = [...event.expenses].sort((a, b) => priority(a.name) - priority(b.name))
  for (const expense of expenses) {
    if (remaining <= 0 || /emergency|reserve/i.test(expense.name)) continue
    const reducible = Math.max(0, expense.planned - expense.actual)
    const limit = Math.floor(Math.min(reducible, expense.planned * .2) / 100) * 100
    const saving = Math.min(limit, Math.ceil(remaining / 100) * 100)
    if (saving <= 0) continue
    changes.push({ expenseId: expense.id, name: expense.name, from: expense.planned, to: expense.planned - saving, saving })
    remaining -= saving
  }
  return {
    targetSavings: Math.max(0, Math.round(targetSavings / 100) * 100) - Math.max(0, remaining),
    targetBudget: Math.max(10_000, targetBudget < event.budget
      ? event.budget - (Math.max(0, Math.round(targetSavings / 100) * 100) - Math.max(0, remaining))
      : targetBudget),
    changes,
    shortfall: Math.max(0, remaining),
  }
}

function toGeneratedEvent(input: WizardData, plan: GeneratedPlan): EventPlan {
  const total = plan.budget.reduce((sum, item) => sum + Math.max(0, item.estimatedCost), 0)
  const scale = total > input.budget ? input.budget / total : 1
  const expenses = plan.budget.map((item, index) => ({
    id: id(),
    name: item.category,
    planned: Math.floor(Math.max(0, item.estimatedCost) * scale / 100) * 100,
    actual: 0,
    color: palette[index % palette.length],
  }))
  const tasks = plan.timeline.map((item) => ({
    id: id(),
    name: item.task,
    description: item.description,
    dueDate: addDays(input.date, -item.daysBeforeEvent),
    priority: (item.priority[0].toUpperCase() + item.priority.slice(1)) as Priority,
    status: 'To do' as TaskStatus,
  }))
  const vendors = makeVendorChecklist(plan.vendorChecklist)
  return {
    id: id(),
    ...input,
    theme: plan.theme.name,
    concept: plan.eventSummary,
    expenses: expenses.length ? expenses : makeExpenses(input.budget),
    tasks: tasks.length ? tasks : makeTasks(input.date),
    vendors,
    created: new Date().toISOString(),
    generatedPlan: plan,
  }
}

const STORAGE_KEY = 'happixo-event-plan-v1'
const PENDING_EVENT_KEY = 'happixo-pending-event-v1'
const TODAY_DATE = new Date().toISOString().slice(0, 10)
const MAX_EVENT_BUDGET = 1_000_000_000
const MAX_EVENT_GUESTS = 100_000
const boundedAmount = (value: number) => Math.min(MAX_EVENT_BUDGET, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))
const palette = ['#7654a3', '#c88d83', '#b89a60', '#748e7d', '#ab91be', '#d5a984']
const formatINR = (value: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format(Number.isFinite(value) ? value : 0)
const signedINR = (value: number) => `${value > 0 ? '+' : ''}${formatINR(value)}`
const themeEstimate = (theme: string) => ({
  'Saffron garden soirée': 14000,
  'Moonlit lavender': 18000,
  'Coastal colour story': 12000,
  'Modern ivory & gold': 24000,
}[theme] ?? 0)
const venueEstimate = (venue: string) => venue === 'Indoor' ? 18000 : venue === 'Outdoor' ? 0 : 9000
const dateLabel = (value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  value ? new Intl.DateTimeFormat('en-IN', options).format(new Date(`${value}T12:00:00`)) : 'Date to be decided'
const dayDiff = (value: string) => Math.ceil((new Date(`${value}T23:59:59`).getTime() - Date.now()) / 86400000)
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}
const id = () => crypto.randomUUID()

function makeTasks(eventDate: string): Task[] {
  return [
    { id: id(), name: 'Shortlist and book your venue', description: 'Compare availability, capacity and inclusions.', dueDate: addDays(eventDate, -55), priority: 'High', status: 'In progress' },
    { id: id(), name: 'Confirm guest list', description: 'Share invitations and keep track of RSVPs.', dueDate: addDays(eventDate, -35), priority: 'High', status: 'To do' },
    { id: id(), name: 'Book catering and finalize menu', description: 'Confirm dietary preferences and tasting.', dueDate: addDays(eventDate, -25), priority: 'High', status: 'To do' },
    { id: id(), name: 'Confirm decor and florals', description: 'Share the mood board with your decorator.', dueDate: addDays(eventDate, -18), priority: 'Medium', status: 'To do' },
    { id: id(), name: 'Send final vendor run sheet', description: 'Share arrival times and contact details.', dueDate: addDays(eventDate, -5), priority: 'Medium', status: 'To do' },
    { id: id(), name: 'Pick up final essentials', description: 'Pack favors, signage and personal touches.', dueDate: addDays(eventDate, -1), priority: 'Low', status: 'To do' },
  ]
}
function makeExpenses(budget: number): Expense[] {
  const rows = [
    ['Venue & setup', .28], ['Food & drinks', .30], ['Decor & flowers', .16],
    ['Photography', .10], ['Music & entertainment', .08], ['Invitations & extras', .04],
  ] as const
  return rows.map(([name, share], index) => ({
    id: id(), name, planned: Math.round(budget * share / 100) * 100,
    actual: index === 0 ? Math.round(budget * share * .75 / 100) * 100 : 0, color: palette[index],
  }))
}
function makeVendorChecklist(suggestions?: GeneratedPlan['vendorChecklist']): Vendor[] {
  const categories = suggestions?.length
    ? suggestions
    : [
      { category: 'Venue', estimatedCost: 0, notes: 'Compare availability, capacity and included setup.' },
      { category: 'Catering', estimatedCost: 0, notes: 'Confirm menu, dietary needs and service.' },
      { category: 'Decor & florals', estimatedCost: 0, notes: 'Review styling, setup time and reuse options.' },
      { category: 'Photography', estimatedCost: 0, notes: 'Check coverage, deliverables and schedule.' },
      { category: 'Music & entertainment', estimatedCost: 0, notes: 'Confirm equipment, sound check and run time.' },
    ]
  return categories.map((item) => ({
    id: id(),
    category: item.category,
    estimatedCost: boundedAmount(item.estimatedCost),
    status: 'To do',
    contact: '',
    notes: item.notes,
  }))
}
function makeEvent(input: WizardData): EventPlan {
  const expenses = makeExpenses(input.budget)
  return {
    id: id(),
    ...input,
    concept: `${input.theme || 'A little magic'} comes to life in ${input.city || 'your city'}: a thoughtful ${input.type.toLowerCase()} for ${input.guests} guests, with meaningful details, welcoming food and room to celebrate.`,
    expenses, tasks: makeTasks(input.date), vendors: makeVendorChecklist(), created: new Date().toISOString(),
  }
}
function sampleEvent(): EventPlan {
  const date = '2026-12-12'
  return makeEvent({
    name: 'Aarav & Mira’s Celebration', type: 'Wedding', date, city: 'Jaipur',
    budget: 850000, guests: 120, theme: 'Saffron garden soirée', food: 'Vegetarian + vegan options',
    venue: 'Outdoor', requirements: 'Live acoustic music, accessible seating, and a kids’ corner',
  })
}
function readSavedEvent(): EventPlan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return sampleEvent()
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'name' in parsed && 'expenses' in parsed && 'tasks' in parsed) {
      const saved = parsed as Partial<EventPlan> & Pick<EventPlan, 'name' | 'expenses' | 'tasks'>
      return normalizeEventIds({
        ...saved,
        id: saved.id || id(),
        type: saved.type ?? 'Other',
        date: saved.date ?? TODAY_DATE,
        city: saved.city ?? '',
        budget: saved.budget ?? 300000,
        guests: saved.guests ?? 80,
        theme: saved.theme ?? '',
        food: saved.food ?? '',
        venue: saved.venue ?? '',
        requirements: saved.requirements ?? '',
        concept: saved.concept ?? '',
        expenses: saved.expenses ?? [],
        tasks: saved.tasks ?? [],
        vendors: Array.isArray(saved.vendors) ? saved.vendors : makeVendorChecklist(saved.generatedPlan?.vendorChecklist),
        created: saved.created ?? new Date().toISOString(),
      })
    }
  } catch (error) {
    console.warn('Could not load the saved HappiXO plan; opening the sample plan instead.', error)
  }
  return sampleEvent()
}

function readPendingEvent(): EventPlan | null {
  try {
    const raw = localStorage.getItem(PENDING_EVENT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const saved = parsed as Partial<EventPlan>
    if (
      typeof saved.name !== 'string' || typeof saved.type !== 'string' ||
      typeof saved.date !== 'string' || typeof saved.city !== 'string' ||
      typeof saved.budget !== 'number' || typeof saved.guests !== 'number' ||
      !Array.isArray(saved.expenses) || !Array.isArray(saved.tasks) ||
      !Array.isArray(saved.vendors)
    ) return null
    return normalizeEventIds({
      ...saved,
      id: typeof saved.id === 'string' ? saved.id : id(),
      name: saved.name,
      type: saved.type as Category,
      date: saved.date,
      city: saved.city,
      budget: saved.budget,
      guests: saved.guests,
      theme: saved.theme ?? '',
      food: saved.food ?? '',
      venue: saved.venue ?? '',
      requirements: saved.requirements ?? '',
      concept: saved.concept ?? '',
      created: saved.created ?? new Date().toISOString(),
      expenses: saved.expenses,
      tasks: saved.tasks,
      vendors: saved.vendors,
    })
  } catch (error) {
    console.warn('Could not restore a pending HappiXO event for account saving.', error)
    return null
  }
}

function storePendingEvent(event: EventPlan): boolean {
  try {
    localStorage.setItem(PENDING_EVENT_KEY, JSON.stringify(event))
    return true
  } catch (error) {
    console.error('Could not preserve the generated event while awaiting account sign-in.', error)
    return false
  }
}

function clearPendingEvent() {
  try {
    localStorage.removeItem(PENDING_EVENT_KEY)
  } catch (error) {
    console.warn('The event was saved, but the temporary browser copy could not be cleared.', error)
  }
}

function readLocalPlanForImport(): EventPlan | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !('name' in parsed) ||
      !('expenses' in parsed) || !Array.isArray(parsed.expenses) ||
      !('tasks' in parsed) || !Array.isArray(parsed.tasks)) return null
    return readSavedEvent()
  } catch (error) {
    console.warn('Could not inspect the existing browser plan for account import.', error)
    return null
  }
}

const categoryCards: { name: Exclude<Category, 'Other'>; icon: LucideIcon; note: string; description: string }[] = [
  { name: 'Wedding', icon: Heart, note: 'The day that feels like you', description: 'A once-in-a-lifetime day, shaped around your story.' },
  { name: 'Birthday', icon: PartyPopper, note: 'Another year, more magic', description: 'Good people, candlelight and a reason to celebrate.' },
  { name: 'College event', icon: Sparkles, note: 'Make campus unforgettable', description: 'Big energy, brilliant stages and memories for the group chat.' },
  { name: 'Community gathering', icon: Flower2, note: 'Bring your people together', description: 'A warm, welcoming celebration for the people around you.' },
]
const themeOptions = [
  { name: 'Saffron garden soirée', desc: 'Warm marigolds, candlelight and lush greens.', colors: ['#d68b37', '#d9aa51', '#73886a'], decor: 'Brass lamps, marigold strings, low floral centerpieces', food: 'Seasonal vegetarian thalis, kulfi bar', activity: 'Live folk trio and a flower-wrapping corner' },
  { name: 'Moonlit lavender', desc: 'Soft lilac, silver details and a little starlight.', colors: ['#9c89be', '#d6c8e5', '#b8b7c9'], decor: 'Draped lilac fabric, glass votives, baby’s breath', food: 'Small plates, lavender lemonade, petite desserts', activity: 'Acoustic set and a wish-making station' },
  { name: 'Coastal colour story', desc: 'Easygoing blues, coral and sun-washed details.', colors: ['#508e9b', '#e68d7a', '#e3c98c'], decor: 'Hand-painted signage, tropical leaves, woven textures', food: 'Fresh chaat, coconut treats, bright mocktails', activity: 'Polaroid guestbook and lawn games' },
  { name: 'Modern ivory & gold', desc: 'Quietly luxe neutrals with champagne accents.', colors: ['#f2ede2', '#c3a66b', '#837666'], decor: 'Ivory linens, sculptural greenery, gold candleholders', food: 'Family-style sharing menu, elegant petit fours', activity: 'Jazz quartet and a memorable toast' },
]
const navItems: { name: Tab; icon: LucideIcon }[] = [
  { name: 'Overview', icon: Compass }, { name: 'Budget', icon: Wallet }, { name: 'Timeline', icon: CalendarDays },
  { name: 'Checklist', icon: CheckCircle2 }, { name: 'Vendors', icon: BriefcaseBusiness }, { name: 'HappiXO Copilot', icon: MessageCircle },
  { name: 'What-if', icon: Settings2 }, { name: 'Theme studio', icon: Flower2 },
]

function App() {
  const [event, setEvent] = useState<EventPlan>(readSavedEvent)
  const [page, setPage] = useState<'landing' | 'wizard' | 'auth' | 'events' | 'dashboard'>('landing')
  const [user, setUser] = useState<User | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'update'>('login')
  const [authReady, setAuthReady] = useState(!supabase)
  const [profileName, setProfileName] = useState('')
  const [cloudEvents, setCloudEvents] = useState<EventPlan[]>([])
  const [cloudLoaded, setCloudLoaded] = useState(false)
  const [cloudLoading, setCloudLoading] = useState(false)
  const [cloudSaving, setCloudSaving] = useState(false)
  const [cloudSaved, setCloudSaved] = useState(false)
  const [cloudSaveError, setCloudSaveError] = useState('')
  const [cloudError, setCloudError] = useState('')
  const [cloudReload, setCloudReload] = useState(0)
  const [pendingEvent, setPendingEvent] = useState<EventPlan | null>(readPendingEvent)
  const [pendingEventRetry, setPendingEventRetry] = useState(0)
  const [pendingEventError, setPendingEventError] = useState('')
  const [localPlanToImport] = useState<EventPlan | null>(readLocalPlanForImport)
  const [localImportDone, setLocalImportDone] = useState(false)
  const [profilePhone, setProfilePhone] = useState('')
  const [tab, setTab] = useState<Tab>('Overview')
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')
  const [isPrintingPlan, setIsPrintingPlan] = useState(false)
  const [aiConfigured, setAIConfigured] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [wizard, setWizard] = useState<WizardData>({
    name: '', type: 'Wedding', date: '', city: '', budget: 300000, guests: 80,
    theme: '', food: 'Vegetarian', venue: 'Outdoor', requirements: '',
  })
  const [step, setStep] = useState(0)
  const [naturalText, setNaturalText] = useState('')
  const [taskFilter, setTaskFilter] = useState<'All' | TaskStatus>('All')
  const [newTask, setNewTask] = useState('')
  const [chat, setChat] = useState<ChatMessage[]>([
    { role: 'assistant', text: 'Hi! I’m your HappiXO planning companion. Ask me about your budget, guest list, menu or theme. I’ll suggest changes first, and you decide what to apply.' },
  ])
  const [question, setQuestion] = useState('')
  const [simBudget, setSimBudget] = useState(event.budget)
  const [simGuests, setSimGuests] = useState(event.guests)
  const [simVenue, setSimVenue] = useState(event.venue)
  const [simTheme, setSimTheme] = useState(event.theme)
  const [simWeather, setSimWeather] = useState(false)

  useEffect(() => {
    if (!supabase) {
      return
    }
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((authEvent, session) => {
      if (!active) return
      setUser(session?.user ?? null)
      setAuthReady(true)
      if (!session?.user) {
        setCloudLoaded(false)
        setCloudLoading(false)
        setCloudEvents([])
        setCloudSaved(false)
        setCloudError('')
        setCloudSaveError('')
        setProfileName('')
        setProfilePhone('')
        setLocalImportDone(false)
      } else if (authEvent !== 'TOKEN_REFRESHED') {
        setCloudLoading(true)
        setCloudLoaded(false)
        setCloudError('')
      }
      if (authEvent === 'PASSWORD_RECOVERY') {
        setAuthMode('update')
        setPage('auth')
        return
      }
      if (authEvent === 'SIGNED_IN') setAuthMode('login')
      if (session?.user) setPage((current) => current === 'auth' ? 'events' : current)
      else if (isSupabaseConfigured) setPage((current) => current === 'dashboard' || current === 'events' ? 'auth' : current)
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        logDatabaseError('Could not restore the HappiXO sign-in session.', error)
        setToast('Could not restore your sign-in session. Please sign in again.')
      }
      setUser(data.session?.user ?? null)
      setAuthReady(true)
      if (data.session?.user) setCloudLoading(true)
      if (window.location.hash.includes('type=recovery')) {
        setAuthMode('update')
        setPage('auth')
      } else if (data.session?.user) setPage('events')
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const userId = user?.id
  const userName = user?.user_metadata.full_name
  useEffect(() => {
    if (!userId || !supabase) return
    let active = true
    void Promise.all([
      fetchEvents(userId),
      supabase.from('profiles').select('full_name,phone').eq('id', userId).maybeSingle(),
    ]).then(([savedEvents, profileResult]) => {
      if (!active) return
      if (profileResult.error) throw profileResult.error
      if (!profileResult.data) {
        throw new Error('Your customer profile is missing. Apply the HappiXO Supabase migration and try again.')
      }
      setCloudEvents(savedEvents)
      setProfileName(profileResult.data?.full_name || String(userName ?? 'HappiXO customer'))
      setProfilePhone(profileResult.data?.phone ?? '')
      setLocalImportDone(localStorage.getItem(`happixo-imported-${userId}`) === 'true')
      if (savedEvents.length) {
        setEvent(savedEvents[0])
        setSimBudget(savedEvents[0].budget)
        setSimGuests(savedEvents[0].guests)
        setSimVenue(savedEvents[0].venue)
        setSimTheme(savedEvents[0].theme)
      }
      setCloudSaved(savedEvents.length > 0)
      setCloudLoaded(true)
    }).catch((error: unknown) => {
      if (!active) return
      logDatabaseError('Could not load the customer’s HappiXO data.', error)
      const message = error instanceof Error ? error.message : 'Could not load your saved events.'
      setCloudError(message)
      setToast(`Could not load your saved events: ${message}`)
    }).finally(() => {
      if (active) setCloudLoading(false)
    })
    return () => { active = false }
  }, [userId, userName, cloudReload])

  useEffect(() => {
    if (isSupabaseConfigured) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(event)) }
    catch (error) { console.error('Unable to save the HappiXO event in this browser.', error); window.setTimeout(() => setToast('Could not save changes in this browser.'), 0) }
  }, [event])
  useEffect(() => {
    if (!user || !cloudLoaded || !supabase || page !== 'dashboard') return
    let active = true
    const timer = window.setTimeout(() => {
      setCloudSaving(true)
      setCloudSaved(false)
      setCloudSaveError('')
      void saveEventPlan(user.id, event).then(async (savedId) => {
        if (!active) return
        setCloudSaved(true)
        if (savedId !== event.id) setEvent((current) => current.id === event.id ? { ...current, id: savedId } : current)
        try {
          const savedEvents = await fetchEvents(user.id)
          if (!active) return
          setCloudEvents(savedEvents)
          setCloudSaveError('')
        } catch (error) {
          if (!active) return
          logDatabaseError('The event was saved, but the event list could not be refreshed.', error)
          const message = error instanceof Error ? error.message : 'Please reopen My Events to refresh.'
          setCloudSaveError(`Saved, but refresh failed: ${message}`)
          setToast(`Your event was saved, but HappiXO could not refresh the event list: ${message}`)
        }
      }).catch((error: unknown) => {
        if (!active) return
        logDatabaseError('Could not save this HappiXO event to Supabase.', error)
        const message = error instanceof Error ? error.message : 'Could not save your event to your account.'
        setCloudSaved(false)
        setCloudSaveError(message)
        setToast(`Could not save your event: ${message}`)
      }).finally(() => {
        if (active) setCloudSaving(false)
      })
    }, 650)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [event, user, cloudLoaded, page])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (!isPrintingPlan) return
    const handleAfterPrint = () => setIsPrintingPlan(false)
    window.addEventListener('afterprint', handleAfterPrint)
    const frame = window.requestAnimationFrame(() => window.print())
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('afterprint', handleAfterPrint)
    }
  }, [isPrintingPlan])
  useEffect(() => {
    let active = true
    getAIStatus().then((status) => {
      if (active) setAIConfigured(status.configured)
    }).catch((error: unknown) => {
      console.info('HappiXO is using the local demo assistant because its API is unavailable.', error)
      if (active) setAIConfigured(false)
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!user || !cloudLoaded || !pendingEvent) return
    let active = true
    const newEvent = normalizeEventIds(pendingEvent)
    void saveEventPlan(user.id, newEvent).then(async (savedId) => {
      if (!active) return
      const savedEvents = await fetchEvents(user.id)
      if (!active) return
      const savedEvent = savedEvents.find((item) => item.id === savedId) ?? { ...newEvent, id: savedId }
      setCloudEvents(savedEvents)
      setEvent(savedEvent)
      setPendingEvent(null)
      clearPendingEvent()
      setPendingEventError('')
      setCloudSaved(true)
      setSimBudget(savedEvent.budget)
      setSimGuests(savedEvent.guests)
      setSimVenue(savedEvent.venue)
      setSimTheme(savedEvent.theme)
      setPage('dashboard')
      setToast('Your event is saved to your HappiXO account.')
    }).catch((error: unknown) => {
      if (!active) return
      logDatabaseError('Could not save your newly created event.', error)
      const message = error instanceof Error ? error.message : 'Could not save your event to your account.'
      setPendingEventError(message)
      setPage('events')
      setToast(`Could not save your event: ${message}`)
    })
    return () => { active = false }
  }, [user, cloudLoaded, pendingEvent, pendingEventRetry])

  const planned = event.expenses.reduce((sum, row) => sum + row.planned, 0)
  const spent = event.expenses.reduce((sum, row) => sum + row.actual, 0)
  const remaining = event.budget - spent
  const utilization = event.budget ? Math.round(spent / event.budget * 100) : 0
  const completed = event.tasks.filter((task) => task.status === 'Done').length
  const progress = event.tasks.length ? Math.round(completed / event.tasks.length * 100) : 0
  const upcoming = [...event.tasks].filter((task) => task.status !== 'Done').sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3)
  const chartData = event.expenses.map((row) => ({ name: row.name, value: row.planned, color: row.color }))
  const simCost = useMemo(() => {
    const guestImpact = (simGuests - event.guests) * 1200
    const venueImpact = venueEstimate(simVenue) - venueEstimate(event.venue)
    const themeImpact = themeEstimate(simTheme) - themeEstimate(event.theme)
    const weatherAlreadyIncluded = event.expenses.some((expense) => /weather contingency|weather backup/i.test(expense.name) && expense.planned > 0)
    const weatherImpact = simWeather && !weatherAlreadyIncluded ? 22000 : 0
    const planned = event.expenses.reduce((sum, expense) => sum + expense.planned, 0)
    const proposedSavings = simBudget < event.budget
      ? proposeSavings(event, event.budget - simBudget, simBudget).targetSavings
      : 0
    return Math.max(0, planned + guestImpact + venueImpact + themeImpact + weatherImpact - proposedSavings)
  }, [event, simBudget, simGuests, simVenue, simTheme, simWeather])

  const updateEvent = (update: Partial<EventPlan>) => {
    if (user) {
      setCloudSaved(false)
      setCloudSaveError('')
    }
    const normalizedUpdate = { ...update }
    if (typeof normalizedUpdate.budget === 'number') {
      normalizedUpdate.budget = Math.min(MAX_EVENT_BUDGET, Math.max(10_000, Math.round(normalizedUpdate.budget)))
      setSimBudget(normalizedUpdate.budget)
    }
    if (typeof normalizedUpdate.guests === 'number') {
      normalizedUpdate.guests = Math.min(MAX_EVENT_GUESTS, Math.max(1, Math.round(normalizedUpdate.guests)))
      setSimGuests(normalizedUpdate.guests)
    }
    if (typeof normalizedUpdate.venue === 'string') setSimVenue(normalizedUpdate.venue)
    if (typeof normalizedUpdate.theme === 'string') setSimTheme(normalizedUpdate.theme)
    setEvent((current) => ({ ...current, ...normalizedUpdate }))
  }
  const saveEventDetails = (details: EventDetailsDraft) => {
    updateEvent(details)
    setToast(user ? 'Event details updated. Saving to your account…' : 'Event details updated.')
  }
  const updateExpense = (expenseId: string, key: 'planned' | 'actual' | 'name', value: string | number) => {
    if (user) setCloudSaved(false)
    const normalized = key === 'name' ? value : boundedAmount(Number(value))
    setEvent((current) => ({ ...current, expenses: current.expenses.map((row) => row.id === expenseId ? { ...row, [key]: normalized } : row) }))
  }
  const updateTask = (taskId: string, update: Partial<Task>) => {
    if (user) setCloudSaved(false)
    setEvent((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, ...update } : task) }))
  }
  const updateVendor = (vendorId: string, update: Partial<Vendor>) => {
    if (user) setCloudSaved(false)
    setEvent((current) => ({ ...current, vendors: current.vendors.map((vendor) => vendor.id === vendorId ? { ...vendor, ...update } : vendor) }))
  }
  const addVendor = () => {
    if (user) setCloudSaved(false)
    setEvent((current) => ({
      ...current,
      vendors: [...current.vendors, { id: id(), category: 'New vendor', estimatedCost: 0, status: 'To do', contact: '', notes: '' }],
    }))
  }
  const openWorkspace = () => {
    if (user) setPage('events')
    else if (isSupabaseConfigured) setPage('auth')
    else setPage('dashboard')
  }
  const openSavedEvent = (savedEvent: EventPlan) => {
    setEvent(savedEvent)
    setCloudSaved(true)
    setSimBudget(savedEvent.budget)
    setSimGuests(savedEvent.guests)
    setSimVenue(savedEvent.venue)
    setSimTheme(savedEvent.theme)
    setTab('Overview')
    setPage('dashboard')
  }
  const signOut = async () => {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) {
      setToast(`Could not sign out: ${error.message}`)
      return
    }
    setUser(null)
    setPage('landing')
  }
  const saveProfile = async (fullName: string, phone: string) => {
    if (!user || !supabase) throw new Error('Sign in with a configured Supabase account to update your profile.')
    const { data, error } = await supabase.from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq('id', user.id)
      .select('full_name,phone')
      .single()
    if (error) throw error
    setProfileName(data.full_name)
    setProfilePhone(data.phone ?? '')
    setToast('Your profile was updated in Supabase.')
  }
  const importLocalEvent = async () => {
    if (!user || !localPlanToImport || !supabase) return
    const imported = normalizeEventIds(localPlanToImport)
    try {
      const savedId = await saveEventPlan(user.id, imported)
      const savedEvents = await fetchEvents(user.id)
      const savedEvent = savedEvents.find((item) => item.id === savedId) ?? { ...imported, id: savedId }
      try { localStorage.setItem(`happixo-imported-${user.id}`, 'true') }
      catch (error) { console.warn('Could not remember that the browser plan was imported.', error) }
      setLocalImportDone(true)
      setCloudEvents(savedEvents)
      openSavedEvent(savedEvent)
      setToast('Your existing browser plan was imported. The original local copy remains available.')
    } catch (error) {
      logDatabaseError('Could not import the existing browser plan.', error)
      setToast(error instanceof Error ? `Could not import your plan: ${error.message}` : 'Could not import your existing plan.')
    }
  }
  const removeSavedEvent = async (savedEvent: EventPlan) => {
    if (!user || !window.confirm(`Delete “${savedEvent.name}” and its saved budget, tasks, vendor list and recommendations? This cannot be undone.`)) return
    try {
      await deleteSavedEvent(savedEvent.id)
      const remainingEvents = await fetchEvents(user.id)
      setCloudEvents(remainingEvents)
      setCloudSaved(remainingEvents.length > 0)
      if (event.id === savedEvent.id) setPage('events')
      setToast('The event and its related planning data were deleted.')
    } catch (error) {
      logDatabaseError('Could not delete the saved event.', error)
      setToast(error instanceof Error ? `Could not delete the event: ${error.message}` : 'Could not delete the saved event.')
    }
  }
  const startWizard = (type?: Category) => {
    setWizard((current) => ({ ...current, ...(type ? { type } : {}) }))
    setStep(0); setPage('wizard'); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const generatePlan = async () => {
    const data = { ...wizard }
    if (naturalText.trim()) {
      const text = naturalText.trim()
      data.requirements = [data.requirements, `Additional event description: ${text}`].filter(Boolean).join('\n')
      const guestMatch = text.match(/(\d{1,4})\s*(?:guests?|people|friends)/i)
      const budgetMatch = text.match(/(?:₹|rs\.?\s*|budget(?:\s+of)?\s*)([\d,]+(?:\.\d+)?)\s*(lakh|lacs?|k|thousand)?/i)
      if (guestMatch) data.guests = Math.min(MAX_EVENT_GUESTS, Number(guestMatch[1]))
      if (budgetMatch) {
        const base = Number(budgetMatch[1].replaceAll(',', ''))
        const unit = budgetMatch[2]?.toLowerCase()
        const multiplier = unit === 'lakh' || unit === 'lac' || unit === 'lacs' ? 100000 : unit === 'k' || unit === 'thousand' ? 1000 : 1
        const parsedBudget = Math.round(base * multiplier)
        if (parsedBudget >= 10000 && parsedBudget <= MAX_EVENT_BUDGET) data.budget = parsedBudget
        else if (parsedBudget > MAX_EVENT_BUDGET) setToast('That budget is above the demo planning limit. Keeping your form budget instead.')
      }
      if (!data.name) data.name = text.length > 42 ? `${data.type} celebration` : text
    }
    setIsGenerating(true)
    let configured = aiConfigured
    if (!configured) {
      try {
        configured = (await getAIStatus()).configured
        setAIConfigured(configured)
      } catch {
        configured = false
      }
    }
    if (configured) {
      try {
        const generated = await generateAIPlan(data as EventInput)
        const generatedEvent = normalizeEventIds(toGeneratedEvent(data, generated))
        if (user) setCloudSaved(false)
        setEvent(generatedEvent)
        setSimBudget(data.budget); setSimGuests(data.guests); setSimVenue(data.venue); setSimTheme(generated.theme.name); setSimWeather(false)
        setTab('Overview')
        if (isSupabaseConfigured && !user) {
          const preserved = storePendingEvent(generatedEvent)
          setPendingEvent(generatedEvent)
          setPage('auth')
          setToast(preserved
            ? 'Sign in or create an account to save this event and its HappiXO recommendations.'
            : 'Sign in to save this event. Keep this page open while you complete account setup.')
        } else {
          setPage('dashboard')
          setToast(user ? 'Your Gemini plan is ready and is being saved to your account.' : 'Your Gemini plan is ready in browser demo mode.')
        }
        setIsGenerating(false)
        return
      } catch (error) {
        console.error('Gemini plan generation failed; using the local demo planner.', error)
        setAIConfigured(false)
        setToast(error instanceof Error ? `${error.message} A local demo plan is ready instead.` : 'Gemini is unavailable. A local demo plan is ready instead.')
      }
    } else {
      setToast('Gemini is not configured. Your plan is generated locally in demo mode.')
    }
    const localEvent = normalizeEventIds(makeEvent(data))
    if (user) setCloudSaved(false)
    setEvent(localEvent)
    setSimBudget(data.budget); setSimGuests(data.guests); setSimVenue(data.venue); setSimTheme(data.theme); setSimWeather(false)
    setTab('Overview')
    if (isSupabaseConfigured && !user) {
      const preserved = storePendingEvent(localEvent)
      setPendingEvent(localEvent)
      setPage('auth')
      setToast(preserved
        ? 'Sign in or create an account to save this event to your account.'
        : 'Sign in to save this event. Keep this page open while you complete account setup.')
    } else {
      setPage('dashboard')
      if (!user) setToast('This plan is in browser demo mode and is not saved to Supabase.')
    }
    setIsGenerating(false)
  }
  const nextWizard = () => {
    if (step === 0 && (!wizard.name.trim() || !wizard.date || wizard.date < TODAY_DATE)) { setToast('Add an event name and a date today or later to continue.'); return }
    if (step === 1 && (!wizard.city.trim() || wizard.budget < 10000 || wizard.budget > MAX_EVENT_BUDGET || wizard.guests < 1 || wizard.guests > MAX_EVENT_GUESTS)) { setToast('Add a location, a budget from ₹10,000 to ₹1,00,00,00,000, and 1–1,00,000 guests.'); return }
    setStep((current) => Math.min(2, current + 1))
  }
  const addExpense = () => {
    if (user) setCloudSaved(false)
    setEvent((current) => ({ ...current, expenses: [...current.expenses, { id: id(), name: 'New expense', planned: 0, actual: 0, color: palette[current.expenses.length % palette.length] }] }))
  }
  const addTask = (e: FormEvent) => {
    e.preventDefault()
    if (!newTask.trim()) return
    if (user) setCloudSaved(false)
    setEvent((current) => ({ ...current, tasks: [...current.tasks, { id: id(), name: newTask.trim(), description: 'Added to your event checklist.', dueDate: current.date, priority: 'Medium', status: 'To do' }] }))
    setNewTask('')
    setToast(user ? 'Task added. Saving to your account…' : 'Task added to your browser demo.')
  }
  const sendQuestion = async (e: FormEvent) => {
    e.preventDefault()
    const prompt = question.trim()
    if (!prompt || isChatLoading) return
    setQuestion('')
    setIsChatLoading(true)
    try {
    const budgetReductionRequest = /\b(reduce|cut|lower|decrease|save)\b.*\b(budget|expenses?|spending|costs?)\b|\b(budget|expenses?|spending|costs?)\b.*\b(reduce|cut|lower|decrease|save)\b/i.test(prompt)
    const reductionAmount = prompt.match(/(?:₹|rs\.?\s*)\s*([\d,]+)/i)?.[1] ?? prompt.match(/\bby\s+([\d,]+)/i)?.[1]
    const requestedSavings = budgetReductionRequest ? (reductionAmount ? Number(reductionAmount.replaceAll(',', '')) : Math.round(event.budget * .05)) : 0
    const reducesBudgetTarget = /\b(reduce|cut|lower|decrease)\b.*\bbudget\b|\bbudget\b.*\b(reduce|cut|lower|decrease)\b/i.test(prompt)
    const deterministicProposal = requestedSavings > 0
      ? proposeSavings(event, requestedSavings, reducesBudgetTarget ? Math.max(10_000, event.budget - requestedSavings) : event.budget)
      : undefined
    let configured = aiConfigured
    if (!configured) {
      try {
        configured = (await getAIStatus()).configured
        setAIConfigured(configured)
      } catch {
        configured = false
      }
    }
    if (configured) {
      try {
        const answer = await askAI({
          event: {
            name: event.name, type: event.type, date: event.date, city: event.city,
            budget: event.budget, guests: event.guests, theme: event.theme, food: event.food,
            venue: event.venue, requirements: event.requirements, concept: event.concept,
            expenses: event.expenses.map(({ name, planned, actual }) => ({ name, planned, actual })),
            vendors: event.vendors.map(({ category, status, notes }) => ({ category, status, notes })),
          },
          history: chat.slice(-10).map(({ role, text }) => ({ role, text })),
          message: prompt,
        })
        const budgetChange = answer.suggestedChanges.find((change) => change.field === 'budget' && typeof change.value === 'number')
        const savingsProposal = deterministicProposal ?? (budgetChange && Number(budgetChange.value) < event.budget
          ? proposeSavings(event, event.budget - Number(budgetChange.value), Number(budgetChange.value))
          : undefined)
        setChat((current) => [...current, { role: 'user', text: prompt }, {
          role: 'assistant',
          text: deterministicProposal ? `${answer.reply}\n\nThe requested reduction is calculated locally and broken into editable category changes below.` : answer.reply,
          changes: answer.suggestedChanges.filter((change) => change !== budgetChange),
          ...(savingsProposal ? { savingsProposal } : {}),
        }])
        return
      } catch (error) {
        console.error('Gemini copilot request failed; using local demo suggestions.', error)
        setAIConfigured(false)
        setToast(error instanceof Error ? `${error.message} Local suggestions are still available.` : 'Gemini is unavailable. Local suggestions are still available.')
      }
    }
    const lower = prompt.toLowerCase()
    let answer = `For ${event.name}, I’d start by keeping the guest experience simple and intentional. ${event.guests} guests are planned in ${event.city}, with ${formatINR(event.budget)} to work with. Want me to explore a budget or theme adjustment?`
    let suggestion: ChatMessage['suggestion']
    let savingsProposal: SavingsProposal | undefined
    if (/₹|budget|spend|cost|save|reduce/.test(lower)) {
      const amountText = prompt.match(/(?:₹|rs\.?\s*)\s*([\d,]+)/i)?.[1]?.replaceAll(',', '')
      const amount = amountText ? Number(amountText) : Math.round(event.budget * .05)
      const targetBudget = /reduce my budget|lower my budget|cut my budget/.test(lower)
        ? Math.max(10_000, event.budget - amount)
        : event.budget
      savingsProposal = proposeSavings(event, amount, targetBudget)
      answer = savingsProposal.changes.length
        ? `I found ${formatINR(savingsProposal.targetSavings)} in potential category reductions, starting with flexible decor, entertainment and extras before essentials. Review the itemized proposal below; nothing changes until you apply it.${savingsProposal.shortfall ? ` The requested ${formatINR(amount)} reduction may not be achievable without affecting essential categories.` : ''}`
        : `I couldn't find flexible planned costs to reduce without cutting into actual or essential expenses. You can edit categories in Budget or adjust the target budget manually.`
    } else if (/50 more|more guests|guest|invite/.test(lower)) {
      const count = Number(prompt.match(/\d+/)?.[0] ?? 50) + (/\bmore\b/.test(lower) ? event.guests : 0)
      suggestion = { type: 'guests', value: count }
      answer = `Planning for ${count} guests could add roughly ${formatINR(Math.max(0, count - event.guests) * 1200)} for food, seating and service. Check venue capacity before confirming. Apply the guest-count update below if it looks right.`
    } else if (/theme|traditional|south indian|decor/.test(lower)) {
      const newTheme = /south indian|traditional/.test(lower) ? 'Temple garden traditions' : 'Coastal colour story'
      suggestion = { type: 'theme', value: newTheme }
      answer = `Try “${newTheme}”: layer regional flowers, brass details and warm lighting, then keep the tables simple. Consider a banana-leaf inspired vegetarian menu with a filter coffee finish. This is a suggestion; it won’t apply until you choose below.`
    } else if (/vegetarian|menu|food/.test(lower)) {
      answer = `For ${event.food.toLowerCase()}, try a welcoming menu with a live chaat counter, seasonal mains, two clearly labelled vegan dishes, and a small dessert tasting. Ask your caterer to share allergen labels and portion sizes before you lock the menu.`
    } else if (/weather|rain|backup/.test(lower)) {
      answer = `Since your venue is ${event.venue.toLowerCase()}, ask about a covered alternate space, a tent quote and a vendor-access plan. I’ve included a weather-backup estimate in What-if so you can compare options without changing your plan.`
    }
    setChat((current) => [...current, { role: 'user', text: prompt }, { role: 'assistant', text: answer, suggestion, savingsProposal }])
    } finally {
      setIsChatLoading(false)
    }
  }
  const applySavingsProposal = (proposal: SavingsProposal) => {
    const changes = new Map(proposal.changes.map((change) => [change.expenseId, change.to]))
    updateEvent({
      budget: proposal.targetBudget,
      expenses: event.expenses.map((expense) => changes.has(expense.id) ? { ...expense, planned: changes.get(expense.id)! } : expense),
    })
    setToast(user ? 'Changes applied. Saving to your account…' : 'Changes applied to your browser demo.')
  }
  const applyChange = (change: ProposedChange) => {
    if (change.field === 'budget') {
      const targetBudget = Number(change.value)
      if (targetBudget > event.budget) {
        updateEvent({ budget: targetBudget })
        setToast(user ? 'Changes applied. Saving to your account…' : 'Changes applied to your browser demo.')
        return
      }
      const proposal = proposeSavings(event, event.budget - targetBudget, targetBudget)
      if (proposal.changes.length) applySavingsProposal(proposal)
      else setToast('Could not find flexible categories to reduce. Nothing was changed.')
      return
    }
    if (change.field === 'guests') updateEvent({ guests: Number(change.value) })
    else if (change.field === 'theme') updateEvent({ theme: String(change.value) })
    else if (change.field === 'food') updateEvent({ food: String(change.value) })
    else if (change.field === 'venue') updateEvent({ venue: String(change.value) })
    else updateEvent({ requirements: String(change.value) })
    setToast(user ? 'Changes applied. Saving to your account…' : 'Changes applied to your browser demo.')
  }
  const applySuggestion = (suggestion: NonNullable<ChatMessage['suggestion']>) => {
    if (suggestion.type === 'budget') {
      const targetBudget = Number(suggestion.value)
      applySavingsProposal(proposeSavings(event, event.budget - targetBudget, targetBudget))
    } else if (suggestion.type === 'guests') updateEvent({ guests: Number(suggestion.value) })
    else updateEvent({ theme: String(suggestion.value) })
    setToast(user ? 'Changes applied. Saving to your account…' : 'Changes applied to your browser demo.')
  }
  const applyScenario = (proposal?: SavingsProposal) => {
    const expenseChanges = new Map((proposal?.changes ?? []).map((change) => [change.expenseId, change.to]))
    let expenses = event.expenses.map((expense) => expenseChanges.has(expense.id)
      ? { ...expense, planned: expenseChanges.get(expense.id)! }
      : { ...expense })
    const adjustCategory = (pattern: RegExp, amount: number, fallbackName: string) => {
      if (!amount) return
      const index = expenses.findIndex((expense) => pattern.test(expense.name))
      if (index >= 0) {
        const expense = expenses[index]
        expenses[index] = { ...expense, planned: Math.max(expense.actual, expense.planned + amount) }
      } else if (amount > 0) {
        expenses = [...expenses, { id: id(), name: fallbackName, planned: amount, actual: 0, color: palette[expenses.length % palette.length] }]
      }
    }
    adjustCategory(/food|cater|meal/i, (simGuests - event.guests) * 1200, 'Food & guest service')
    adjustCategory(/venue|setup/i, venueEstimate(simVenue) - venueEstimate(event.venue), 'Venue & setup')
    adjustCategory(/decor|flower|floral/i, themeEstimate(simTheme) - themeEstimate(event.theme), 'Theme decor')
    const weatherAlreadyIncluded = expenses.some((expense) => /weather contingency|weather backup/i.test(expense.name) && expense.planned > 0)
    adjustCategory(/weather contingency|weather backup/i, simWeather && !weatherAlreadyIncluded ? 22000 : 0, 'Weather contingency')
    const budget = proposal?.targetBudget ?? simBudget
    const requirements = simWeather && !/weather|rain|covered|contingency/i.test(event.requirements)
      ? [event.requirements, 'Weather contingency: confirm a covered backup space or tent option.'].filter(Boolean).join('\n')
      : event.requirements
    updateEvent({ budget, guests: simGuests, venue: simVenue, theme: simTheme, requirements, expenses })
    setSimWeather(false)
    setToast(proposal?.shortfall
      ? `Applied feasible scenario changes; the requested budget reduction still needs ${formatINR(proposal.shortfall)} more savings.`
      : user ? 'Scenario changes applied. Saving to your account…' : 'Scenario changes applied to your browser demo.')
  }

  return (
    <div className={`app-shell ${isPrintingPlan ? 'printing-plan' : ''}`}>
      {!isPrintingPlan && <AnimatePresence mode="wait">
        {!authReady && isSupabaseConfigured ? (
          <motion.div key="auth-loading" className="auth-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Sparkles size={20} /> Restoring your HappiXO session…</motion.div>
        ) : page === 'landing' ? (
          <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Landing onStart={startWizard} onDashboard={openWorkspace} onAuth={() => setPage('auth')} />
          </motion.div>
        ) : page === 'wizard' ? (
          <motion.div key="wizard" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Wizard
              data={wizard} setData={setWizard} step={step} setStep={setStep} naturalText={naturalText}
              setNaturalText={setNaturalText} accountSaved={Boolean(user)} onBack={() => step > 0 ? setStep(step - 1) : setPage('landing')}
              onNext={nextWizard} onGenerate={generatePlan} isGenerating={isGenerating}
            />
          </motion.div>
        ) : page === 'auth' ? (
          <motion.div key="auth" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <AuthPage initialMode={authMode} onBack={() => setPage('landing')} onAuthenticated={() => setPage('events')} />
          </motion.div>
        ) : page === 'events' ? (
          <motion.div key="events" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <EventsPage
              events={cloudEvents} loading={cloudLoading} loaded={cloudLoaded} error={cloudError} saveError={pendingEventError}
              profileName={profileName} profileEmail={user?.email ?? ''} profilePhone={profilePhone} localPlanAvailable={Boolean(localPlanToImport) && !localImportDone}
              onRetry={() => {
                setCloudLoaded(false)
                setCloudLoading(true)
                setCloudError('')
                setCloudEvents([])
                setCloudReload((current) => current + 1)
              }}
              onRetrySave={() => {
                setPendingEventError('')
                setPendingEventRetry((current) => current + 1)
              }} onCreate={() => startWizard()}
              onOpen={openSavedEvent} onDelete={removeSavedEvent} onImport={importLocalEvent} onSignOut={signOut} onSaveProfile={saveProfile}
            />
          </motion.div>
        ) : (
          <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard-layout">
            <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
              <a className="brand brand-sidebar" href="#" onClick={(e) => { e.preventDefault(); openWorkspace() }}><span className="brand-mark"><Sparkles size={17} /></span> happi<span>xo</span></a>
              <div className="workspace-label">YOUR WORKSPACE</div>
              <button className="event-switcher" onClick={openWorkspace}><span className="event-avatar">{event.name.slice(0, 1).toUpperCase()}</span><span className="switcher-copy"><b>{event.name}</b><small>{event.type}</small></span><ChevronDown size={15} /></button>
              <div className="sidebar-nav" aria-label="Event planning sections">
                <div className="workspace-label nav-label">PLAN YOUR EVENT</div>
                {navItems.map(({ name, icon: Icon }) => (
                  <button className={`nav-item ${tab === name ? 'active' : ''}`} key={name} onClick={() => { setTab(name); setMobileNav(false) }}>
                    <Icon size={17} strokeWidth={1.8} /><span>{name}</span>{name === 'HappiXO Copilot' && <span className="nav-new">XO</span>}
                  </button>
                ))}
              </div>
              <div className="sidebar-spacer" />
              <div className="sidebar-help"><span className="help-icon"><CircleHelp size={17} /></span><div><b>Planning a lot?</b><small>Your plan saves automatically.</small></div></div>
              <div className="profile-row"><div className="profile-avatar">{(profileName || 'H').slice(0, 1).toUpperCase()}</div><div><b>{profileName || 'HappiXO guest'}</b><small>{user?.email || 'Demo workspace'}</small></div><button className="icon-button" title={user ? 'Sign out' : 'Account'} aria-label={user ? 'Sign out' : 'Sign in'} onClick={user ? signOut : () => setPage('auth')}><LogOut size={17} /></button></div>
            </aside>
            <main className="dashboard-main">
              <header className="dashboard-topbar">
                <button className="icon-button mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation"><Menu size={20} /></button>
                <div className="breadcrumb">My events <ChevronRight size={14} /> <b>{event.name}</b></div>
                <div className="topbar-actions"><span className="demo-pill" title={cloudSaveError || undefined}><span /> {user ? cloudSaving ? 'Saving…' : cloudSaveError ? cloudSaveError.startsWith('Saved,') ? 'Saved · refresh needed' : 'Save failed' : cloudSaved ? 'Saved to your account' : 'Not saved yet' : supabase ? 'Sign in to save' : aiConfigured ? 'Gemini · browser demo' : 'Demo · browser only'}</span>{user && <button className="topbar-link" onClick={() => setPage('events')}>My Events</button>}<button className="button button-light button-small export-plan-button" onClick={() => setIsPrintingPlan(true)}><Download size={14} /> Download Event Plan</button><button className="topbar-link" onClick={() => setPage('landing')}>Home <OpenIcon size={14} /></button></div>
              </header>
              <div className="dashboard-content">
                <AnimatePresence mode="wait">
                  <motion.section key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .18 }}>
                    {tab === 'Overview' && <Overview event={event} planned={planned} spent={spent} remaining={remaining} utilization={utilization} progress={progress} upcoming={upcoming} chartData={chartData} accountSaved={Boolean(user)} onGo={setTab} onSaveDetails={saveEventDetails} />}
                    {tab === 'Budget' && <BudgetPage event={event} planned={planned} spent={spent} remaining={remaining} utilization={utilization} chartData={chartData} updateEvent={updateEvent} updateExpense={updateExpense} addExpense={addExpense} />}
                    {tab === 'Timeline' && <TimelinePage event={event} tasks={event.tasks} updateTask={updateTask} deleteTask={(taskId) => { if (user) setCloudSaved(false); setEvent((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== taskId) })) }} addTask={addTask} newTask={newTask} setNewTask={setNewTask} filter={taskFilter} setFilter={setTaskFilter} />}
                    {tab === 'Checklist' && <ChecklistPage event={event} tasks={event.tasks} progress={progress} updateTask={updateTask} deleteTask={(taskId) => { if (user) setCloudSaved(false); setEvent((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== taskId) })) }} addTask={addTask} newTask={newTask} setNewTask={setNewTask} filter={taskFilter} setFilter={setTaskFilter} />}
                    {tab === 'Vendors' && <VendorsPage vendors={event.vendors} updateVendor={updateVendor} addVendor={addVendor} deleteVendor={(vendorId) => { if (user) setCloudSaved(false); setEvent((current) => ({ ...current, vendors: current.vendors.filter((vendor) => vendor.id !== vendorId) })) }} />}
                    {tab === 'HappiXO Copilot' && <CopilotPage chat={chat} question={question} setQuestion={setQuestion} sendQuestion={sendQuestion} isChatLoading={isChatLoading} applySuggestion={applySuggestion} applyChange={applyChange} applySavingsProposal={applySavingsProposal} event={event} aiConfigured={aiConfigured} />}
                    {tab === 'What-if' && <Simulator event={event} simBudget={simBudget} setSimBudget={setSimBudget} simGuests={simGuests} setSimGuests={setSimGuests} simVenue={simVenue} setSimVenue={setSimVenue} simTheme={simTheme} setSimTheme={setSimTheme} simWeather={simWeather} setSimWeather={setSimWeather} simCost={simCost} onApplyScenario={applyScenario} />}
                    {tab === 'Theme studio' && <ThemeStudio event={event} onApply={(theme) => { updateEvent({ theme }); setToast(`${theme} applied to your plan.`) }} />}
                  </motion.section>
                </AnimatePresence>
              </div>
            </main>
          </motion.div>
        )}
      </AnimatePresence>}
      {!isPrintingPlan && <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><CheckCircle2 size={17} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={15} /></button></motion.div>}</AnimatePresence>}
      {isPrintingPlan && <EventPlanPrintView event={event} planned={planned} accountSaved={Boolean(user)} />}
    </div>
  )
}

function EventsPage({ events, loading, loaded, error, saveError, profileName, profileEmail, profilePhone, localPlanAvailable, onRetry, onRetrySave, onCreate, onOpen, onDelete, onImport, onSignOut, onSaveProfile }: {
  events: EventPlan[]
  loading: boolean
  loaded: boolean
  error: string
  saveError: string
  profileName: string
  profileEmail: string
  profilePhone: string
  localPlanAvailable: boolean
  onRetry: () => void
  onRetrySave: () => void
  onCreate: () => void
  onOpen: (event: EventPlan) => void
  onDelete: (event: EventPlan) => void
  onImport: () => void
  onSignOut: () => void
  onSaveProfile: (fullName: string, phone: string) => Promise<void>
}) {
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileDraftName, setProfileDraftName] = useState(profileName)
  const [profileDraftPhone, setProfileDraftPhone] = useState(profilePhone)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const today = TODAY_DATE
  const upcoming = events.filter((event) => event.date >= today)
  const past = events.filter((event) => event.date < today)
  const openProfileEditor = () => {
    setProfileDraftName(profileName)
    setProfileDraftPhone(profilePhone)
    setProfileError('')
    setEditingProfile(true)
  }
  const submitProfile = async (formEvent: FormEvent) => {
    formEvent.preventDefault()
    if (!profileDraftName.trim()) {
      setProfileError('Enter your full name.')
      return
    }
    setProfileSaving(true)
    setProfileError('')
    try {
      await onSaveProfile(profileDraftName, profileDraftPhone)
      setEditingProfile(false)
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Could not update your profile.')
    } finally {
      setProfileSaving(false)
    }
  }
  const renderEvent = (event: EventPlan) => {
    const tasksDone = event.tasks.filter((task) => task.status === 'Done').length
    const progress = event.tasks.length ? Math.round(tasksDone / event.tasks.length * 100) : 0
    return <article className="my-event-card panel" key={event.id}>
      <div className="my-event-topline"><span className="my-event-type"><PartyPopper size={14} /> {event.type}</span><button className="icon-button delete-button" aria-label={`Delete ${event.name}`} title={`Delete ${event.name}`} onClick={() => onDelete(event)}><Trash2 size={15} /></button></div>
      <h3>{event.name}</h3>
      <div className="my-event-details"><span><CalendarDays size={14} /> {dateLabel(event.date)}</span><span><IndianRupee size={14} /> {formatINR(event.budget)}</span><span><Users size={14} /> {event.guests} guests</span></div>
      <div className="my-event-progress"><span>Planning progress</span><b>{progress}%</b><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div>
      {event.generatedPlan && <span className="my-event-recommendation"><Sparkles size={13} /> HappiXO recommendations saved</span>}
      <button className="button button-dark full-button" onClick={() => onOpen(event)}>Open event <ArrowRight size={15} /></button>
    </article>
  }
  return <main className="my-events-page">
    <header className="my-events-header">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><span className="brand-mark"><Sparkles size={17} /></span> happi<span>xo</span></a>
      <div className="my-events-account"><span>{profileName || 'Your HappiXO account'}</span><button className="text-button" onClick={openProfileEditor}>Edit profile</button><button className="text-button" onClick={onSignOut}>Sign out</button></div>
    </header>
    <section className="my-events-content">
      <PageHeading eyebrow="YOUR CELEBRATIONS, ALL IN ONE PLACE" title="My Events" subtitle="Your saved plans and recommendations, ready whenever you are." action={<button className="button button-dark" disabled={!loaded || loading} onClick={onCreate}><Plus size={16} /> Create an event</button>} />
      {localPlanAvailable && <aside className="local-import-card"><div><b>Found an event plan saved in this browser</b><span>Import a copy into your account. The original browser copy will not be removed.</span></div><button className="button button-light button-small" disabled={!loaded || loading} onClick={onImport}>Import existing plan</button></aside>}
      {error && <div className="cloud-error" role="alert"><div><b>We couldn’t load your saved events.</b><span>{error}</span></div><button className="button button-light button-small" onClick={onRetry}>Try again</button></div>}
      {saveError && <div className="cloud-error" role="alert"><div><b>Your new event was not saved.</b><span>{saveError}</span></div><button className="button button-light button-small" onClick={onRetrySave}>Try saving again</button></div>}
      {error ? null : loading || !loaded ? <div className="events-loading" role="status"><Sparkles size={19} /> Loading your saved events…</div> : events.length === 0 ? <section className="my-events-section"><EmptyState icon={CalendarDays} title="No events created yet." text="Create an event plan and it will be saved to your account." /></section> : <>
        <section className="my-events-section"><div className="my-events-section-heading"><div><h2>Upcoming events</h2><p>{upcoming.length} {upcoming.length === 1 ? 'celebration' : 'celebrations'} ahead</p></div></div>{upcoming.length ? <div className="my-events-grid">{upcoming.map(renderEvent)}</div> : <EmptyState icon={CalendarDays} title="No upcoming events" text="Your saved past celebrations remain below." />}</section>
        {past.length > 0 && <section className="my-events-section"><div className="my-events-section-heading"><div><h2>Past events</h2><p>Your completed celebrations remain saved.</p></div></div><div className="my-events-grid">{past.map(renderEvent)}</div></section>}
      </>}
    </section>
    {editingProfile && <div className="event-edit-backdrop" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget) setEditingProfile(false) }}>
      <section className="event-edit-dialog profile-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title">
        <div className="event-edit-heading"><div><div className="eyebrow">YOUR ACCOUNT DETAILS</div><h2 id="profile-edit-title">Edit profile</h2></div><button className="icon-button" type="button" aria-label="Close profile editor" onClick={() => setEditingProfile(false)}><X size={18} /></button></div>
        <form className="event-details-form profile-details-form" onSubmit={(formEvent) => void submitProfile(formEvent)}>
          <label>Full name<input className="input-field" value={profileDraftName} onChange={(change) => setProfileDraftName(change.target.value)} maxLength={120} required /></label>
          <label>Email<input className="input-field" type="email" value={profileEmail} readOnly /></label>
          <label>Phone (optional)<input className="input-field" type="tel" value={profileDraftPhone} onChange={(change) => setProfileDraftPhone(change.target.value)} maxLength={40} /></label>
          {profileError && <p className="auth-error event-edit-error" role="alert">{profileError}</p>}
          <div className="event-edit-actions"><button className="button button-light" type="button" onClick={() => setEditingProfile(false)}>Cancel</button><button className="button button-dark" type="submit" disabled={profileSaving}>{profileSaving ? 'Saving…' : 'Save profile'}</button></div>
        </form>
      </section>
    </div>}
  </main>
}

function Landing({ onStart, onDashboard, onAuth }: { onStart: (type?: Category) => void; onDashboard: () => void; onAuth: () => void }) {
  const [openingCategory, setOpeningCategory] = useState<Category | null>(null)
  const openingTimer = useRef<number | undefined>(undefined)
  const openInvitation = (category: Category = 'Wedding') => {
    if (openingCategory) return
    setOpeningCategory(category)
    openingTimer.current = window.setTimeout(() => {
      setOpeningCategory(null)
      onStart(category)
    }, 1050)
  }

  useEffect(() => () => window.clearTimeout(openingTimer.current), [])

  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><span className="brand-mark"><Sparkles size={17} /></span> happi<span>xo</span></a>
        <nav className="landing-links"><a href="#how-it-works">How it works</a><a href="#celebrations">Celebrations</a><a href="#features">Features</a></nav>
        <div className="landing-actions"><button className="text-button" onClick={onAuth}>Sign in</button><button className="text-button" onClick={onDashboard}>{isSupabaseConfigured ? 'My Events' : 'Open demo'}</button><button className="button button-dark button-small" disabled={openingCategory !== null} onClick={() => openInvitation()}>Start planning <ArrowRight size={15} /></button></div>
      </header>
      {!supabase && <aside className="database-setup-notice" role="status"><b>Account storage is unavailable</b><span>{supabaseConfigurationError} Plans created in this browser demo will not appear in Supabase.</span></aside>}
      <main>
        <section className="hero-section cinematic-hero">
          <CinematicVideo video="/videos/celebration.mp4" poster="/videos/celebration.jpg" className="hero-scene" />
          <div className="hero-scene-wash" />
          <div className="hero-grain" />
          <div className="hero-particles" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div className="cinematic-hero-inner">
            <div className="hero-copy">
              <div className="cinematic-eyebrow"><Sparkles size={14} /> YOUR VERY OWN EVENT PLANNING COMPANION</div>
              <h1>Your Dream Event.<br /><em>Beautifully Planned.</em></h1>
              <p className="hero-description">From unforgettable weddings to magical birthdays, let HappiXO turn your imagination into a perfectly planned celebration.</p>
              <div className="hero-ctas">
                <button className="button button-ivory button-large" disabled={openingCategory !== null} onClick={() => openInvitation()}><Sparkles size={16} /> Start Planning with HappiXO</button>
                <a className="button button-glass button-large" href="#celebrations">Explore Celebrations <ArrowDownRight size={16} /></a>
              </div>
              <div className="hero-proof"><span className="live-scene-indicator" /><span>Celebrations, in their golden hour</span><span className="hero-proof-divider" /> Made for the moments that matter</div>
            </div>
            <motion.div
              className="invitation-card"
              initial={{ opacity: 0, y: 22, rotate: 1.4 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ duration: .85, delay: .18, ease: [.22, .7, .2, 1] }}
              aria-label="HappiXO invitation"
            >
              <div className="invitation-card-inner">
                <span className="invitation-rule" />
                <span className="invitation-card-spark">✳</span>
                <span className="invitation-wordmark">HappiXO</span>
                <span className="invitation-divider"><i /> ✦ <i /></span>
                <span className="invitation-message">Every celebration begins<br />with a beautiful plan.</span>
                <span className="invitation-prompt">Create your perfect event with HappiXO.</span>
                <button className="invitation-seal" aria-label="Start planning with HappiXO" onClick={() => openInvitation()}><Sparkles size={17} /></button>
              </div>
            </motion.div>
          </div>
          <a className="cinematic-scroll-cue" href="#celebrations"><span /> SCROLL TO EXPLORE</a>
          <AnimatePresence>
            {openingCategory && (
              <motion.div className="invitation-reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .24 }} aria-live="polite">
                <motion.div
                  className="invitation-reveal-card"
                  initial={{ opacity: 0, scale: .88, rotateX: 16, y: 34 }}
                  animate={{ opacity: 1, scale: 1, rotateX: [0, -4, 7], y: [0, -4, 2] }}
                  transition={{ duration: 1.02, ease: [.2, .75, .25, 1] }}
                >
                  <span className="invitation-reveal-kicker">A LITTLE MAGIC, IN THE MAKING</span>
                  <span className="invitation-wordmark">HappiXO</span>
                  <span className="invitation-divider"><i /> ✦ <i /></span>
                  <span className="invitation-message">Every celebration begins<br />with a beautiful plan.</span>
                  <span className="invitation-prompt">Your {openingCategory.toLowerCase()} story starts here.</span>
                  <Sparkles size={17} className="invitation-reveal-spark" />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
        <CinematicStorySection id="celebrations" className="story-wedding" video="/videos/wedding.mp4" poster="/videos/wedding.jpg" eyebrow="A DAY THAT FEELS LIKE FOREVER" title="Every Love Story Deserves a Magical Celebration." description="From the first flowers to the last dance, shape a wedding day that feels unmistakably yours." buttonLabel="Plan a Wedding" category="Wedding" onPlan={openInvitation} />
        <CinematicStorySection className="story-birthday" video="/videos/birthday.mp4" poster="/videos/birthday.jpg" eyebrow="A LITTLE MORE MAGIC, EVERY YEAR" title="Make Every Birthday Unforgettable." description="Bring the candles, colour, favourite people and one more reason to make a wish." buttonLabel="Plan a Birthday" category="Birthday" onPlan={openInvitation} />
        <CinematicStorySection className="story-community" video="/videos/community.mp4" poster="/videos/community.jpg" eyebrow="GOOD THINGS HAPPEN TOGETHER" title="Bringing People Together, Beautifully." description="Make room for shared traditions, new connections and the joy of celebrating as a community." buttonLabel="Plan a Community Event" category="Community gathering" onPlan={openInvitation} />
        <CinematicStorySection className="story-college" video="/videos/college.mp4" poster="/videos/college.jpg" eyebrow="BIG ENERGY, BRIGHTER MEMORIES" title="Turn Every College Event Into a Memory." description="From the first sound check to the final encore, bring your campus celebration to life." buttonLabel="Plan a College Event" category="College event" onPlan={openInvitation} />
        <CinematicStorySection className="story-ai" video="/videos/preparation.mp4" poster="/videos/preparation.jpg" eyebrow="A LITTLE MORE THOUGHT, A LOT LESS STRESS" title="One HappiXO. Endless Celebrations." description="Turn your first spark of an idea into a thoughtful event plan, with every detail in its right place." buttonLabel="Start Planning with HappiXO" category="Wedding" onPlan={openInvitation} highlights={['HappiXO Event Planning', 'Smart Budgeting', 'Personalized Themes', 'Vendor Checklists', 'Event Timelines']} />
        <section className="feature-section" id="features">
          <div className="feature-intro"><div className="eyebrow">THOUGHTFUL PLANNING, MINUS THE SPREADSHEETS</div><h2>Everything in its place.<br /><em>Nothing</em> left to chance.</h2><p>All the moving parts, gently brought together. So you can spend less time planning the party and more time looking forward to it.</p><button className="button button-dark" onClick={() => openInvitation()}>Meet your planning companion <ArrowRight size={16} /></button></div>
          <div className="feature-list"><Feature icon={Sparkles} title="A plan that starts with you" text="Share your kind of celebration, your budget and the little details. Get a thoughtful first draft—not a one-size-fits-all checklist." number="01" /><Feature icon={Wallet} title="A budget with breathing room" text="See where every rupee is going. Adjust your numbers as you go, with real totals that update right away." number="02" /><Feature icon={CalendarDays} title="A timeline that keeps its promises" text="Turn a big to-do into small, timely steps. Your checklist moves with your event date, not the other way around." number="03" /><Feature icon={Users} title="A little help with the details" text="Keep vendor categories, guest needs and thoughtful touches close by, all in one calm workspace." number="04" /></div>
        </section>
        <section className="preview-section" id="how-it-works">
          <div className="preview-copy"><div className="eyebrow">A SNEAK PEEK AT THE PLAN</div><h2>One lovely place<br />to <em>see it all.</em></h2><p>From the first idea to the final toast, your plan stays clear, flexible and very much yours.</p><button className="button button-dark" onClick={onDashboard}>Explore the sample plan <ArrowRight size={16} /></button></div>
          <div className="preview-card"><div className="preview-top"><div><small>YOUR CELEBRATION</small><h3>Aarav & Mira’s Celebration</h3><span><MapPin size={13} /> Jaipur <i /> <CalendarDays size={13} /> 12 Dec, 2026</span></div><span className="preview-badge"><Sparkles size={13} /> YOUR PLAN</span></div><div className="preview-stats"><div><small>PLANNED BUDGET</small><b>₹8,50,000</b><span><span className="mini-check">✓</span> Thoughtfully allocated</span></div><div><small>GUESTS TO CELEBRATE WITH</small><b>120</b><span>Good things are gathering</span></div><div><small>PLANNING PROGRESS</small><b>17%</b><span>One step at a time</span></div></div><div className="preview-bottom"><div className="preview-donut"><svg viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" /><circle className="donut-fill" cx="25" cy="25" r="20" /></svg><span>6<small>steps</small></span></div><div className="preview-next"><small>UP NEXT</small><b>Shortlist and book your venue</b><span><CalendarDays size={13} /> Coming up in your timeline</span></div><ArrowRight size={17} /></div><div className="preview-spark">✳</div></div>
        </section>
        <section className="testimonial-section"><div className="eyebrow">KIND WORDS, IMAGINED MOMENTS</div><h2>A calmer kind of <em>celebration.</em></h2><p className="sample-caption">Illustrative stories from the kinds of celebrations we love helping with.</p><div className="quote-grid"><Quote quote="We finally had one place for the budget, the checklist and all the little ideas. It made the whole thing feel possible." name="Riya & Dev" context="Planning an intimate wedding" tone="lavender" /><Quote quote="The timeline helped our college team go from a group chat to a real, run-of-show plan. No more last-minute chaos." name="Ananya" context="Campus fest coordinator" tone="peach" /><Quote quote="We could talk through options before changing anything. That breathing room was exactly what I needed." name="Meera" context="Hosting a family milestone" tone="sage" /></div></section>
        <CinematicStorySection className="story-finale" video="/videos/finale.mp4" poster="/videos/finale.jpg" eyebrow="YOUR NEXT FAVOURITE MEMORY STARTS HERE" title="Your Next Unforgettable Moment Starts Here." description="The best celebrations start with a single idea. Let’s make yours a beautiful one." buttonLabel="Create My Event" category="Wedding" onPlan={openInvitation} />
      </main>
      <footer className="landing-footer"><a className="brand" href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><span className="brand-mark"><Sparkles size={16} /></span> happi<span>xo</span></a><span>Made for the moments that matter.</span><div><a href="#features">How it works</a><a href="#celebrations">Celebrations</a><button onClick={onDashboard}>Open demo plan</button></div><small>© 2026 HappiXO · Thoughtfully planned, locally saved.</small></footer>
    </div>
  )
}

function CinematicVideo({ video, poster, className, style }: { video: string; poster: string; className: string; style?: MotionStyle }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isReducedMotion, setIsReducedMotion] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(true)
  const [videoFailed, setVideoFailed] = useState(false)
  const shouldPlay = isVisible && documentVisible && !isReducedMotion && !isMobile && !videoFailed

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleActiveVideo = (event: Event) => {
      const activeContainer = (event as CustomEvent<HTMLDivElement>).detail
      if (activeContainer !== container) setIsVisible(false)
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        window.dispatchEvent(new CustomEvent('happixo:cinematic-video-active', { detail: container }))
      }
      setIsVisible(entry.isIntersecting)
    }, { threshold: .1 })
    window.addEventListener('happixo:cinematic-video-active', handleActiveVideo)
    observer.observe(container)
    return () => {
      observer.disconnect()
      window.removeEventListener('happixo:cinematic-video-active', handleActiveVideo)
    }
  }, [])

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const mobileViewport = window.matchMedia('(max-width: 700px)')
    const updateMediaPreferences = () => {
      setIsReducedMotion(reducedMotion.matches)
      setIsMobile(mobileViewport.matches)
    }
    const updateDocumentVisibility = () => setDocumentVisible(!document.hidden)
    updateMediaPreferences()
    updateDocumentVisibility()
    reducedMotion.addEventListener('change', updateMediaPreferences)
    mobileViewport.addEventListener('change', updateMediaPreferences)
    document.addEventListener('visibilitychange', updateDocumentVisibility)
    return () => {
      reducedMotion.removeEventListener('change', updateMediaPreferences)
      mobileViewport.removeEventListener('change', updateMediaPreferences)
      document.removeEventListener('visibilitychange', updateDocumentVisibility)
    }
  }, [])

  useEffect(() => {
    const element = videoRef.current
    if (!element || !shouldPlay) {
      element?.pause()
      return
    }
    let active = true
    void element.play().catch((error: unknown) => {
      if (!active || element.paused) return
      console.info(`HappiXO is showing the poster because ${video} could not play.`, error)
      setVideoFailed(true)
    })
    return () => {
      active = false
      element.pause()
    }
  }, [shouldPlay, video])

  const handleVideoError = () => {
    console.info(`HappiXO is showing the poster because ${video} could not load.`)
    setVideoFailed(true)
  }

  return (
    <motion.div ref={containerRef} style={style} className={`cinematic-video ${shouldPlay ? 'cinematic-video-playing' : ''} ${className}`} aria-hidden="true">
      <img className="cinematic-video-poster" src={poster} alt="" loading={isVisible ? 'eager' : 'lazy'} decoding="async" />
      <video
        ref={videoRef}
        className="cinematic-video-media"
        src={shouldPlay ? video : undefined}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        onError={handleVideoError}
      />
    </motion.div>
  )
}

function CinematicStorySection({ id, className, video, poster, eyebrow, title, description, buttonLabel, category, onPlan, highlights }: {
  id?: string
  className: string
  video: string
  poster: string
  eyebrow: string
  title: string
  description: string
  buttonLabel: string
  category: Category
  onPlan: (category: Category) => void
  highlights?: string[]
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start end', 'end start'] })
  const parallaxOffset = useTransform(scrollYProgress, [0, 1], [-24, 24])

  return (
    <section ref={sectionRef} id={id} className={`story-section ${className}`}>
      <CinematicVideo video={video} poster={poster} className="story-video" style={{ y: parallaxOffset }} />
      <div className="story-wash" />
      <motion.div
        className="story-copy"
        initial={{ opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: .3 }}
        transition={{ duration: .7, ease: [.22, .7, .2, 1] }}
      >
        <div className="story-eyebrow"><Sparkles size={14} /> {eyebrow}</div>
        <h2>{title}</h2>
        <p>{description}</p>
        {highlights && <ul className="story-highlights">{highlights.map((highlight) => <li key={highlight}><Check size={15} />{highlight}</li>)}</ul>}
        <button className="button button-ivory button-large" onClick={() => onPlan(category)}>{buttonLabel} <ArrowRight size={16} /></button>
      </motion.div>
      <span className="story-scene-mark" aria-hidden="true">HappiXO <i /> {className.replace('story-', '').toUpperCase()}</span>
    </section>
  )
}

function Feature({ icon: Icon, title, text, number }: { icon: LucideIcon; title: string; text: string; number: string }) {
  return <article className="feature-row"><span className="feature-number">{number}</span><span className="feature-icon"><Icon size={19} /></span><div><h3>{title}</h3><p>{text}</p></div><ChevronRight size={17} className="feature-chevron" /></article>
}
function Quote({ quote, name, context, tone }: { quote: string; name: string; context: string; tone: string }) {
  return <article className={`quote-card tone-${tone}`}><span className="quote-mark">“</span><p>{quote}</p><div className="quote-person"><span>{name.slice(0, 1)}</span><div><b>{name}</b><small>{context}</small></div></div></article>
}

function EventPlanPrintView({ event, planned, accountSaved }: { event: EventPlan; planned: number; accountSaved: boolean }) {
  const generated = event.generatedPlan
  const themeDescription = generated?.theme.description ?? themeOptions.find((theme) => theme.name === event.theme)?.desc
  return <article className="print-plan">
    <header className="print-plan-header"><span>HappiXO · EVENT PLAN</span><h1>{event.name}</h1><p>{event.type} · {dateLabel(event.date)} · {event.city}</p></header>
    <section><h2>At a glance</h2><div className="print-plan-facts"><span><b>Guests</b>{event.guests}</span><span><b>Total budget</b>{formatINR(event.budget)}</span><span><b>Planned spend</b>{formatINR(planned)}</span><span><b>Venue</b>{event.venue}</span></div><p>{event.concept}</p></section>
    <section><h2>Theme & recommendations</h2><h3>{event.theme || 'To be decided'}</h3>{themeDescription && <p>{themeDescription}</p>}<p><b>Food:</b> {event.food || 'To be decided'}</p>{generated?.foodSuggestions.length ? <ul>{generated.foodSuggestions.map((item, index) => <li key={`food-${index}`}>{item}</li>)}</ul> : null}{generated?.activities.length ? <ul>{generated.activities.map((item, index) => <li key={`activity-${index}`}>{item}</li>)}</ul> : null}</section>
    <section><h2>Budget breakdown</h2><table><thead><tr><th>Category</th><th>Planned</th><th>Actual</th><th>Remaining</th></tr></thead><tbody>{event.expenses.map((expense) => <tr key={expense.id}><td>{expense.name}</td><td>{formatINR(expense.planned)}</td><td>{formatINR(expense.actual)}</td><td>{formatINR(expense.planned - expense.actual)}</td></tr>)}</tbody><tfoot><tr><th>Total</th><th>{formatINR(planned)}</th><th>{formatINR(event.expenses.reduce((sum, item) => sum + item.actual, 0))}</th><th>{formatINR(planned - event.expenses.reduce((sum, item) => sum + item.actual, 0))}</th></tr></tfoot></table></section>
    <section><h2>Preparation timeline</h2>{event.tasks.length ? <ol>{[...event.tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((task) => <li key={task.id}><b>{task.name}</b> · {dateLabel(task.dueDate)} · {task.status}<br />{task.description}</li>)}</ol> : <p>No timeline tasks yet.</p>}</section>
    <section><h2>Vendor checklist</h2>{event.vendors.length ? <table><thead><tr><th>Category</th><th>Estimate</th><th>Status</th><th>Contact & notes</th></tr></thead><tbody>{event.vendors.map((vendor) => <tr key={vendor.id}><td>{vendor.category}</td><td>{formatINR(vendor.estimatedCost)}</td><td>{vendor.status}</td><td>{[vendor.contact, vendor.notes].filter(Boolean).join(' — ') || 'To be added'}</td></tr>)}</tbody></table> : <p>No vendors on the checklist yet.</p>}</section>
    <section><h2>Important planning notes</h2><p>{event.requirements || 'No additional notes.'}</p>{generated?.savingTips.length ? <><h3>Budget tips</h3><ul>{generated.savingTips.map((tip, index) => <li key={`tip-${index}`}>{tip}</li>)}</ul></> : null}{generated?.contingencyPlan.length ? <><h3>Contingency ideas</h3><ul>{generated.contingencyPlan.map((tip, index) => <li key={`contingency-${index}`}>{tip}</li>)}</ul></> : null}</section>
    <footer>{generated ? 'HappiXO-generated planning suggestions and all costs are estimates; verify details directly with local vendors.' : 'Locally generated demo plan. Estimates are illustrative, not vendor quotes.'} · {accountSaved ? 'Saved to your HappiXO account.' : 'Saved in this browser.'}</footer>
  </article>
}

function Wizard({ data, setData, step, setStep, naturalText, setNaturalText, accountSaved, onBack, onNext, onGenerate, isGenerating }: {
  data: WizardData; setData: (value: WizardData) => void; step: number; setStep: (value: number) => void
  naturalText: string; setNaturalText: (value: string) => void; accountSaved: boolean; onBack: () => void; onNext: () => void; onGenerate: () => void | Promise<void>; isGenerating: boolean
}) {
  const update = (patch: Partial<WizardData>) => setData({ ...data, ...patch })
  const stepTitles = ['The big idea', 'The practical bits', 'The little details']
  return <div className="wizard-page"><header className="wizard-nav"><a className="brand" href="#" onClick={(e) => { e.preventDefault(); onBack() }}><span className="brand-mark"><Sparkles size={17} /></span> happi<span>xo</span></a><div className="wizard-save"><span className="demo-pill"><span /> {accountSaved ? 'Account planning' : 'Demo mode'}</span><span>{accountSaved ? 'Saved to your account after planning' : 'Private to this browser'}</span></div><button className="icon-button" aria-label="Close wizard" onClick={onBack}><X size={19} /></button></header>
    <main className="wizard-main"><aside className="wizard-aside"><div className="eyebrow">A GOOD THING IS TAKING SHAPE</div><h1>Let’s make room<br />for <em>something lovely.</em></h1><p>A few little details help us make your first plan feel like it was made just for you.</p><div className="wizard-steps">{stepTitles.map((title, index) => <button key={title} className={`wizard-step ${index === step ? 'current' : ''} ${index < step ? 'complete' : ''}`} onClick={() => index < step && setStep(index)}><span>{index < step ? <Check size={14} /> : `0${index + 1}`}</span><div><b>{title}</b><small>{['Set the scene', 'Make it real', 'Make it yours'][index]}</small></div></button>)}</div><div className="wizard-aside-note"><Sparkles size={16} /><span>{accountSaved ? 'Your plan will be saved to your HappiXO account.' : 'Your plan stays right here, in your browser.'}</span></div></aside>
    <section className="wizard-form-card"><div className="form-progress"><span>STEP 0{step + 1} <i /> 03</span><div><i style={{ width: `${(step + 1) / 3 * 100}%` }} /></div></div><AnimatePresence mode="wait"><motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: .16 }}>
      {step === 0 && <div className="wizard-step-content"><div className="eyebrow">FIRST, THE REASON TO GATHER</div><h2>What are we celebrating?</h2><p className="form-subtitle">Every great plan starts with a name and a date.</p><label className="field-label">What kind of event? <span>Choose one</span></label><div className="type-pills">{categoryCards.map((item) => <button key={item.name} className={data.type === item.name ? 'selected' : ''} onClick={() => update({ type: item.name })}><item.icon size={15} />{item.name === 'Community gathering' ? 'Community Event' : item.name}</button>)}</div><label className="field-label" htmlFor="event-name">Give your event a name</label><input id="event-name" className="input-field" placeholder="e.g. Aisha’s 30th, The big reunion…" value={data.name} onChange={(e) => update({ name: e.target.value })} maxLength={72} /><label className="field-label" htmlFor="event-date">When’s the big day?</label><div className="input-icon-wrap"><CalendarDays size={17} /><input id="event-date" className="input-field" type="date" min={TODAY_DATE} value={data.date} onChange={(e) => update({ date: e.target.value })} /></div></div>}
      {step === 1 && <div className="wizard-step-content"><div className="eyebrow">LET’S MAKE IT REAL</div><h2>Where, and for whom?</h2><p className="form-subtitle">A few practical details help keep your plan grounded.</p><label className="field-label" htmlFor="event-city">City or location</label><div className="input-icon-wrap"><MapPin size={17} /><input id="event-city" className="input-field" placeholder="e.g. Jaipur, Rajasthan" value={data.city} onChange={(e) => update({ city: e.target.value })} /></div><div className="field-grid"><div><label className="field-label" htmlFor="event-budget">Your budget <span>INR</span></label><div className="input-icon-wrap"><IndianRupee size={16} /><input id="event-budget" className="input-field" type="number" min="10000" max={MAX_EVENT_BUDGET} step="5000" value={data.budget} onChange={(e) => update({ budget: Number(e.target.value) })} /></div></div><div><label className="field-label" htmlFor="event-guests">Expected guests</label><div className="input-icon-wrap"><Users size={16} /><input id="event-guests" className="input-field" type="number" min="1" max={MAX_EVENT_GUESTS} value={data.guests} onChange={(e) => update({ guests: Number(e.target.value) })} /></div></div></div><div className="budget-hint"><Lightbulb size={15} /> No pressure to get it perfect. Your budget can change anytime.</div></div>}
      {step === 2 && <div className="wizard-step-content"><div className="eyebrow">THE DETAILS THAT MAKE IT YOURS</div><h2>What should it feel like?</h2><p className="form-subtitle">The little touches make a celebration memorable.</p><label className="field-label" htmlFor="event-theme">Theme or style</label><input id="event-theme" className="input-field" placeholder="e.g. Garden party, modern minimal…" value={data.theme} onChange={(e) => update({ theme: e.target.value })} /><label className="field-label" htmlFor="event-food">Food preferences</label><select id="event-food" className="input-field" value={data.food} onChange={(e) => update({ food: e.target.value })}><option>Vegetarian</option><option>Vegetarian + vegan options</option><option>Non-vegetarian</option><option>Mixed menu</option><option>To be decided</option></select><label className="field-label">Where will the party happen?</label><div className="choice-row">{['Indoor', 'Outdoor', 'A mix of both'].map((venue) => <button key={venue} className={`choice-card ${data.venue === venue ? 'selected' : ''}`} onClick={() => update({ venue })}><span className="choice-radio" />{venue}</button>)}</div><label className="field-label" htmlFor="event-needs">Anything else we should know? <span>Optional</span></label><textarea id="event-needs" className="input-field textarea-field" placeholder="Accessibility, a special moment, the one thing you don’t want to forget…" value={data.requirements} onChange={(e) => update({ requirements: e.target.value })} rows={3} /><div className="natural-entry"><Sparkles size={16} /><div><b>Or just tell us in your own words</b><small>We’ll use this as a starting point for your plan.</small></div><textarea aria-label="Describe your event in your own words" placeholder="“A relaxed outdoor birthday for 40 friends, around ₹1.5 lakh…”" value={naturalText} onChange={(e) => setNaturalText(e.target.value)} rows={2} /></div></div>}
    </motion.div></AnimatePresence><div className="wizard-footer"><button className="button button-light" onClick={onBack} disabled={isGenerating}><ArrowLeft size={15} /> {step === 0 ? 'Back to home' : 'Go back'}</button>{step < 2 ? <button className="button button-dark" onClick={onNext}>Continue <ArrowRight size={16} /></button> : <button className="button button-dark" onClick={onGenerate} disabled={isGenerating}>{isGenerating ? <><Sparkles size={16} /> Making your plan…</> : <><Sparkles size={16} /> Make my plan</>}</button>}</div><p className="wizard-reassure"><span><Check size={12} /></span> No sign-up. HappiXO offers connected planning when configured; demo mode is ready otherwise.</p></section></main>
  </div>
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>
}
function StatCard({ label, value, detail, icon: Icon, tone, detailIcon }: { label: string; value: string; detail: string; icon: LucideIcon; tone: string; detailIcon?: LucideIcon }) {
  const DetailIcon = detailIcon
  return <article className="stat-card"><div className="stat-label">{label}<span className={`stat-icon ${tone}`}><Icon size={17} /></span></div><b className="stat-value">{value}</b><span className="stat-detail">{DetailIcon && <DetailIcon size={13} />}{detail}</span></article>
}
function Overview({ event, planned, spent, remaining, utilization, progress, upcoming, chartData, accountSaved, onGo, onSaveDetails }: {
  event: EventPlan; planned: number; spent: number; remaining: number; utilization: number; progress: number
  upcoming: Task[]; chartData: { name: string; value: number; color: string }[]; accountSaved: boolean; onGo: (tab: Tab) => void
  onSaveDetails: (details: EventDetailsDraft) => void
}) {
  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [details, setDetails] = useState<EventDetailsDraft>(() => ({
    name: event.name, type: event.type, date: event.date, city: event.city, budget: event.budget,
    guests: event.guests, theme: event.theme, food: event.food, venue: event.venue, requirements: event.requirements,
  }))
  const days = dayDiff(event.date)
  const openDetailsEditor = () => {
    setDetails({
      name: event.name, type: event.type, date: event.date, city: event.city, budget: event.budget,
      guests: event.guests, theme: event.theme, food: event.food, venue: event.venue, requirements: event.requirements,
    })
    setDetailsError('')
    setEditingDetails(true)
  }
  const submitDetails = (formEvent: FormEvent) => {
    formEvent.preventDefault()
    const updatedDetails = { ...details, name: details.name.trim(), city: details.city.trim() }
    if (!updatedDetails.name || !updatedDetails.city) {
      setDetailsError('Add an event name and city before saving.')
      return
    }
    onSaveDetails(updatedDetails)
    setEditingDetails(false)
  }
  return <div className="dashboard-page">
    <div className="welcome-strip"><div><div className="eyebrow">YOUR EVENT, TAKING SHAPE <span className="demo-inline">· {event.generatedPlan ? 'GEMINI PLAN' : 'DEMO PLAN'}</span></div><h1>{event.name}</h1><div className="event-meta"><span><PartyPopper size={14} /> {event.type}</span><i /><span><CalendarDays size={14} /> {dateLabel(event.date)}</span><i /><span><MapPin size={14} /> {event.city}</span><i /><span><Users size={14} /> {event.guests} guests</span></div></div><button className="button button-light edit-details" onClick={openDetailsEditor}><Settings2 size={15} /> Edit event details</button></div>
    <div className="countdown-banner"><span className="countdown-icon"><CalendarDays size={18} /></span><div><b>{days > 0 ? `${days} days until the celebration` : days === 0 ? 'Today is the day!' : 'Your celebration has passed'}</b><small>{days > 0 ? 'Plenty of time to make it feel just right.' : 'Every good moment is worth remembering.'}</small></div><div className="countdown-date"><b>{dateLabel(event.date, { day: '2-digit', month: 'short' })}</b><small>{new Date(`${event.date}T12:00:00`).getFullYear()}</small></div></div>
    <div className="stat-grid"><StatCard label="Total budget" value={formatINR(event.budget)} detail={`${formatINR(planned)} thoughtfully allocated`} icon={Wallet} tone="purple" /><StatCard label="Estimated spent" value={formatINR(spent)} detail={`${utilization}% of your total budget`} icon={ArrowUpRight} tone="coral" /><StatCard label="Still to spend" value={formatINR(remaining)} detail={remaining < 0 ? 'Over your budget—review expenses' : 'Room for the finishing touches'} icon={IndianRupee} tone="sage" detailIcon={remaining < 0 ? ArrowUpRight : ArrowDownRight} /><StatCard label="Planning progress" value={`${progress}%`} detail={`${event.tasks.filter((task) => task.status === 'Done').length} of ${event.tasks.length} tasks complete`} icon={CheckCircle2} tone="gold" /></div>
    <div className="overview-grid"><section className="panel budget-overview"><div className="panel-heading"><div><h2>Budget at a glance</h2><p>A clear picture of where the plan stands.</p></div><button className="link-button" onClick={() => onGo('Budget')}>View budget <ArrowRight size={14} /></button></div><div className="budget-chart-wrap"><div className="budget-chart"><Suspense fallback={<span className="chart-placeholder" role="status" aria-label="Loading budget chart" />}><BudgetDonut chartData={chartData} innerRadius="68%" outerRadius="94%" formatAmount={formatINR} /></Suspense><div className="chart-center"><b>{formatINR(planned)}</b><small>planned</small></div></div><div className="chart-legend">{event.expenses.slice(0, 5).map((expense) => <div key={expense.id}><span style={{ background: expense.color }} />{expense.name}<b>{formatINR(expense.planned)}</b></div>)}</div></div><div className="spent-progress"><div><span>Spent so far</span><b>{formatINR(spent)} <small>of {formatINR(event.budget)}</small></b></div><div className="progress-track"><i style={{ width: `${Math.min(Math.max(utilization, 0), 100)}%` }} /></div><div className="spent-progress-bottom"><span>0%</span><span>{utilization}% utilized</span><span>100%</span></div></div></section>
      <section className="panel upcoming-panel"><div className="panel-heading"><div><h2>Coming up next</h2><p>Small steps, beautifully timed.</p></div><button className="icon-button subtle" onClick={() => onGo('Timeline')} aria-label="Open timeline"><ArrowUpRight size={17} /></button></div>{upcoming.length ? <div className="upcoming-list">{upcoming.map((task, index) => <div className="upcoming-item" key={task.id}><div className={`upcoming-marker marker-${index}`}><CalendarDays size={14} /></div><div className="upcoming-info"><b>{task.name}</b><small>{task.dueDate < TODAY_DATE ? 'Overdue' : `Due ${dateLabel(task.dueDate, { day: 'numeric', month: 'short' })}`}</small></div><span className={`priority-dot priority-${task.priority.toLowerCase()}`} title={`${task.priority} priority`} /></div>)}</div> : <EmptyState icon={CheckCircle2} title="All caught up" text="Add a task to keep your plan moving." />}<button className="button button-light full-button" onClick={() => onGo('Timeline')}>Open your timeline <ArrowRight size={15} /></button></section></div>
    <div className="overview-lower"><section className="theme-card"><div className="theme-art"><div className="theme-art-orb orb1" /><div className="theme-art-orb orb2" /><div className="theme-leaf">✳</div><div className="theme-palettes">{(event.generatedPlan?.theme.colors ?? themeOptions[0].colors).slice(0, 4).map((color) => <i key={color} style={{ background: color }} />)}</div></div><div className="theme-card-copy"><div className="eyebrow">THE FEEL OF THE DAY</div><h3>{event.theme || 'Your celebration, your style'}</h3><p>{event.generatedPlan?.theme.description ?? themeOptions.find((option) => option.name === event.theme)?.desc ?? 'A thoughtful direction for the little details that make your event feel like you.'}</p><button className="link-button" onClick={() => onGo('Theme studio')}>Explore the theme studio <ArrowRight size={14} /></button></div></section><section className="panel concept-card"><div className="concept-icon"><Sparkles size={17} /></div><div className="eyebrow">YOUR EVENT CONCEPT <span className="demo-inline">· {event.generatedPlan ? 'GEMINI' : 'LOCAL DEMO'}</span></div><p>{event.concept}</p><div className="concept-chips"><span><Users size={12} /> {event.guests} guests</span><span><CloudSun size={12} /> {event.venue}</span><span><Heart size={12} /> {event.food}</span></div></section></div>
    {event.generatedPlan && <GeneratedPlanDetails plan={event.generatedPlan} />}
    <div className="sample-disclaimer"><Sparkles size={14} /> {event.generatedPlan ? 'HappiXO-generated suggestions and costs are estimates only, not vendor quotes or bookings.' : 'This is a deterministic demo plan generated locally—not a live HappiXO response.'} {accountSaved ? 'Your edits save to your account.' : 'Your edits save in this browser.'}</div>
    {editingDetails && <div className="event-edit-backdrop" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget) setEditingDetails(false) }}>
      <section className="event-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="event-edit-title">
        <div className="event-edit-heading"><div><div className="eyebrow">KEEP YOUR PLAN UP TO DATE</div><h2 id="event-edit-title">Edit event details</h2></div><button className="icon-button" type="button" aria-label="Close editor" onClick={() => setEditingDetails(false)}><X size={18} /></button></div>
        <form className="event-details-form" onSubmit={submitDetails}>
          <label>Event name<input className="input-field" value={details.name} onChange={(change) => setDetails({ ...details, name: change.target.value })} maxLength={120} required /></label>
          <label>Event type<select className="input-field" value={details.type} onChange={(change) => setDetails({ ...details, type: change.target.value as Category })}>{[...categoryCards.map((item) => item.name), 'Other' as const].map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label>Date<input className="input-field" type="date" value={details.date} onChange={(change) => setDetails({ ...details, date: change.target.value })} required /></label>
          <label>City or location<input className="input-field" value={details.city} onChange={(change) => setDetails({ ...details, city: change.target.value })} maxLength={120} required /></label>
          <label>Budget (INR)<input className="input-field" type="number" min={10_000} max={MAX_EVENT_BUDGET} step={1000} value={details.budget} onChange={(change) => setDetails({ ...details, budget: Number(change.target.value) })} required /></label>
          <label>Guest count<input className="input-field" type="number" min={1} max={MAX_EVENT_GUESTS} step={1} value={details.guests} onChange={(change) => setDetails({ ...details, guests: Number(change.target.value) })} required /></label>
          <label>Theme<input className="input-field" value={details.theme} onChange={(change) => setDetails({ ...details, theme: change.target.value })} maxLength={120} /></label>
          <label>Food preferences<input className="input-field" value={details.food} onChange={(change) => setDetails({ ...details, food: change.target.value })} maxLength={160} /></label>
          <label>Venue<input className="input-field" value={details.venue} onChange={(change) => setDetails({ ...details, venue: change.target.value })} maxLength={160} /></label>
          <label className="event-edit-notes">Planning notes<textarea className="input-field" value={details.requirements} onChange={(change) => setDetails({ ...details, requirements: change.target.value })} maxLength={2000} rows={3} /></label>
          {detailsError && <p className="auth-error event-edit-error" role="alert">{detailsError}</p>}
          <div className="event-edit-actions"><button className="button button-light" type="button" onClick={() => setEditingDetails(false)}>Cancel</button><button className="button button-dark" type="submit">Save event details</button></div>
        </form>
      </section>
    </div>}
  </div>
}

function EmptyState({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) { return <div className="empty-state"><Icon size={24} /><b>{title}</b><span>{text}</span></div> }

function GeneratedPlanDetails({ plan }: { plan: GeneratedPlan }) {
  const budgetTotal = plan.budget.reduce((sum, row) => sum + row.estimatedCost, 0)
  return <section className="panel generated-plan"><div className="panel-heading"><div><h2>Your personalized planning notes</h2><p>Gemini suggestions · cost estimates in INR · verify details with local vendors</p></div><span className="estimate-pill"><Sparkles size={13} /> HappiXO Plan</span></div><div className="generated-grid"><div><h3><Wallet size={14} /> Budget estimates <span>{formatINR(budgetTotal)}</span></h3>{plan.budget.map((row) => <div className="generated-list-item" key={row.category}><b>{row.category}<small>{row.reason}</small></b><strong>{formatINR(row.estimatedCost)}</strong></div>)}</div><div><h3><Users size={14} /> Vendor checklist</h3>{plan.vendorChecklist.map((row) => <div className="generated-list-item" key={row.category}><b>{row.category}<small>{row.notes}</small></b><strong>{formatINR(row.estimatedCost)}</strong></div>)}</div><div><h3><Heart size={14} /> Food & activities</h3><ul>{[...plan.foodSuggestions, ...plan.activities].map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div><div><h3><Lightbulb size={14} /> Savings & contingency</h3><ul>{[...plan.savingTips, ...plan.contingencyPlan].map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div></div></section>
}

function BudgetPage({ event, planned, spent, remaining, utilization, chartData, updateEvent, updateExpense, addExpense }: {
  event: EventPlan; planned: number; spent: number; remaining: number; utilization: number
  chartData: { name: string; value: number; color: string }[]
  updateEvent: (update: Partial<EventPlan>) => void
  updateExpense: (id: string, key: 'planned' | 'actual' | 'name', value: string | number) => void
  addExpense: () => void
}) {
  const [proposal, setProposal] = useState<SavingsProposal | null>(null)
  const savings = event.expenses.reduce((sum, item) => sum + Math.max(0, item.planned * .1), 0)
  const reviewSavings = () => setProposal(proposeSavings(event, Math.min(savings, Math.max(0, planned - spent))))
  const applyProposal = () => {
    if (!proposal) return
    const changes = new Map(proposal.changes.map((change) => [change.expenseId, change.to]))
    updateEvent({ expenses: event.expenses.map((row) => changes.has(row.id) ? { ...row, planned: changes.get(row.id)! } : row) })
    setProposal(null)
  }
  return <div className="dashboard-page">
    <PageHeading eyebrow="THE NUMBERS, WITHOUT THE GUESSWORK" title="Your event budget" subtitle="Every total updates as you plan. Your budget math stays right here in the app." action={<button className="button button-dark" onClick={addExpense}><Plus size={16} /> Add expense</button>} />
    <div className="budget-controls panel"><div className="budget-total-control"><div><span className="eyebrow">YOUR TOTAL BUDGET</span><b>{formatINR(event.budget)}</b></div><label htmlFor="budget-total">Edit total budget <span>INR</span><div className="input-icon-wrap"><IndianRupee size={16} /><input id="budget-total" type="number" min="10000" step="5000" value={event.budget} onChange={(e) => updateEvent({ budget: Math.max(0, Number(e.target.value)) })} /></div></label></div><div className="budget-metrics"><div><small>Planned</small><b>{formatINR(planned)}</b></div><div><small>Actually spent</small><b>{formatINR(spent)}</b></div><div className={remaining < 0 ? 'metric-danger' : ''}><small>{remaining < 0 ? 'Over budget' : 'Remaining'}</small><b>{formatINR(remaining)}</b></div></div></div>
    {planned > event.budget && <div className="budget-warning"><ArrowUpRight size={17} /><div><b>Your planned expenses are over budget.</b><span>Review a few categories or increase your total budget to bring the plan back in balance.</span></div></div>}
    {event.guests > 0 && event.budget / event.guests < 500 && <div className="budget-warning"><Lightbulb size={17} /><div><b>This budget may be tight for the event requirements.</b><span>At under ₹500 per guest, verify venue, food, accessibility and service needs locally before committing.</span></div></div>}
    <div className="budget-content-grid"><section className="panel expense-panel"><div className="panel-heading"><div><h2>Expense categories</h2><p>Enter planned costs and update actuals as you go.</p></div><span className="table-currency">All amounts in INR</span></div><div className="expense-table-wrap"><table className="expense-table"><thead><tr><th>Category</th><th>Planned</th><th>Actual spent</th><th>Remaining</th><th aria-label="Actions" /></tr></thead><tbody>{event.expenses.map((row) => { const delta = row.planned - row.actual; return <tr key={row.id}><td><span className="expense-category"><i style={{ background: row.color }} /><input aria-label="Expense name" value={row.name} onChange={(e) => updateExpense(row.id, 'name', e.target.value)} /></span></td><td><div className="money-input"><span>₹</span><input aria-label={`${row.name} planned cost`} type="number" min="0" value={row.planned} onChange={(e) => updateExpense(row.id, 'planned', Math.max(0, Number(e.target.value)))} /></div></td><td><div className="money-input"><span>₹</span><input aria-label={`${row.name} actual cost`} type="number" min="0" value={row.actual} onChange={(e) => updateExpense(row.id, 'actual', Math.max(0, Number(e.target.value)))} /></div></td><td className={delta < 0 ? 'over-amount' : 'remaining-amount'}>{formatINR(delta)}</td><td><button className="icon-button delete-button" title={`Remove ${row.name}`} onClick={() => updateEvent({ expenses: event.expenses.filter((expense) => expense.id !== row.id) })}><Trash2 size={15} /></button></td></tr>})}</tbody></table></div><button className="add-row-button" onClick={addExpense}><Plus size={15} /> Add another category</button><div className="expense-footer"><span>Total allocated</span><b>{formatINR(planned)}</b></div></section>
    <aside className="budget-side"><section className="panel allocation-panel"><div className="panel-heading"><div><h2>Where it’s going</h2><p>Planned allocation by category.</p></div></div><div className="allocation-chart"><Suspense fallback={<span className="chart-placeholder" role="status" aria-label="Loading budget chart" />}><BudgetDonut chartData={chartData} innerRadius="65%" outerRadius="92%" formatAmount={formatINR} /></Suspense><div className="chart-center"><b>{formatINR(planned)}</b><small>planned</small></div></div><div className="budget-utilization"><div><span>Budget utilized</span><b>{utilization}%</b></div><div className="progress-track"><i style={{ width: `${Math.min(Math.max(utilization, 0), 100)}%` }} /></div><small>{formatINR(spent)} spent of {formatINR(event.budget)}</small></div></section><section className="savings-card"><div className="savings-icon"><Lightbulb size={18} /></div><div className="eyebrow">A FEW THOUGHTFUL SAVINGS</div><h3>Keep a little in reserve.</h3><p>Compare packages across vendors, reuse ceremony florals at dinner, and ask about weekday pricing. A flexible review may free up around <b>{formatINR(savings)}</b>.</p><button className="link-button" onClick={reviewSavings}>Review specific savings <ArrowRight size={14} /></button><small>Emergency reserve and actual spending are protected.</small></section></aside></div>
    {proposal && <SavingsProposalCard proposal={proposal} onApply={applyProposal} onDismiss={() => setProposal(null)} />}
    <section className="reserve-card"><div><div className="eyebrow">PEACE OF MIND, BUILT IN</div><h3>Set aside an emergency reserve</h3><p>A little contingency can go a long way if plans shift on the day.</p></div><label htmlFor="reserve-input"><span>Reserve amount</span><div className="money-input reserve-input"><span>₹</span><input id="reserve-input" type="number" min="0" value={event.expenses.find((row) => row.name === 'Emergency reserve')?.planned ?? 0} onChange={(e) => { const value = Math.max(0, Number(e.target.value)); const existing = event.expenses.find((row) => row.name === 'Emergency reserve'); updateEvent({ expenses: existing ? event.expenses.map((row) => row.id === existing.id ? { ...row, planned: value } : row) : [...event.expenses, { id: id(), name: 'Emergency reserve', planned: value, actual: 0, color: '#aaa58d' }] }) }} /></div></label></section>
  </div>
}

function SavingsProposalCard({ proposal, onApply, onDismiss, applied = false }: { proposal: SavingsProposal; onApply: () => void; onDismiss: () => void; applied?: boolean }) {
  return <section className="panel savings-proposal"><div className="savings-proposal-heading"><div><div className="eyebrow">{applied ? 'SAVED TO YOUR PLAN' : 'REVIEW BEFORE APPLYING'}</div><h2>{applied ? 'Savings plan applied' : 'Suggested expense reductions'}</h2><p>Flexible categories first; actual spend and emergency reserve remain untouched.</p></div><button className="icon-button" onClick={onDismiss} aria-label="Dismiss savings proposal"><X size={17} /></button></div><div className="savings-change-list">{proposal.changes.map((change) => <div className="savings-change-row" key={change.expenseId}><span>{change.name}</span><b>{formatINR(change.from)} <ArrowRight size={13} /> {formatINR(change.to)}</b><strong>−{formatINR(change.saving)}</strong></div>)}</div><div className="savings-proposal-footer"><div><b>{formatINR(proposal.targetSavings)} potential savings</b>{proposal.shortfall > 0 && <small>Could not safely reach the requested target; short by {formatINR(proposal.shortfall)}.</small>}</div>{!applied && <div><button className="button button-light button-small" onClick={onDismiss}>Keep current plan</button><button className="button button-dark button-small" onClick={onApply} disabled={!proposal.changes.length}>Apply these changes <Check size={13} /></button></div>}</div></section>
}

function TimelinePage({ event, tasks, updateTask, deleteTask, addTask, newTask, setNewTask, filter, setFilter }: {
  event: EventPlan; tasks: Task[]; updateTask: (id: string, update: Partial<Task>) => void; deleteTask: (id: string) => void; addTask: (e: FormEvent) => void
  newTask: string; setNewTask: (value: string) => void; filter: 'All' | TaskStatus; setFilter: (value: 'All' | TaskStatus) => void
}) {
  const sorted = [...tasks].filter((task) => filter === 'All' || task.status === filter).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const diff = (date: string) => Math.ceil((new Date(`${event.date}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) / 86400000)
  return <div className="dashboard-page"><PageHeading eyebrow="A LITTLE AT A TIME" title="Your planning timeline" subtitle="A practical run-up to the big day, generated from your event date." action={<div className="event-date-badge"><CalendarDays size={15} /> {dateLabel(event.date)}</div>} />
    <div className="timeline-summary"><div className="timeline-summary-icon"><Clock3 size={19} /></div><div><b>{tasks.length} thoughtful steps to go</b><span>Dates are suggested starting points. Adjust them to fit your plans.</span></div><span className="timeline-summary-date">{Math.max(0, dayDiff(event.date))} days out</span></div>
    <div className="timeline-layout"><section className="panel timeline-panel"><div className="panel-heading"><div><h2>Before the celebration</h2><p>Milestones arranged by due date.</p></div><FilterSelect filter={filter} setFilter={setFilter} /></div>{sorted.length ? <div className="timeline-list">{sorted.map((task) => { const overdue = task.status !== 'Done' && task.dueDate < TODAY_DATE; const remainingDays = diff(task.dueDate); return <TaskRow key={task.id} task={task} overdue={overdue} daysLabel={remainingDays > 0 ? `${remainingDays} days before` : remainingDays === 0 ? 'Event day' : 'Past date'} onChange={updateTask} onDelete={() => deleteTask(task.id)} />})}</div> : <EmptyState icon={CalendarDays} title="No tasks here yet" text="Change your filter or add a task below." />}<TaskForm addTask={addTask} newTask={newTask} setNewTask={setNewTask} /></section><EventSchedule event={event} /></div>
  </div>
}
function ChecklistPage({ event, tasks, progress, updateTask, deleteTask, addTask, newTask, setNewTask, filter, setFilter }: {
  event: EventPlan; tasks: Task[]; progress: number; updateTask: (id: string, update: Partial<Task>) => void; deleteTask: (id: string) => void; addTask: (e: FormEvent) => void
  newTask: string; setNewTask: (value: string) => void; filter: 'All' | TaskStatus; setFilter: (value: 'All' | TaskStatus) => void
}) {
  const shown = tasks.filter((task) => filter === 'All' || task.status === filter)
  return <div className="dashboard-page"><PageHeading eyebrow="ONE CHECK AT A TIME" title="Your event checklist" subtitle="Add the things that matter. Keep the little details from getting lost." action={<div className="event-date-badge"><CheckCircle2 size={15} /> {progress}% complete</div>} /><div className="checklist-progress-card panel"><div className="progress-circle"><svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="23" /><circle className="circle-progress" cx="28" cy="28" r="23" style={{ strokeDashoffset: 144 - 144 * progress / 100 }} /></svg><b>{progress}%</b></div><div><b>You’re making lovely progress.</b><span>{tasks.filter((task) => task.status === 'Done').length} of {tasks.length} tasks done for {event.name}.</span></div><div className="checklist-progress-track"><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><small>All your progress saves automatically.</small></div></div>
    <section className="panel checklist-panel"><div className="panel-heading"><div><h2>All the little things</h2><p>Your checklist, your pace.</p></div><FilterSelect filter={filter} setFilter={setFilter} /></div>{shown.length ? <div className="timeline-list">{shown.map((task) => <TaskRow key={task.id} task={task} overdue={task.status !== 'Done' && task.dueDate < TODAY_DATE} daysLabel={`Due ${dateLabel(task.dueDate, { day: 'numeric', month: 'short' })}`} onChange={updateTask} onDelete={() => deleteTask(task.id)} />)}</div> : <EmptyState icon={CheckCircle2} title="Nothing in this filter" text="Try another status or add a fresh task." />}<TaskForm addTask={addTask} newTask={newTask} setNewTask={setNewTask} /></section>
  </div>
}
function VendorsPage({ vendors, updateVendor, addVendor, deleteVendor }: {
  vendors: Vendor[]
  updateVendor: (id: string, update: Partial<Vendor>) => void
  addVendor: () => void
  deleteVendor: (id: string) => void
}) {
  const booked = vendors.filter((vendor) => vendor.status === 'Booked').length
  return <div className="dashboard-page">
    <PageHeading eyebrow="THE PEOPLE WHO BRING IT TO LIFE" title="Your vendor checklist" subtitle="Track quotes and conversations. No vendors are contacted or booked for you." action={<button className="button button-dark" onClick={addVendor}><Plus size={15} /> Add vendor</button>} />
    <div className="timeline-summary"><div className="timeline-summary-icon"><BriefcaseBusiness size={18} /></div><div><b>{booked} of {vendors.length} vendors booked</b><span>Your shortlist saves with this event in this browser.</span></div></div>
    <section className="vendor-list">{vendors.map((vendor) => <article className="panel vendor-card" key={vendor.id}>
      <div className="vendor-card-heading"><BriefcaseBusiness size={17} /><input aria-label="Vendor category" value={vendor.category} maxLength={100} onChange={(event) => updateVendor(vendor.id, { category: event.target.value })} /><button className="icon-button delete-button" aria-label={`Remove ${vendor.category || 'vendor'}`} onClick={() => deleteVendor(vendor.id)}><Trash2 size={15} /></button></div>
      <label className="vendor-field"><span>Estimated cost · INR</span><input aria-label={`Estimated cost for ${vendor.category}`} type="number" min="0" max={MAX_EVENT_BUDGET} value={vendor.estimatedCost} onChange={(event) => updateVendor(vendor.id, { estimatedCost: boundedAmount(Number(event.target.value)) })} /></label>
      <label className="vendor-field"><span>Contact or company</span><input aria-label={`Contact for ${vendor.category}`} value={vendor.contact} maxLength={120} placeholder="Add a contact" onChange={(event) => updateVendor(vendor.id, { contact: event.target.value })} /></label>
      <label className="vendor-field"><span>Planning notes</span><textarea aria-label={`Notes for ${vendor.category}`} value={vendor.notes} maxLength={500} rows={2} placeholder="Quotes, questions and details to confirm" onChange={(event) => updateVendor(vendor.id, { notes: event.target.value })} /></label>
      <label className="vendor-field"><span>Status</span><select aria-label={`Status for ${vendor.category}`} value={vendor.status} onChange={(event) => updateVendor(vendor.id, { status: event.target.value as VendorStatus })}><option>To do</option><option>Contacted</option><option>Booked</option></select></label>
    </article>)}</section>
    {!vendors.length && <EmptyState icon={BriefcaseBusiness} title="Your vendor shortlist is clear" text="Add a vendor category to start keeping track." />}
    <p className="vendor-disclaimer">Estimates and vendor details are for your personal planning only. HappiXO does not verify, contact or book vendors.</p>
  </div>
}
function FilterSelect({ filter, setFilter }: { filter: 'All' | TaskStatus; setFilter: (value: 'All' | TaskStatus) => void }) {
  return <select className="filter-select" aria-label="Filter tasks by status" value={filter} onChange={(e) => setFilter(e.target.value as 'All' | TaskStatus)}><option>All</option><option>To do</option><option>In progress</option><option>Done</option></select>
}
function TaskRow({ task, overdue, daysLabel, onChange, onDelete }: { task: Task; overdue: boolean; daysLabel: string; onChange: (id: string, update: Partial<Task>) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  return <article className={`task-row ${task.status === 'Done' ? 'task-done' : ''}`}><button className={`task-check ${task.status === 'Done' ? 'checked' : ''}`} aria-label={task.status === 'Done' ? 'Mark as not done' : 'Mark as done'} onClick={() => onChange(task.id, { status: task.status === 'Done' ? 'To do' : 'Done' })}>{task.status === 'Done' && <Check size={14} />}</button><div className="task-main">{editing ? <input className="task-edit-input" aria-label="Edit task name" autoFocus value={task.name} onChange={(e) => onChange(task.id, { name: e.target.value })} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === 'Enter' && setEditing(false)} /> : <button className="task-title-button" onClick={() => setEditing(true)} title="Click to edit task name"><b>{task.name}</b></button>}<small>{task.description}</small><div className="task-meta"><span className={overdue ? 'task-overdue' : ''}><CalendarDays size={12} /> {daysLabel}{overdue && ' · overdue'}</span><span className={`task-priority priority-text-${task.priority.toLowerCase()}`}><i /> {task.priority} priority</span></div></div><select className="task-status-select" aria-label={`Status for ${task.name}`} value={task.status} onChange={(e) => onChange(task.id, { status: e.target.value as TaskStatus })}><option>To do</option><option>In progress</option><option>Done</option></select><button className="icon-button delete-button task-delete" onClick={onDelete} aria-label={`Delete ${task.name}`}><Trash2 size={15} /></button></article>
}
function TaskForm({ addTask, newTask, setNewTask }: { addTask: (e: FormEvent) => void; newTask: string; setNewTask: (value: string) => void }) {
  return <form className="task-add-form" onSubmit={addTask}><Plus size={16} /><input aria-label="New task name" placeholder="Add something to your list…" value={newTask} onChange={(e) => setNewTask(e.target.value)} /><button className="button button-dark button-small" type="submit" disabled={!newTask.trim()}>Add task</button></form>
}
function EventSchedule({ event }: { event: EventPlan }) {
  const entries = [
    ['09:00', 'Venue access & vendor setup', 'A little breathing room before the day begins.'],
    ['11:30', 'Final walk-through', 'Check signage, seating and sound together.'],
    ['13:00', 'Guest arrival & welcome', 'Easy music, refreshments and a warm hello.'],
    ['14:00', 'The main celebration', `A moment to remember, surrounded by your people.`],
    ['16:00', 'Food, toasts & good company', 'Leave space for a few happy surprises.'],
    ['18:30', 'One last dance', 'End the day on a lovely note.'],
  ]
  return <aside className="panel day-schedule"><div className="panel-heading"><div><h2>Event-day flow</h2><p>A sample schedule · adjust with your vendors</p></div></div><div className="schedule-date"><CalendarDays size={14} /> {dateLabel(event.date, { weekday: 'short', day: 'numeric', month: 'long' })}</div><div className="schedule-items">{entries.map(([time, name, desc], index) => <div className="schedule-item" key={time}><div className="schedule-time">{time}</div><div className="schedule-line"><i className={index === entries.length - 1 ? 'last' : ''} /></div><div className="schedule-copy"><b>{name}</b><span>{desc}</span></div></div>)}</div><div className="schedule-note"><Sparkles size={14} /> A starting point, made for your kind of day.</div></aside>
}

function CopilotPage({ chat, question, setQuestion, sendQuestion, isChatLoading, applySuggestion, applyChange, applySavingsProposal, event, aiConfigured }: {
  chat: ChatMessage[]; question: string; setQuestion: (value: string) => void
  sendQuestion: (e: FormEvent) => void
  isChatLoading: boolean
  applySuggestion: (suggestion: NonNullable<ChatMessage['suggestion']>) => void
  applyChange: (change: ProposedChange) => void
  applySavingsProposal: (proposal: SavingsProposal) => void
  event: EventPlan; aiConfigured: boolean
}) {
  const [applied, setApplied] = useState<string[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])
  const suggestions = ['Reduce my budget by ₹5,000', 'What if I invite 50 more guests?', 'Give me vegetarian menu ideas', 'Suggest a traditional South Indian theme']
  return <div className="dashboard-page copilot-page">
    <PageHeading eyebrow="A THOUGHTFUL SECOND OPINION" title="Your planning companion" subtitle="Ask a question, explore an idea, and stay in control of every change." action={<span className="demo-pill"><span /> {aiConfigured ? 'Gemini connected' : 'Local demo assistant'}</span>} />
    <div className="copilot-layout">
      <section className="panel chat-panel">
        <div className="chat-header"><div className="copilot-avatar"><Sparkles size={18} /></div><div><b>HappiXO companion</b><span><i /> {aiConfigured ? 'Gemini connected · Suggestions need your approval' : 'Here to help · Local demo mode'}</span></div><button className="icon-button subtle" title="Assistant settings" aria-label="Assistant settings"><MoreHorizontal size={18} /></button></div>
        <div className="chat-context"><Sparkles size={14} /> Responses use your saved event details. Suggestions are not applied until you choose an action.</div>
        <div className="chat-messages" aria-live="polite">{chat.map((message, index) => {
          const proposalId = `${index}-budget-proposal`
          return <div className={`chat-message ${message.role}`} key={`${index}-${message.text.slice(0, 10)}`}>
            {message.role === 'assistant' && <span className="chat-mini-avatar"><Sparkles size={13} /></span>}
            <div className="chat-bubble">
              <p>{message.text}</p>
              {message.suggestion && <div className="suggestion-card"><div><span className="eyebrow">PROPOSED PLAN UPDATE</span><b>{message.suggestion.type === 'budget' ? `Budget target: ${formatINR(Number(message.suggestion.value))}` : message.suggestion.type === 'guests' ? `Guest count: ${message.suggestion.value} guests` : `Theme: ${message.suggestion.value}`}</b></div>{applied.includes(`${index}-legacy`) ? <span className="applied-label"><Check size={13} /> Applied</span> : <button className="button button-dark button-small" onClick={() => { applySuggestion(message.suggestion!); setApplied((current) => [...current, `${index}-legacy`]) }}>Apply to plan <Check size={13} /></button>}</div>}
              {message.savingsProposal && !dismissed.includes(proposalId) && <SavingsProposalCard proposal={message.savingsProposal} onDismiss={() => setDismissed((current) => [...current, proposalId])} onApply={() => { applySavingsProposal(message.savingsProposal!); setApplied((current) => [...current, proposalId]) }} applied={applied.includes(proposalId)} />}
              {message.changes?.map((change, changeIndex) => {
                const changeId = `${index}-${changeIndex}-${change.field}`
                return <div className="suggestion-card" key={changeId}><div><span className="eyebrow">SUGGESTED {change.field.toUpperCase()}</span><b>{change.field === 'budget' ? formatINR(Number(change.value)) : String(change.value)}</b><small>{change.reason}</small></div>{applied.includes(changeId) ? <span className="applied-label"><Check size={13} /> Applied</span> : <button className="button button-dark button-small" onClick={() => { applyChange(change); setApplied((current) => [...current, changeId]) }}>Apply suggestion <Check size={13} /></button>}</div>
              })}
            </div>
            {message.role === 'user' && <span className="user-mini-avatar">H</span>}
          </div>
        })}{isChatLoading && <div className="chat-message assistant chat-pending"><span className="chat-mini-avatar"><Sparkles size={13} /></span><div className="chat-bubble"><p>Reviewing your event details…</p></div></div>}</div>
        <div className="suggested-prompts"><span>TRY ASKING</span><div>{suggestions.map((prompt) => <button key={prompt} disabled={isChatLoading} onClick={() => setQuestion(prompt)}>{prompt}</button>)}</div></div>
        <form className="chat-composer" onSubmit={sendQuestion}><input aria-label="Ask your planning companion" placeholder={isChatLoading ? 'Your companion is thinking…' : 'Ask about your event…'} value={question} onChange={(e) => setQuestion(e.target.value)} disabled={isChatLoading} /><button aria-label="Send message" disabled={!question.trim() || isChatLoading}><Send size={17} /></button></form>
        <div className="chat-footnote">{aiConfigured ? 'Gemini responses · Your conversation is sent to your configured server.' : 'Demo mode · No message leaves your browser'}</div>
      </section>
      <aside className="copilot-side"><section className="panel copilot-context-card"><div className="eyebrow">YOUR CURRENT PLAN</div><h3>{event.name}</h3><div className="copilot-facts"><span><CalendarDays size={14} /> {dateLabel(event.date)}</span><span><MapPin size={14} /> {event.city}</span><span><Users size={14} /> {event.guests} guests</span><span><Wallet size={14} /> {formatINR(event.budget)} budget</span></div></section><section className="copilot-tip"><div className="tip-icon"><Lightbulb size={18} /></div><div className="eyebrow">A LITTLE TIP</div><p>Want to test an idea without changing anything? Head to <b>What-if</b> to compare estimated costs first.</p></section><section className="panel vendor-snapshot"><div className="eyebrow">VENDOR CATEGORIES</div><h3>Your planning shortlist</h3><div className="vendor-tags">{['Venue', 'Catering', 'Decor & florals', 'Photography', 'Music', 'Transport'].map((item) => <span key={item}><CheckCircle2 size={13} /> {item}</span>)}</div><small>A handy checklist—not actual vendor bookings.</small></section></aside>
    </div>
  </div>
}

function Simulator({ event, simBudget, setSimBudget, simGuests, setSimGuests, simVenue, setSimVenue, simTheme, setSimTheme, simWeather, setSimWeather, simCost, onApplyScenario }: {
  event: EventPlan; simBudget: number; setSimBudget: (value: number) => void; simGuests: number; setSimGuests: (value: number) => void
  simVenue: string; setSimVenue: (value: string) => void; simTheme: string; setSimTheme: (value: string) => void
  simWeather: boolean; setSimWeather: (value: boolean) => void; simCost: number
  onApplyScenario: (proposal?: SavingsProposal) => void
}) {
  const currentCost = event.expenses.reduce((sum, expense) => sum + expense.planned, 0)
  const impact = simCost - currentCost
  const budgetImpact = simBudget - event.budget
  const guestImpact = (simGuests - event.guests) * 1200
  const venueImpact = venueEstimate(simVenue) - venueEstimate(event.venue)
  const themeImpact = themeEstimate(simTheme) - themeEstimate(event.theme)
  const weatherAlreadyIncluded = event.expenses.some((expense) => /weather contingency|weather backup/i.test(expense.name) && expense.planned > 0)
  const weatherImpact = simWeather && !weatherAlreadyIncluded ? 22000 : 0
  const proposal = useMemo(
    () => simBudget < event.budget ? proposeSavings(event, event.budget - simBudget, simBudget) : undefined,
    [event, simBudget],
  )
  const items = [
    simGuests !== event.guests && `Food & guest services ${signedINR(guestImpact)}`,
    simVenue !== event.venue && `Venue & setup ${signedINR(venueImpact)}`,
    simTheme !== event.theme && `Decor & flowers ${signedINR(themeImpact)}`,
    weatherImpact > 0 && `Weather contingency +${formatINR(weatherImpact)}`,
  ].filter((item): item is string => typeof item === 'string')
  const nextSteps = [
    simGuests !== event.guests && 'Confirm venue capacity and per-person catering rates.',
    simVenue !== event.venue && 'Ask venues what setup, power and furniture are included.',
    simTheme !== event.theme && 'Review decor choices against the updated styling allowance.',
    weatherImpact > 0 && 'Confirm a covered backup and vendor access plan.',
    simWeather && weatherAlreadyIncluded && 'A weather contingency is already included in planned expenses.',
    simBudget < currentCost && 'Review the itemized savings proposal; the target budget is below current planned costs.',
    !items.length && simBudget === event.budget && 'Choose a scenario change to see its estimated impact.',
  ].filter((item): item is string => typeof item === 'string')
  const hasChanges = simBudget !== event.budget || simGuests !== event.guests || simVenue !== event.venue || simTheme !== event.theme || simWeather
  return <div className="dashboard-page"><PageHeading eyebrow="TRY AN IDEA ON FOR SIZE" title="The what-if studio" subtitle="Play with the possibilities. Your saved plan stays exactly as it is." action={<span className="estimate-pill"><Sparkles size={14} /> ESTIMATES ONLY</span>} />
    <div className="simulator-grid">
      <section className="panel simulator-controls">
        <div className="panel-heading"><div><h2>What would you change?</h2><p>Adjust any of the options to explore their estimated impact.</p></div></div>
        <label className="sim-control"><span><b>Event budget</b><small>Adjust your target amount</small></span><span className="sim-number"><span>₹</span><input type="number" min="10000" max={MAX_EVENT_BUDGET} step="5000" value={simBudget} onChange={(e) => setSimBudget(Math.min(MAX_EVENT_BUDGET, Math.max(10_000, Number(e.target.value))))} /></span></label>
        <label className="sim-control"><span><b>Guest count</b><small>Currently {event.guests} guests</small></span><span className="sim-number"><Users size={15} /><input type="number" min="1" max={MAX_EVENT_GUESTS} value={simGuests} onChange={(e) => setSimGuests(Math.min(MAX_EVENT_GUESTS, Math.max(1, Number(e.target.value))))} /></span></label>
        <div className="sim-control"><span><b>Venue style</b><small>Indoor or under the open sky?</small></span><div className="segmented-control">{['Indoor', 'Outdoor'].map((venue) => <button key={venue} className={simVenue === venue ? 'selected' : ''} onClick={() => setSimVenue(venue)}>{venue}</button>)}</div></div>
        <div className="sim-control"><span><b>Theme</b><small>Try a different event mood</small></span><select className="filter-select" aria-label="Simulated event theme" value={simTheme} onChange={(e) => setSimTheme(e.target.value)}>{[event.theme, ...themeOptions.map((item) => item.name).filter((name) => name !== event.theme)].map((theme) => <option key={theme}>{theme}</option>)}</select></div>
        <div className="sim-control"><span><b>Weather backup</b><small>Covered space or a tent option</small></span><button className={`toggle-switch ${simWeather ? 'on' : ''}`} role="switch" aria-checked={simWeather} onClick={() => setSimWeather(!simWeather)}><i /></button></div>
        <div className="sim-reset"><button className="link-button" onClick={() => { setSimBudget(event.budget); setSimGuests(event.guests); setSimVenue(event.venue); setSimTheme(event.theme); setSimWeather(false) }}>Reset to current plan <X size={13} /></button></div>
      </section>
      <aside className="sim-result">
        <div className="sim-result-top"><div className="eyebrow">YOUR ESTIMATED SCENARIO</div><span className="estimate-pill"><Sparkles size={13} /> NOT A FINAL QUOTE</span></div>
        <div className="sim-total">{formatINR(simCost)}</div><span className="sim-total-caption">Estimated total cost</span>
        <div className={`sim-impact ${impact > 0 ? 'impact-up' : impact < 0 ? 'impact-down' : ''}`}>{impact > 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{signedINR(impact)} <span>vs current estimated cost</span></div>
        <div className="sim-divider" /><div className="sim-detail-row"><span>Current estimated cost</span><b>{formatINR(currentCost)}</b></div>
        <div className="sim-detail-row"><span>Scenario budget limit</span><b>{formatINR(proposal?.targetBudget ?? simBudget)}</b></div>
        {simBudget !== event.budget && <div className="sim-detail-row"><span>Budget limit change</span><b>{signedINR(budgetImpact)}</b></div>}
        {simGuests !== event.guests && <div className="sim-detail-row"><span>Guest-count estimate <small>₹1,200 per person change</small></span><b>{signedINR(guestImpact)}</b></div>}
        {simVenue !== event.venue && <div className="sim-detail-row"><span>Venue adjustment <small>Estimated setup difference</small></span><b>{signedINR(venueImpact)}</b></div>}
        {simTheme !== event.theme && <div className="sim-detail-row"><span>Theme styling estimate <small>Decor and materials allowance</small></span><b>{signedINR(themeImpact)}</b></div>}
        {weatherImpact > 0 && <div className="sim-detail-row"><span>Weather backup <small>Covered-space estimate</small></span><b>+{formatINR(weatherImpact)}</b></div>}
        <div className="sim-divider" /><div className="affected-items"><b>Affected expense categories</b>{items.length ? items.map((item) => <span key={item}><CheckCircle2 size={13} /> {item}</span>) : <span><CheckCircle2 size={13} /> No expense categories affected</span>}</div>
        {nextSteps.length > 0 && <div className="sim-next-steps"><b>Suggested next steps</b>{nextSteps.map((step) => <span key={step}>{step}</span>)}</div>}
        <div className="sim-disclaimer"><Lightbulb size={15} /> Estimates use ₹1,200 per guest, fixed venue/theme allowances and ₹22,000 for weather backup. Costs are estimates, not quotes. Nothing changes until you apply the scenario.</div>
        {!proposal && <button className="button button-ivory sim-apply-button" disabled={!hasChanges} onClick={() => onApplyScenario()}><Check size={14} /> Apply reviewed scenario</button>}
      </aside>
    </div>
    {proposal && <SavingsProposalCard proposal={proposal} onDismiss={() => setSimBudget(event.budget)} onApply={() => onApplyScenario(proposal)} />}
  </div>
}

function ThemeStudio({ event, onApply }: { event: EventPlan; onApply: (theme: string) => void }) {
  const currentThemeIsCustom = !themeOptions.some((theme) => theme.name === event.theme)
  return <div className="dashboard-page"><PageHeading eyebrow="A MOOD BOARD, WITH A PLAN" title="Find your event’s feeling" subtitle={currentThemeIsCustom ? `Your saved custom theme is “${event.theme}”. Explore other directions or keep your current choice.` : 'Explore a few thoughtful directions, then bring your favourite into your plan.'} action={<span className="event-date-badge"><Flower2 size={15} /> Your style, your call</span>} /><div className="theme-studio-grid">{themeOptions.map((theme, index) => { const active = theme.name === event.theme; return <article className={`studio-theme-card ${active ? 'theme-active' : ''}`} key={theme.name}><div className={`studio-theme-art studio-art-${index}`}><div className="studio-art-shapes"><i /><i /><i /></div><div className="studio-art-caption"><span>HappiXO THEME STUDIO</span><b>{String(index + 1).padStart(2, '0')}</b></div><div className="theme-swatch-row">{theme.colors.map((color) => <i key={color} style={{ background: color }} />)}</div></div><div className="studio-theme-body"><div className="studio-title-row"><h2>{theme.name}</h2>{active && <span className="active-theme-badge"><Check size={12} /> CURRENT</span>}</div><p>{theme.desc}</p><div className="theme-detail"><span>DECOR & DETAILS</span><p>{theme.decor}</p></div><div className="theme-detail"><span>FOOD & ACTIVITIES</span><p>{theme.food} · {theme.activity}</p></div><button className={`button ${active ? 'button-light applied-button' : 'button-dark'} full-button`} disabled={active} onClick={() => onApply(theme.name)}>{active ? 'This is your current theme' : 'Make this my theme'} {!active && <ArrowRight size={15} />}</button></div></article>})}</div><div className="theme-note"><Sparkles size={15} /> Applying a theme updates your event plan. Your decor, food and activity details here are inspiration—not bookings.</div></div>
}

export default App
