import SwiftUI
import SwiftData

@main
struct TaskFlowApp: App {
    @State private var isUnlocked = false

    var body: some Scene {
        WindowGroup {
            SecurityLockView(isUnlocked: $isUnlocked) {
                RootTabView()
            }
        }
        .modelContainer(for: [
            Summary.self,
            SummarySection.self,
            TaskItem.self,
            FollowUpDraft.self,
            AppSettings.self
        ])
    }
}
