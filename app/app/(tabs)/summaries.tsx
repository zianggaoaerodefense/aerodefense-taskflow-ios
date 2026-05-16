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
import { fetchSummaries } from '../../services/summaries'
import type { Summary } from '../../types/database'

export default function SummariesScreen() {
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      setSummaries(await fetchSummaries())
    } catch {
      Alert.alert('Error', 'Could not load summaries.')
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
      data={summaries}
      keyExtractor={(s) => s.id}
      contentContainerStyle={summaries.length === 0 ? styles.center : styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load()} />
      }
      ListEmptyComponent={
        <Text style={styles.muted}>
          No summaries yet. The ChatGPT agent will post them here after each session.
        </Text>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => setExpanded(expanded === item.id ? null : item.id)}
          activeOpacity={0.85}
        >
          <View style={styles.cardTop}>
            <Text style={styles.cardTitle} numberOfLines={expanded === item.id ? undefined : 1}>
              {item.title}
            </Text>
            {item.source === 'agent' && (
              <View style={styles.agentBadge}>
                <Text style={styles.agentText}>Agent</Text>
              </View>
            )}
          </View>
          <Text style={styles.date}>{item.created_at.slice(0, 10)}</Text>
          {expanded === item.id && (
            <Text style={styles.content}>{item.content}</Text>
          )}
        </TouchableOpacity>
      )}
    />
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
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 2 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  date: { fontSize: 12, color: '#8E8E93', marginBottom: 6 },
  content: { fontSize: 14, color: '#444', lineHeight: 20, marginTop: 8 },
  agentBadge: {
    backgroundColor: '#F5EEFF',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  agentText: { color: '#AF52DE', fontSize: 11, fontWeight: '600' },
})
