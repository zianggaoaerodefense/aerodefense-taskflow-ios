import { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native'
import { Link } from 'expo-router'
import { supabase } from '../../lib/supabase'

export default function SignUpScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function signUp() {
    if (!email.trim() || !password) {
      Alert.alert('Missing fields', 'Enter your email and password.')
      return
    }
    if (password.length < 8) {
      Alert.alert('Weak password', 'Use at least 8 characters.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })
    setLoading(false)
    if (error) {
      Alert.alert('Sign-up failed', error.message ?? 'Try a different email.')
    }
    // On success the root layout auth observer will redirect
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Create account</Text>
      <Text style={styles.subtitle}>Set up your TaskFlow workspace</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#aaa"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
      />

      <TextInput
        style={styles.input}
        placeholder="Password (min 8 characters)"
        placeholderTextColor="#aaa"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        onSubmitEditing={signUp}
      />

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={signUp}
        disabled={loading}
      >
        <Text style={styles.buttonText}>{loading ? 'Creating account…' : 'Sign Up'}</Text>
      </TouchableOpacity>

      <Link href="/(auth)/sign-in" style={styles.link}>
        Already have an account? Sign in
      </Link>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 6,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 36,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
    color: '#1a1a1a',
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    marginTop: 24,
    textAlign: 'center',
    color: '#007AFF',
    fontSize: 15,
  },
})
