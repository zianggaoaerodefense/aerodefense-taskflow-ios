// SupabaseClient.swift
//
// SETUP: Add the Supabase Swift SDK via Swift Package Manager.
//   Repository URL: https://github.com/supabase/supabase-swift
//   Version: 2.x (Up to Next Major)
//   Products to add: Supabase, Realtime
//
// CONFIGURATION:
//   Add SUPABASE_URL and SUPABASE_ANON_KEY to your target's Info.plist
//   (via a .xcconfig or directly in Build Settings > Info.plist Values).
//   These are NOT secrets — the anon key is designed for client-side use
//   and is restricted by Row-Level Security on the Supabase side.
//
// SECURITY:
//   - Never add the service role key here or anywhere in the app
//   - Never hardcode tokens, API keys, or connection strings in source
//   - The Supabase Swift SDK stores sessions in Keychain by default

import Foundation
import Supabase

enum SupabaseConfig {
    static var url: URL {
        guard
            let raw = Bundle.main.infoDictionary?["SUPABASE_URL"] as? String,
            let url = URL(string: raw)
        else {
            fatalError("SUPABASE_URL missing or invalid in Info.plist")
        }
        return url
    }

    static var anonKey: String {
        guard
            let key = Bundle.main.infoDictionary?["SUPABASE_ANON_KEY"] as? String,
            !key.isEmpty
        else {
            fatalError("SUPABASE_ANON_KEY missing in Info.plist")
        }
        return key
    }
}

// Shared client instance. Session is automatically persisted to Keychain.
let supabase = SupabaseClient(
    supabaseURL: SupabaseConfig.url,
    supabaseKey: SupabaseConfig.anonKey
)
