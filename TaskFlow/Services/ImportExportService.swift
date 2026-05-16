import Foundation
import UniformTypeIdentifiers
import SwiftData

// MARK: - Codable DTOs
//
// These plain structs mirror the SwiftData models but are fully Codable so
// they can be serialised to / deserialised from JSON without pulling in any
// SwiftData machinery. They contain no PII beyond what the app models already
// store; callers are responsible for securing exported data at rest.

struct SummarySectionDTO: Codable {
    var id: UUID
    var heading: String
    var body: String
    var extractedBullets: [String]
}

struct SummaryDTO: Codable {
    var id: UUID
    var title: String
    var dateCreated: Date
    var dateUpdated: Date
    var source: String?
    var rawText: String
    var tags: [String]
    var sections: [SummarySectionDTO]
}

struct TaskItemDTO: Codable {
    var id: UUID
    var title: String
    var details: String
    var sourceSummaryID: UUID?
    var sourceSummaryTitle: String?
    var statusRaw: String
    var priorityRaw: String
    var targetCompletionDate: Date?
    var actualCompletionDate: Date?
    var requesterName: String?
    var requesterContact: String?
    var resourceTypeRaw: String
    var resourceLabel: String?
    var resourceURL: String?
    var notes: String
    var createdAt: Date
    var updatedAt: Date
    var doneAt: Date?
}

struct FollowUpDraftDTO: Codable {
    var id: UUID
    var taskID: UUID
    var channelTypeRaw: String
    var recipientOrTarget: String?
    var subject: String?
    var body: String
    var statusRaw: String
    var createdAt: Date
    var updatedAt: Date
    var approvedAt: Date?
}

/// Top-level envelope written to / read from exported JSON files.
struct AppExportPayload: Codable {
    /// Increment when the shape of any DTO changes so import code can reject
    /// or migrate incompatible payloads gracefully.
    var schemaVersion: String = "1.0"
    var exportedAt: Date
    var summaries: [SummaryDTO]
    var tasks: [TaskItemDTO]
    var followUpDrafts: [FollowUpDraftDTO]
}

// MARK: - ImportExportService

struct ImportExportService {

    // MARK: - JSON encoder / decoder (shared, ISO 8601 dates)

    private static var encoder: JSONEncoder {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        return enc
    }

    private static var decoder: JSONDecoder {
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return dec
    }

    // MARK: - Export

    /// Serialise all app data to a JSON `Data` blob wrapped in `AppExportPayload`.
    static func exportJSON(
        summaries: [Summary],
        tasks: [TaskItem],
        drafts: [FollowUpDraft]
    ) throws -> Data {
        let payload = AppExportPayload(
            exportedAt: Date(),
            summaries: summaries.map(summaryDTO(from:)),
            tasks: tasks.map(taskItemDTO(from:)),
            followUpDrafts: drafts.map(followUpDraftDTO(from:))
        )
        return try encoder.encode(payload)
    }

    // MARK: - Import

    /// Decode a previously exported JSON blob back into an `AppExportPayload`.
    /// Throws `DecodingError` on malformed input.
    static func importJSON(data: Data) throws -> AppExportPayload {
        try decoder.decode(AppExportPayload.self, from: data)
    }

