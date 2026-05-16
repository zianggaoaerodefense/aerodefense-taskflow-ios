import SwiftUI
import SwiftData
import UniformTypeIdentifiers

// MARK: - SettingsView
//
// App settings editor. All storage is local (SwiftData); no data is sent over
// the network in Phase 1. Sensitive data exports show a warning before the
// system share sheet. Import reads a previously exported JSON file.

struct SettingsView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var summaries: [Summary]
    @Query private var tasks: [TaskItem]
    @Query private var drafts: [FollowUpDraft]

    @State private var viewModel = SettingsViewModel()
    @State private var settings: AppSettings?
    @State private var showImportPicker = false
    @State private var showSensitiveWarning = false
    @State private var showExportShareSheet = false
    @State private var exportURL: URL?

    var body: some View {
        NavigationStack {
            Group {
                if let settings {
                    settingsForm(settings)
                } else {
                    ProgressView("Loading settings…")
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                if settings == nil {
                    settings = viewModel.loadOrCreateSettings(context: modelContext)
                }
            }
            // Status message banner anchored to the safe area bottom
            .safeAreaInset(edge: .bottom) {
                if let msg = viewModel.statusMessage {
                    statusBanner(msg)
                }
            }
            // Sensitive export warning
            .alert("Export Warning", isPresented: $showSensitiveWarning) {
                Button("Cancel", role: .cancel) {}
                Button("Export") {
                    triggerExport()
                }
            } message: {
                Text(
                    "Exported files may contain sensitive work information. " +
                    "Store them securely and do not share them unintentionally."
                )
            }
            // Import document picker
            .fileImporter(
                isPresented: $showImportPicker,
                allowedContentTypes: [.json],
                allowsMultipleSelection: false
            ) { result in
                handleImport(result: result)
            }
            // Export share sheet
            .sheet(isPresented: $showExportShareSheet) {
                if let url = exportURL {
                    ShareSheet(items: [url])
                }
            }
        }
    }

    // MARK: - Settings Form

    @ViewBuilder
    private func settingsForm(_ s: AppSettings) -> some View {
        Form {
            // ── Security ──────────────────────────────────────────────────────
            Section {
                Toggle("Require Face ID / Touch ID", isOn: Bindable(s).requireFaceID)
            } header: {
                Text("Security")
            } footer: {
                Text(
                    "When enabled, biometric authentication is required each time the app opens. " +
                    "This uses iOS LocalAuthentication and does not transmit biometric data."
                )
            }

            // ── Appearance ────────────────────────────────────────────────────
            Section("Appearance") {
                LabeledContent("App Name") {
                    TextField("Display name", text: Bindable(s).appDisplayName)
                        .multilineTextAlignment(.trailing)
                }
            }

            // ── Defaults for New Tasks ────────────────────────────────────────
            Section("Defaults for New Tasks") {
                Picker("Default priority", selection: Bindable(s).defaultTaskPriority) {
                    ForEach(TaskPriority.allCases, id: \.self) { p in
                        Text(p.label).tag(p)
                    }
                }
                Picker("Default resource type", selection: Bindable(s).defaultResourceType) {
                    ForEach(ResourceType.allCases, id: \.self) { r in
                        Label(r.label, systemImage: r.icon).tag(r)
                    }
                }
            }

            // ── Export Format ─────────────────────────────────────────────────
            Section {
                Picker("Format", selection: Bindable(s).exportFormatPreference) {
                    ForEach(ExportFormat.allCases, id: \.self) { f in
                        Text(f.label).tag(f)
                    }
                }
                .pickerStyle(.segmented)
            } header: {
                Text("Export Format")
            } footer: {
                Text("The format used when exporting all data. JSON is machine-readable; Markdown is human-readable.")
            }

            // ── Data Management ───────────────────────────────────────────────
            Section {
                // Record counts
                HStack {
                    Label("Summaries", systemImage: "doc.text")
                    Spacer()
                    Text("\(summaries.count)")
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                HStack {
                    Label("Tasks", systemImage: "checkmark.circle")
                    Spacer()
                    Text("\(tasks.count)")
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                HStack {
                    Label("Follow-up drafts", systemImage: "paperplane")
                    Spacer()
                    Text("\(drafts.count)")
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }

                // Export button — shows warning first
                Button {
                    showSensitiveWarning = true
                } label: {
                    Label("Export All Data…", systemImage: "square.and.arrow.up")
                }

                // Import button
                Button {
                    showImportPicker = true
                } label: {
                    Label("Import Data…", systemImage: "square.and.arrow.down")
                }
            } header: {
                Text("Data")
            } footer: {
                Text("Exported files are stored locally. Do not share them over unencrypted channels.")
            }

            // ── GPT Management Agent Sync ─────────────────────────────────────
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Agent Sync (Phase 2)")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text(
                        "In Phase 1 this app is the source of truth. Data can be exported as JSON " +
                        "for a GPT management agent to process, then re-imported. Direct sync " +
                        "requires a future backend API — ChatGPT memory is not the database."
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)

                // Placeholder toggle — disabled until Phase 2
                Toggle("Enable Agent Sync", isOn: .constant(false))
                    .disabled(true)
                    .foregroundStyle(.secondary)
            } header: {
                Text("GPT Management Agent Sync")
            }

            // ── About ─────────────────────────────────────────────────────────
            Section("About") {
                LabeledContent("Version", value: appVersion)
                LabeledContent("Build", value: appBuild)
                LabeledContent("Storage", value: "Local (SwiftData)")
                LabeledContent("Network", value: "None — local only")
                NavigationLink("Security Notes") {
                    SecurityNotesView()
                }
            }
        }
    }

    // MARK: - Export

    private func triggerExport() {
        guard let data = viewModel.exportAll(
            summaries: summaries,
            tasks: tasks,
            drafts: drafts
        ) else {
            viewModel.statusMessage = "Export failed"
            scheduleMessageClear()
            return
        }

        let filename = "taskflow-export-\(isoDateStamp()).json"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try data.write(to: url)
            exportURL = url
            showExportShareSheet = true
        } catch {
            viewModel.statusMessage = "Export failed: \(error.localizedDescription)"
            scheduleMessageClear()
        }
    }

    // MARK: - Import

    private func handleImport(result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            viewModel.statusMessage = "Import failed: \(error.localizedDescription)"
            scheduleMessageClear()
        case .success(let urls):
            guard let url = urls.first else { return }
            guard url.startAccessingSecurityScopedResource() else {
                viewModel.statusMessage = "Import failed: permission denied"
                scheduleMessageClear()
                return
            }
            defer { url.stopAccessingSecurityScopedResource() }
            do {
                let data = try Data(contentsOf: url)
                viewModel.importData(from: data, context: modelContext)
            } catch {
                viewModel.statusMessage = "Import failed: \(error.localizedDescription)"
            }
            scheduleMessageClear()
        }
    }

    // MARK: - Status Banner

    private func statusBanner(_ message: String) -> some View {
        Text(message)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Color.indigo.gradient, in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .animation(.spring, value: viewModel.statusMessage)
            .onTapGesture { viewModel.statusMessage = nil }
    }

    private func scheduleMessageClear() {
        Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            viewModel.statusMessage = nil
        }
    }

    // MARK: - Helpers

    private func isoDateStamp() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    private var appBuild: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
    }
}

