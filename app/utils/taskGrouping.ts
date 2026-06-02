// Utility: group and sort tasks for multi-dimensional views.

import type { Task } from '../types/database'
import { generateTaskGroupKeys, getTimeGroup } from './groupKeys'

export type GroupViewMode =
  | 'time'
  | 'source'
  | 'action'
  | 'workflow'
  | 'project'
  | 'requester'
  | 'priority'

export const VIEW_MODE_LABELS: Record<GroupViewMode, string> = {
  time: 'Time',
  source: 'Source',
  action: 'Action',
  workflow: 'Workflow',
  project: 'Project',
  requester: 'Requester',
  priority: 'Priority',
}

export const VIEW_MODES: GroupViewMode[] = [
  'time',
  'source',
  'action',
  'workflow',
  'project',
  'requester',
  'priority',
]

export type SortKey = 'urgency' | 'due' | 'created' | 'priority' | 'source'

export const SORT_KEY_LABELS: Record<SortKey, string> = {
  urgency: 'Urgency',
  due: 'Due Date',
  created: 'Created',
  priority: 'Priority',
  source: 'Source',
}

export const SORT_KEYS: SortKey[] = ['urgency', 'due', 'created', 'priority', 'source']

export interface TaskGroup {
  key: string
  label: string
  tasks: Task[]
  openCount: number
  highPriorityCount: number
  nextDue: Task | null
}

const TIME_ORDER = ['Overdue', 'Today', 'Tomorrow', 'This Week', 'Later', 'No Date']
const PRIORITY_ORDER = ['Critical', 'High', 'Medium', 'Low']

const STATUS_RANK: Record<string, number> = {
  open: 0,
  in_progress: 1,
  waiting: 2,
  done: 3,
  archived: 4,
}
const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function comparePrimary(a: Task, b: Task, key: SortKey): number {
  switch (key) {
    case 'due':
      if (a.due_at && b.due_at) return new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
      if (a.due_at) return -1
      if (b.due_at) return 1
      return 0
    case 'created':
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    case 'priority': {
      const pa = PRIORITY_RANK[a.priority] ?? 4
      const pb = PRIORITY_RANK[b.priority] ?? 4
      return pa - pb
    }
    case 'source':
      return a.source.localeCompare(b.source)
    default:
      return 0
  }
}

export function sortTasks(tasks: Task[], sortKey: SortKey = 'urgency'): Task[] {
  return [...tasks].sort((a, b) => {
    const sa = STATUS_RANK[a.status] ?? 5
    const sb = STATUS_RANK[b.status] ?? 5
    if (sa !== sb) return sa - sb

    // User-chosen primary sort key (when not urgency, apply before the default chain)
    if (sortKey !== 'urgency') {
      const primary = comparePrimary(a, b, sortKey)
      if (primary !== 0) return primary
    }

    const ua = a.urgency_score ?? 0
    const ub = b.urgency_score ?? 0
    if (ua !== ub) return ub - ua

    if (a.due_at && b.due_at)
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
    if (a.due_at) return -1
    if (b.due_at) return 1

    const pa = PRIORITY_RANK[a.priority] ?? 4
    const pb = PRIORITY_RANK[b.priority] ?? 4
    if (pa !== pb) return pa - pb

    if (a.last_source_at || b.last_source_at) {
      if (!a.last_source_at) return 1
      if (!b.last_source_at) return -1
      return new Date(b.last_source_at).getTime() - new Date(a.last_source_at).getTime()
    }

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function isActive(t: Task): boolean {
  return t.status === 'open' || t.status === 'in_progress' || t.status === 'waiting'
}

function isHighPriority(t: Task): boolean {
  return t.priority === 'high' || t.priority === 'critical'
}

function makeGroup(key: string, tasks: Task[], sortKey: SortKey = 'urgency'): TaskGroup {
  const sorted = sortTasks(tasks, sortKey)
  const activeTasks = tasks.filter(isActive)
  const nextDue =
    activeTasks
      .filter((t) => t.due_at != null)
      .reduce<Task | null>(
        (earliest, t) =>
          earliest === null ||
          new Date(t.due_at!).getTime() < new Date(earliest.due_at!).getTime()
            ? t
            : earliest,
        null,
      )
  return {
    key,
    label: key,
    tasks: sorted,
    openCount: activeTasks.length,
    highPriorityCount: activeTasks.filter(isHighPriority).length,
    nextDue,
  }
}

function getGroupKey(task: Task, mode: GroupViewMode): string {
  const keys = generateTaskGroupKeys(task)
  switch (mode) {
    case 'time': return keys.by_time
    case 'source': return keys.by_source
    case 'action': return keys.by_action
    case 'workflow': return keys.by_workflow
    case 'project': return keys.by_project
    case 'requester': return keys.by_requester
    case 'priority': {
      const p = task.priority
      return p === 'critical' ? 'Critical' : p === 'high' ? 'High' : p === 'medium' ? 'Medium' : 'Low'
    }
  }
}

export function groupTasks(tasks: Task[], mode: GroupViewMode, sortKey: SortKey = 'urgency'): TaskGroup[] {
  const map = new Map<string, Task[]>()
  for (const task of tasks) {
    const key = getGroupKey(task, mode)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(task)
  }

  const groups = Array.from(map.entries()).map(([key, t]) => makeGroup(key, t, sortKey))

  if (mode === 'time') {
    groups.sort((a, b) => {
      const ai = TIME_ORDER.indexOf(a.key)
      const bi = TIME_ORDER.indexOf(b.key)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  } else if (mode === 'priority') {
    groups.sort((a, b) => {
      const ai = PRIORITY_ORDER.indexOf(a.key)
      const bi = PRIORITY_ORDER.indexOf(b.key)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  } else {
    groups.sort((a, b) => {
      if (b.openCount !== a.openCount) return b.openCount - a.openCount
      return a.label.localeCompare(b.label)
    })
  }

  return groups
}

export function getTaskTimeGroup(task: Task): string {
  return getTimeGroup(task.due_at)
}
