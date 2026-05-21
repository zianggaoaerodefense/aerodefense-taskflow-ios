import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  Alert,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  SectionListData,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { supabase } from '../../lib/supabase'
import {
  completeTask,
  createTask,
  fetchTasks,
  updateTaskStatus,
} from '../../services/tasks'
import type { Task, TaskPriority, TaskStatus } from '../../types/database'
import { getSourceLabel, getCategoryLabel } from '../../utils/groupKeys'
import {
  groupTasks,
  sortTasks,
  type GroupViewMode,
  type TaskGroup,
  VIEW_MODES,
  VIEW_MODE_LABELS,
} from '../../utils/taskGrouping'

// ---------------------------------------------------------------------------
// Display constants
// ---------------------------------------------------------------------------

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
const SOURCE_BADGE: Record<string, { bg: string; fg: string }> = {
  email:        { bg: '#FF9500', fg: '#fff' },
  slack:        { bg: '#4A154B', fg: '#fff' },
  calendar:     { bg: '#34C759', fg: '#fff' },
  jira:         { bg: '#0052CC', fg: '#fff' },
  github:       { bg: '#1a1a1a', fg: '#fff' },
  chatgpt_agent:{ bg: '#6E40C9', fg: '#fff' },
  agent:        { bg: '#6E40C9', fg: '#fff' },
  manual:       { bg: '#8E8E93', fg: '#fff' },
  user:         { bg: '#8E8E93', fg: '#fff' },
}
const CATEGORY_BADGE: Record<string, string> = {
  review:      '#FF9500',
  respond:     '#007AFF',
  investigate: '#FFCC00',
  implement:   '#34C759',
  prepare:     '#5AC8FA',
  approve:     '#FF3B30',
  follow_up:   '#FF6B35',
  decide:      '#BF5AF2',
  schedule:    '#32ADE6',
  monitor:     '#30B0C7',
  test:        '#34C759',
  deploy:      '#FF3B30',
  summarize:   '#636366',
  delegate:    '#8E8E93',
  blocked:     '#FF3B30',
}

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'critical']
const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
}
const ACTION_BTN_W = 90

// ---------------------------------------------------------------------------
// TasksScreen
// ---------------------------------------------------------------------------

type TaskSection = SectionListData<Task, {
  key: string
  label: string
  openCount: number
  highPriorityCount: number
  nextDue: Task | null
}>

