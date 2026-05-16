// Task CRUD service.
// Every mutation also inserts a task_events row so the ChatGPT agent can
// see user-side changes on the next agent-context call.
//
// SECURITY:
// - user_id is set by RLS from the authenticated session JWT; never passed
//   in insert/update payloads from the app.
// - task_events are user-scoped by RLS as well.

import { supabase } from '../lib/supabase'
import type { Task, TaskPriority, TaskStatus } from '../types/database'

export type { TaskStatus, TaskPriority }

export async function fetchTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .neq('status', 'archived')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function createTask(input: {
  title: string
  description?: string
  priority?: TaskPriority
  due_at?: string
}): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: input.title,
      description: input.description ?? null,
      status: 'open' as TaskStatus,
      priority: input.priority ?? 'medium',
      due_at: input.due_at ?? null,
      source: 'user',
    })
    .select()
    .single()

  if (error) throw error

  // Emit task event — failures here are non-blocking
  await supabase.from('task_events').insert({
    task_id: data.id,
    actor: 'user',
    event_type: 'created',
    new_status: 'open',
    details: {},
  })

  return data
}

export async function updateTaskStatus(
  task: Task,
  newStatus: TaskStatus,
): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', task.id)

  if (error) throw error

  await supabase.from('task_events').insert({
    task_id: task.id,
    actor: 'user',
    event_type: 'status_changed',
    previous_status: task.status,
    new_status: newStatus,
    details: {},
  })
}

export async function completeTask(task: Task): Promise<void> {
  return updateTaskStatus(task, 'done')
}

export async function snoozeTask(task: Task, until: Date): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'waiting' as TaskStatus,
      snoozed_until: until.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', task.id)

  if (error) throw error

  await supabase.from('task_events').insert({
    task_id: task.id,
    actor: 'user',
    event_type: 'snoozed',
    previous_status: task.status,
    new_status: 'waiting',
    details: { snoozed_until: until.toISOString() },
  })
}

export async function updateTaskFields(
  taskId: string,
  fields: { title?: string; description?: string; priority?: TaskPriority },
): Promise<void> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.title !== undefined) updates.title = fields.title
  if (fields.description !== undefined) updates.description = fields.description
  if (fields.priority !== undefined) updates.priority = fields.priority

  const { error } = await supabase.from('tasks').update(updates).eq('id', taskId)
  if (error) throw error

  await supabase.from('task_events').insert({
    task_id: taskId,
    actor: 'user',
    event_type: 'updated',
    details: { fields: Object.keys(fields) },
  })
}

