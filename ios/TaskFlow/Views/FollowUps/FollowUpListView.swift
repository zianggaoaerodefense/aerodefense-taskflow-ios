import SwiftUI
import SwiftData

// MARK: - FollowUpListView
//
// Displays all FollowUpDraft records grouped by workflow status.
// Active statuses (Draft, Reviewed, Approved) are always visible as named
// sections. Completed/historical entries (Sent, Archived) live under a
// disclosure toggle to keep the list focused.

struct FollowUpListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \FollowUpDraft.createdAt, order: .reverse) private var allDrafts: [FollowUpDraft]
    @State private var viewModel = FollowUpViewModel()
    @State private var showHistorySection = false

    // Statuses shown as always-visible sections
    private let activeSections: [DraftStatus] = [.draft, .reviewed, .approved]
    // Collapsed under a disclosure toggle
    private let historySections: [DraftStatus] = [.sentExternally, .archived]

    var body: some View {
        NavigationStack {
            Group {
                if allDrafts.isEmpty {
                    EmptyStateView(
                        title: "No Follow-ups",
                        systemImage: "paperplane",
                        description: "Follow-up drafts generated from tasks will appear here."
                    )
                } else {
                    draftList
                }
            }
            .navigationTitle("Follow-ups")
            .sheet(item: $viewModel.selectedDraft) { draft in
                FollowUpDetailView(draft: draft, viewModel: viewModel)
            }
        }
    }

    // MARK: - Draft list

    private var draftList: some View {
        List {
            // Active sections: Draft → Reviewed → Approved
            ForEach(activeSections, id: \.self) { status in
                let sectionDrafts = viewModel.drafts(for: status, from: allDrafts)
                if !sectionDrafts.isEmpty {
                    Section {
                        ForEach(sectionDrafts) { draft in
                            DraftCardRow(draft: draft)
                                .contentShape(Rectangle())
                                .onTapGesture { viewModel.selectedDraft = draft }
                                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                    leadingSwipeActions(for: draft)
                                }
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    trailingSwipeActions(for: draft)
                                }
                        }
                    } header: {
                        DraftSectionHeader(status: status, count: sectionDrafts.count)
                    }
                }
            }

            // History section: Sent Externally & Archived — collapsible
            let historyDrafts = historySections
                .flatMap { viewModel.drafts(for: $0, from: allDrafts) }
                .sorted { $0.createdAt > $1.createdAt }

            if !historyDrafts.isEmpty {
                Section {
                    if showHistorySection {
                        ForEach(historyDrafts) { draft in
                            DraftCardRow(draft: draft)
                                .contentShape(Rectangle())
                                .onTapGesture { viewModel.selectedDraft = draft }
                        }
                    }
                } header: {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            showHistorySection.toggle()
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(
                                systemName: showHistorySection
                                    ? "chevron.down"
                                    : "chevron.right"
                            )
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)

                            Text("Sent & Archived")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.secondary)

                            Spacer()

                            Text("\(historyDrafts.count)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .textCase(nil)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - Swipe actions

    @ViewBuilder
    private func leadingSwipeActions(for draft: FollowUpDraft) -> some View {
        if draft.draftStatus == .draft {
            Button {
                viewModel.updateStatus(draft, to: .reviewed, context: modelContext)
            } label: {
                Label("Mark Reviewed", systemImage: "checkmark.circle")
            }
            .tint(.orange)
        } else if draft.draftStatus == .reviewed {
            Button {
                viewModel.updateStatus(draft, to: .approved, context: modelContext)
            } label: {
                Label("Approve", systemImage: "hand.thumbsup")
            }
            .tint(.green)
        }
    }

    @ViewBuilder
    private func trailingSwipeActions(for draft: FollowUpDraft) -> some View {
        if draft.draftStatus != .archived {
            Button(role: .destructive) {
                viewModel.archive(draft, context: modelContext)
            } label: {
                Label("Archive", systemImage: "archivebox")
            }
        }
        Button {
            viewModel.copyToClipboard(draft)
        } label: {
            Label("Copy", systemImage: "doc.on.doc")
        }
        .tint(.indigo)
    }
}

// MARK: - DraftSectionHeader

private struct DraftSectionHeader: View {
    let status: DraftStatus
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
            Text(status.label)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer()
            Text("\(count)")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .textCase(nil)
    }

    private var statusColor: Color {
        switch status {
        case .draft:          return .blue
        case .reviewed:       return .orange
        case .approved:       return .green
        case .sentExternally: return .indigo
        case .archived:       return .gray
        }
    }
}

// MARK: - DraftCardRow

private struct DraftCardRow: View {
    let draft: FollowUpDraft

    var body: some View {
        HStack(alignment: .center, spacing: 12) {

            // Channel-type icon in a tinted circle
            ZStack {
                Circle()
                    .fill(channelColor.opacity(0.15))
                    .frame(width: 42, height: 42)
                Image(systemName: channelIcon)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(channelColor)
            }

            // Content column
            VStack(alignment: .leading, spacing: 4) {
                // Subject, task title, or body preview
                Text(displayTitle)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .foregroundStyle(.primary)

                // Linked task name (secondary)
                if let taskTitle = draft.task?.title {
                    Text("Task: \(taskTitle)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                HStack(spacing: 6) {
                    DraftStatusBadge(status: draft.draftStatus)
                    Spacer()
                    Text(draft.createdAt, style: .date)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: Computed helpers

    private var displayTitle: String {
        if let subject = draft.subject, !subject.isEmpty { return subject }
        if let taskTitle = draft.task?.title { return taskTitle }
        let preview = draft.body.trimmingCharacters(in: .whitespacesAndNewlines)
        return preview.isEmpty ? "Follow-up" : String(preview.prefix(60))
    }

    /// SF Symbol name keyed to channel type.
    private var channelIcon: String {
        switch draft.channelType {
        case .email: return "envelope.fill"
        case .slack: return "bubble.left.fill"
        case .jira:  return "ticket.fill"
        case .other: return "doc.text.fill"
        }
    }

    /// Accent color keyed to channel type.
    private var channelColor: Color {
        switch draft.channelType {
        case .email: return .blue
        case .slack: return .purple
        case .jira:  return .indigo
        case .other: return .secondary
        }
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    FollowUpListView()
        .modelContainer(for: [FollowUpDraft.self, TaskItem.self], inMemory: true)
}
#endif
