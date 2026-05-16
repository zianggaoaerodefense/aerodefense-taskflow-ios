import Foundation
import SwiftData
import Observation

@MainActor
@Observable
class SummaryViewModel {
    var searchText = ""
    var showAddSummary = false
    var selectedSummary: Summary?

    // MARK: - Filtering

    func filtered(_ summaries: [Summary]) -> [Summary] {
        guard !searchText.trimmingCharacters(in: .whitespaces).isEmpty else {
            return summaries
        }
        let query = searchText.lowercased()
        return summaries.filter { summary in
            summary.title.lowercased().contains(query)
                || summary.rawText.lowercased().contains(query)
                || summary.tags.contains { $0.lowercased().contains(query) }
                || (summary.source?.lowercased().contains(query) ?? false)
        }
    }

    // MARK: - Add Summary

    func addSummary(
        title: String,
        rawText: String,
        source: String?,
        tags: [String],
        context: ModelContext
    ) {
        let parsedSections = SummaryParser.parse(rawText: rawText)

        let sections = parsedSections.map { parsed in
            SummarySection(
                heading: parsed.heading,
                body: parsed.body,
                extractedBullets: parsed.bullets
            )
        }

        let summary = Summary(
            title: title,
            rawText: rawText,
            source: source.flatMap { $0.isEmpty ? nil : $0 },
            tags: tags,
            sections: sections
        )

        context.insert(summary)
    }

    // MARK: - Task Extraction

    func extractSuggestions(from summary: Summary) -> [TaskExtractionService.SuggestedTask] {
        TaskExtractionService.extractSuggestions(from: summary)
    }

    func addTasks(
        from suggestions: [TaskExtractionService.SuggestedTask],
        summary: Summary,
        context: ModelContext
    ) {
        for suggestion in suggestions {
            let task = TaskItem(
                title: suggestion.title,
                details: suggestion.details,
                sourceSummaryID: summary.id,
                sourceSummaryTitle: summary.title,
                resourceType: suggestion.suggestedResourceType
            )
            context.insert(task)
            summary.linkedTasks.append(task)
        }
        summary.dateUpdated = Date()
    }

    // MARK: - Delete

    func delete(_ summary: Summary, context: ModelContext) {
        context.delete(summary)
    }
}