export default function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [viewMode, setViewMode] = useState<GroupViewMode>('time')

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

  useFocusEffect(useCallback(() => { load(true) }, [load]))

  useEffect(() => {
    const channel = supabase
      .channel(`tasks-changes-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        () => load(true),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const sections = useMemo<TaskSection[]>(() => {
    const groups = groupTasks(tasks, viewMode)
    return groups.map((g) => ({
      key: g.key,
      label: g.label,
      openCount: g.openCount,
      highPriorityCount: g.highPriorityCount,
      nextDue: g.nextDue,
      data: g.tasks,
    }))
  }, [tasks, viewMode])

  async function handleComplete(task: Task) {
    try {
      await completeTask(task)
      setTasks((prev: Task[]) =>
        prev.map((t: Task) => (t.id === task.id ? { ...t, status: 'done' as TaskStatus } : t)),
      )
    } catch {
      Alert.alert('Error', 'Could not complete task.')
    }
  }

  async function handleArchive(task: Task) {
    try {
      await updateTaskStatus(task, 'archived')
      setTasks((prev: Task[]) => prev.filter((t: Task) => t.id !== task.id))
    } catch {
      Alert.alert('Error', 'Could not archive task.')
    }
  }

  async function handleReopen(task: Task) {
    try {
      await updateTaskStatus(task, 'open')
      setTasks((prev: Task[]) =>
        prev.map((t: Task) =>
          t.id === task.id ? { ...t, status: 'open' as TaskStatus, updated_at: new Date().toISOString() } : t,
        ),
      )
    } catch {
      Alert.alert('Error', 'Could not reopen task.')
    }
  }

  async function handleCreate(input: {
    title: string
    description?: string
    priority: TaskPriority
  }) {
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

  const isEmpty = tasks.length === 0

  return (
    <View style={styles.root}>
      <ViewModePicker current={viewMode} onChange={setViewMode} />
      <SectionList<Task, TaskSection>
        sections={sections}
        keyExtractor={(t: Task) => t.id}
        contentContainerStyle={isEmpty ? styles.center : styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load()} />
        }
        ListEmptyComponent={
          <Text style={styles.muted}>
            No open tasks. Tap + to create one or the ChatGPT agent will add them here.
          </Text>
        }
        renderSectionHeader={({ section }: { section: TaskSection }) => (
          <GroupHeader
            label={section.label as string}
            openCount={section.openCount as number}
            highPriorityCount={section.highPriorityCount as number}
            nextDue={section.nextDue as Task | null}
          />
        )}
        renderItem={({ item }: { item: Task }) => (
          <SwipeableTaskCard
            task={item}
            onComplete={() => handleComplete(item)}
            onArchive={() => handleArchive(item)}
            onReopen={() => handleReopen(item)}
          />
        )}
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.85}
      >
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

// ---------------------------------------------------------------------------
// ViewModePicker — horizontal scrollable chip selector
// ---------------------------------------------------------------------------

function ViewModePicker({
  current,
  onChange,
}: {
  current: GroupViewMode
  onChange: (m: GroupViewMode) => void
}) {
  return (
    <View style={picker.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={picker.scroll}
      >
        {VIEW_MODES.map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[picker.chip, current === mode && picker.chipActive]}
            onPress={() => onChange(mode)}
            activeOpacity={0.75}
          >
            <Text style={[picker.chipText, current === mode && picker.chipTextActive]}>
              {VIEW_MODE_LABELS[mode]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

// ---------------------------------------------------------------------------
// GroupHeader
// ---------------------------------------------------------------------------

function GroupHeader({
  label,
  openCount,
  highPriorityCount,
  nextDue,
}: {
  label: string
  openCount: number
  highPriorityCount: number
  nextDue: Task | null
}) {
  return (
    <View style={gh.wrap}>
      <View style={gh.top}>
        <Text style={gh.label}>{label}</Text>
        <View style={gh.stats}>
          <Text style={gh.stat}>{openCount} open</Text>
          {highPriorityCount > 0 && (
            <Text style={[gh.stat, gh.statHigh]}>{highPriorityCount} high</Text>
          )}
        </View>
      </View>
      {nextDue && (
        <Text style={gh.nextDue} numberOfLines={1}>
          Next due: {fmtDate(nextDue.due_at!)} — {nextDue.title}
        </Text>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// SwipeableTaskCard
// ---------------------------------------------------------------------------

function SwipeableTaskCard({
  task,
  onComplete,
  onArchive,
  onReopen,
}: {
  task: Task
  onComplete: () => void
  onArchive: () => void
  onReopen: () => void
}) {
  const isDone = task.status === 'done'
  const snapWidth = isDone ? ACTION_BTN_W * 2 : ACTION_BTN_W

  const snapRef = useRef(snapWidth)
  const onArchiveRef = useRef(onArchive)
  const onReopenRef = useRef(onReopen)
  snapRef.current = snapWidth
  onArchiveRef.current = onArchive
  onReopenRef.current = onReopen

  const translateX = useRef(new Animated.Value(0)).current
  const positionRef = useRef(0)

  useEffect(() => {
    const id = translateX.addListener(({ value }: { value: number }) => { positionRef.current = value })
    return () => translateX.removeListener(id)
  }, [translateX])

  function snapOpen() {
    Animated.spring(translateX, { toValue: -snapRef.current, useNativeDriver: true, bounciness: 2 }).start()
  }
  function snapClose() {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start()
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt: unknown, g: { dx: number; dy: number }) =>
        Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderGrant: () => {
        translateX.setOffset(positionRef.current)
        translateX.setValue(0)
      },
      onPanResponderMove: (_evt: unknown, g: { dx: number }) => {
        translateX.setValue(Math.max(Math.min(g.dx, 16), -(snapRef.current + 12)))
      },
      onPanResponderRelease: (_evt: unknown, g: { dx: number; vx: number }) => {
        translateX.flattenOffset()
        if (g.dx < -40 || (g.vx < -0.5 && positionRef.current < -16)) {
          snapOpen()
        } else {
          snapClose()
        }
      },
      onPanResponderTerminate: () => {
        translateX.flattenOffset()
        snapClose()
      },
    }),
  ).current

  return (
    <View style={swipe.container}>
      <View style={[swipe.actions, { width: snapWidth }]}>
        {isDone && (
          <TouchableOpacity
            style={[swipe.btn, { backgroundColor: '#007AFF' }]}
            onPress={() => { snapClose(); onReopenRef.current() }}
          >
            <Text style={swipe.btnText}>Re-open</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[swipe.btn, { backgroundColor: '#FF3B30' }]}
          onPress={() => { snapClose(); onArchiveRef.current() }}
        >
          <Text style={swipe.btnText}>Archive</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <TaskCard
          task={task}
          onComplete={() => { snapClose(); onComplete() }}
          onIgnore={() => { snapClose(); onArchiveRef.current() }}
        />
      </Animated.View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// TaskCard — with source, category, workflow, and requester badges
// ---------------------------------------------------------------------------

function SourceBadge({ source, source_type }: { source: string; source_type?: string | null }) {
  const label = source === 'github' && source_type === 'github_pr'
    ? 'PR'
    : source === 'github' && source_type === 'github_issue'
    ? 'Issue'
    : getSourceLabel(source, source_type).replace('GitHub ', '')
  const style = SOURCE_BADGE[source] ?? { bg: '#8E8E93', fg: '#fff' }
  return (
    <View style={[badge.wrap, { backgroundColor: style.bg }]}>
      <Text style={[badge.text, { color: style.fg }]}>{label}</Text>
    </View>
  )
}

function CategoryBadge({ category }: { category: string }) {
  const bg = CATEGORY_BADGE[category] ?? '#8E8E93'
  return (
    <View style={[badge.wrap, { backgroundColor: bg + '22', borderWidth: 1, borderColor: bg }]}>
      <Text style={[badge.text, { color: bg }]}>{getCategoryLabel(category)}</Text>
    </View>
  )
}

function TaskCard({ task, onComplete, onIgnore }: {
  task: Task
  onComplete: () => void
  onIgnore: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const statusColor = STATUS_COLOR[task.status] ?? '#8E8E93'
  const priorityColor = PRIORITY_COLOR[task.priority] ?? '#8E8E93'
  const isActive = task.status !== 'done' && task.status !== 'archived'

  return (
    <View style={[styles.card, { borderLeftColor: statusColor }]}>
      <Pressable onPress={() => setExpanded((v: boolean) => !v)}>
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle} numberOfLines={expanded ? undefined : 2}>
            {task.title}
          </Text>
          <View style={styles.cardTopRight}>
            <View style={[styles.chip, { backgroundColor: statusColor }]}>
              <Text style={styles.chipText}>{STATUS_LABEL[task.status]}</Text>
            </View>
            <Text style={styles.chevron}>{expanded ? '▴' : '▾'}</Text>
          </View>
        </View>

        {/* Badges row: source + category */}
        <View style={styles.badgeRow}>
          <SourceBadge source={task.source} source_type={task.source_type} />
          {task.task_category && <CategoryBadge category={task.task_category} />}
        </View>

        {task.description ? (
          <Text style={styles.cardDesc} numberOfLines={expanded ? undefined : 2}>
            {task.description}
          </Text>
        ) : null}

        {/* Workflow / project / requester meta */}
        {(task.workflow_name || task.project_name || task.requester) && (
          <View style={styles.metaRow}>
            {task.workflow_name && (
              <Text style={styles.metaTag} numberOfLines={1}>⚙ {task.workflow_name}</Text>
            )}
            {task.project_name && !task.workflow_name && (
              <Text style={styles.metaTag} numberOfLines={1}>◈ {task.project_name}</Text>
            )}
            {task.requester && (
              <Text style={styles.metaTag} numberOfLines={1}>↑ {task.requester}</Text>
            )}
          </View>
        )}

        {/* Source title link */}
        {task.source_title && expanded && (
          <Text style={styles.sourceTitle} numberOfLines={1}>
            {task.source_title}
          </Text>
        )}
      </Pressable>

      <View style={styles.cardBottom}>
        <Text style={[styles.priority, { color: priorityColor }]}>
          {task.priority.toUpperCase()}
        </Text>

        {task.source === 'agent' && !task.source_type && (
          <View style={styles.agentBadge}>
            <Text style={styles.agentBadgeText}>Agent</Text>
          </View>
        )}

        {task.due_at && (
          <Text style={styles.due}>Due {fmtDate(task.due_at)}</Text>
        )}

        <Text style={styles.timestamp}>
          {expanded ? fmtDateTime(task.created_at) : fmtDate(task.created_at)}
        </Text>

        <View style={styles.cardActions}>
          {isActive && (
            <>
              <TouchableOpacity style={styles.checkBtn} onPress={onComplete}>
                <Text style={styles.checkBtnText}>✓</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ignoreBtn} onPress={onIgnore}>
                <Text style={styles.ignoreBtnText}>✕</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// CreateTaskModal (unchanged)
// ---------------------------------------------------------------------------

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
    await onCreate({ title: title.trim(), description: description.trim() || undefined, priority })
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
                <Text style={[modal.priorityChipText, priority === p && modal.priorityChipTextActive]}>
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { color: '#8E8E93', fontSize: 15, textAlign: 'center' },
  list: { paddingVertical: 8, paddingBottom: 100 },
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
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  cardDesc: { fontSize: 13, color: '#666', marginBottom: 6 },
  cardTopRight: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  chevron: { fontSize: 10, color: '#C7C7CC', marginTop: 2 },
  badgeRow: { flexDirection: 'row', gap: 5, marginBottom: 5, flexWrap: 'wrap' },
  metaRow: { flexDirection: 'row', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  metaTag: { fontSize: 11, color: '#636366' },
  sourceTitle: { fontSize: 11, color: '#007AFF', marginBottom: 4 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: 6, marginLeft: 'auto' },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  priority: { fontSize: 11, fontWeight: '700' },
  agentBadge: { backgroundColor: '#F5EEFF', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  agentBadgeText: { color: '#AF52DE', fontSize: 11, fontWeight: '600' },
  due: { fontSize: 11, color: '#FF9500' },
  timestamp: { fontSize: 11, color: '#8E8E93' },
  checkBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#34C759', justifyContent: 'center', alignItems: 'center',
  },
  checkBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 20 },
  ignoreBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#C7C7CC', justifyContent: 'center', alignItems: 'center',
  },
  ignoreBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', lineHeight: 18 },
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabIcon: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '400' },
})

const badge = StyleSheet.create({
  wrap: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
})

const picker = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  scroll: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 16, borderWidth: 1, borderColor: '#C6C6C8',
    backgroundColor: '#F2F2F7',
  },
  chipActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  chipText: { fontSize: 13, fontWeight: '500', color: '#3C3C43' },
  chipTextActive: { color: '#fff' },
})

const gh = StyleSheet.create({
  wrap: {
    marginHorizontal: 16, marginTop: 14, marginBottom: 4,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: 13, fontWeight: '700', color: '#3C3C43', textTransform: 'uppercase', letterSpacing: 0.5 },
  stats: { flexDirection: 'row', gap: 6 },
  stat: { fontSize: 11, color: '#8E8E93', fontWeight: '500' },
  statHigh: { color: '#FF3B30' },
  nextDue: { fontSize: 11, color: '#636366', marginTop: 2 },
})

const swipe = StyleSheet.create({
  container: { marginHorizontal: 16, marginVertical: 5, borderRadius: 12, overflow: 'hidden' },
  actions: { position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  btn: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
})

const modal = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#C6C6C8',
  },
  headerBtn: { minWidth: 60 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  cancel: { fontSize: 17, color: '#8E8E93' },
  add: { fontSize: 17, fontWeight: '600', color: '#007AFF', textAlign: 'right' },
  addDisabled: { opacity: 0.4 },
  body: { padding: 16, gap: 12 },
  titleInput: {
    backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#1a1a1a',
  },
  descInput: {
    backgroundColor: '#fff', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#1a1a1a', minHeight: 80,
  },
  sectionLabel: {
    fontSize: 13, fontWeight: '600', color: '#8E8E93',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  priorityRow: { flexDirection: 'row', gap: 8 },
  priorityChip: {
    flex: 1, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#C6C6C8', alignItems: 'center', backgroundColor: '#fff',
  },
  priorityChipText: { fontSize: 13, fontWeight: '600', color: '#8E8E93' },
  priorityChipTextActive: { color: '#fff' },
})
