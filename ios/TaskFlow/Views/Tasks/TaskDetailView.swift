import SwiftUI
import SwiftData

// MARK: - TaskDetailView
//
// Full-detail sheet for a TaskItem. Displays every field in grouped rounded
// cards following the Flat Design 2.0 aesthetic (soft shadows, indigo accent,
// colorful status chips). Quick-action buttons at the bottom advance the task
// through its status workflow with haptic feedback. Tapping "Edit" opens
// EditTaskView as a second-level sheet.

struct TaskDetailView: View {
    let task: TaskItem
    let viewModel: TaskBoardViewModel

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var showEdit = false
    @State private var showFollowUp = false

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {

                    // ── Header card: title, status, priority ──────────────────
                    headerCard

                    // ── Details card ──────────────────────────────────────────
                    if !task.details.isEmpty || !task.notes.isEmpty {
                        detailsCard
                    }

                    // ── Dates card ────────────────────────────────────────────
                    datesCard

                    // ── Requester card ────────────────────────────────────────
                    if task.requesterName != nil || task.requesterContact != nil {
                        requesterCard
                    }

                    // ── Resource card ─────────────────────────────────────────
                    resourceCard

                    // ── Source summary card ───────────────────────────────────
                    if let srcTitle = task.sourceSummaryTitle {
                        sourceSummaryCard(title: srcTitle)
                    }

                    // ── Follow-up draft card ──────────────────────────────────
                    followUpCard

                    // ── Action buttons ────────────────────────────────────────
                    actionButtons
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .padding(.bottom, 16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Task Detail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") { dismiss() }
                        .tint(.indigo)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Edit") { showEdit = true }
                        .fontWeight(.semibold)
                        .tint(.indigo)
                }
            }
            .sheet(isPresented: $showEdit) {
                EditTaskView(task: task)
            }
        }
    }

    // MARK: - Header Card

    private var headerCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 12) {
                Text(task.title)
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    StatusChip(status: task.status)
                    PriorityBadge(priority: task.priority)
                    Spacer()
                }

                HStack(spacing: 4) {
                    Image(systemName: "clock")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("Created \(task.createdAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if task.updatedAt > task.createdAt {
                        Text("· updated \(task.updatedAt.formatted(date: .abbreviated, time: .omitted))")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }

    // MARK: - Details Card

    private var detailsCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 12) {
                if !task.details.isEmpty {
                    detailSection(
                        icon: "text.alignleft",
                        label: "Details",
                        content: task.details
                    )
                }

                if !task.details.isEmpty && !task.notes.isEmpty {
                    Divider()
                }

                if !task.notes.isEmpty {
                    detailSection(
                        icon: "note.text",
                        label: "Notes",
                        content: task.notes
                    )
                }
            }
        }
    }

    // MARK: - Dates Card

    private var datesCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 10) {
                Label("Dates", systemImage: "calendar")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)

                Divider()

                if let target = task.targetCompletionDate {
                    let isPastDue = target < Date() && task.status != .done
                    HStack(spacing: 10) {
                        Image(systemName: isPastDue ? "exclamationmark.calendar" : "calendar")
                            .foregroundStyle(isPastDue ? .red : .indigo)
                            .frame(width: 20)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Target Completion")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(target.formatted(date: .long, time: .omitted))
                                .font(.subheadline)
                                .fontWeight(.medium)
                                .foregroundStyle(isPastDue ? .red : .primary)
                        }
                        if isPastDue {
                            Spacer()
                            Text("Past Due")
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color.red.opacity(0.12))
                                .foregroundStyle(.red)
                                .clipShape(Capsule())
                        }
                    }
                } else {
                    HStack(spacing: 10) {
                        Image(systemName: "calendar.badge.minus")
                            .foregroundStyle(.tertiary)
                            .frame(width: 20)
                        Text("No target date set")
                            .font(.subheadline)
                            .foregroundStyle(.tertiary)
                    }
                }

                if let actual = task.actualCompletionDate {
                    Divider()
                    HStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .frame(width: 20)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Completed")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(actual.formatted(date: .long, time: .omitted))
                                .font(.subheadline)
                                .fontWeight(.medium)
                                .foregroundStyle(.green)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Requester Card

    private var requesterCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 10) {
                Label("Requester", systemImage: "person.fill")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)

                Divider()

                if let name = task.requesterName {
                    HStack(spacing: 10) {
                        Image(systemName: "person.circle")
                            .foregroundStyle(.indigo)
                            .frame(width: 20)
                        Text(name)
                            .font(.subheadline)
                            .foregroundStyle(.primary)
                    }
                }

                if let contact = task.requesterContact, !contact.isEmpty {
                    HStack(spacing: 10) {
                        Image(systemName: "at")
                            .foregroundStyle(.secondary)
                            .frame(width: 20)
                        Text(contact)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: - Resource Card

    private var resourceCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 10) {
                Label("Resource", systemImage: task.resourceType.icon)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)

                Divider()

                HStack(spacing: 8) {
                    ResourceTypeBadge(resourceType: task.resourceType)
                    if let lbl = task.resourceLabel, !lbl.isEmpty {
                        Text(lbl)
                            .font(.subheadline)
                            .foregroundStyle(.primary)
                    }
                }

                if let urlString = task.resourceURL, !urlString.isEmpty {
                    if let url = URL(string: urlString) {
                        Link(destination: url) {
                            HStack(spacing: 6) {
                                Image(systemName: "link")
                                    .font(.caption)
                                Text(urlString)
                                    .font(.caption)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                Spacer()
                                Image(systemName: "arrow.up.right.square")
                                    .font(.caption)
                            }
                            .padding(10)
                            .background(Color.indigo.opacity(0.08))
                            .foregroundStyle(.indigo)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    } else {
                        HStack(spacing: 6) {
                            Image(systemName: "link")
                                .font(.caption)
                            Text(urlString)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Source Summary Card

    private func sourceSummaryCard(title: String) -> some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 10) {
                Label("Source Summary", systemImage: "doc.text")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)

                Divider()

                HStack(spacing: 8) {
                    Image(systemName: "link.circle.fill")
                        .foregroundStyle(.indigo)
                    Text(title)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                    Spacer()
                }
            }
        }
    }

    // MARK: - Follow-up Draft Card

    private var followUpCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 10) {
                Label("Follow-up Draft", systemImage: "paperplane")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)

                Divider()

                if let draft = task.followUpDraft {
                    HStack(spacing: 10) {
                        ChannelTypeIcon(channelType: draft.channelType)
                            .frame(width: 20)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(draft.channelType.label)
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                DraftStatusBadge(status: draft.draftStatus)
                            }
                            if let recipient = draft.recipientOrTarget, !recipient.isEmpty {
                                Text("To: \(recipient)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }

                    Text(draft.body)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.tertiarySystemFill))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                } else {
                    HStack(spacing: 8) {
                        Image(systemName: "paperplane.circle")
                            .foregroundStyle(.tertiary)
                        Text("No follow-up draft yet. Mark as Done to generate one automatically.")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
    }

    // MARK: - Action Buttons

    @ViewBuilder
    private var actionButtons: some View {
        VStack(spacing: 10) {
            switch task.status {
            case .new:
                statusActionButton(
                    label: "Mark Reviewed",
                    icon: "eye.circle.fill",
                    color: .orange,
                    targetStatus: .reviewed
                )
                statusActionButton(
                    label: "Mark Waiting",
                    icon: "clock.fill",
                    color: Color(red: 0.85, green: 0.70, blue: 0.0),
                    targetStatus: .waiting
                )
                statusActionButton(
                    label: "Mark Done",
                    icon: "checkmark.circle.fill",
                    color: .green,
                    targetStatus: .done
                )

            case .reviewed:
                statusActionButton(
                    label: "Mark Waiting",
                    icon: "clock.fill",
                    color: Color(red: 0.85, green: 0.70, blue: 0.0),
                    targetStatus: .waiting
                )
                statusActionButton(
                    label: "Mark Done",
                    icon: "checkmark.circle.fill",
                    color: .green,
                    targetStatus: .done
                )

            case .waiting:
                statusActionButton(
                    label: "Mark Done",
                    icon: "checkmark.circle.fill",
                    color: .green,
                    targetStatus: .done
                )
                statusActionButton(
                    label: "Mark Reviewed",
                    icon: "eye.circle.fill",
                    color: .orange,
                    targetStatus: .reviewed
                )

            case .done:
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("This task is complete")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(.green)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color.green.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    private func statusActionButton(
        label: String,
        icon: String,
        color: Color,
        targetStatus: TaskStatus
    ) -> some View {
        Button {
            viewModel.updateStatus(task, to: targetStatus, context: modelContext)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: icon)
                Text(label)
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(color.opacity(0.30), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    private func detailSection(icon: String, label: String, content: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: icon)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)

            Text(content)
                .font(.body)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
