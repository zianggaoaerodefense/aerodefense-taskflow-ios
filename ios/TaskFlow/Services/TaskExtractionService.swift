import Foundation

// MARK: - TaskExtractionService
//
// A deterministic, local parser that scans a Summary's sections and bullets
// for action-oriented sentences and returns lightweight SuggestedTask values.
// No network calls or AI are involved; all matching is case-insensitive text
// search against a curated list of action verbs.

struct TaskExtractionService {

    // MARK: - Output type

    struct SuggestedTask: Equatable {
        let title: String
        let details: String
        let sectionContext: String           // heading of the source section
        let suggestedResourceType: ResourceType
    }

    // MARK: - Action verb vocabulary

    static let actionVerbs: [String] = [
        "follow up", "send", "review", "check", "create", "update", "finish",
        "test", "verify", "prepare", "schedule", "draft", "ask", "confirm",
        "investigate", "implement", "deploy", "document", "provide", "share",
        "discuss"
    ]

    // MARK: - Public API

    /// Extract action-item suggestions from a populated `Summary`.
    ///
    /// Strategy:
    ///   1. For each section, scan `extractedBullets` first (highest signal).
    ///   2. Then scan sentences in `body` for any action verb.
    ///   3. Deduplicate by normalised title similarity before returning.
    static func extractSuggestions(from summary: Summary) -> [SuggestedTask] {
        var suggestions: [SuggestedTask] = []

        for section in summary.sections {
            // --- Bullets (already pre-extracted, high confidence) ---
            for bullet in section.extractedBullets {
                if containsActionVerb(bullet) {
                    let resourceType = inferResourceType(from: bullet)
                    let task = SuggestedTask(
                        title: capitalised(bullet),
                        details: "From section "\(section.heading)" in "\(summary.title)"",
                        sectionContext: section.heading,
                        suggestedResourceType: resourceType
                    )
                    suggestions.append(task)
                }
            }

            // --- Body sentences ---
            let sentences = splitIntoSentences(section.body)
            for sentence in sentences {
                guard containsActionVerb(sentence) else { continue }
                let resourceType = inferResourceType(from: sentence)
                let task = SuggestedTask(
                    title: capitalised(sentence),
                    details: "From section "\(section.heading)" in "\(summary.title)"",
                    sectionContext: section.heading,
                    suggestedResourceType: resourceType
                )
                suggestions.append(task)
            }
        }

        return deduplicated(suggestions)
    }

    /// Returns true when at least one existing `TaskItem` already refers to
    /// `summaryID`, so callers can avoid re-extracting from the same summary.
    static func hasExistingTasks(summaryID: UUID, existingTasks: [TaskItem]) -> Bool {
        existingTasks.contains { $0.sourceSummaryID == summaryID }
    }

    /// Infer the most likely `ResourceType` from keywords present in `text`.
    static func inferResourceType(from text: String) -> ResourceType {
        let lower = text.lowercased()
        if lower.contains("email") || lower.contains("mail")                            { return .email }
        if lower.contains("slack") || lower.contains("message") || lower.contains("dm") { return .slack }
        if lower.contains("jira") || lower.contains("ticket") || lower.contains("issue") { return .jira }
        if lower.contains("github") || lower.contains("pull request") || lower.contains("pr ") || lower.contains(" pr") || lower.contains("commit") { return .github }
        if lower.contains("doc") || lower.contains("document") || lower.contains("report") || lower.contains("wiki") { return .document }
        return .other
    }

    // MARK: - Private helpers

    /// Returns true when `text` contains at least one action verb
    /// (case-insensitive whole-word match preferred, but substring for
    /// multi-word verbs like "follow up").
    private static func containsActionVerb(_ text: String) -> Bool {
        let lower = text.lowercased()
        for verb in actionVerbs {
            if verb.contains(" ") {
                // Multi-word verb: substring match is sufficient
                if lower.contains(verb) { return true }
            } else {
                // Single word: require word boundaries via regex to reduce noise
                let pattern = "\\b\(NSRegularExpression.escapedPattern(for: verb))\\b"
                if let _ = lower.range(of: pattern, options: .regularExpression) {
                    return true
                }
            }
        }
        return false
    }

    /// Split a block of text into individual sentences on common terminators.
    private static func splitIntoSentences(_ text: String) -> [String] {
        guard !text.isEmpty else { return [] }
        // Use a simple heuristic: split on ". ", "! ", "? ", or newline,
        // then trim and drop very short fragments.
        var sentences: [String] = []
        let raw = text.components(separatedBy: CharacterSet(charactersIn: ".!?\n"))
        for fragment in raw {
            let trimmed = fragment.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.count >= 10 { // ignore very short fragments
                sentences.append(trimmed)
            }
        }
        return sentences
    }

    /// Capitalise the first character of a string without lowercasing the rest.
    private static func capitalised(_ text: String) -> String {
        guard let first = text.first else { return text }
        return first.uppercased() + text.dropFirst()
    }

    /// Remove suggestions whose normalised titles are very similar (>= 80 %
    /// character overlap) to an already-accepted suggestion.
    private static func deduplicated(_ suggestions: [SuggestedTask]) -> [SuggestedTask] {
        var accepted: [SuggestedTask] = []
        for candidate in suggestions {
            let normCandidate = normalised(candidate.title)
            let isDuplicate = accepted.contains { existing in
                similarity(normCandidate, normalised(existing.title)) >= 0.8
            }
            if !isDuplicate {
                accepted.append(candidate)
            }
        }
        return accepted
    }

    /// Lowercase, strip punctuation, and collapse whitespace for comparison.
    private static func normalised(_ text: String) -> String {
        text.lowercased()
            .components(separatedBy: CharacterSet.punctuationCharacters).joined()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// Dice coefficient–inspired character bigram overlap in [0, 1].
    private static func similarity(_ a: String, _ b: String) -> Double {
        guard !a.isEmpty, !b.isEmpty else { return a == b ? 1.0 : 0.0 }
        func bigrams(_ s: String) -> [String] {
            let chars = Array(s)
            guard chars.count >= 2 else { return [] }
            return (0..<(chars.count - 1)).map { String([chars[$0], chars[$0 + 1]]) }
        }
        let biA = bigrams(a)
        let biB = Set(bigrams(b))
        guard !biA.isEmpty, !biB.isEmpty else { return 0 }
        let intersection = biA.filter { biB.contains($0) }.count
        return (2.0 * Double(intersection)) / Double(biA.count + biB.count)
    }
}