    /// Convert an `AppExportPayload` into SwiftData model objects.
    /// The caller is responsible for inserting the returned objects into
    /// a `ModelContext`; this function does not touch any context itself.
    static func createModels(
        from payload: AppExportPayload
    ) -> (summaries: [Summary], tasks: [TaskItem], drafts: [FollowUpDraft]) {

        // --- Summaries & their sections ---
        var summaryMap: [UUID: Summary] = [:]
        var summaries: [Summary] = []

        for dto in payload.summaries {
            let sections: [SummarySection] = dto.sections.map { sDTO in
                SummarySection(
                    id: sDTO.id,
                    heading: sDTO.heading,
                    body: sDTO.body,
                    extractedBullets: sDTO.extractedBullets
                )
            }
            let summary = Summary(
                id: dto.id,
                title: dto.title,
                dateCreated: dto.dateCreated,
                dateUpdated: dto.dateUpdated,
                source: dto.source,
                rawText: dto.rawText,
                tags: dto.tags,
                sections: sections,
                linkedTasks: []
            )
            summaryMap[summary.id] = summary
            summaries.append(summary)
        }

        // --- Tasks ---
        var taskMap: [UUID: TaskItem] = [:]
        var tasks: [TaskItem] = []

        for dto in payload.tasks {
            let task = TaskItem(
                id: dto.id,
                title: dto.title,
                details: dto.details,
                sourceSummaryID: dto.sourceSummaryID,
                sourceSummaryTitle: dto.sourceSummaryTitle,
                status: TaskStatus(rawValue: dto.statusRaw) ?? .new,
                priority: TaskPriority(rawValue: dto.priorityRaw) ?? .normal,
                targetCompletionDate: dto.targetCompletionDate,
                actualCompletionDate: dto.actualCompletionDate,
                requesterName: dto.requesterName,
                requesterContact: dto.requesterContact,
                resourceType: ResourceType(rawValue: dto.resourceTypeRaw) ?? .other,
                resourceLabel: dto.resourceLabel,
                resourceURL: dto.resourceURL,
                notes: dto.notes
            )
            // Restore timestamps that the init sets to Date()
            task.createdAt = dto.createdAt
            task.updatedAt = dto.updatedAt
            task.doneAt    = dto.doneAt

            // Wire summary relationship if the summary was included in this payload
            if let summaryID = dto.sourceSummaryID,
               let summary = summaryMap[summaryID] {
                task.sourceSummary = summary
                summary.linkedTasks.append(task)
            }

            taskMap[task.id] = task
            tasks.append(task)
        }

        // --- Follow-up drafts ---
        var drafts: [FollowUpDraft] = []

        for dto in payload.followUpDrafts {
            let draft = FollowUpDraft(
                id: dto.id,
                taskID: dto.taskID,
                channelType: ChannelType(rawValue: dto.channelTypeRaw) ?? .other,
                recipientOrTarget: dto.recipientOrTarget,
                subject: dto.subject,
                body: dto.body,
                status: DraftStatus(rawValue: dto.statusRaw) ?? .draft
            )
            draft.createdAt  = dto.createdAt
            draft.updatedAt  = dto.updatedAt
            draft.approvedAt = dto.approvedAt

            // Wire task relationship if the task was included in this payload
            if let task = taskMap[dto.taskID] {
                draft.task     = task
                task.followUpDraft = draft
            }

            drafts.append(draft)
        }

        return (summaries: summaries, tasks: tasks, drafts: drafts)
    }

    // MARK: - Markdown Export

