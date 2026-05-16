import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { supabase } from '../../lib/supabase'
import { completeTask, createTask, fetchTasks } from '../../services/tasks'
import type { Task, TaskPriority, TaskStatus } from '../../types/database'

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

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'critical']
const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export default function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)

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

  async function handleCreate(input: { title: string; description?: string; priority: TaskPriority }) {
    try {
      await createTask(input)
      await load(true)
    } catch {
      Alert.alert('Error', 'Could not create task.')
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
    <View style={styles.root}>
      <FlatList
        data={tasks}
        keyExtractor={(t) => t.id}
        contentContainerStyle={tasks.length === 0 ? styles.center : styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load()} />
        }
        ListEmptyComponent={
          <Text style={styles.muted}>No open tasks. Tap + to create one or the ChatGPT agent will add them here.</Text>
        }
        renderItem={({ item }) => (
          <TaskCard task={item} onComplete={() => handleComplete(item)} />
        )}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)} activeOpacity={0.85}>
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>
      <CreateTaskModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onCreate={async (input) => {
          setModalVisible(false)
          await handleCreate(input)
        }}
      />
    </View>
  )
}

function CreateTaskModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean
  onClose: () => void
  onCreate: (input: { title: string; description?: string; priority: TaskPriority }) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setTitle('')
    setDescription('')
    setPriority('medium')
    setSubmitting(false)
  }

  async function handleAdd() {
    if (!title.trim()) {
      Alert.alert('Required', 'Please enter a task title.')
      return
    }
    setSubmitting(true)
    await onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
    })
    reset()
  }

  function handleCancel() {
    reset()
    onClose()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={handleCancel}
    >
      <View style={modal.container}>
        <View style={modal.header}>
          <Pressable onPress={handleCancel} style={modal.headerBtn}>
            <Text style={modal.cancel}>Cancel</Text>
          </Pressable>
          <Text style={modal.headerTitle}>New Task</Text>
          <Pressable onPress={handleAdd} disabled={submitting} style={modal.headerBtn}>
            <Text style={[modal.add, submitting && modal.addDisabled]}>Add</Text>
          </Pressable>
        </View>

        <View style={modal.body}>
          <TextInput
            style={modal.titleInput}
            placeholder="Title"
            placeholderTextColor="#C7C7CC"
            value={title}
            onChangeText={setTitle}
            autoFocus
            returnKeyType="next"
          />
          <TextInput
            style={modal.descInput}
            placeholder="Description (optional)"
            placeholderTextColor="#C7C7CC"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <Text style={modal.sectionLabel}>Priority</Text>
          <View style={modal.priorityRow}>
            {PRIORITIES.map((p) => (
              <Pressable
                key={p}
                style={[
                  modal.priorityChip,
                  priority === p && { backgroundColor: PRIORITY_COLOR[p], borderColor: PRIORITY_COLOR[p] },
                ]}
                onPress={() => setPriority(p)}
              >
                <Text
                  style={[
                    modal.priorityChipText,
                    priority === p && modal.priorityChipTextActive,
                  ]}
                >
                  {PRIORITY_LABEL[p]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
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
  root: { flex: 1 },
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
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabIcon: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '400' },
})

const modal = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  headerBtn: { minWidth: 60 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  cancel: { fontSize: 17, color: '#8E8E93' },
  add: { fontSize: 17, fontWeight: '600', color: '#007AFF', textAlign: 'right' },
  addDisabled: { opacity: 0.4 },
  body: { padding: 16, gap: 12 },
  titleInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1a1a1a',
  },
  descInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1a1a1a',
    minHeight: 80,
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5 },
  priorityRow: { flexDirection: 'row', gap: 8 },
  priorityChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#C6C6C8',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  priorityChipText: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  priorityChipTextActive: { color: '#fff' },
})
