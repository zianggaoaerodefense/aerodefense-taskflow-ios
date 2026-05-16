import SwiftUI
import SwiftData

struct RootTabView: View {
    @Query private var tasks: [TaskItem]
    @Query private var drafts: [FollowUpDraft]
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        TabView {
            SummaryListView()
                .tabItem { Label("Summaries", systemImage: "doc.text.fill") }

            TaskBoardView()
                .tabItem { Label("Tasks", systemImage: "checkmark.circle.fill") }
                .badge(tasks.filter { $0.status == .new }.count)

            FollowUpListView()
                .tabItem { Label("Follow-ups", systemImage: "paperplane.fill") }
                .badge(drafts.filter { $0.draftStatus == .draft }.count)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tabViewStyle(.automatic)
        .tint(.indigo)
        .onAppear {
            SampleData.insertIfNeeded(into: modelContext)
        }
    }
}
