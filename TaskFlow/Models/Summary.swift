import Foundation
import SwiftData

@Model
final class Summary {
    var id: UUID
    var title: String
    var dateCreated: Date
    var dateUpdated: Date
    var source: String?
    var rawText: String
    var tags: [String]

    @Relationship(deleteRule: .cascade, inverse: \SummarySection.summary)
    var sections: [SummarySection]

    @Relationship(inverse: \TaskItem.sourceSummary)
    var linkedTasks: [TaskItem]

    init(
        id: UUID = UUID(),
        title: String,
        dateCreated: Date = Date(),
        dateUpdated: Date = Date(),
        source: String? = nil,
        rawText: String,
        tags: [String] = [],
        sections: [SummarySection] = [],
        linkedTasks: [TaskItem] = []
    ) {
        self.id = id
        self.title = title
        self.dateCreated = dateCreated
        self.dateUpdated = dateUpdated
        self.source = source
        self.rawText = rawText
        self.tags = tags
        self.sections = sections
        self.linkedTasks = linkedTasks
    }
}

@Model
final class SummarySection {
    var id: UUID
    var heading: String
    var body: String
    var extractedBullets: [String]
    var summary: Summary?

    init(
        id: UUID = UUID(),
        heading: String,
        body: String,
        extractedBullets: [String] = []
    ) {
        self.id = id
        self.heading = heading
        self.body = body
        self.extractedBullets = extractedBullets
    }
}
