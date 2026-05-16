import { useState } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'

export default function SettingsScreen() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function signOut() {
    setLoading(true)
    const { error } = await supabase.auth.signOut()
    setLoading(false)
    if (error) Alert.alert('Error', 'Sign-out failed. Please try again.')
    // Root layout observer will redirect to (auth) on sign-out
  }

  return (
    <View style={styles.container}>
      <Section title="Agent">
        <Row
          label="Connect ChatGPT Agent"
          subtitle="Create or revoke agent connection tokens"
          onPress={() => router.push('/agent-connections')}
          chevron
        />
      </Section>

      <Section title="Account">
        <Row
          label={loading ? 'Signing out…' : 'Sign Out'}
          onPress={signOut}
          destructive
          disabled={loading}
        />
      </Section>

      <Text style={styles.footer}>
        TaskFlow — private workflow manager{'\n'}
        Agent connections are managed per user and revocable at any time.
      </Text>
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  )
}

function Row({
  label,
  subtitle,
  onPress,
  chevron,
  destructive,
  disabled,
}: {
  label: string
  subtitle?: string
  onPress: () => void
  chevron?: boolean
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={styles.rowLabels}>
        <Text style={[styles.rowLabel, destructive && styles.destructive]}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {chevron && <Text style={styles.chevron}>›</Text>}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7', padding: 20 },
  section: { marginBottom: 28 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    marginBottom: 6,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  rowLabels: { flex: 1 },
  rowLabel: { fontSize: 16, color: '#1a1a1a' },
  rowSubtitle: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  destructive: { color: '#FF3B30' },
  chevron: { fontSize: 20, color: '#c7c7cc', marginLeft: 8 },
  footer: {
    marginTop: 'auto',
    textAlign: 'center',
    fontSize: 12,
    color: '#8E8E93',
    lineHeight: 18,
  },
})
