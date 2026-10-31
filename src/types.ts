import type { GeneratedPlan } from './ai'

export type Category = 'Wedding' | 'Birthday' | 'College event' | 'Community gathering' | 'Other'
export type TaskStatus = 'To do' | 'In progress' | 'Done'
export type Priority = 'High' | 'Medium' | 'Low'
export type Expense = { id: string; name: string; planned: number; actual: number; color: string }
export type Task = { id: string; name: string; description: string; dueDate: string; priority: Priority; status: TaskStatus }
export type VendorStatus = 'To do' | 'Contacted' | 'Booked'
export type Vendor = { id: string; category: string; estimatedCost: number; status: VendorStatus; contact: string; notes: string }
export type EventPlan = {
  id: string
  name: string
  type: Category
  date: string
  city: string
  budget: number
  guests: number
  theme: string
  food: string
  venue: string
  requirements: string
  concept: string
  expenses: Expense[]
  tasks: Task[]
  vendors: Vendor[]
  created: string
  generatedPlan?: GeneratedPlan
}
export type WizardData = Omit<EventPlan, 'id' | 'concept' | 'expenses' | 'tasks' | 'vendors' | 'created' | 'generatedPlan'>
