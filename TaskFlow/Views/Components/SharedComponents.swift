import SwiftUI

// MARK: - TaskPriorityBadge
//
// A compact coloured capsule displaying a task's priority.
// Used in SummaryDetailView and TaskBoardView.

struct TaskPriorityBadge: View {
    let priority: TaskPriority

    var body: some View {
        Text(priority.label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(priority.color.opacity(0.15))
            .foregroundStyle(priority.color)
            .clipShape(Capsule())
    }
}

// MARK: - TaskStatusBadge

struct TaskStatusBadge: View {
    let status: TaskStatus

    var body: some View {
        Text(status.label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(status.color.opacity(0.15))
            .foregroundStyle(status.color)
            .clipShape(Capsule())
    }
}

// MARK: - DraftStatusBadge

struct DraftStatusBadge: View {
    let status: DraftStatus

    var body: some View {
        Text(status.label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(statusColor.opacity(0.15))
            .foregroundStyle(statusColor)
            .clipShape(Capsule())
    }

    private var statusColor: Color {
        switch status {
        case .draft:          return .blue
        case .reviewed:       return .orange
        case .approved:       return .green
        case .sentExternally: return .indigo
        case .archived:       return .gray
        }
    }
}

// MARK: - ChannelTypeIcon

struct ChannelTypeIcon: View {
    let channelType: ChannelType

    var body: some View {
        Image(systemName: iconName)
            .foregroundStyle(iconColor)
    }

    private var iconName: String {
        switch channelType {
        case .email: return "envelope.fill"
        case .slack: return "bubble.left.and.bubble.right.fill"
        case .jira:  return "ticket.fill"
        case .other: return "paperplane.fill"
        }
    }

    private var iconColor: Color {
        switch channelType {
        case .email: return .blue
        case .slack: return .purple
        case .jira:  return .indigo
        case .other: return .secondary
        }
    }
}

// MARK: - ResourceTypeIcon

struct ResourceTypeIcon: View {
    let resourceType: ResourceType

    var body: some View {
        Image(systemName: resourceType.icon)
    }
}

// MARK: - EmptyStateView

struct EmptyStateView: View {
    let title: String
    let systemImage: String
    var description: String? = nil

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            if let description {
                Text(description)
            }
        }
    }
}

// MARK: - Date formatting helpers

extension DateFormatter {
    static let mediumDate: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f
    }()

    static let shortDate: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .none
        return f
    }()

    static let mediumDateTime: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()
}
