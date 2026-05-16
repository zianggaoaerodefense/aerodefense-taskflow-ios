import LocalAuthentication
import Foundation
import SwiftUI
import SwiftData

// MARK: - SecurityLockService
//
// A MainActor-bound ObservableObject that wraps LocalAuthentication.
// It publishes authentication state so views can react to lock / unlock
// transitions. No credentials or biometric data are stored by this service;
// it delegates entirely to the OS LAContext.

@MainActor
final class SecurityLockService: ObservableObject {

    // MARK: - Published state

    /// True while the app considers the current session authenticated.
    @Published var isAuthenticated: Bool = false

    /// Human-readable description of the last authentication failure, if any.
    /// Cleared on each new authentication attempt and on `lock()`.
    @Published var authError: String?

    // MARK: - Public API

    /// Attempt to authenticate the user.
    ///
    /// If the device has no biometrics or passcode configured the method
    /// grants access immediately rather than blocking the user (fail-open for
    /// passcode-less devices; callers that require stricter policy should
    /// enforce it at a higher layer).
    ///
    /// - Parameter reason: The localised reason string shown in the system
    ///   authentication UI. Defaults to a generic prompt.
    func authenticate(reason: String = "Unlock TaskFlow") async {
        authError = nil

        let context = LAContext()
        var policyError: NSError?

        // Check for biometrics first, then fall back to passcode.
        let canUseBiometrics = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &policyError
        )
        let canUsePasscode = context.canEvaluatePolicy(
            .deviceOwnerAuthentication,
            error: &policyError
        )

        guard canUseBiometrics || canUsePasscode else {
            // No authentication mechanism is configured on this device.
            // Grant access so the app remains usable; the Settings screen
            // can advise the user to add a passcode.
            isAuthenticated = true
            return
        }

        // .deviceOwnerAuthentication automatically falls back from Face ID /
        // Touch ID to the device passcode, giving the user a second path if
        // biometrics fail.
        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: reason
            )
            isAuthenticated = success
        } catch {
            // Do not log the LAError detail — it may contain device-specific
            // information. Surface only the localised description to the UI.
            authError = error.localizedDescription
            isAuthenticated = false
        }
    }

    /// Lock the session. The user must authenticate again to regain access.
    func lock() {
        isAuthenticated = false
        authError = nil
    }
}

// MARK: - SecurityLockView
//
// A generic container view that gates its content behind device authentication
// when the active AppSettings record has `requireFaceID == true`.
//
// Usage:
//   SecurityLockView(isUnlocked: $isUnlocked) {
//       RootTabView()
//   }
//
// Behaviour:
//   • requireFaceID == false (default) → content is shown immediately with no
//     authentication prompt.
//   • requireFaceID == true, not yet authenticated → lock screen is shown and
//     authentication is triggered automatically on appear.
//   • requireFaceID == true, authenticated → content is shown.

struct SecurityLockView<Content: View>: View {

    // MARK: - Inputs

    /// Mirrors the authentication state upward to the caller so that, for
    /// example, `TaskFlowApp` can conditionally apply scene-level modifiers.
    @Binding var isUnlocked: Bool

    /// The protected content to reveal after authentication.
    let content: () -> Content

    // MARK: - Dependencies

    @StateObject private var lockService = SecurityLockService()

    /// Fetch the first AppSettings record. If none exists yet the view treats
    /// `requireFaceID` as `false` (the safe default) until settings are
    /// bootstrapped by `SettingsViewModel`.
    @Query private var settingsResults: [AppSettings]

    // MARK: - Private helpers

    private var requiresFaceID: Bool {
        settingsResults.first?.requireFaceID ?? false
    }

    // MARK: - Body

    var body: some View {
        Group {
            if !requiresFaceID || lockService.isAuthenticated {
                content()
                    .onChange(of: lockService.isAuthenticated) { _, authenticated in
                        isUnlocked = authenticated
                    }
            } else {
                lockScreen
            }
        }
        .onAppear {
            if requiresFaceID && !lockService.isAuthenticated {
                Task { await lockService.authenticate() }
            } else if !requiresFaceID {
                isUnlocked = true
            }
        }
        // When the app returns from the background it should re-evaluate
        // authentication state. Scene phase observation is handled by the
        // caller if deeper session-timeout behaviour is needed.
        .onChange(of: requiresFaceID) { _, newValue in
            if !newValue {
                // FaceID requirement was turned off; grant access immediately.
                isUnlocked = true
            } else if !lockService.isAuthenticated {
                Task { await lockService.authenticate() }
            }
        }
    }

    // MARK: - Lock screen

    @ViewBuilder
    private var lockScreen: some View {
        ZStack {
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 28) {

                Spacer()

                // App icon placeholder / lock symbol
                Image(systemName: "lock.shield.fill")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 72, height: 72)
                    .foregroundStyle(.indigo)

                // App name
                Text("TaskFlow")
                    .font(.largeTitle.bold())
                    .foregroundStyle(.primary)

                Text("Your data is locked.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                // Error message (only shown after a failed attempt)
                if let errorMessage = lockService.authError {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                Spacer()

                // Unlock button
                Button {
                    Task { await lockService.authenticate() }
                } label: {
                    Label(
                        "Unlock with Face ID / Passcode",
                        systemImage: "faceid"
                    )
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.indigo)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 32)
                }
                .padding(.bottom, 48)
            }
        }
    }
}
