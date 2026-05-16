// Agent Connections screen
//
// Users create a connection token here, then configure it as the X-Agent-Token
// header value in their Custom GPT action.
//
// SECURITY:
// - Raw token is shown once and never stored by the app.
// - Revocation immediately invalidates the token hash in Supabase.
// - The Supabase session JWT (not the agent token) is used to call the Edge Functions.

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Clipboard,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Stack } from 'expo-router'
import {
  createConnection,
  listConnections,
  revokeConnection,
  type CreatedConnection,
} from '../services/agentConnections'
import type { AgentConnection } from '../types/database'

export default function AgentConnectionsScreen() {
  const [connections, setConnections] = useState<AgentConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newToken, setNewToken] = useState<CreatedConnection | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      setConnections(await listConnections())
    } catch {
      Alert.alert('Error', 'Could not load connections.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load(true) }, [load])

  async function handleRevoke(id: string, label: string) {
    Alert.alert(
      'Revoke connection',
      `Revoke "${label}"? The ChatGPT agent will no longer be able to use it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              await revokeConnection(id)
              await load(true)
            } catch {
              Alert.alert('Error', 'Could not revoke connection.')
            }
          },
        },
      ],
    )
  }

  const active = connections.filter((c) => c.status === 'active')
  const revoked = connections.filter((c) => c.status !== 'active')

  return (
    <>
      <Stack.Screen
        options={{
          title: 'ChatGPT Agent',
          headerRight: () => (
            <TouchableOpacity onPress={() => setShowCreate(true)} style={styles.headerBtn}>
              <Text style={styles.headerBtnText}>New</Text>
            </TouchableOpacity>
          ),
        }}
      />

      {newToken && (
        <TokenBanner token={newToken} onDismiss={() => setNewToken(null)} />
      )}

      <FlatList
        data={active}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load()} />
        }
        ListHeaderComponent={
          active.length === 0 && !loading ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No active connections</Text>
              <Text style={styles.emptySubtitle}>
                Tap <Text style={styles.bold}>New</Text> to generate a token, then paste it into your
                Custom GPT action as the <Text style={styles.mono}>X-Agent-Token</Text> header value.
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          revoked.length > 0 ? (
            <View style={styles.revokedSection}>
              <Text style={styles.sectionLabel}>REVOKED</Text>
              {revoked.map((c) => (
                <View key={c.id} style={[styles.card, styles.revokedCard]}>
                  <Text style={styles.revokedLabel}>{c.label}</Text>
                  <Text style={styles.meta}>Revoked {c.revoked_at?.slice(0, 10) ?? ''}</Text>
                </View>
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ConnectionCard
            connection={item}
            onRevoke={() => handleRevoke(item.id, item.label)}
          />
        )}
      />

      <CreateModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={async (label, days) => {
          setShowCreate(false)
          try {
            const result = await createConnection(label, days)
            setNewToken(result)
            await load(true)
          } catch (e: unknown) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Could not create connection.')
          }
        }}
      />
    </>
  )
}

// One-time token display banner
function TokenBanner({
  token,
  onDismiss,
}: {
  token: CreatedConnection
  onDismiss: () => void
}) {
  function copy() {
    Clipboard.setString(token.token)
    Alert.alert('Copied', 'Token copied to clipboard.')
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.bannerTitle}>Connection created</Text>
      <Text style={styles.bannerWarning}>
        Copy this token now — it will not be shown again.
      </Text>
      <View style={styles.tokenBox}>
        <Text style={styles.tokenText} numberOfLines={3} selectable>
          {token.token}
        </Text>
      </View>
      <Text style={styles.bannerHint}>
        Add this as the <Text style={styles.mono}>X-Agent-Token</Text> header in your Custom GPT
        action. See <Text style={styles.mono}>docs/chatgpt-agent-actions.md</Text> for setup
        instructions.
      </Text>
      <View style={styles.bannerActions}>
        <TouchableOpacity style={styles.copyBtn} onPress={copy}>
          <Text style={styles.copyBtnText}>Copy Token</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss}>
          <Text style={styles.dismissBtnText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function ConnectionCard({
  connection,
  onRevoke,
}: {
  connection: AgentConnection
  onRevoke: () => void
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardLabel}>{connection.label}</Text>
        <View style={styles.activeDot} />
      </View>
      <Text style={styles.meta}>
        Created {connection.created_at.slice(0, 10)}
        {connection.last_used_at
          ? `  ·  Last used ${connection.last_used_at.slice(0, 10)}`
          : '  ·  Never used'}
      </Text>
      {connection.expires_at && (
        <Text style={styles.expiry}>Expires {connection.expires_at.slice(0, 10)}</Text>
      )}
      <TouchableOpacity style={styles.revokeBtn} onPress={onRevoke}>
        <Text style={styles.revokeBtnText}>Revoke</Text>
      </TouchableOpacity>
    </View>
  )
}

function CreateModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean
  onClose: () => void
  onCreate: (label: string, days?: number) => void
}) {
  const [label, setLabel] = useState('ChatGPT Agent')
  const [expiryEnabled, setExpiryEnabled] = useState(false)
  const [days, setDays] = useState('30')

  function submit() {
    const trimmed = label.trim()
    if (!trimmed) { Alert.alert('Error', 'Enter a label.'); return }
    const daysNum = expiryEnabled ? parseInt(days, 10) : undefined
    if (expiryEnabled && (!daysNum || daysNum < 1 || daysNum > 365)) {
      Alert.alert('Error', 'Expiry must be 1–365 days.')
      return
    }
    onCreate(trimmed, daysNum)
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet">
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>New Connection</Text>
          <TouchableOpacity onPress={submit}>
            <Text style={styles.modalCreate}>Create</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.modalBody}>
          <Text style={styles.fieldLabel}>Label</Text>
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. ChatGPT Agent"
            placeholderTextColor="#aaa"
          />

          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setExpiryEnabled(!expiryEnabled)}
          >
            <Text style={styles.fieldLabel}>Set expiry</Text>
            <View style={[styles.toggle, expiryEnabled && styles.toggleOn]}>
              <View style={[styles.toggleThumb, expiryEnabled && styles.toggleThumbOn]} />
            </View>
          </TouchableOpacity>

          {expiryEnabled && (
            <>
              <Text style={styles.fieldLabel}>Days until expiry</Text>
              <TextInput
                style={styles.input}
                value={days}
                onChangeText={setDays}
                keyboardType="number-pad"
                placeholder="30"
                placeholderTextColor="#aaa"
              />
            </>
          )}

          <Text style={styles.hint}>
            The raw token is shown once after creation. Paste it into your Custom GPT action
            configuration as the <Text style={styles.mono}>X-Agent-Token</Text> header value.
            Without an expiry the connection remains active until you revoke it.
          </Text>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10, flexGrow: 1 },
  headerBtn: { paddingHorizontal: 4 },
  headerBtnText: { color: '#007AFF', fontSize: 16 },

  // Empty state
  emptyBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  emptySubtitle: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },

  // Connection card
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
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759',
  },
  meta: { fontSize: 12, color: '#8E8E93' },
  expiry: { fontSize: 12, color: '#FF9500', marginTop: 2 },
  revokeBtn: { alignSelf: 'flex-start', marginTop: 10 },
  revokeBtnText: { color: '#FF3B30', fontSize: 14, fontWeight: '500' },

  // Revoked section
  revokedSection: { marginTop: 24 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    marginBottom: 6,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  revokedCard: { opacity: 0.5, marginTop: 8 },
  revokedLabel: { fontSize: 14, color: '#1a1a1a' },

  // Token banner
  banner: {
    backgroundColor: '#F0FDF4',
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
    margin: 16,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  bannerTitle: { fontSize: 15, fontWeight: '700', color: '#1a7a3c' },
  bannerWarning: { fontSize: 13, color: '#1a7a3c' },
  tokenBox: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#d0f0dd',
  },
  tokenText: { fontFamily: 'Courier', fontSize: 12, color: '#1a1a1a', lineHeight: 18 },
  bannerHint: { fontSize: 12, color: '#555', lineHeight: 18 },
  bannerActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  copyBtn: {
    backgroundColor: '#34C759',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  copyBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  dismissBtn: { paddingVertical: 8 },
  dismissBtnText: { color: '#007AFF', fontSize: 14 },

  // Create modal
  modal: { flex: 1, backgroundColor: '#f2f2f7' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: { fontSize: 16, fontWeight: '600' },
  modalCancel: { color: '#8E8E93', fontSize: 16 },
  modalCreate: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
  modalBody: { padding: 20, gap: 8 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 13,
    fontSize: 15,
    backgroundColor: '#fff',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#e0e0e0',
    padding: 2,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: '#34C759' },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  toggleThumbOn: { alignSelf: 'flex-end' },
  hint: { fontSize: 13, color: '#8E8E93', lineHeight: 18, marginTop: 8 },

  // Shared
  bold: { fontWeight: '700' },
  mono: { fontFamily: 'Courier' },
})
