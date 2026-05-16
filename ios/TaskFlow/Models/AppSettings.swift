import Foundation
import SwiftData

// MARK: - ExportFormat Enum

enum ExportFormat: String, Codable, CaseIterable {
    case json, markdown

    var label: String {
        switch self {
        case .json:     return "JSON"
        case .markdown: return "Markdown"
        }
    }
}

// MARK: - AppSettings Model

/// Singleton-style settings record. The app fetches the first instance
/// or inserts a new default one if none exists.
@Model
final class AppSettings {
    var requireFaceID: Bool
    var appDisplayName: String
    var exportFormatPreferenceRaw: String
    var agentSyncEnabled: Bool
    var defaultTaskPriorityRaw: String
    var defaultResourceTypeRaw: String

    // MARK: Computed enum accessors

    var exportFormatPreference: ExportFormat {
        get { ExportFormat(rawValue: exportFormatPreferenceRaw) ?? .json }
        set { exportFormatPreferenceRaw = newValue.rawValue }
    }

    var defaultTaskPriority: TaskPriority {
        get { TaskPriority(rawValue: defaultTaskPriorityRaw) ?? .normal }
        set { defaultTaskPriorityRaw = newValue.rawValue }
    }

    var defaultResourceType: ResourceType {
        get { ResourceType(rawValue: defaultResourceTypeRaw) ?? .other }
        set { defaultResourceTypeRaw = newValue.rawValue }
    }

    // MARK: Initializer

    init(
        requireFaceID: Bool = false,
        appDisplayName: String = "TaskFlow",
        exportFormatPreference: ExportFormat = .json,
        agentSyncEnabled: Bool = false,
        defaultTaskPriority: TaskPriority = .normal,
        defaultResourceType: ResourceType = .other
    ) {
        self.requireFaceID = requireFaceID
        self.appDisplayName = appDisplayName
        self.exportFormatPreferenceRaw = exportFormatPreference.rawValue
        self.agentSyncEnabled = agentSyncEnabled
        self.defaultTaskPriorityRaw = defaultTaskPriority.rawValue
        self.defaultResourceTypeRaw = defaultResourceType.rawValue
    }

    // MARK: Default factory

    /// Returns a new AppSettings instance with all defaults applied.
    /// Use this when no persisted settings record exists yet.
    static var `default`: AppSettings { AppSettings() }
}
