import SwiftUI
import SwiftData

// MARK: - FollowUpDetailView
//
// Full edit/review sheet for a single FollowUpDraft.
// Layout: header info card → editable fields → action buttons.
// The body is a free-text TextEditor. Status advances through
// Draft → Reviewed → Approved → Sent Externally via action buttons.

struct FollowUpDetailView: View {
    @Bindable var draft: FollowUpDraft
    let viewModel: FollowUpViewModel

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var showCopied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {

                    // ── Header card ───────────────────────────────────────────
                    headerCard

                    // ── Jira resource URL (prominent if jira channel) ─────────
                    if draft.channelType == .jira,
                       let url = draft.task?.resourceURL,
                       !url.isEmpty {
                        jiraResourceCard(url: url)
                    }

                    // ── Editable fields ───────────────────────────────────────
                    editableFields

                    // ── Body editor ───────────────────────────────────────────
                    bodyEditor

                    // ── Action buttons ────────────────────────────────────────
                    actionButtons

                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Draft")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        draft.updatedAt = Date()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        viewModel.copyToClipboard(draft)
                        showCopied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            showCopied = false
                        }
                    } label: {
                        Label(
                            showCopied ? "Copied!" : "Copy",
                            systemImage: showCopied ? "checkmark" : "doc.on.doc"
                        )
                    }
                    .tint(showCopied ? .green : .indigo)
                    .animation(.easeInOut(duration: 0.2), value: showCopied)
                }
            }
        }
    }

    // MARK: - Header Card

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                // Channel icon in colored circle
                ZStack {
                    Circle()
                        .fill(channelColor.opacity(0.15))
                        .frame(width: 48, height: 48)
                    Image(systemName: channelIcon)
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(channelColor)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(draft.channelType.label)
                        .font(.headline)
                    DraftStatusBadge(status: draft.draftStatus)
                }

                Spacer()
            }

            if let taskTitle = draft.task?.title {
                Divider()
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Task: \(taskTitle)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }

            HStack(spacing: 16) {
                Label(DateFormatter.mediumDate.string(from: draft.createdAt), systemImage: "calendar")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let approvedAt = draft.approvedAt {
                    Label(
                        "Approved \(DateFormatter.shortDate.string(from: approvedAt))",
                        systemImage: "checkmark.seal"
                    )
                    .font(.caption)
                    .foregroundStyle(.green)
                }
            }
        }
        .padding(16)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
    }

    // MARK: - Jira Resource Card

    private func jiraResourceCard(url: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "ticket.fill")
                .font(.subheadline)
                .foregroundStyle(.indigo)
            VStack(alignment: .leading, spacing: 2) {
                Text("Jira Ticket")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                if let parsed = URL(string: url) {
                    Link(url, destination: parsed)
                        .font(.caption)
                        .lineLimit(1)
                        .tint(.indigo)
                } else {
                    Text(url)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            Image(systemName: "arrow.up.right.square")
                .font(.caption)
                .foregroundStyle(.indigo)
        }
        .padding(14)
        .background(Color.indigo.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.indigo.opacity(0.20), lineWidth: 1)
        )
    }

    // MARK: - Editable Fields

    private var editableFields: some View {
        VStack(alignment: .leading, spacing: 12) {

            // Recipient / target
            fieldCard(label: "Recipient") {
                TextField(
                    "Recipient or target",
                    text: Binding(
                        get: { draft.recipientOrTarget ?? "" },
                        set: { draft.recipientOrTarget = $0.isEmpty ? nil : $0 }
                    )
                )
                .autocorrectionDisabled()
                .autocapitalization(.none)
                .font(.body)
            }

            // Subject — editable only for email channel
            if draft.channelType == .email {
                fieldCard(label: "Subject") {
                    TextField(
                        "Subject line",
                        text: Binding(
                            get: { draft.subject ?? "" },
                            set: { draft.subject = $0.isEmpty ? nil : $0 }
                        )
                    )
                    .font(.body)
                }
            }
        }
    }

    @ViewBuilder
    private func fieldCard<Content: View>(
        label: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            content()
        }
        .padding(14)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .shadow(color: .black.opacity(0.04), radius: 4, x: 0, y: 1)
    }

    // MARK: - Body Editor

    private var bodyEditor: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Body")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)

            TextEditor(text: $draft.body)
                .frame(minHeight: 220)
                .font(.body)
                .padding(10)
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .shadow(color: .black.opacity(0.04), radius: 4, x: 0, y: 1)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 0.5)
                )
        }
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        VStack(spacing: 10) {

            // Mark Reviewed — shown when draft is in .draft status
            if draft.draftStatus == .draft {
                ActionButton(
                    title: "Mark Reviewed",
                    systemImage: "eye.circle.fill",
                    color: .orange
                ) {
                    viewModel.updateStatus(draft, to: .reviewed, context: modelContext)
                }
            }

            // Mark Approved — shown when draft is in .reviewed status
            if draft.draftStatus == .reviewed {
                ActionButton(
                    title: "Mark Approved",
                    systemImage: "checkmark.seal.fill",
                    color: .green
                ) {
                    viewModel.updateStatus(draft, to: .approved, context: modelContext)
                }
            }

            // Mark Sent — shown when draft is in .approved status
            if draft.draftStatus == .approved {
                ActionButton(
                    title: "Mark as Sent",
                    systemImage: "paperplane.fill",
                    color: .indigo
                ) {
                    viewModel.updateStatus(draft, to: .sentExternally, context: modelContext)
                }
            }

            // Archive — always visible unless already archived
            if draft.draftStatus != .archived {
                ActionButton(
                    title: "Archive",
                    systemImage: "archivebox.fill",
                    color: .gray,
                    role: .destructive
                ) {
                    viewModel.archive(draft, context: modelContext)
                    dismiss()
                }
            }
        }
    }

    // MARK: - Computed helpers

    private var channelIcon: String {
        switch draft.channelType {
        case .email: return "envelope.fill"
        case .slack: return "bubble.left.and.bubble.right.fill"
        case .jira:  return "ticket.fill"
        case .other: return "doc.text.fill"
        }
    }

    private var channelColor: Color {
        switch draft.channelType {
        case .email: return .blue
        case .slack: return .purple
        case .jira:  return .indigo
        case .other: return .secondary
        }
    }
}

// MARK: - ActionButton

/// Reusable full-width action button with consistent Flat Design 2.0 styling.
private struct ActionButton: View {
    let title: String
    let systemImage: String
    let color: Color
    var role: ButtonRole? = nil
    let action: () -> Void

    var body: some View {
        Button(role: role, action: action) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(
                    role == .destructive
                        ? Color(.secondarySystemBackground)
                        : color.opacity(0.12)
                )
                .foregroundStyle(
                    role == .destructive ? color.opacity(0.7) : color
                )
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(
                            color.opacity(role == .destructive ? 0.25 : 0.30),
                            lineWidth: 0.75
                        )
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    let draft = FollowUpDraft(
        taskID: UUID(),
        channelType: .email,
        recipientOrTarget: "team@example.com",
        subject: "Q2 Review Follow-up",
        body: "Hi team,\n\nFollowing up on the Q2 engineering review...",
        status: .draft
    )
    return FollowUpDetailView(
        draft: draft,
        viewModel: FollowUpViewModel()
    )
    .modelContainer(for: [FollowUpDraft.self, TaskItem.self], inMemory: true)
}
#endif
