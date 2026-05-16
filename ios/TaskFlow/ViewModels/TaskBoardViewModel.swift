import Foundation
import SwiftData
import UIKit
import Observation

@MainActor
@Observable
class TaskBoardViewModel {
    var searchText = ""
    var selectedTask: TaskItem?
    var showEditTask = false

    // MARK: - Filtering / Sorting

    func tasks(for status: TaskStatus, from allTasks: [TaskItem]) -> [TaskItem] {
        let filtered: [TaskItem]
        if searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            filtered = allTasks.filter { $0.status == status }
        } else {
            let query = searchText.lowercased()
            filtered = allTasks.filter { task in
                task.status == status
                    && (task.title.lowercased().contains(query)
                        || task.details.lowercased().contains(query)
                        || (task.requesterName?.lowercased().contains(query) ?? false)
                        || (task.sourceSummaryTitle?.lowercased().contains(query) ?? false))
            }
        }
        return filtered.sorted { $0.createdAt > $1.createdAt }
    }

    // MARK: - Status Update

    func updateStatus(_ task: TaskItem, to status: TaskStatus, context: ModelContext) {
        task.status = status
        task.updatedAt = Date()

        if status == .done {
            task.doneAt = Date()
            if task.actualCompletionDate == nil {
                task.actualCompletionDate = Date()
            }
        }

        // Generate follow-up draft when moving to done and no draft exists yet
        if status == .done && task.followUpDraft == nil {
            let draft = FollowUpDraftService.generateDraft(for: task)
            context.insert(draft)
            task.followUpDraft = draft
        }

        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()
    }

    // MARK: - Delete

    func delete(_ task: TaskItem, context: ModelContext) {
        context.delete(task)
    }
}