// MARK: - SecurityNotesView

struct SecurityNotesView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Security Notes")
                    .font(.largeTitle.weight(.bold))

                securitySection(
                    title: "Local Storage",
                    body: "All data is stored locally on this device using SwiftData. " +
                          "No data is sent to any server, cloud, or external service in Phase 1."
                )

                securitySection(
                    title: "Face ID / Passcode",
                    body: "When enabled, this app requires device authentication to open. " +
                          "This uses iOS LocalAuthentication and does not transmit biometric data " +
                          "anywhere."
                )

                securitySection(
                    title: "Exports",
                    body: "Exported JSON files contain all your task and summary data. " +
                          "Treat them as sensitive documents. Do not store in unencrypted locations " +
                          "or share accidentally."
                )

                securitySection(
                    title: "No Analytics",
                    body: "This app contains no analytics, tracking, or telemetry of any kind."
                )

                securitySection(
                    title: "Future Phases",
                    body: "Phase 2 may add optional backend sync. All external integrations will " +
                          "require explicit user configuration and will be opt-in only."
                )
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Security Notes")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func securitySection(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline)
            Text(body)
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }
}

// MARK: - ShareSheet (UIActivityViewController wrapper)

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

// MARK: - Preview

#if DEBUG
#Preview {
    SettingsView()
        .modelContainer(
            for: [Summary.self, TaskItem.self, FollowUpDraft.self, AppSettings.self],
            inMemory: true
        )
}
#endif
