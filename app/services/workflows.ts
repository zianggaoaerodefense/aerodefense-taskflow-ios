import { supabase } from '../lib/supabase'
import type { Workflow } from '../types/database'

export async function fetchWorkflows(): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id, name, description, status, created_at, updated_at')
    .neq('status', 'archived')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as Workflow[]
}
