// ConnectAgentView.swift
//
// UI for managing ChatGPT agent connections.
// Users create a connection token here, then paste it into their Custom GPT
// action configuration as the X-Agent-Token header value.
//
// SECURITY:
//   - Raw token shown once and never stored by the app
//   - Revocation immediately marks the token hash inactive in the database
//   - Calls go through the Edge Function (not raw database) via HTTPS

import SwiftUI
import Supabase

// MARK: - Models

struct AgentConnection: Codable, Identifiable {
    let id: String
    let label: String
    let status: String
    let expires_at: String?
    let last_used_at: String?
    let created_at: String
    let revoked_at: String?

    var isActive: Bool { status == "active" }

    var formattedCreated: String {
        String(created_at.prefix(10))
    }

    var formattedLastUsed: String? {
        last_used_at.map { String($0.prefix(10)) }
    }

    var formattedExpiry: String? {
        expires_at.map { String($0.prefix(10)) }
    }
}

private struct ConnectionListResponse: Codable {
    // Directly decoded from the Supabase query result
}

private struct CreateConnectionResponse: Codable {
    let connection: AgentConnectionBrief
    let token: String
    let warning: String

    struct AgentConnectionBrief: Codable {
        let id: String
        let label: String
        let status: String
        let expires_at: String?
        let created_at: String
    }
}

// MARK: - View Model

@MainActor
final class AgentConnectionViewModel: ObservableObject {
    @Published var connections: [AgentConnection] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var newlyCreatedToken: String?
    @Published var showCreateSheet = false
    @Published var labelInput = "ChatGPT Agent"
    @Published var expiresDays: Int = 30
    @Published var expiryEnabled = false

    func fetchConnections() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let result: [AgentConnection] = try await supabase
                .from("agent_connections")
                .select("id, label, status, expires_at, last_used_at, created_at, revoked_at")
                .order("created_at", ascending: false)
                .execute()
                .value
            connections = result
        } catch {
            errorMessage = "Failed to load connections."
        }
    }

    func createConnection() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            guard let session = supabase.auth.currentSession else {
                errorMessage = "Not signed in."
                return
            }
            var body: [String: Any] = ["label": labelInput]
            if expiryEnabled { body["expires_in_days"] = expiresDays }

            guard let fnURL = URL(
                string: "\(SupabaseConfig.url.absoluteString)/functions/v1/create-agent-connection"
            ) else { return }

            var req = URLRequest(url: fnURL)
            req.httpMethod = "POST"
            req.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)

            let (data, _) = try await URLSession.shared.data(for: req)
            let resp = try JSONDecoder().decode(CreateConnectionResponse.self, from: data)
            newlyCreatedToken = resp.token
            await fetchConnections()
        } catch {
            errorMessage = "Failed to create connection."
        }
    }

    func revokeConnection(_ connectionId: String) async {
        isLoading = true
        defer { isLoading = false }

        do {
            guard let session = supabase.auth.currentSession else {
                errorMessage = "Not signed in."
                return
            }
            guard let fnURL = URL(
                string: "\(SupabaseConfig.url.absoluteString)/functions/v1/revoke-agent-connection"
            ) else { return }

            var req = URLRequest(url: fnURL)
            req.httpMethod = "POST"
            req.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(
                withJSONObject: ["connection_id": connectionId]
            )
            _ = try await URLSession.shared.data(for: req)
            await fetchConnections()
        } catch {
            errorMessage = "Failed to revoke connection."
        }
    }

    func dismissNewToken() {
        newlyCreatedToken = nil
    }
}

// MARK: - Main View

struct ConnectAgentView: View {
    @StateObject private var vm = AgentConnectionViewModel()

    var body: some View {
        NavigationStack {
            List {
                if let token = vm.newlyCreatedToken {
                    newTokenBanner(token)
                }

                Section("Active Connections") {
                    let active = vm.connections.filter(\.isActive)
                    if active.isEmpty {
                        Text("No active connections.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(active) { conn in
                            ConnectionRow(connection: conn) {
                                Task { await vm.revokeConnection(conn.id) }
                            }
                        }
                    }
                }

                Section("Revoked") {
                    let revoked = vm.connections.filter { !$0.isActive }
                    if revoked.isEmpty {
                        Text("None.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(revoked) { conn in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(conn.label)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                Text("Revoked \(conn.formattedCreated)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Connect ChatGPT Agent")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New Connection") {
                        vm.showCreateSheet = true
                    }
                }
            }
            .sheet(isPresented: $vm.showCreateSheet) {
                CreateConnectionSheet(vm: vm)
            }
            .alert("Error", isPresented: .constant(vm.errorMessage != nil)) {
                Button("OK") { vm.errorMessage = nil }
            } message: {
                Text(vm.errorMessage ?? "")
            }
            .task { await vm.fetchConnections() }
        }
    }

    @ViewBuilder
    private func newTokenBanner(_ token: String) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                Label("Connection Created", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.headline)

                Text("Copy this token now — it will not be shown again.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Text(token)
                        .font(.system(.caption, design: .monospaced))
                        .lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        UIPasteboard.general.string = token
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .foregroundStyle(.blue)
                    }
                }
                .padding(10)
                .background(Color(.systemGray6))
                .clipShape(RoundedRectangle(cornerRadius: 8))

                Text(
                    "Add this value as the **X-Agent-Token** header in your Custom GPT action. See **docs/chatgpt-agent-actions.md** for the full setup guide."
                )
                .font(.caption)
                .foregroundStyle(.secondary)

                Button("Dismiss") { vm.dismissNewToken() }
                    .font(.caption)
                    .foregroundStyle(.blue)
            }
        } header: {
            Text("New Token")
        }
    }
}

// MARK: - Connection Row

struct ConnectionRow: View {
    let connection: AgentConnection
    let onRevoke: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(connection.label)
                        .font(.subheadline)
                        .fontWeight(.medium)
                    if let used = connection.formattedLastUsed {
                        Text("Last used: \(used)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Never used")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let expiry = connection.formattedExpiry {
                        Text("Expires: \(expiry)")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
                Spacer()
                Button(role: .destructive, action: onRevoke) {
                    Text("Revoke")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Create Sheet

struct CreateConnectionSheet: View {
    @ObservedObject var vm: AgentConnectionViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Label") {
                    TextField("e.g. ChatGPT Agent", text: $vm.labelInput)
                }
                Section {
                    Toggle("Set expiry", isOn: $vm.expiryEnabled)
                    if vm.expiryEnabled {
                        Stepper(
                            "\(vm.expiresDays) day\(vm.expiresDays == 1 ? "" : "s")",
                            value: $vm.expiresDays,
                            in: 1...365
                        )
                    }
                } header: {
                    Text("Expiry")
                } footer: {
                    Text("Without an expiry, the connection remains active until manually revoked.")
                        .font(.caption)
                }
                Section {
                    Text(
                        "The raw token is shown once after creation. " +
                        "Paste it into your Custom GPT action as the X-Agent-Token header value."
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("New Agent Connection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        dismiss()
                        Task { await vm.createConnection() }
                    }
                    .disabled(vm.labelInput.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

#Preview {
    ConnectAgentView()
}
