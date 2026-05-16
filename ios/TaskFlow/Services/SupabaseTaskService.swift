// SupabaseTaskService.swift
//
// Task, summary, and workflow reads/writes against Supabase Postgres.
// Every task mutation also inserts a task_events row for the audit trail.
// Realtime subscriptions trigger a re-fetch when the agent creates new tasks.
//
// SECURITY:
//   - user_id is set by Supabase RLS from the authenticated session JWT
//   - Never pass user_id in insert or update payloads from the app
//   - Service role key is not used here; this file uses the anon client

import Foundation
import Supabase

// MARK: - Row types (snake_case keys match Postgres column names)

struct SupabaseTask: Codable, Identifiable {
    let id: UUID
    var title: String
    var description: String?
    var status: String
    var priority: String
    var due_at: String?
    var snoozed_until: String?
    var source: String?
    var workflow_id: UUID?
    var summary_id: UUID?
    let created_at: String
    var updated_at: String
}

struct SupabaseSummary: Codable, Identifiable {
    let id: UUID
    var title: String
    var content: String
    var source: String?
    var status: String
    let created_at: String
}

struct SupabaseWorkflow: Codable, Identifiable {
    let id: UUID
    var name: String
    var description: String?
    var status: String
    let created_at: String
}

// MARK: - Insert payloads (user_id omitted — RLS infers it from JWT)

private struct TaskInsert: Encodable {
    let title: String
    let description: String?
    let status: String
    let priority: String
    let due_at: String?
    let source: String
}

private struct TaskEventInsert: Encodable {
    let task_id: String
    let actor: String
    let event_type: String
    let previous_status: String?
    let new_status: String?
    let details: [String: String]
}

// MARK: - Service

@MainActor
final class SupabaseTaskService: ObservableObject {
    static let shared = SupabaseTaskService()

    @Published var tasks: [SupabaseTask] = []
    @Published var summaries: [SupabaseSummary] = []
    @Published var workflows: [SupabaseWorkflow] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var realtimeChannel: RealtimeChannelV2?

    private init() {}

    // MARK: - Fetch

    func fetchAll() async {
        isLoading = true
        defer { isLoading = false }
        async let t: () = fetchTasks()
        async let s: () = fetchSummaries()
        async let w: () = fetchWorkflows()
        _ = await (t, s, w)
    }

    func fetchTasks() async {
        do {
            let result: [SupabaseTask] = try await supabase
                .from("tasks")
                .select()
                .neq("status", value: "archived")
                .order("created_at", ascending: false)
                .execute()
                .value
            tasks = result
        } catch {
            errorMessage = "Failed to load tasks."
        }
    }

    func fetchSummaries() async {
        do {
            let result: [SupabaseSummary] = try await supabase
                .from("summaries")
                .select()
                .eq("status", value: "active")
                .order("created_at", ascending: false)
                .execute()
                .value
            summaries = result
        } catch {
            errorMessage = "Failed to load summaries."
        }
    }

    func fetchWorkflows() async {
        do {
            let result: [SupabaseWorkflow] = try await supabase
                .from("workflows")
                .select()
                .order("created_at", ascending: false)
                .execute()
                .value
            workflows = result
        } catch {
            errorMessage = "Failed to load workflows."
        }
    }

    // MARK: - Task mutations (always emit a task_events row)

    func createTask(
        title: String,
        description: String? = nil,
        priority: String = "medium",
        dueAt: String? = nil
    ) async throws -> SupabaseTask {
        let payload = TaskInsert(
            title: title,
            description: description,
            status: "open",
            priority: priority,
            due_at: dueAt,
            source: "user"
        )
        let created: SupabaseTask = try await supabase
            .from("tasks")
            .insert(payload)
            .select()
            .single()
            .execute()
            .value

        await emitTaskEvent(
            taskId: created.id.uuidString,
            actor: "user",
            eventType: "created",
            newStatus: "open"
        )

        if let index = tasks.firstIndex(where: { $0.id == created.id }) {
            tasks[index] = created
        } else {
            tasks.insert(created, at: 0)
        }
        return created
    }

    func updateStatus(task: SupabaseTask, newStatus: String) async throws {
        try await supabase
            .from("tasks")
            .update(["status": newStatus, "updated_at": iso8601Now()])
            .eq("id", value: task.id.uuidString)
            .execute()

        await emitTaskEvent(
            taskId: task.id.uuidString,
            actor: "user",
            eventType: "status_changed",
            previousStatus: task.status,
            newStatus: newStatus
        )
        await fetchTasks()
    }

    func completeTask(_ task: SupabaseTask) async throws {
        try await updateStatus(task: task, newStatus: "done")
    }

    func snoozeTask(_ task: SupabaseTask, until: Date) async throws {
        let formatter = ISO8601DateFormatter()
        try await supabase
            .from("tasks")
            .update([
                "status": "waiting",
                "snoozed_until": formatter.string(from: until),
                "updated_at": iso8601Now(),
            ])
            .eq("id", value: task.id.uuidString)
            .execute()

        await emitTaskEvent(
            taskId: task.id.uuidString,
            actor: "user",
            eventType: "snoozed",
            previousStatus: task.status,
            newStatus: "waiting"
        )
        await fetchTasks()
    }

    func updateFields(
        taskId: UUID,
        title: String? = nil,
        description: String? = nil,
        priority: String? = nil
    ) async throws {
        var updates: [String: String] = ["updated_at": iso8601Now()]
        if let t = title { updates["title"] = t }
        if let d = description { updates["description"] = d }
        if let p = priority { updates["priority"] = p }

        try await supabase
            .from("tasks")
            .update(updates)
            .eq("id", value: taskId.uuidString)
            .execute()

        await emitTaskEvent(
            taskId: taskId.uuidString,
            actor: "user",
            eventType: "updated"
        )
        await fetchTasks()
    }

    // MARK: - Realtime

    func subscribeToTaskChanges() {
        Task {
            let channel = supabase.channel("public:tasks")
            let changes = channel.postgresChange(AnyAction.self, table: "tasks")
            await channel.subscribe()
            realtimeChannel = channel
            for await _ in changes {
                await fetchTasks()
            }
        }
    }

    func unsubscribeFromTaskChanges() {
        Task {
            if let ch = realtimeChannel {
                await ch.unsubscribe()
                realtimeChannel = nil
            }
        }
    }

    // MARK: - Private helpers

    private func emitTaskEvent(
        taskId: String,
        actor: String,
        eventType: String,
        previousStatus: String? = nil,
        newStatus: String? = nil
    ) async {
        var details: [String: String] = [:]
        if let prev = previousStatus { details["previous_status"] = prev }

        let payload = TaskEventInsert(
            task_id: taskId,
            actor: actor,
            event_type: eventType,
            previous_status: previousStatus,
            new_status: newStatus,
            details: details
        )
        try? await supabase.from("task_events").insert(payload).execute()
    }

    private func iso8601Now() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}
