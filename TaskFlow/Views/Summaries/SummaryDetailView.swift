import SwiftUI
import SwiftData

// MARK: - SummaryDetailView

struct SummaryDetailView: View {
    let summary: Summary
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var showExtractionPreview = false
    @State private var suggestions: [TaskExtractionService.SuggestedTask] = []

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {

                    // MARK: Header card
                    headerCard

                    // MARK: Parsed sections (expandable) or raw text fallback
                    if !summary.sections.isEmpty {
                        ForEach(summary.sections) { section in
                            SectionDisclosureCard(section: section)
                        }
                    } else if !summary.rawText.isEmpty {
                        rawTextCard
                    }

                    // MARK: Linked tasks
                    if !summary.linkedTasks.isEmpty {
                        linkedTasksCard
                    }

                    // MARK: Create Tasks CTA
                    createTasksButton
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(.systemGroupedBackground))
            .navigationTitle(summary.title)
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                        .tint(.indigo)
                }
            }
        }
        .sheet(isPresented: $showExtractionPreview) {
            TaskExtractionPreviewView(summary: summary, suggestions: suggestions)
        }
    }

    // MARK: - Header Card

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 12) {

            // Dates row
            HStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("CREATED")
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .foregroundStyle(.secondary)
                    Text(Self.dateFormatter.string(from: summary.dateCreated))
                        .font(.caption)
                        .foregroundStyle(.primary)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("UPDATED")
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .foregroundStyle(.secondary)
                    Text(Self.dateFormatter.string(from: summary.dateUpdated))
                        .font(.caption)
                        .foregroundStyle(.primary)
                }
                Spacer()
                if let source = summary.source, !source.isEmpty {
                    SourceBadge(source: source)
                }
            }

            // Tags row
            if !summary.tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(summary.tags, id: \.self) { tag in
                            SummaryTagChip(text: tag)
                        }
                    }
                }
            }

            // Linked tasks banner
            if !summary.linkedTasks.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.indigo)
                    Text("\(summary.linkedTasks.count) linked task\(summary.linkedTasks.count == 1 ? "" : "s")")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(.indigo)
                    Spacer()
                }
                .padding(10)
                .background(Color.indigo.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(16)
        .background(.background)
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.07), radius: 8, x: 0, y: 2)
    }

    // MARK: - Raw Text Card (no sections fallback)

    private var rawTextCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Raw Text", systemImage: "text.alignleft")
                .font(.headline)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)

            Divider()

            Text(summary.rawText)
                .font(.body)
                .foregroundStyle(.primary)
        }
        .padding(16)
        .background(.background)
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.07), radius: 8, x: 0, y: 2)
    }

    // MARK: - Linked Tasks Card

    private var linkedTasksCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Linked Tasks", systemImage: "checkmark.circle")
                .font(.headline)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)

            Divider()

            ForEach(summary.linkedTasks) { task in
                HStack(spacing: 10) {
                    Image(systemName: task.status == .done
                          ? "checkmark.circle.fill"
                          : "circle")
                        .font(.subheadline)
                        .foregroundStyle(task.status.color)

                    Text(task.title)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .lineLimit(2)

                    Spacer()

                    TaskStatusChip(status: task.status)
                }
            }
        }
        .padding(16)
        .background(.background)
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.07), radius: 8, x: 0, y: 2)
    }

    // MARK: - Create Tasks Button

    private var createTasksButton: some View {
        Button {
            loadSuggestions()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "wand.and.sparkles")
                    .font(.headline)
                Text("Create Tasks from Summary")
                    .font(.headline)
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Color.indigo)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: Color.indigo.opacity(0.30), radius: 8, x: 0, y: 4)
        }
        .buttonStyle(.plain)
        .padding(.top, 4)
        .padding(.bottom, 8)
    }

    // MARK: - Actions

    func loadSuggestions() {
        suggestions = TaskExtractionService.extractSuggestions(from: summary)
        showExtractionPreview = true
    }
}

// MARK: - SectionDisclosureCard

struct SectionDisclosureCard: View {
    let section: SummarySection
    @State private var isExpanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            DisclosureGroup(isExpanded: $isExpanded) {
                VStack(alignment: .leading, spacing: 12) {

                    // Body text
                    if !section.body.isEmpty {
                        Divider()
                            .padding(.top, 4)
                        Text(section.body)
                            .font(.body)
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    // Extracted bullets
                    if !section.extractedBullets.isEmpty {
                        Divider()

                        VStack(alignment: .leading, spacing: 6) {
                            Text("KEY POINTS")
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .foregroundStyle(.secondary)

                            ForEach(section.extractedBullets, id: \.self) { bullet in
                                HStack(alignment: .top, spacing: 8) {
                                    Circle()
                                        .fill(Color.indigo)
                                        .frame(width: 6, height: 6)
                                        .padding(.top, 6)
                                    Text(bullet)
                                        .font(.subheadline)
                                        .foregroundStyle(.primary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }
                }
                .padding(.bottom, 4)
            } label: {
                Text(section.heading)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
            }
            .tint(.indigo)
        }
        .padding(16)
        .background(.background)
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.07), radius: 8, x: 0, y: 2)
    }
}

// MARK: - TaskStatusChip

struct TaskStatusChip: View {
    let status: TaskStatus

    var body: some View {
        Text(status.label)
            .font(.caption2)
            .fontWeight(.semibold)
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(status.color)
            .clipShape(Capsule())
    }
}
