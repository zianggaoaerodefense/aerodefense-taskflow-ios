import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { supabase } from '../../lib/supabase'
import { completeTask, fetchTasks } from '../../services/tasks'
import type { Task, TaskPriority, TaskStatus } from '../../types/database'

// Status display helpers
const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  done: 'Done',
  archived: 'Archived',
}
const STATUS_COLOR: Record<TaskStatus, string> = {
  open: '#007AFF',
  in_progress: '#FF9500',
  waiting: '#FFCC00',
  done: '#34C759',
  archived: '#8E8E93',
}
const PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: '#8E8E93',
  medium: '#007AFF',
  high: '#FF9500',
  critical: '#FF3B30',
}

export default function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      setTasks(await fetchTasks())
    } catch {
      Alert.alert('Error', 'Could not load tasks.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load(true) }, [load])

  // Realtime subscription: refresh when the agent creates or updates a task
  useEffect(() => {
    const channel = supabase
      .channel('tasks-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        () => load(true),
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [load])

  async function handleComplete(task: Task) {
    try {
      await completeTask(task)
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: 'done' } : t)),
      )
    } catch {
      Alert.alert('Error', 'Could not complete task.')
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    )
  }

  return (
    <FlatList
      data={tasks}
      keyExtractor={(t) => t.id}
      contentContainerStyle={tasks.length === 0 ? styles.center : styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load()} />
      }
      ListEmptyComponent={
        <Text style={styles.muted}>No open tasks. The ChatGPT agent will add them here.</Text>
      }
      renderItem={({ item }) => (
        <TaskCard task={item} onComplete={() => handleComplete(item)} />
      )}
    />
  )
}

function TaskCard({ task, onComplete }: { task: Task; onComplete: () => void }) {
  const statusColor = STATUS_COLOR[task.status] ?? '#8E8E93'
  const priorityColor = PRIORITY_COLOR[task.priority] ?? '#8E8E93'

  return (
    <View style={[styles.card, { borderLeftColor: statusColor }]}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {task.title}
        </Text>
        <View style={[styles.chip, { backgroundColor: statusColor }]}>
          <Text style={styles.chipText}>{STATUS_LABEL[task.status]}</Text>
        </View>
      </View>

      {task.description ? (
        <Text style={styles.cardDesc} numberOfLines={2}>
          {task.description}
        </Text>
      ) : null}

      <View style={styles.cardBottom}>
        <Text style={[styles.priority, { color: priorityColor }]}>
          {task.priority.toUpperCase()}
        </Text>

        {task.source === 'agent' && (
          <View style={styles.agentBadge}>
            <Text style={styles.agentBadgeText}>Agent</Text>
          </View>
        )}

        {task.due_at && (
          <Text style={styles.due}>Due {task.due_at.slice(0, 10)}</Text>
        )}

        {task.status !== 'done' && task.status !== 'archived' && (
          <TouchableOpacity style={styles.doneBtn} onPress={onComplete}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { color: '#8E8E93', fontSize: 15, textAlign: 'center' },
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  cardDesc: { fontSize: 13, color: '#666', marginBottom: 8 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  priority: { fontSize: 11, fontWeight: '700' },
  agentBadge: {
    backgroundColor: '#F5EEFF',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  agentBadgeText: { color: '#AF52DE', fontSize: 11, fontWeight: '600' },
  due: { fontSize: 12, color: '#FF9500' },
  doneBtn: {
    marginLeft: 'auto',
    backgroundColor: '#34C759',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  doneBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
})
