// Supabase client for the Expo app.
//
// SECURITY:
// - Uses anon key only — safe for client bundles; all data access is
//   restricted by Row-Level Security on the server side.
// - Service role key must never appear here or anywhere in the app.
// - Sessions are stored in expo-secure-store (hardware-backed on iOS/Android).
//   Large session values are chunked because SecureStore enforces a ~2 KB
//   per-item limit.
// - EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are set in
//   .env (local) or your CI secret store (staging/prod). They are NOT secrets.

import 'react-native-url-polyfill/auto'
import * as SecureStore from 'expo-secure-store'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

// SecureStore values are capped at ~2 KB. Supabase JWT session payloads can
// exceed that, so we chunk large values across numbered keys.
const CHUNK_SIZE = 1800

const SecureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    const countStr = await SecureStore.getItemAsync(`${key}__n`)
    if (!countStr) return SecureStore.getItemAsync(key)
    const count = parseInt(countStr, 10)
    const parts: string[] = []
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`)
      if (part == null) return null
      parts.push(part)
    }
    return parts.join('')
  },

  async setItem(key: string, value: string): Promise<void> {
    // Always remove whatever representation currently exists for this key
    // before writing, so stale chunk keys or stale base keys never linger.
    await SecureStoreAdapter.removeItem(key)

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value)
      return
    }
    const count = Math.ceil(value.length / CHUNK_SIZE)
    await SecureStore.setItemAsync(`${key}__n`, String(count))
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(
        `${key}__${i}`,
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      )
    }
  },

  async removeItem(key: string): Promise<void> {
    const countStr = await SecureStore.getItemAsync(`${key}__n`)
    if (countStr) {
      const count = parseInt(countStr, 10)
      await SecureStore.deleteItemAsync(`${key}__n`)
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}__${i}`)
      }
    }
    // Always delete the base key — it may coexist with chunk keys from a
    // previous write that didn't clean up both representations.
    await SecureStore.deleteItemAsync(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
