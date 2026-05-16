import { supabase } from '../lib/supabase'
import type { Summary } from '../types/database'

export async function fetchSummaries(): Promise<Summary[]> {
  const { data, error } = await supabase
    .from('summaries')
    .select('id, title, content, source, status, created_at, updated_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return data as Summary[]
}
