import Foundation

// MARK: - FollowUpDraftService
//
// Generates a FollowUpDraft for a completed TaskItem. All content is produced
// locally from the task's stored fields — no network calls are made. The
// generated body text is intentionally conservative and does not embed any
// PII beyond what the TaskItem itself already holds.

struct FollowUpDraftService {

    // MARK: - Public API

    /// Create a ready-to-edit `FollowUpDraft` for `task`.
    ///
    /// Channel type is derived from the task's `resourceType`. The resulting
    /// draft has `DraftStatus.draft` so it must be reviewed before sending.
    static func generateDraft(for task: TaskItem) -> FollowUpDraft {
        let channel = channelType(for: task.resourceType)
        let subject = generateSubject(for: task, channelType: channel)
        let body    = generateBody(for: task, channelType: channel)

        return FollowUpDraft(
            taskID: task.id,
            channelType: channel,
            recipientOrTarget: task.requesterContact ?? task.requesterName,
            subject: subject,
            body: body,
            status: .draft
        )
    }

    // MARK: - Channel mapping

    /// Map `ResourceType` to the most appropriate `ChannelType`.
    static func channelType(for resourceType: ResourceType) -> ChannelType {
        switch resourceType {
        case .email:              return .email
        case .slack:              return .slack
        case .jira:               return .jira
        case .github, .document, .other: return .other
        }
    }

    // MARK: - Body generation

    private static func generateBody(for task: TaskItem, channelType: ChannelType) -> String {
        let name           = task.requesterName ?? "there"
        let completionStr  = task.actualCompletionDate.map {
            DateFormatter.localizedString(from: $0, dateStyle: .medium, timeStyle: .none)
        } ?? "recently"
        let detailsSnippet = task.details.isEmpty ? "(no further details)" : task.details

        switch channelType {
        case .email:
            return """
            Hi \(name),

            I wanted to follow up and let you know that I completed: \(task.title).

            Summary:
            \(detailsSnippet)

            Please let me know if you need anything else.

            Best regards
            """

        case .slack:
            // Keep Slack messages concise; cap details at 120 characters.
            let snippet = detailsSnippet.count > 120
                ? detailsSnippet.prefix(120) + "…"
                : detailsSnippet[...]
            return "Hi \(name), quick update: I completed *\(task.title)*. \(snippet) Let me know if you want me to adjust anything. 👍"

        case .jira:
            return """
            Task completed.

            Summary:
            \(detailsSnippet)

            Completion date: \(completionStr)
            """

        case .other:
            return """
            Completed: \(task.title)

            Details:
            \(detailsSnippet)

            Completed on: \(completionStr)
            """
        }
    }

    // MARK: - Subject generation

    private static func generateSubject(for task: TaskItem, channelType: ChannelType) -> String? {
        // Only email-style channels benefit from an explicit subject line.
        switch channelType {
        case .email:
            return "Follow-up: \(task.title)"
        case .slack, .jira, .other:
            return nil
        }
    }
}
