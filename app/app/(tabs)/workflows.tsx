import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { fetchWorkflows } from '../../services/workflows'
import type { Workflow } from '../../types/database'

const STATUS_LABEL: Record<Workflow['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
}

const STATUS_COLOR: Record<Workflow['status'], string> = {
  active: '#34C759',
  paused: '#FF9500',
  archived: '#8E8E93',
}

export default function WorkflowsScreen() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      setWorkflows(await fetchWorkflows())
    } catch {
      Alert.alert('Error', 'Could not load workflows.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load(true) }, [load])

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    )
  }

  return (
    <FlatList
      data={workflows}
      keyExtractor={(w) => w.id}
      contentContainerStyle={workflows.length === 0 ? styles.center : styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load()} />
      }
      ListEmptyComponent={
        <Text style={styles.muted}>
          No workflows yet. The ChatGPT agent will create them here.
        </Text>
      }
      renderItem={({ item }) => <WorkflowCard workflow={item} />}
    />
  )
}

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  const statusColor = STATUS_COLOR[workflow.status] ?? '#8E8E93'

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {workflow.name}
        </Text>
        <View style={[styles.chip, { backgroundColor: statusColor }]}>
          <Text style={styles.chipText}>{STATUS_LABEL[workflow.status]}</Text>
        </View>
      </View>
      {workflow.description ? (
        <Text style={styles.cardDesc} numberOfLines={2}>
          {workflow.description}
        </Text>
      ) : null}
      <Text style={styles.date}>{workflow.created_at.slice(0, 10)}</Text>
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
  cardDesc: { fontSize: 13, color: '#666', marginBottom: 6 },
  date: { fontSize: 12, color: '#8E8E93' },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '600' },
})
