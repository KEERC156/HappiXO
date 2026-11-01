import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { EventPlan } from '../types'

const PURPLE: [number, number, number] = [103, 75, 135]
const INK: [number, number, number] = [52, 43, 48]
const MUTED: [number, number, number] = [112, 103, 103]
const CREAM: [number, number, number] = [248, 242, 233]

function text(value: unknown, fallback = 'Not provided') {
  const normalized = String(value ?? '').trim()
  return (normalized || fallback)
    .replace(/[₹]/g, 'INR ')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
}

function amount(value: number) {
  return `INR ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('en-IN')}`
}

function displayDate(value: string) {
  if (!value) return 'Date to be decided'
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? 'Date to be decided'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

function addSectionTitle(pdf: jsPDF, title: string, y: number) {
  if (y > 265) {
    pdf.addPage()
    y = 20
  }
  pdf.setFillColor(...CREAM)
  pdf.roundedRect(14, y, 182, 9, 1.5, 1.5, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor(...PURPLE)
  pdf.text(title, 18, y + 6.2)
  return y + 14
}

function addTable(
  pdf: jsPDF,
  headers: string[],
  rows: string[][],
  startY: number,
) {
  autoTable(pdf, {
    startY,
    head: [headers],
    body: rows.length ? rows : [['No entries yet', ...headers.slice(1).map(() => '—')]],
    theme: 'grid',
    margin: { left: 14, right: 14, bottom: 18 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.4, textColor: INK, overflow: 'linebreak' },
    headStyles: { fillColor: PURPLE, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [252, 249, 245] },
    didDrawPage: () => {
      pdf.setFillColor(...PURPLE)
      pdf.rect(0, 0, 210, 3, 'F')
    },
  })
  return (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY
}

function dateBeforeEvent(eventDate: string, daysBeforeEvent: number) {
  const date = new Date(`${eventDate}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'Date to be decided'
  date.setUTCDate(date.getUTCDate() - daysBeforeEvent)
  return displayDate(date.toISOString().slice(0, 10))
}

export function eventPlanFilename(eventName: string) {
  const slug = eventName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return `HappiXO_Event_Plan${slug ? `_${slug}` : ''}.pdf`
}

export function createEventPlanPdf(event: EventPlan) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const generated = event.generatedPlan
  const expenses = event.expenses ?? []
  const tasks = event.tasks ?? []
  const vendors = event.vendors ?? []
  const planned = expenses.reduce((sum, item) => sum + (Number(item.planned) || 0), 0)
  const spent = expenses.reduce((sum, item) => sum + (Number(item.actual) || 0), 0)
  const allocatedBudget = generated?.budget?.length
    ? generated.budget
    : expenses.map((item) => ({ category: item.name, estimatedCost: item.planned, reason: '' }))
  const remaining = event.budget - spent
  let y = 15

  pdf.setFillColor(...PURPLE)
  pdf.roundedRect(14, y, 28, 12, 2, 2, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor(255, 255, 255)
  pdf.text('HappiXO', 17, y + 8)
  pdf.setFontSize(8)
  pdf.setTextColor(...MUTED)
  pdf.text('YOUR CELEBRATION, THOUGHTFULLY PLANNED', 47, y + 5)
  pdf.setFontSize(8)
  pdf.text(`Created ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date())}`, 47, y + 10)

  y += 22
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(22)
  pdf.setTextColor(...INK)
  const titleLines = pdf.splitTextToSize(text(event.name, 'Untitled event'), 180)
  pdf.text(titleLines, 14, y)
  y += titleLines.length * 9 + 2
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(...MUTED)
  pdf.text(`${text(event.type)}  |  ${displayDate(event.date)}  |  ${text(event.city)}`, 14, y)
  y += 9

  y = addSectionTitle(pdf, 'Event at a glance', y)
  pdf.setFontSize(9)
  pdf.setTextColor(...INK)
  const facts = [
    ['Guests', text(event.guests, '0')],
    ['Total budget', amount(event.budget || 0)],
    ['Planned allocation', amount(planned)],
    ['Spent', amount(spent)],
    ['Budget remaining', amount(remaining)],
    ['Venue', text(event.venue)],
  ]
  const factWidth = 58
  facts.forEach(([label, value], index) => {
    const column = index % 3
    const row = Math.floor(index / 3)
    const x = 14 + column * 61
    const factY = y + row * 17
    pdf.setDrawColor(226, 215, 202)
    pdf.setFillColor(252, 249, 245)
    pdf.roundedRect(x, factY, factWidth, 14, 1.5, 1.5, 'FD')
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(...MUTED)
    pdf.text(label, x + 3, factY + 5)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(...INK)
    pdf.text(pdf.splitTextToSize(value, factWidth - 6)[0] || '—', x + 3, factY + 10.5)
  })
  y += 39
  const concept = text(event.concept, '')
  if (concept) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(...INK)
    const lines = pdf.splitTextToSize(concept, 180)
    pdf.text(lines, 14, y)
    y += lines.length * 4.5 + 5
  }

  y = addSectionTitle(pdf, 'Budget allocation and expenses', y)
  const allocatedRows = allocatedBudget.map((item) => [
    text(item.category),
    amount(item.estimatedCost),
    text(item.reason, '—'),
  ])
  y = addTable(pdf, ['Budget category', 'Allocation', 'Recommendation'], allocatedRows, y) + 5
  const expenseRows = expenses.map((item) => [
    text(item.name),
    amount(item.planned),
    amount(item.actual),
    amount(item.planned - item.actual),
  ])
  y = addTable(pdf, ['Expense', 'Planned', 'Actual', 'Unspent'], expenseRows, y) + 8
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(...INK)
  pdf.text(`Event budget remaining after actual spend: ${amount(remaining)}`, 14, y)
  y += 10

  y = addSectionTitle(pdf, 'Event timeline and tasks', y)
  const timelineRows = tasks
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((task) => [
      text(task.dueDate ? displayDate(task.dueDate) : 'Date to be decided'),
      text(task.name),
      text(task.status),
      text(task.description, '—'),
    ])
  y = addTable(pdf, ['Due date', 'Task', 'Status', 'Details'], timelineRows, y) + 8
  const aiTimeline = generated?.timeline ?? []
  if (aiTimeline.length) {
    y = addSectionTitle(pdf, 'AI suggested schedule', y)
    const suggestionRows = aiTimeline.map((item) => [
      dateBeforeEvent(event.date, item.daysBeforeEvent),
      text(item.task),
      text(item.priority),
      text(item.description),
    ])
    y = addTable(pdf, ['Suggested date', 'Milestone', 'Priority', 'Details'], suggestionRows, y) + 8
  }

  y = addSectionTitle(pdf, 'Vendor checklist', y)
  const vendorRows = vendors.map((vendor) => [
    text(vendor.category),
    amount(vendor.estimatedCost),
    text(vendor.status),
    [vendor.contact, vendor.notes].filter(Boolean).map((value) => text(value)).join(' - ') || '—',
  ])
  y = addTable(pdf, ['Vendor category', 'Estimate', 'Status', 'Contact and notes'], vendorRows, y) + 8

  y = addSectionTitle(pdf, 'AI-generated recommendations', y)
  if (!generated) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(...MUTED)
    pdf.text('No AI-generated recommendations are saved for this event.', 14, y)
    y += 8
  } else {
    const recommendationGroups: Array<[string, string[]]> = [
      ['Summary', [generated.eventSummary]],
      ['Theme', [`${generated.theme.name}: ${generated.theme.description}`, `Colors: ${generated.theme.colors.join(', ')}`]],
      ['AI vendor suggestions', generated.vendorChecklist.map((item) => `${item.category} - ${amount(item.estimatedCost)} - ${item.notes}`)],
      ['Food suggestions', generated.foodSuggestions],
      ['Activities', generated.activities],
      ['Budget tips', generated.savingTips],
      ['Contingency ideas', generated.contingencyPlan],
    ]
    for (const [heading, items] of recommendationGroups) {
      const usefulItems = items.map((item) => text(item, '')).filter(Boolean)
      if (!usefulItems.length) continue
      if (y > 270) {
        pdf.addPage()
        y = 20
      }
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.setTextColor(...PURPLE)
      pdf.text(heading, 14, y)
      y += 5
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8.5)
      pdf.setTextColor(...INK)
      for (const item of usefulItems) {
        const lines = pdf.splitTextToSize(`- ${item}`, 180)
        if (y + lines.length * 4 > 275) {
          pdf.addPage()
          y = 20
        }
        pdf.text(lines, 16, y)
        y += lines.length * 4 + 1
      }
      y += 3
    }
  }

  if (event.requirements?.trim()) {
    y = addSectionTitle(pdf, 'Special requirements and notes', y + 3)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(...INK)
    const requirementLines = pdf.splitTextToSize(text(event.requirements), 180)
    pdf.text(requirementLines, 14, y)
  }

  const pageCount = pdf.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page)
    pdf.setDrawColor(226, 215, 202)
    pdf.line(14, 284, 196, 284)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(...MUTED)
    pdf.text('HappiXO event plan | Estimates are planning guidance, not vendor quotes.', 14, 289)
    pdf.text(`${page} / ${pageCount}`, 196, 289, { align: 'right' })
  }

  return { pdf, filename: eventPlanFilename(event.name) }
}

export async function downloadEventPlanPdf(event: EventPlan) {
  const { pdf, filename } = createEventPlanPdf(event)
  await pdf.save(filename, { returnPromise: true })
  return filename
}
