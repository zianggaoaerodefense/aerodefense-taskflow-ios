import SwiftUI
import SwiftData

// MARK: - Enums

enum TaskStatus: String, Codable, CaseIterable {
    case new
    case reviewNeeded
    case actionNeeded
    case waiting
    case done
    case archived

    var label: String {
        switch self {
        case .new:          return "New"
        case .reviewNeeded: return "Review Needed"
        case .actionNeeded: return "Action Needed"
        case .waiting:      return "Waiting"
        case .done:         return "Done"
        case .archived:     return "Archived"
        }
    }

    var color: Color {
        switch self {
        case .new:          return .blue
        case .reviewNeeded: return .purple
        case .actionNeeded: return .orange
        case .waiting:      return .yellow
        case .done:         return .green
        case .archived:     return .gray
        }
    }
}

enum TaskPriority: String, Codable, CaseIterable {
    case low, normal, high, urgent

    var label: String { rawValue.capitalized }

    var color: Color {
        switch self {
        case .low:    return .gray
        case .normal: return .blue
        case .high:   return .orange
        case .urgent: return .red
        }
    }
}

enum ResourceType: String, Codable, CaseIterable {
    case email, slack, jira, github, document, other

    var label: String { rawValue.capitalized }

    var icon: String {
        switch self {
        case .email:    return "envelope"
        case .slack:    return "bubble.left.and.bubble.right"
        case .jira:     return "ticket"
        case .github:   return "chevron.left.forwardslash.chevron.right"
        case .document: return "doc.text"
        case .other:    return "link"
        }
    }
}

// MARK: - TaskItem Model

@Model
final class TaskItem {
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
    var reviewedAt: Date?
    // Backend sync fields
    var remoteId: String?
    var isSynced: Bool

    var sourceSummary: Summary?

    @Relationship(deleteRule: .cascade)
    var followUpDraft: FollowUpDraft?

    // MARK: Computed enum accessors

    var status: TaskStatus {
        get { TaskStatus(rawValue: statusRaw) ?? .new }
        set { statusRaw = newValue.rawValue }
    }

    var priority: TaskPriority {
        get { TaskPriority(rawValue: priorityRaw) ?? .normal }
        set { priorityRaw = newValue.rawValue }
    }

    var resourceType: ResourceType {
        get { ResourceType(rawValue: resourceTypeRaw) ?? .other }
        set { resourceTypeRaw = newValue.rawValue }
    }

    // MARK: Initializer

    init(
        id: UUID = UUID(),
        title: String,
        details: String = "",
        sourceSummaryID: UUID? = nil,
        sourceSummaryTitle: String? = nil,
        status: TaskStatus = .new,
        priority: TaskPriority = .normal,
        targetCompletionDate: Date? = nil,
        actualCompletionDate: Date? = nil,
        requesterName: String? = nil,
        requesterContact: String? = nil,
        resourceType: ResourceType = .other,
        resourceLabel: String? = nil,
        resourceURL: String? = nil,
        notes: String = ""
    ) {
        self.id = id
        self.title = title
        self.details = details
        self.sourceSummaryID = sourceSummaryID
        self.sourceSummaryTitle = sourceSummaryTitle
        self.statusRaw = status.rawValue
        self.priorityRaw = priority.rawValue
        self.resourceTypeRaw = resourceType.rawValue
        self.resourceLabel = resourceLabel
        self.resourceURL = resourceURL
        self.notes = notes
        self.requesterName = requesterName
        self.requesterContact = requesterContact
        self.targetCompletionDate = targetCompletionDate
        self.actualCompletionDate = actualCompletionDate
        self.createdAt = Date()
        self.updatedAt = Date()
        self.isSynced = false
    }
}
