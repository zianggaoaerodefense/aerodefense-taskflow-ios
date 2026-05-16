/**
 * SyncService.swift
 *
 * Bridges the backend APIClient with the local SwiftData cache.
 * The backend (MongoDB via Lambda) is the system of record.
 * Local SwiftData is a cache for smooth offline UX.
 *
 * SECURITY:
 * - Never sends userId in request bodies (APIClient handles auth header)
 * - No MongoDB credentials exist anywhere in this file
 * - Sync errors are surfaced to the UI, not silently swallowed
 */

import Foundation
import SwiftData

// MARK: - Sync Status

enum SyncStatus: Equatable {
    case notConfigured      // API URL or token not set
    case offline            // API unreachable
    case syncing            // In progress
    case synced(Date)       // Last successful sync timestamp
    case error(String)      // Last error description

    static func == (lhs: SyncStatus, rhs: SyncStatus) -> Bool {
        switch (lhs, rhs) {
        case (.notConfigured, .notConfigured): return true
        case (.offline, .offline):             return true
        case (.syncing, .syncing):             return true
        case (.synced(let a), .synced(let b)): return a == b
        case (.error(let a), .error(let b)):   return a == b
        default:                               return false
        }
    }
}

// MARK: - SyncService

@MainActor
final class SyncService: ObservableObject {
    static let shared = SyncService()
    private let api = APIClient.shared

    @Published var status: SyncStatus = .notConfigured

    // MARK: - Full Sync

    func syncAll(context: ModelContext) async {
        guard TokenStorage.shared.authToken != nil else {
            status = .notConfigured
            return
        }
        status = .syncing
        do {
            try await syncTasks(context: context)
            try await syncSummaries(context: context)
            try await syncDrafts(context: context)
            status = .synced(Date())
        } catch APIError.unauthorized {
            status = .notConfigured
        } catch APIError.networkError {
            status = .offline
        } catch {
            status = .error(error.localizedDescription)
        }
    }

    // MARK: - Pull: Tasks

    func syncTasks(context: ModelContext) async throws {
        let apiTasks = try await api.fetchTasks()
        for apiTask in apiTasks {
            if let existing = try? context.fetch(
                FetchDescriptor<TaskItem>(predicate: #Predicate { $0.remoteId == apiTask.id })
            ).first {
                // Update existing cached record
                existing.title = apiTask.title
                existing.details = apiTask.details
                existing.statusRaw = apiTask.status
                existing.priorityRaw = apiTask.priority
                existing.requesterName = apiTask.requesterName
                existing.notes = apiTask.notes
                existing.isSynced = true
            } else {
                // Insert new cached record
                let task = TaskItem(
                    title: apiTask.title,
                    details: apiTask.details,
                    status: TaskStatus(rawValue: apiTask.status) ?? .new,
                    priority: TaskPriority(rawValue: apiTask.priority) ?? .normal,
                    requesterName: apiTask.requesterName,
                    notes: apiTask.notes
                )
                task.remoteId = apiTask.id
                task.isSynced = true
                context.insert(task)
            }
        }
    }

    // MARK: - Pull: Summaries

    func syncSummaries(context: ModelContext) async throws {
        let apiSummaries = try await api.fetchSummaries()
        for apiSummary in apiSummaries {
            if let existing = try? context.fetch(
                FetchDescriptor<Summary>(predicate: #Predicate { $0.remoteId == apiSummary.id })
            ).first {
                existing.title = apiSummary.title
                existing.dateUpdated = Date()
                existing.reviewNeeded = apiSummary.reviewNeeded
                existing.actionNeeded = apiSummary.actionNeeded
                existing.isSynced = true
            } else {
                let summary = Summary(
                    title: apiSummary.title,
                    source: apiSummary.sourceType,
                    rawText: apiSummary.rawText,
                    tags: apiSummary.tags,
                    reviewNeeded: apiSummary.reviewNeeded,
                    actionNeeded: apiSummary.actionNeeded
                )
                summary.remoteId = apiSummary.id
                summary.isSynced = true
                context.insert(summary)
            }
        }
    }

    // MARK: - Pull: Follow-up Drafts

    func syncDrafts(context: ModelContext) async throws {
        let apiDrafts = try await api.fetchDrafts()
        for apiDraft in apiDrafts {
            if let existing = try? context.fetch(
                FetchDescriptor<FollowUpDraft>(predicate: #Predicate { $0.remoteId == apiDraft.id })
            ).first {
                existing.body = apiDraft.body
                existing.statusRaw = apiDraft.status
                existing.isSynced = true
            } else {
                let draft = FollowUpDraft(
                    taskID: UUID(),  // placeholder; linked via remoteId
                    channelType: ChannelType(rawValue: apiDraft.channelType) ?? .other,
                    recipientOrTarget: apiDraft.recipientOrTarget,
                    subject: apiDraft.subject,
                    body: apiDraft.body,
                    status: DraftStatus(rawValue: apiDraft.status) ?? .draft
                )
                draft.remoteId = apiDraft.id
                draft.isSynced = true
                context.insert(draft)
            }
        }
    }

    // MARK: - Push: Task

    /// Push a local TaskItem to the backend. Sets remoteId on success.
    func pushTask(_ task: TaskItem) async throws {
        if let remoteId = task.remoteId {
            // Update existing backend record
            _ = try await api.updateTask(id: remoteId, updates: [
                "title": task.title,
                "details": task.details,
                "status": task.statusRaw,
                "priority": task.priorityRaw,
                "notes": task.notes,
                "requesterName": task.requesterName as Any,
                "resourceType": task.resourceTypeRaw,
            ])
        } else {
            // Create new backend record
            let created = try await api.createTask(
                title: task.title,
                details: task.details,
                status: task.statusRaw,
                priority: task.priorityRaw,
                resourceType: task.resourceTypeRaw,
                notes: task.notes,
                requesterName: task.requesterName
            )
            task.remoteId = created.id
        }
        task.isSynced = true
        task.updatedAt = Date()
    }

    // MARK: - Push: Status transitions

    func markTaskDone(_ task: TaskItem) async throws {
        guard let remoteId = task.remoteId else { return }
        let updated = try await api.markTaskDone(id: remoteId)
        task.statusRaw = updated.status
        task.isSynced = true
        task.updatedAt = Date()
    }

    func markTaskReviewed(_ task: TaskItem) async throws {
        guard let remoteId = task.remoteId else { return }
        let updated = try await api.markTaskReviewed(id: remoteId)
        task.statusRaw = updated.status
        task.isSynced = true
        task.updatedAt = Date()
    }

    func markTaskActionNeeded(_ task: TaskItem) async throws {
        guard let remoteId = task.remoteId else { return }
        let updated = try await api.markTaskActionNeeded(id: remoteId)
        task.statusRaw = updated.status
        task.isSynced = true
        task.updatedAt = Date()
    }

    func markTaskWaiting(_ task: TaskItem) async throws {
        guard let remoteId = task.remoteId else { return }
        let updated = try await api.markTaskWaiting(id: remoteId)
        task.statusRaw = updated.status
        task.isSynced = true
        task.updatedAt = Date()
    }

    // MARK: - Push: Summary

    func pushSummary(_ summary: Summary) async throws {
        if summary.remoteId != nil { return }  // existing summaries are read-only from app in Phase 2
        let created = try await api.createSummary(
            title: summary.title,
            rawText: summary.rawText,
            sourceType: summary.source ?? "manual",
            tags: summary.tags
        )
        summary.remoteId = created.id
        summary.isSynced = true
        summary.dateUpdated = Date()
    }
}
