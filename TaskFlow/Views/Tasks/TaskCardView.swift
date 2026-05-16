import SwiftUI
import SwiftData

// MARK: - TaskCardView
//
// Flat Design 2.0 card for a single TaskItem. Displays title, priority badge,
// status chip, resource type, optional source summary reference, dates, and
// requester in a clean stacked layout. Supports swipe actions and a context
// menu for quick status changes. Tapping opens TaskDetailView via the shared
// TaskBoardViewModel.selectedTask binding.

struct TaskCardView: View {
    let task: TaskItem
    let viewModel: TaskBoardViewModel

    @Environment(\.modelContext) private var modelContext

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {

            // ── Row 1: title + priority badge ─────────────────────────────────
            HStack(alignment: .top, spacing: 8) {
                Text(task.title)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 4)

                PriorityBadge(priority: task.priority)
            }

            // ── Row 2: status chip + resource type badge ───────────────────────
            HStack(spacing: 6) {
                StatusChip(status: task.status)
                ResourceTypeBadge(resourceType: task.resourceType)
                Spacer()
            }

            // ── Row 3: source summary (if present) ────────────────────────────
            if let src = task.sourceSummaryTitle {
                HStack(spacing: 4) {
                    Image(systemName: "doc.text")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(src)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            // ── Row 4: dates + requester + resource link indicator ─────────────
            HStack(spacing: 12) {
                if let target = task.targetCompletionDate {
                    let isPastDue = target < Date() && task.status != .done
                    Label(
                        target.formatted(date: .abbreviated, time: .omitted),
                        systemImage: "calendar"
                    )
                    .font(.caption2)
                    .foregroundStyle(isPastDue ? .red : .secondary)
                }

                if let req = task.requesterName {
                    Label(req, systemImage: "person.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                if let url = task.resourceURL, !url.isEmpty {
                    Image(systemName: "link")
                        .font(.caption2)
                        .foregroundStyle(.indigo)
                }
            }

            // ── Row 5: completion banner (done tasks only) ────────────────────
            if task.status == .done, let done = task.actualCompletionDate {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.caption2)
                        .foregroundStyle(.green)
                    Text("Completed \(done.formatted(date: .abbreviated, time: .omitted))")
                        .font(.caption2)
                        .foregroundStyle(.green)
                }
            }
        }
        .padding(14)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: .black.opacity(0.06), radius: 6, x: 0, y: 2)
        .contentShape(Rectangle())
        .onTapGesture {
            viewModel.selectedTask = task
        }
        // ── Context menu ──────────────────────────────────────────────────────
        .contextMenu {
            if task.status != .reviewed {
                Button {
                    viewModel.updateStatus(task, to: .reviewed, context: modelContext)
                } label: {
                    Label("Mark Reviewed", systemImage: "eye.circle")
                }
            }

            if task.status != .waiting {
                Button {
                    viewModel.updateStatus(task, to: .waiting, context: modelContext)
                } label: {
                    Label("Mark Waiting", systemImage: "clock")
                }
            }

            if task.status != .done {
                Button {
                    viewModel.updateStatus(task, to: .done, context: modelContext)
                } label: {
                    Label("Mark Done", systemImage: "checkmark.circle.fill")
                }
            }

            Divider()

            Button {
                viewModel.selectedTask = task
            } label: {
                Label("View Details", systemImage: "info.circle")
            }

            Divider()

            Button(role: .destructive) {
                viewModel.delete(task, context: modelContext)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        // ── Trailing swipe: delete ────────────────────────────────────────────
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                viewModel.delete(task, context: modelContext)
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        // ── Leading swipe: mark done (unless already done) ────────────────────
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if task.status != .done {
                Button {
                    viewModel.updateStatus(task, to: .done, context: modelContext)
                } label: {
                    Label("Done", systemImage: "checkmark.circle.fill")
                }
                .tint(.green)
            }
        }
    }
}
