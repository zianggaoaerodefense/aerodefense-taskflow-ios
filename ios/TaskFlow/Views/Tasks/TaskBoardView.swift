import SwiftUI
import SwiftData

// MARK: - TaskBoardView
//
// Main Tasks screen. Tasks are grouped by status with a horizontal filter
// strip for quick single-status focus. A floating + button opens the create
// sheet. Tapping a card opens TaskDetailView.

struct TaskBoardView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \TaskItem.createdAt, order: .reverse) private var allTasks: [TaskItem]

    @State private var viewModel = TaskBoardViewModel()
    @State private var showAddTask = false
    @State private var selectedStatus: TaskStatus? = nil   // nil = show all

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    // Horizontal status filter strip
                    filterStrip
                        .padding(.bottom, 4)

                    // Grouped sections
                    LazyVStack(spacing: 20) {
                        ForEach(TaskStatus.allCases, id: \.self) { status in
                            let statusTasks = viewModel.tasks(for: status, from: allTasks)
                            let shouldShow  = selectedStatus == nil || selectedStatus == status

                            if shouldShow && (!statusTasks.isEmpty || selectedStatus == status) {
                                TaskStatusSection(
                                    status: status,
                                    tasks: statusTasks,
                                    viewModel: viewModel
                                )
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Tasks")
            .searchable(
                text: $viewModel.searchText,
                placement: .navigationBarDrawer(displayMode: .automatic),
                prompt: "Search tasks…"
            )
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showAddTask = true
                    } label: {
                        Image(systemName: "plus")
                            .fontWeight(.semibold)
                    }
                    .tint(.indigo)
                }
            }
            // Open detail/edit for a tapped card
            .sheet(item: $viewModel.selectedTask) { task in
                TaskDetailView(task: task, viewModel: viewModel)
            }
            // Create new task
            .sheet(isPresented: $showAddTask) {
                EditTaskView(task: nil)
            }
        }
    }

    // MARK: - Filter Strip

    private var filterStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // "All" chip
                StatusFilterChip(
                    label: "All",
                    systemImage: "square.grid.2x2",
                    count: nil,
                    isSelected: selectedStatus == nil,
                    color: .indigo
                ) {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        selectedStatus = nil
                    }
                }

                ForEach(TaskStatus.allCases, id: \.self) { status in
                    let count = viewModel.tasks(for: status, from: allTasks).count
                    StatusFilterChip(
                        label: status.label,
                        systemImage: nil,
                        count: count,
                        isSelected: selectedStatus == status,
                        color: status.color
                    ) {
                        withAnimation(.easeInOut(duration: 0.18)) {
                            selectedStatus = (selectedStatus == status) ? nil : status
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
    }
}

// MARK: - StatusFilterChip

private struct StatusFilterChip: View {
    let label: String
    let systemImage: String?
    let count: Int?
    let isSelected: Bool
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let icon = systemImage {
                    Image(systemName: icon)
                        .font(.caption.weight(.semibold))
                }
                Text(label)
                    .font(.subheadline.weight(.semibold))
                if let n = count, n > 0 {
                    Text("\(n)")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(isSelected ? color.opacity(0.25) : Color(.tertiarySystemFill))
                        .foregroundStyle(isSelected ? color : Color.secondary)
                        .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(isSelected ? color.opacity(0.15) : Color(.secondarySystemBackground))
            .foregroundStyle(isSelected ? color : Color.secondary)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(
                        isSelected ? color.opacity(0.40) : Color.clear,
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - TaskStatusSection

struct TaskStatusSection: View {
    let status: TaskStatus
    let tasks: [TaskItem]
    let viewModel: TaskBoardViewModel

    @Environment(\.modelContext) private var modelContext

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeaderRow(status: status, count: tasks.count)
                .padding(.top, 6)

            if tasks.isEmpty {
                emptyState
            } else {
                ForEach(tasks) { task in
                    TaskCardView(task: task, viewModel: viewModel)
                }
            }
        }
    }

    private var emptyState: some View {
        HStack {
            Spacer()
            Text("No \(status.label.lowercased()) tasks")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
                .padding(.vertical, 24)
            Spacer()
        }
        .background(Color(.secondarySystemBackground).opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
