import Foundation
import SwiftData
import UIKit
import Observation

@MainActor
@Observable
class FollowUpViewModel {
    var selectedDraft: FollowUpDraft?

    // MARK: - Filtering / Sorting

    func drafts(for status: DraftStatus, from allDrafts: [FollowUpDraft]) -> [FollowUpDraft] {
        allDrafts
            .filter { $0.draftStatus == status }
            .sorted { $0.createdAt > $1.createdAt }
    }

    // MARK: - Status Update

    func updateStatus(_ draft: FollowUpDraft, to status: DraftStatus, context: ModelContext) {
        draft.draftStatus = status
        draft.updatedAt = Date()
        if status == .approved {
            draft.approvedAt = Date()
        }
    }

    // MARK: - Clipboard

    func copyToClipboard(_ draft: FollowUpDraft) {
        UIPasteboard.general.string = draft.body
    }

    // MARK: - Archive

    func archive(_ draft: FollowUpDraft, context: ModelContext) {
        draft.draftStatus = .archived
        draft.updatedAt = Date()
    }
}
