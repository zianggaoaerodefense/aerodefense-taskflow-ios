import Foundation

// MARK: - SummaryParser
//
// A pure, dependency-free struct that parses raw Markdown-ish text into
// structured sections. It understands ATX headings (#, ##, ###) and
// unordered / ordered bullet lines.

struct SummaryParser {

    // MARK: - Output type

    struct ParsedSection {
        let heading: String   // "" for the preamble before the first heading
        let body: String      // full non-bullet text belonging to this section
        let bullets: [String] // bullet / list lines extracted from this section
    }

    // MARK: - Public API

    /// Parse `rawText` into an array of `ParsedSection` values.
    /// - If the text begins with content before any heading, that content is
    ///   returned as a section with an empty heading string.
    /// - Sections are split on ATX heading lines (#, ##, ###).
    /// - Within each section, bullet lines (-, *, or 1.) are collected into
    ///   `bullets`; remaining non-blank lines form `body`.
    static func parse(rawText: String) -> [ParsedSection] {
        let lines = splitLines(rawText)
        guard !lines.isEmpty else { return [] }

        // Group lines into raw sections: [(heading, [bodyLine])]
        var rawSections: [(heading: String, lines: [String])] = []
        var currentHeading = ""
        var currentLines: [String] = []

        for line in lines {
            if let heading = extractHeading(from: line) {
                // Flush current accumulation
                rawSections.append((heading: currentHeading, lines: currentLines))
                currentHeading = heading
                currentLines = []
            } else {
                currentLines.append(line)
            }
        }
        // Flush the final section
        rawSections.append((heading: currentHeading, lines: currentLines))

        // Convert raw sections into ParsedSections, dropping fully empty ones
        var parsed: [ParsedSection] = []
        for raw in rawSections {
            let section = buildSection(heading: raw.heading, lines: raw.lines)
            // Keep sections that have a heading OR some content
            if !section.heading.isEmpty || !section.body.isEmpty || !section.bullets.isEmpty {
                parsed.append(section)
            }
        }
        return parsed
    }

    // MARK: - Helpers

    /// Split text into trimmed lines.
    private static func splitLines(_ text: String) -> [String] {
        text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// If `line` is an ATX heading (#, ##, or ###), return the heading text;
    /// otherwise return nil.
    private static func extractHeading(from line: String) -> String? {
        // Match optional leading hashes followed by a space and heading text.
        // We support up to four levels to avoid false-positives with deeper nesting.
        let pattern = #"^#{1,4}\s+(.+)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(
                in: line,
                range: NSRange(line.startIndex..., in: line)
              ),
              let range = Range(match.range(at: 1), in: line)
        else { return nil }
        return String(line[range]).trimmingCharacters(in: .whitespaces)
    }

    /// Return true when `line` is a bullet or numbered-list item.
    private static func isBulletLine(_ line: String) -> Bool {
        // Unordered: starts with "- ", "* ", or "+ "
        if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") {
            return true
        }
        // Ordered: starts with a digit sequence followed by ". " or ") "
        let orderedPattern = #"^\d+[.)]\s"#
        if let _ = line.range(of: orderedPattern, options: .regularExpression) {
            return true
        }
        return false
    }

    /// Strip leading bullet marker characters from a line so the stored
    /// text starts with the actual content.
    private static func stripBulletMarker(from line: String) -> String {
        // Unordered markers
        for prefix in ["- ", "* ", "+ "] {
            if line.hasPrefix(prefix) {
                return String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
            }
        }
        // Ordered marker: remove "1. " / "1) " etc.
        let orderedPattern = #"^\d+[.)]\s+"#
        if let range = line.range(of: orderedPattern, options: .regularExpression) {
            return String(line[range.upperBound...]).trimmingCharacters(in: .whitespaces)
        }
        return line
    }

    /// Build a `ParsedSection` from a heading string and the lines that
    /// belong to it.
    private static func buildSection(heading: String, lines: [String]) -> ParsedSection {
        var bodyLines: [String] = []
        var bullets: [String] = []

        for line in lines {
            guard !line.isEmpty else { continue }
            if isBulletLine(line) {
                bullets.append(stripBulletMarker(from: line))
            } else {
                bodyLines.append(line)
            }
        }

        let body = bodyLines.joined(separator: "\n")
        return ParsedSection(heading: heading, body: body, bullets: bullets)
    }
}
