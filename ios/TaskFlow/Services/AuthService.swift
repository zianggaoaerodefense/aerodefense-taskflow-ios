// AuthService.swift
//
// Wraps Supabase Auth for sign-in, sign-up, sign-out, and session observation.
//
// SECURITY:
//   - Sessions are stored by the Supabase SDK in Keychain, not UserDefaults
//   - Passwords are never logged or persisted
//   - Error messages shown to the user never include credential details

import Foundation
import Supabase

@MainActor
final class AuthService: ObservableObject {
    static let shared = AuthService()

    @Published var session: Session?
    @Published var isLoading = false
    @Published var errorMessage: String?

    var isSignedIn: Bool { session != nil }
    var userId: String? { session?.user.id.uuidString }

    private init() {}

    // Call once from the app entry point to observe auth state changes.
    func startObserving() {
        Task {
            for await (event, newSession) in await supabase.auth.authStateChanges {
                switch event {
                case .signedIn, .tokenRefreshed, .userUpdated:
                    session = newSession
                case .signedOut, .userDeleted:
                    session = nil
                default:
                    break
                }
            }
        }
    }

    func signIn(email: String, password: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await supabase.auth.signIn(
                email: email,
                password: password
            )
            session = response.session
        } catch {
            errorMessage = "Sign-in failed. Check your email and password."
        }
    }

    func signUp(email: String, password: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await supabase.auth.signUp(
                email: email,
                password: password
            )
            session = response.session
        } catch {
            errorMessage = "Sign-up failed. Try a different email or check your connection."
        }
    }

    func signOut() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            try await supabase.auth.signOut()
            session = nil
        } catch {
            errorMessage = "Sign-out failed. Please try again."
        }
    }
}
