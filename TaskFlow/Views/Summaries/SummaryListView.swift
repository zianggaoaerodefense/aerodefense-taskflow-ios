import SwiftUI
import SwiftData

// MARK: - SummaryListView

struct SummaryListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Summary.dateUpdated, order: .reverse) private var summaries: [Summary]
    @State private var viewModel = SummaryViewModel()

    var body: some View {
        NavigationStack {
            let visible = viewModel.filtered(summaries)

            Group {
                if visible.isEmpty {
                    emptySummariesView
                } else {
                    summaryScrollView(visible)
                }
            }
            .navigationTitle("Summaries")
            .searchable(
                text: $viewModel.searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search summaries…"
            )
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        viewModel.showAddSummary = true
                    } label: {
                        Image(systemName: "plus")
                            .fontWeight(.semibold)
                    }
                    .tint(.indigo)
                }
            }
            .sheet(isPresented: $viewModel.showAddSummary) {
                AddSummaryView(viewModel: viewModel)
            }
            .sheet(item: $viewModel.selectedSummary) { summary in
                SummaryDetailView(summary: summary)
            }
        }
    }

    // MARK: - Empty State

    @ViewBuilder
    private var emptySummariesView: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "doc.text.magnifyingglass")
                .font(.system(size: 62))
                .foregroundStyle(.indigo.opacity(0.45))
            Text(summaries.isEmpty ? "No Summaries Yet" : "No Results")
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)
            Text(summaries.isEmpty
                 ? "Tap + to add your first summary."
                 : "Try adjusting your search.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            if summaries.isEmpty {
                Button {
                    viewModel.showAddSummary = true
                } label: {
                    Label("Add Summary", systemImage: "plus.circle.fill")
                        .fontWeight(.semibold)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(Color.indigo)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding()
    }

    // MARK: - Scroll View of Cards

    @ViewBuilder
    private func summaryScrollView(_ items: [Summary]) -> some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                ForEach(items) { summary in
                    SummaryCardView(summary: summary)
                        .onTapGesture {
                            viewModel.selectedSummary = summary
                        }
                        .contextMenu {
                            Button(role: .destructive) {
                                viewModel.delete(summary, context: modelContext)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color(.systemGroupedBackground))
    }
}

// MARK: - SummaryCardView

struct SummaryCardView: View {
    let summary: Summary

    private static let relativeDateFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {

            // MARK: Title row + task badge
            HStack(alignment: .top, spacing: 8) {
                Text(summary.title)
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 4)

                if !summary.linkedTasks.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption)
                        Text("\(summary.linkedTasks.count)")
                            .font(.caption)
                            .fontWeight(.semibold)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.indigo)
                    .clipShape(Capsule())
                }
            }

            // MARK: Source badge + relative date
            HStack(spacing: 8) {
                if let source = summary.source, !source.isEmpty {
                    SourceBadge(source: source)
                }
                Spacer()
                Text(Self.relativeDateFormatter.localizedString(
                    for: summary.dateCreated,
                    relativeTo: Date()
                ))
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            // MARK: Tags
            if !summary.tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(summary.tags, id: \.self) { tag in
                            SummaryTagChip(text: tag)
                        }
                    }
                }
            }
        }
        .padding(16)
        .background(.background)
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.07), radius: 8, x: 0, y: 2)
    }
}

// MARK: - SourceBadge

struct SourceBadge: View {
    let source: String

    private var icon: String {
        switch source.lowercased() {
        case "slack":       return "bubble.left.and.bubble.right"
        case "email":       return "envelope"
        case "import":      return "square.and.arrow.down"
        case "gpt memory":  return "sparkles"
        case "manual":      return "pencil"
        default:            return "doc.text"
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption2)
            Text(source)
                .font(.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(.secondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color(.systemFill))
        .clipShape(Capsule())
    }
}

// MARK: - SummaryTagChip

struct SummaryTagChip: View {
    let text: String

    var body: some View {
        Text("#\(text)")
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundStyle(Color.indigo)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.indigo.opacity(0.12))
            .clipShape(Capsule())
    }
}
