// Import Agent Output screen.
// Lets the user paste JSON produced by a ChatGPT agent (Skills output),
// preview it, and confirm the import into Supabase.
//
// SECURITY:
// - All writes are scoped to the authenticated user (session.user.id).
// - user_id is never accepted from the pasted JSON; it is always derived
//   from the verified Supabase session.
// - Payloads containing credential-like field names are rejected before
//   any data is written.

import { useRef, useState } from 'react'
import { router } from 'expo-router'
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Stack } from 'expo-router'
import {
  buildPreview,
  executeImport,
  parseAndValidate,
  type AgentImportPayload,
  type ImportPreview,
  type ImportResult,
} from '../services/agentImport'

type Screen = 'paste' | 'importing' | 'success'

export default function AgentImportScreen() {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [payload, setPayload] = useState<AgentImportPayload | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('paste')
  const [result, setResult] = useState<ImportResult | null>(null)
  const inputRef = useRef<TextInput>(null)

  function handleTextChange(value: string) {
    setText(value)
    // Clear preview when the user edits the text so they must re-parse.
    if (preview) {
      setPreview(null)
      setPayload(null)
      setParseError(null)
    }
  }

  function handleParse() {
    Keyboard.dismiss()
    setParseError(null)
    setPreview(null)
    setPayload(null)
    if (!text.trim()) {
      setParseError('Paste the JSON output from the agent first.')
      return
    }
    try {
      const parsed = parseAndValidate(text)
      setPayload(parsed)
      setPreview(buildPreview(parsed))
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : 'Validation failed.')
    }
  }

  async function handleImport() {
    if (!payload) return
    Alert.alert(
      'Confirm import',
      buildConfirmMessage(preview!),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: async () => {
            setScreen('importing')
            try {
              const res = await executeImport(payload)
              setResult(res)
              setScreen('success')
            } catch (e: unknown) {
              setScreen('paste')
              Alert.alert(
                'Import failed',
                e instanceof Error ? e.message : 'Could not write to Supabase.',
              )
            }
          },
        },
      ],
    )
  }

  function handleReset() {
    setText('')
    setPreview(null)
    setPayload(null)
    setParseError(null)
    setResult(null)
    setScreen('paste')
  }

  if (screen === 'importing') {
    return (
      <>
        <Stack.Screen options={{ title: 'Import Agent Output' }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.importingText}>Importing…</Text>
        </View>
      </>
    )
  }

  if (screen === 'success' && result) {
    return (
      <>
        <Stack.Screen options={{ title: 'Import Agent Output' }} />
        <View style={styles.centered}>
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>Import complete</Text>
            <ResultLine label="Tasks created" value={result.taskCount} />
            <ResultLine label="Workflows created" value={result.workflowCount} />
            {result.hasSummary && <ResultLine label="Summary saved" value="Yes" />}
            {result.duplicatesSkipped > 0 && (
              <ResultLine label="Duplicates updated" value={result.duplicatesSkipped} />
            )}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/(tabs)/')}>
            <Text style={styles.primaryBtnText}>View Tasks</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleReset}>
            <Text style={styles.secondaryBtnText}>Import another</Text>
          </TouchableOpacity>
        </View>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Import Agent Output' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={88}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionLabel}>PASTE JSON FROM AGENT</Text>
          <TextInput
            ref={inputRef}
            style={styles.jsonInput}
            value={text}
            onChangeText={handleTextChange}
            multiline
            placeholder={'{\n  "summary": { "title": "…", "content": "…" },\n  "tasks": […]\n}'}
            placeholderTextColor="#aaa"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textAlignVertical="top"
          />

          {parseError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{parseError}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, !text.trim() && styles.btnDisabled]}
            onPress={handleParse}
            disabled={!text.trim()}
          >
            <Text style={styles.primaryBtnText}>Preview</Text>
          </TouchableOpacity>

          {preview && (
            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>Preview</Text>
              {preview.summaryTitle && (
                <PreviewRow label="Summary" value={preview.summaryTitle} />
              )}
              <PreviewRow
                label="Workflows"
                value={preview.workflowCount > 0 ? String(preview.workflowCount) : 'None'}
              />
              <PreviewRow
                label="Tasks"
                value={preview.taskCount > 0 ? String(preview.taskCount) : 'None'}
              />
              {preview.enrichedTaskCount > 0 && (
                <PreviewRow label="Enriched tasks" value={String(preview.enrichedTaskCount)} />
              )}
              {preview.hasAgentMessage && <PreviewRow label="Agent message" value="Yes" />}

              <TouchableOpacity style={[styles.importBtn, styles.importBtnTop]} onPress={handleImport}>
                <Text style={styles.primaryBtnText}>Import</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.hint}>
            Must contain at least one of:{' '}
            <Text style={styles.mono}>summaries</Text>, <Text style={styles.mono}>tasks</Text>,{' '}
            <Text style={styles.mono}>workflows</Text>, <Text style={styles.mono}>agent_messages</Text>.{'\n'}
            Legacy keys also accepted: <Text style={styles.mono}>summary</Text>, <Text style={styles.mono}>agent_message</Text>.{'\n'}
            Tasks support: <Text style={styles.mono}>source</Text>, <Text style={styles.mono}>source_type</Text>, <Text style={styles.mono}>task_category</Text>, <Text style={styles.mono}>requester</Text>, <Text style={styles.mono}>project_name</Text>.{'\n'}
            Credential fields (api_key, token, password, etc.) are rejected automatically.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.previewRow}>
      <Text style={styles.previewLabel}>{label}</Text>
      <Text style={styles.previewValue} numberOfLines={1}>{value}</Text>
    </View>
  )
}

function ResultLine({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={styles.resultValue}>{String(value)}</Text>
    </View>
  )
}

function buildConfirmMessage(preview: ImportPreview): string {
  const parts: string[] = []
  if (preview.summaryTitle) parts.push(`Summary: "${preview.summaryTitle}"`)
  if (preview.workflowCount > 0)
    parts.push(`${preview.workflowCount} workflow${preview.workflowCount !== 1 ? 's' : ''}`)
  if (preview.taskCount > 0)
    parts.push(`${preview.taskCount} task${preview.taskCount !== 1 ? 's' : ''}`)
  if (preview.hasAgentMessage) parts.push('an agent message')
  return `This will import ${parts.join(', ')} into your account.`
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 16, gap: 12, flexGrow: 1 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  jsonInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    padding: 14,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#1a1a1a',
    minHeight: 180,
    marginBottom: 4,
  },

  errorBox: {
    backgroundColor: '#FFF2F2',
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#FF3B30',
  },
  errorText: { fontSize: 13, color: '#c0392b', lineHeight: 18 },

  primaryBtn: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },

  previewCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  previewTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  previewLabel: { fontSize: 14, color: '#555' },
  previewValue: { fontSize: 14, fontWeight: '500', color: '#1a1a1a', flex: 1, textAlign: 'right', marginLeft: 8 },

  importBtn: {
    backgroundColor: '#34C759',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  importBtnTop: { marginTop: 16 },

  hint: { fontSize: 12, color: '#8E8E93', lineHeight: 18, marginTop: 4 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // Importing / success screens
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 20 },
  importingText: { fontSize: 16, color: '#8E8E93', marginTop: 12 },

  successCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    gap: 4,
  },
  successTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  resultLabel: { fontSize: 15, color: '#555' },
  resultValue: { fontSize: 15, fontWeight: '600', color: '#34C759' },

  secondaryBtn: { paddingVertical: 10 },
  secondaryBtnText: { color: '#007AFF', fontSize: 15 },
})
