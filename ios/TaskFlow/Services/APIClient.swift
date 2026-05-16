/**
 * APIClient.swift
 *
 * Async/await HTTP client for the TaskFlow Lambda backend.
 *
 * SECURITY:
 * - No MongoDB credentials anywhere in this file
 * - Auth token stored in UserDefaults (migrate to Keychain in Phase 3)
 * - All requests sent over HTTPS in production
 * - userId is NEVER sent in request bodies — the backend derives it from the JWT
 * - No sensitive data logged
 */

import Foundation

// MARK: - Configuration

enum APIConfig {
    /// Base URL for the Lambda backend. Configurable per-build via Settings tab.
    static var baseURL: String {
        UserDefaults.standard.string(forKey: "taskflow.apiBaseURL") ?? "http://localhost:3000"
    }
}

// MARK: - Errors

enum APIError: LocalizedError {
    case invalidURL
    case noData
    case decodingError(Error)
    case serverError(statusCode: Int, message: String)
    case unauthorized
    case notFound
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:                         return "Invalid API URL configuration"
        case .noData:                             return "No data received from server"
        case .decodingError(let e):               return "Response decode error: \(e.localizedDescription)"
        case .serverError(let code, let msg):     return "Server error \(code): \(msg)"
        case .unauthorized:                       return "Authentication required — please sign in"
        case .notFound:                           return "Resource not found"
        case .networkError(let e):                return "Network error: \(e.localizedDescription)"
        }
    }
}

// MARK: - Token Storage

/// Stores the auth JWT. Phase 3: migrate to Keychain for production hardening.
///
/// SECURITY: Never log, print, or expose the token value.
/// TODO (Phase 3): Replace UserDefaults with SecItem (Keychain) using
/// kSecAttrAccessibleWhenUnlockedThisDeviceOnly so the token is hardware-
/// encrypted and excluded from iCloud backup.
final class TokenStorage {
    static let shared = TokenStorage()
    private let key = "taskflow.authToken"

