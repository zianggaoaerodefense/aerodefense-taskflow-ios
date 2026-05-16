import Foundation
import SwiftData

// MARK: - Enums

enum ChannelType: String, Codable, CaseIterable {
    case email, slack, jira, other

    var label: String { rawValue.capitalized }
}

enum DraftStatus: String, Codable, CaseIterable {
    case draft, reviewed, approved, sentExternally, archived

    var label: String {
        switch self {
        case .draft:          return "Draft"
        case .reviewed:       return "Reviewed"
        case .approved:       return "Approved"
        case .sentExternally: return "Sent Externally"
        case .archived:       return "Archived"
        }
    }
}

// MARK: - FollowUpDraft Model

@Model
final class FollowUpDraft {
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

    var task: TaskItem?

    // MARK: Computed enum accessors

    var channelType: ChannelType {
        get { ChannelType(rawValue: channelTypeRaw) ?? .other }
        set { channelTypeRaw = newValue.rawValue }
    }

    var draftStatus: DraftStatus {
        get { DraftStatus(rawValue: statusRaw) ?? .draft }
        set { statusRaw = newValue.rawValue }
    }

    // MARK: Initializer

    init(
        id: UUID = UUID(),
        taskID: UUID,
        channelType: ChannelType,
        recipientOrTarget: String? = nil,
        subject: String? = nil,
        body: String,
        status: DraftStatus = .draft
    ) {
        self.id = id
        self.taskID = taskID
        self.channelTypeRaw = channelType.rawValue
        self.recipientOrTarget = recipientOrTarget
        self.subject = subject
        self.body = body
        self.statusRaw = status.rawValue
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
