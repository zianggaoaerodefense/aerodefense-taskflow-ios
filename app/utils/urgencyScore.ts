// Utility: compute urgency and importance scores from task fields.

export interface ScoringInput {
  priority?: string | null
  due_at?: string | null
  source?: string | null
  source_type?: string | null
  task_category?: string | null
  tags?: string[]
  metadata?: Record<string, unknown>
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Same local-date parsing as groupKeys.ts: date-only strings are local midnight.
function parseDueDate(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(s)
}

function getTimeScore(due_at: string | null | undefined): number {
  if (!due_at) return 0
  const due = parseDueDate(due_at)
  const today = startOfDay(new Date())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dayAfterTomorrow = new Date(tomorrow)
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1)
  const weekEnd = new Date(today)
  weekEnd.setDate(weekEnd.getDate() + 7)

  if (due < today) return 50
  if (due < tomorrow) return 40
  if (due < dayAfterTomorrow) return 30
  if (due < weekEnd) return 15
  return 0
}

function getPriorityScore(priority?: string | null): number {
  switch (priority) {
    case 'critical': return 50
    case 'high': return 40
    case 'medium': return 20
    case 'low': return 5
    default: return 10
  }
}

function getContextScore(input: ScoringInput): number {
  let score = 0
  const tags = (input.tags ?? []).map((t) => t.toLowerCase())
  const metaStr = JSON.stringify(input.metadata ?? {}).toLowerCase()

  if (input.source === 'calendar') score += 25
  if (input.source === 'github' && input.source_type === 'github_pr') score += 20
  if (input.source === 'slack' && (tags.includes('dm') || tags.includes('mention'))) score += 20
  if (input.source === 'email' && (tags.includes('external') || tags.includes('customer'))) score += 25
  if (
    input.source === 'jira' &&
    (tags.includes('blocker') || tags.includes('blocked') || metaStr.includes('blocker'))
  ) score += 30

  const highImpact = ['production', 'deploy', 'incident', 'customer', 'proposal', 'demo', 'commitment']
  for (const kw of highImpact) {
    if (tags.some((t) => t.includes(kw)) || metaStr.includes(kw)) {
      score += 25
      break
    }
  }

  return Math.min(score, 50)
}

export function computeUrgencyScore(input: ScoringInput): number {
  return getPriorityScore(input.priority) + getTimeScore(input.due_at) + getContextScore(input)
}

export function computeImportanceScore(input: ScoringInput): number {
  let score = getPriorityScore(input.priority)
  const tags = (input.tags ?? []).map((t) => t.toLowerCase())
  const metaStr = JSON.stringify(input.metadata ?? {}).toLowerCase()

  const importantKeywords = ['customer', 'proposal', 'demo', 'deployment', 'production', 'commitment']
  for (const kw of importantKeywords) {
    if (tags.some((t) => t.includes(kw)) || metaStr.includes(kw)) {
      score += 20
      break
    }
  }

  if (['jira', 'github', 'calendar'].includes(input.source ?? '')) score += 10
  return Math.min(score, 100)
}