    var authToken: String? {
        get { UserDefaults.standard.string(forKey: key) }
        set {
            if let v = newValue { UserDefaults.standard.set(v, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
    }

    func clearToken() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

// MARK: - Response DTOs

struct APITask: Codable, Identifiable {
    let id: String
    // userId and orgId are present in the server response for full DTO fidelity,
    // but must NEVER be sent back in request bodies — the backend derives them
    // from the verified JWT.
    let userId: String
    let orgId: String
    var summaryId: String?
    var title: String
    var details: String
    var status: String
    var priority: String
    var requesterName: String?
    var requesterContact: String?
    var resourceType: String
    var resourceLabel: String?
    var resourceUrl: String?
    var targetCompletionDate: String?
    var actualCompletionDate: String?
    var reviewedAt: String?
    var doneAt: String?
    var notes: String
    var followUpDraftId: String?
    var createdBy: String
    var createdAt: String
    var updatedAt: String
}

struct APISummary: Codable, Identifiable {
    let id: String
    var title: String
    var sourceType: String
    var rawText: String
    var tags: [String]
    var suggestedPriority: String
    var reviewNeeded: Bool
    var actionNeeded: Bool
    var taskCandidateIds: [String]
    var linkedTaskIds: [String]
    var structured: APISummaryStructured
    var createdAt: String
    var updatedAt: String
}

struct APISummaryStructured: Codable {
    var requester: String?
    var mainAsk: String?
    var deadline: String?
    var risks: [String]
    var dependencies: [String]
    var sections: [APISummarySection]
}

struct APISummarySection: Codable {
    var id: String
    var heading: String
    var body: String
    var extractedBullets: [String]
}

struct APIFollowUpDraft: Codable, Identifiable {
    let id: String
    var taskId: String
    var channelType: String
    var recipientOrTarget: String?
    var subject: String?
    var body: String
    var status: String
    var createdBy: String
    var createdAt: String
    var updatedAt: String
}

struct APIApprovalRequest: Codable, Identifiable {
    let id: String
    var taskId: String?
    var draftId: String?
    var actionType: String
    var status: String
    var createdBy: String
    var createdAt: String
    var approvedAt: String?
}

struct APIListResponse<T: Codable>: Codable {
    let items: [T]
    let total: Int?
}

// APIErrorResponse is the public name used in SyncService and other consumers.
struct APIErrorResponse: Codable {
    let error: String
}
// Internal alias kept for backward compat within this file.
private typealias APIErrorBody = APIErrorResponse

// MARK: - API Client

@MainActor
final class APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(session: URLSession = .shared) {
        self.session = session
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
    }

    // MARK: Request builder

    private func request(_ path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let url = URL(string: APIConfig.baseURL + path) else { throw APIError.invalidURL }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = TokenStorage.shared.authToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = body
        return req
    }

    private func perform<T: Codable>(_ req: URLRequest) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.networkError(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.noData }
        switch http.statusCode {
        case 200...299:
            do { return try decoder.decode(T.self, from: data) }
            catch { throw APIError.decodingError(error) }
        case 401: throw APIError.unauthorized
        case 404: throw APIError.notFound
        default:
            let msg = (try? decoder.decode(APIErrorBody.self, from: data))?.error ?? "Unknown error"
            throw APIError.serverError(statusCode: http.statusCode, message: msg)
        }
    }

    private func body(_ dict: [String: Any?]) throws -> Data {
        let cleaned = dict.compactMapValues { $0 }
        return try JSONSerialization.data(withJSONObject: cleaned)
    }

    // MARK: - Health

    func checkHealth() async throws -> Bool {
        struct HealthResp: Codable { let status: String }
        let req = try request("/health")
        let resp: HealthResp = try await perform(req)
        return resp.status == "ok"
    }

    // MARK: - Tasks

    func fetchTasks(status: String? = nil) async throws -> [APITask] {
        var path = "/tasks"
        if let s = status { path += "?status=\(s)" }
        let resp: APIListResponse<APITask> = try await perform(try request(path))
        return resp.items
    }

    func createTask(title: String, details: String, status: String, priority: String,
                    resourceType: String, notes: String, summaryId: String? = nil,
                    requesterName: String? = nil) async throws -> APITask {
        let b = try body(["title": title, "details": details, "status": status,
                          "priority": priority, "resourceType": resourceType,
                          "notes": notes, "summaryId": summaryId, "requesterName": requesterName])
        return try await perform(try request("/tasks", method: "POST", body: b))
    }

    func updateTask(id: String, updates: [String: Any?]) async throws -> APITask {
        let b = try body(updates)
        return try await perform(try request("/tasks/\(id)", method: "PATCH", body: b))
    }

    func markTaskDone(id: String) async throws -> APITask {
        try await perform(try request("/tasks/\(id)/mark-done", method: "POST"))
    }

    func markTaskReviewed(id: String) async throws -> APITask {
        try await perform(try request("/tasks/\(id)/mark-reviewed", method: "POST"))
    }

    func markTaskActionNeeded(id: String) async throws -> APITask {
        try await perform(try request("/tasks/\(id)/mark-action-needed", method: "POST"))
    }

    func markTaskWaiting(id: String) async throws -> APITask {
        try await perform(try request("/tasks/\(id)/mark-waiting", method: "POST"))
    }

    func archiveTask(id: String) async throws -> APITask {
        try await perform(try request("/tasks/\(id)/archive", method: "POST"))
    }

    // MARK: - Summaries

    func fetchSummaries() async throws -> [APISummary] {
        let resp: APIListResponse<APISummary> = try await perform(try request("/summaries"))
        return resp.items
    }

    func createSummary(title: String, rawText: String, sourceType: String, tags: [String]) async throws -> APISummary {
        let b = try JSONSerialization.data(withJSONObject: [
            "title": title, "rawText": rawText, "sourceType": sourceType, "tags": tags
        ])
        return try await perform(try request("/summaries", method: "POST", body: b))
    }

    func acceptTaskCandidates(summaryId: String, tasks: [[String: Any]]) async throws -> [APITask] {
        let b = try JSONSerialization.data(withJSONObject: ["tasks": tasks])
        let resp: APIListResponse<APITask> = try await perform(
            try request("/summaries/\(summaryId)/accept-tasks", method: "POST", body: b))
        return resp.items
    }

    // MARK: - Follow-ups

    func fetchDrafts() async throws -> [APIFollowUpDraft] {
        let resp: APIListResponse<APIFollowUpDraft> = try await perform(try request("/followups"))
        return resp.items
    }

    func updateDraft(id: String, body draftBody: String, recipientOrTarget: String?) async throws -> APIFollowUpDraft {
        let b = try body(["body": draftBody, "recipientOrTarget": recipientOrTarget])
        return try await perform(try request("/followups/\(id)", method: "PATCH", body: b))
    }

    func markDraftReviewed(id: String) async throws -> APIFollowUpDraft {
        try await perform(try request("/followups/\(id)/mark-reviewed", method: "POST"))
    }

    func approveDraft(id: String) async throws -> APIFollowUpDraft {
        try await perform(try request("/followups/\(id)/approve", method: "POST"))
    }

    func archiveDraft(id: String) async throws -> APIFollowUpDraft {
        try await perform(try request("/followups/\(id)/archive", method: "POST"))
    }
}