    /// Produce a clean, human-readable Markdown document for a single summary
    /// and its associated tasks.
    ///
    /// Structure:
    ///   # Summary Title
    ///   Metadata block
    ///   ## Sections (with bullets)
    ///   ## Tasks (table)
    static func exportMarkdown(summary: Summary, tasks: [TaskItem]) -> String {
        var lines: [String] = []

        // ── Title ─────────────────────────────────────────────────────────────
        lines.append("# \(summary.title)")
        lines.append("")

        // ── Metadata ──────────────────────────────────────────────────────────
        let dateFmt = DateFormatter()
        dateFmt.dateStyle = .medium
        dateFmt.timeStyle = .short

        lines.append("**Created:** \(dateFmt.string(from: summary.dateCreated))")
        lines.append("**Updated:** \(dateFmt.string(from: summary.dateUpdated))")
        if let source = summary.source, !source.isEmpty {
            lines.append("**Source:** \(source)")
        }
        if !summary.tags.isEmpty {
            lines.append("**Tags:** \(summary.tags.joined(separator: ", "))")
        }
        lines.append("")

        // ── Sections ──────────────────────────────────────────────────────────
        if !summary.sections.isEmpty {
            lines.append("---")
            lines.append("")
            for section in summary.sections {
                if !section.heading.isEmpty {
                    lines.append("## \(section.heading)")
                    lines.append("")
                }
                if !section.body.isEmpty {
                    lines.append(section.body)
                    lines.append("")
                }
                if !section.extractedBullets.isEmpty {
                    for bullet in section.extractedBullets {
                        lines.append("- \(bullet)")
                    }
                    lines.append("")
                }
            }
        }

        // ── Raw text (collapsed) ──────────────────────────────────────────────
        if !summary.rawText.isEmpty {
            lines.append("---")
            lines.append("")
            lines.append("## Raw Text")
            lines.append("")
            // Indent each line so it renders as a blockquote
            let rawLines = summary.rawText
                .components(separatedBy: .newlines)
                .map { "> \($0)" }
            lines.append(contentsOf: rawLines)
            lines.append("")
        }

        // ── Tasks table ───────────────────────────────────────────────────────
        let summaryTasks = tasks.filter { $0.sourceSummaryID == summary.id }
        if !summaryTasks.isEmpty {
            lines.append("---")
            lines.append("")
            lines.append("## Linked Tasks")
            lines.append("")
            lines.append("| Title | Status | Priority | Resource | Due | Requester |")
            lines.append("|-------|--------|----------|----------|-----|-----------|")

            let shortDateFmt = DateFormatter()
            shortDateFmt.dateStyle = .short
            shortDateFmt.timeStyle = .none

            for task in summaryTasks {
                let due = task.targetCompletionDate
                    .map { shortDateFmt.string(from: $0) } ?? "—"
                let requester = task.requesterName ?? "—"
                let resource  = task.resourceType.label
                // Escape any pipe characters inside cell content to avoid
                // breaking the Markdown table.
                let safeTitle = task.title.replacingOccurrences(of: "|", with: "\\|")
                lines.append(
                    "| \(safeTitle) | \(task.status.label) | \(task.priority.label) | \(resource) | \(due) | \(requester) |"
                )
            }
            lines.append("")

            // Detailed task blocks
            lines.append("### Task Details")
            lines.append("")
            for task in summaryTasks {
                lines.append("#### \(task.title)")
                lines.append("")
                if !task.details.isEmpty {
                    lines.append(task.details)
                    lines.append("")
                }
                if !task.notes.isEmpty {
                    lines.append("**Notes:** \(task.notes)")
                    lines.append("")
                }
                if let url = task.resourceURL, !url.isEmpty {
                    lines.append("**Resource:** \(url)")
                    lines.append("")
                }
                if let actual = task.actualCompletionDate {
                    lines.append("**Completed:** \(shortDateFmt.string(from: actual))")
                    lines.append("")
                }
            }
        }

        return lines.joined(separator: "\n")
    }

    // MARK: - Private DTO converters

    private static func summaryDTO(from model: Summary) -> SummaryDTO {
        SummaryDTO(
            id: model.id,
            title: model.title,
            dateCreated: model.dateCreated,
            dateUpdated: model.dateUpdated,
            source: model.source,
            rawText: model.rawText,
            tags: model.tags,
            sections: model.sections.map { s in
                SummarySectionDTO(
                    id: s.id,
                    heading: s.heading,
                    body: s.body,
                    extractedBullets: s.extractedBullets
                )
            }
        )
    }

    private static func taskItemDTO(from model: TaskItem) -> TaskItemDTO {
        TaskItemDTO(
            id: model.id,
            title: model.title,
            details: model.details,
            sourceSummaryID: model.sourceSummaryID,
            sourceSummaryTitle: model.sourceSummaryTitle,
            statusRaw: model.statusRaw,
            priorityRaw: model.priorityRaw,
            targetCompletionDate: model.targetCompletionDate,
            actualCompletionDate: model.actualCompletionDate,
            requesterName: model.requesterName,
            requesterContact: model.requesterContact,
            resourceTypeRaw: model.resourceTypeRaw,
            resourceLabel: model.resourceLabel,
            resourceURL: model.resourceURL,
            notes: model.notes,
            createdAt: model.createdAt,
            updatedAt: model.updatedAt,
            doneAt: model.doneAt
        )
    }

    private static func followUpDraftDTO(from model: FollowUpDraft) -> FollowUpDraftDTO {
        FollowUpDraftDTO(
            id: model.id,
            taskID: model.taskID,
            channelTypeRaw: model.channelTypeRaw,
            recipientOrTarget: model.recipientOrTarget,
            subject: model.subject,
            body: model.body,
            statusRaw: model.statusRaw,
            createdAt: model.createdAt,
            updatedAt: model.updatedAt,
            approvedAt: model.approvedAt
        )
    }
}
