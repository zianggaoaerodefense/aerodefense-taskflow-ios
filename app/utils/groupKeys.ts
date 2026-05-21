// Utility: generate group keys from a task for multi-dimensional grouping.

export interface TaskGroupKeys {
  by_source: string
  by_action: string
  by_workflow: string
  by_project: string
  by_time: string
  by_requester: string
  by_owner: string
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function getTimeGroup(due_at: string | null | undefined): string {
  if (!due_at) return 'No Date'
  const due = new Date(due_at)
  const today = startOfDay(new Date())
  if (due < today) return 'Overdue'
  if (due < addDays(today, 1)) return 'Today'
  if (due < addDays(today, 2)) return 'Tomorrow'
  if (due < addDays(today, 7)) return 'This Week'
  return 'Later'
}

export function getSourceLabel(source: string, source_type?: string | null): string {
  if (source === 'github') {
    if (source_type === 'github_pr') return 'GitHub PR'
    if (source_type === 'github_issue') return 'GitHub Issue'
    return 'GitHub'
  }
  const map: Record<string, string> = {
    email: 'Email',
    slack: 'Slack',
    calendar: 'Calendar',
    jira: 'Jira',
    chatgpt_agent: 'Agent',
    agent: 'Agent',
    manual: 'Manual',
    user: 'Manual',
  }
  return map[source] ?? source
}

export function getCategoryLabel(category: string | null | undefined): string {
  if (!category) return 'Uncategorized'
  const map: Record<string, string> = {
    follow_up: 'Follow Up',
    review: 'Review',
    respond: 'Respond',
    prepare: 'Prepare',
    investigate: 'Investigate',
    implement: 'Implement',
    approve: 'Approve',
    decide: 'Decide',
    schedule: 'Schedule',
    monitor: 'Monitor',
    test: 'Test',
    deploy: 'Deploy',
    summarize: 'Summarize',
    delegate: 'Delegate',
    blocked: 'Blocked',
  }
  return map[category] ?? category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ')
}

export function generateTaskGroupKeys(task: {
  source: string
  source_type?: string | null
  task_category?: string | null
  workflow_name?: string | null
  project_name?: string | null
  due_at?: string | null
  requester?: string | null
  owner?: string | null
}): TaskGroupKeys {
  return {
    by_source: getSourceLabel(task.source, task.source_type),
    by_action: getCategoryLabel(task.task_category),
    by_workflow: task.workflow_name || 'Uncategorized',
    by_project: task.project_name || 'Uncategorized',
    by_time: getTimeGroup(task.due_at),
    by_requester: task.requester || 'Unknown',
    by_owner: task.owner || 'Unknown',
  }
}
