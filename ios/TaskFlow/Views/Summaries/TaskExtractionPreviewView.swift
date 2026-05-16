import SwiftUI
import SwiftData

// MARK: - TaskExtractionPreviewView

struct TaskExtractionPreviewView: View {
    let summary: Summary
    let suggestions: [TaskExtractionService.SuggestedTask]

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var selected: Set<Int> = []
    @State private var viewModel = SummaryViewModel()

    private var allSelected: Bool { selected.count == suggestions.count }
    private var selectedCount: Int { selected.count }

    var body: some View {
        NavigationStack {
            Group {
                if suggestions.isEmpty {
                    emptyView
                } else {
                    suggestionsList
                }
            }
            .navigationTitle("Extract Tasks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                toolbarContent
            }
        }
        .onAppear {
            // Select all by default
            selected = Set(suggestions.indices)
        }
    }

    // MARK: - Empty State

    private var emptyView: some View {
        ContentUnavailableView(
            "No Actions Found",
            systemImage: "magnifyingglass",
            description: Text("No action items were detected in this summary. You can add tasks manually from the Tasks tab.")
        )
    }

    // MARK: - Suggestions List

    private var suggestionsList: some View {
        List {
            Section {
                ForEach(suggestions.indices, id: \.self) { i in
                    SuggestionRow(
                        suggestion: suggestions[i],
                        isSelected: selected.contains(i)
                    )
                    .contentShape(Rectangle())
                    .onTapGesture { toggle(i) }
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    .listRowBackground(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(
                                selected.contains(i)
                                    ? Color.indigo.opacity(0.06)
                                    : Color(.secondarySystemGroupedBackground)
                            )
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                    )
                }
            } header: {
                HStack {
                    Text("\(suggestions.count) suggestion\(suggestions.count == 1 ? "" : "s") found")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)
                    Spacer()
                    Text("From: \(summary.title)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .textCase(nil)
                .padding(.bottom, 4)
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }
        }

        ToolbarItem(placement: .navigationBarLeading) {
            Button(allSelected ? "Deselect All" : "Select All") {
                if allSelected {
                    selected.removeAll()
                } else {
                    selected = Set(suggestions.indices)
                }
            }
            .font(.subheadline)
            .tint(.indigo)
        }

        ToolbarItem(placement: .confirmationAction) {
            Button {
                let chosen = selected.sorted().map { suggestions[$0] }
                viewModel.addTasks(from: chosen, summary: summary, context: modelContext)
                dismiss()
            } label: {
                Text("Add \(selectedCount) Task\(selectedCount == 1 ? "" : "s")")
                    .fontWeight(.semibold)
            }
            .disabled(selected.isEmpty)
            .tint(.indigo)
        }
    }

    // MARK: - Helpers

    private func toggle(_ i: Int) {
        if selected.contains(i) {
            selected.remove(i)
        } else {
            selected.insert(i)
        }
    }
}

// MARK: - SuggestionRow

private struct SuggestionRow: View {
    let suggestion: TaskExtractionService.SuggestedTask
    let isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {

            // Checkbox icon
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isSelected ? Color.indigo : Color.secondary)
                .font(.title3)
                .animation(.easeInOut(duration: 0.15), value: isSelected)

            // Content
            VStack(alignment: .leading, spacing: 4) {
                Text(suggestion.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)

                if !suggestion.sectionContext.isEmpty {
                    Text("From: \(suggestion.sectionContext)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if !suggestion.details.isEmpty {
                    Text(suggestion.details)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                // Resource type badge
                HStack(spacing: 4) {
                    Image(systemName: suggestion.suggestedResourceType.icon)
                        .font(.caption2)
                    Text(suggestion.suggestedResourceType.label)
                        .font(.caption2)
                        .fontWeight(.medium)
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color(.systemFill))
                .clipShape(Capsule())
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
    }
}
