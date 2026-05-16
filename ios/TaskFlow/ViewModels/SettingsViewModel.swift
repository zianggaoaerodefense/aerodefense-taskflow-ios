import Foundation
import SwiftData
import Observation

@MainActor
@Observable
class SettingsViewModel {
    var showExportAlert = false
    var showImportPicker = false
    var exportData: Data?
    var statusMessage: String?

    // MARK: - Settings Bootstrap

    func loadOrCreateSettings(context: ModelContext) -> AppSettings {
        let descriptor = FetchDescriptor<AppSettings>()
        let results = (try? context.fetch(descriptor)) ?? []
        if let existing = results.first {
            return existing
        }
        let settings = AppSettings.default
        context.insert(settings)
        return settings
    }

    // MARK: - Export

    func exportAll(
        summaries: [Summary],
        tasks: [TaskItem],
        drafts: [FollowUpDraft]
    ) -> Data? {
        try? ImportExportService.exportJSON(summaries: summaries, tasks: tasks, drafts: drafts)
    }

    // MARK: - Import

    func importData(from data: Data, context: ModelContext) {
        guard let payload = try? ImportExportService.importJSON(data: data) else {
            statusMessage = "Import failed: invalid format"
            return
        }
        let (summaries, tasks, drafts) = ImportExportService.createModels(from: payload)
        summaries.forEach { context.insert($0) }
        tasks.forEach { context.insert($0) }
        drafts.forEach { context.insert($0) }
        statusMessage = "Imported \(summaries.count) summaries, \(tasks.count) tasks"
    }
}
