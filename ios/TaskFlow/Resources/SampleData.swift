// MARK: - Sample Data
//
// Synthetic preview and onboarding data only. Never contains real user,
// customer, or production data. All records are tagged source = "sample" so
// they can be identified and selectively removed.
//
// Usage:
//   if !SampleData.hasSampleData(context) {
//       SampleData.insertSampleData(into: context)
//   }

import Foundation
import SwiftData

struct SampleData {

    // MARK: - Insert (named entry point expected by callers)

    /// Inserts a complete set of synthetic sample records into the given context.
    /// Call only in previews, onboarding, or simulator first-launch — not in production.
    @MainActor
    static func insertSampleData(into context: ModelContext) {
        _insert(into: context)
    }

    /// Convenience: inserts sample data only if none exists yet.
    @MainActor
    static func insertIfNeeded(into context: ModelContext) {
        guard !hasSampleData(context) else { return }
        _insert(into: context)
    }

    // MARK: - Core insert logic

    @MainActor
    private static func _insert(into context: ModelContext) {

        // ── Summary 1: Q2 Engineering Review ─────────────────────────────────

        let q2Section1 = SummarySection(
            heading: "Goals",
            body: "Deliver the API gateway migration by end of Q2. Improve CI pipeline reliability to 99.5% pass rate. Complete security audit before the June release.",
            extractedBullets: [
                "Deliver API gateway migration by end of Q2",
                "Improve CI pipeline reliability to 99.5%",
                "Complete security audit before June release"
            ]
        )
        let q2Section2 = SummarySection(
            heading: "Action Items",
            body: "Follow up with DevOps on container registry costs. Review the draft RFC for the new auth system. Schedule architecture review with the backend team. Send updated roadmap to stakeholders.",
            extractedBullets: [
                "Follow up with DevOps on container registry costs",
                "Review draft RFC for new auth system",
                "Schedule architecture review with backend team",
                "Send updated roadmap to stakeholders"
            ]
        )
        let q2Section3 = SummarySection(
            heading: "Blockers",
            body: "Staging environment is unstable due to memory leak in service mesh. Investigate and resolve before QA begins. Check with infrastructure team on timeline.",
            extractedBullets: [
                "Investigate memory leak in service mesh",
                "Confirm QA start date with infrastructure team"
            ]
        )

        let summary1 = Summary(
            title: "Q2 Engineering Review",
            dateCreated: Date().addingTimeInterval(-14 * 86_400),
            dateUpdated: Date().addingTimeInterval(-12 * 86_400),
            source: "sample",
            rawText: """
            # Q2 Engineering Review

            ## Goals
            Deliver the API gateway migration by end of Q2. Improve CI pipeline reliability to 99.5% pass rate. Complete security audit before the June release.

            ## Action Items
            - Follow up with DevOps on container registry costs
            - Review the draft RFC for the new auth system
            - Schedule architecture review with the backend team
            - Send updated roadmap to stakeholders

            ## Blockers
            Staging environment is unstable due to memory leak in service mesh. Investigate and resolve before QA begins.
            """,
            tags: ["engineering", "q2", "review"],
            sections: [q2Section1, q2Section2, q2Section3]
        )

        // ── Summary 2: Platform Migration Planning ────────────────────────────

        let migSection1 = SummarySection(
            heading: "Background",
            body: "We are migrating from a monolithic Rails backend to a microservices architecture deployed on Kubernetes. Phase 1 covers the auth and user services.",
            extractedBullets: [
                "Migrate auth service first",
                "User service to follow in Phase 2"
            ]
        )
        let migSection2 = SummarySection(
            heading: "Migration Steps",
            body: "Deploy new auth service to staging. Verify feature parity with integration tests. Implement shadow traffic routing. Schedule cutover window. Document rollback procedure.",
            extractedBullets: [
                "Deploy new auth service to staging",
                "Verify feature parity with integration tests",
                "Implement shadow traffic routing",
                "Schedule cutover window",
                "Document rollback procedure"
            ]
        )
        let migSection3 = SummarySection(
            heading: "Risks",
            body: "Token compatibility between old and new auth systems must be verified. Prepare rollback runbook. Confirm with legal that updated data handling meets compliance requirements.",
            extractedBullets: [
                "Verify token compatibility",
                "Prepare rollback runbook",
                "Confirm compliance with legal team"
            ]
        )

        let summary2 = Summary(
            title: "Platform Migration Planning",
            dateCreated: Date().addingTimeInterval(-7 * 86_400),
            dateUpdated: Date().addingTimeInterval(-5 * 86_400),
            source: "sample",
            rawText: """
            # Platform Migration Planning

            ## Background
            Migrating from monolithic Rails to microservices on Kubernetes. Phase 1: auth + user services.

            ## Migration Steps
            1. Deploy new auth service to staging
            2. Verify feature parity with integration tests
            3. Implement shadow traffic routing
            4. Schedule cutover window
            5. Document rollback procedure

            ## Risks
            - Verify token compatibility between old and new systems
            - Prepare rollback runbook
            - Confirm compliance with legal team
            """,
            tags: ["platform", "migration", "infra"],
            sections: [migSection1, migSection2, migSection3]
        )

        context.insert(summary1)
        context.insert(summary2)

        // ── Sample Tasks ──────────────────────────────────────────────────────

        // Task 1: status=reviewed, priority=high, resourceType=jira
        let task1 = TaskItem(
            title: "Review API rate limiting proposal",
            details: "The backend team shared a draft RFC for the new API rate limiting strategy. Review before the architecture meeting on Friday.",
            sourceSummaryID: summary1.id,
            sourceSummaryTitle: summary1.title,
            status: .reviewed,
            priority: .high,
            targetCompletionDate: Calendar.current.date(byAdding: .day, value: 3, to: Date()),
            requesterName: "Priya Shah",
            requesterContact: "priya@example.internal",
            resourceType: .jira,
            resourceLabel: "ARCH-421",
            resourceURL: "https://jira.example.internal/browse/ARCH-421",
            notes: "Focus on burst limits and per-tenant quotas."
        )

        // Task 2: status=new, priority=normal, resourceType=email
        let task2 = TaskItem(
            title: "Send update to infrastructure team",
            details: "Compose and send an email summary of Q2 review decisions affecting the infrastructure roadmap.",
            sourceSummaryID: summary1.id,
            sourceSummaryTitle: summary1.title,
            status: .new,
            priority: .normal,
            targetCompletionDate: Calendar.current.date(byAdding: .day, value: 2, to: Date()),
            requesterName: "Alex Chen",
            requesterContact: "alex.chen@example.internal",
            resourceType: .email,
            resourceLabel: "Infra distribution list",
            notes: "CC the platform leads. Keep it concise."
        )

        // Task 3: status=done, priority=urgent, resourceType=slack — also gets a follow-up draft
        let task3 = TaskItem(
            title: "Verify staging deployment",
            details: "Confirm the new auth service is running cleanly in staging, all feature-parity tests are passing, and shadow traffic routing is configured.",
            sourceSummaryID: summary2.id,
            sourceSummaryTitle: summary2.title,
            status: .done,
            priority: .urgent,
            targetCompletionDate: Calendar.current.date(byAdding: .day, value: -1, to: Date()),
            actualCompletionDate: Date(),
            requesterName: "DevOps Team",
            requesterContact: "#devops-alerts",
            resourceType: .slack,
            resourceLabel: "#platform-migration",
            notes: "All integration tests green. Shadow traffic at 10%."
        )
        task3.doneAt = Date()

        context.insert(task1)
        context.insert(task2)
        context.insert(task3)

        summary1.linkedTasks.append(contentsOf: [task1, task2])
        summary2.linkedTasks.append(task3)

        // ── Follow-up Drafts ──────────────────────────────────────────────────

        // Draft 1: slack draft (status=draft) linked to task3 (done)
        let draft1 = FollowUpDraft(
            taskID: task3.id,
            channelType: .slack,
            recipientOrTarget: "#platform-migration",
            subject: nil,
            body: """
            Hi team, confirming that staging deployment is complete. \
            All integration tests are green and shadow traffic is routing at 10%. \
            Ready for QA sign-off. Ping me with any questions.
            """,
            status: .draft
        )
        draft1.task = task3
        task3.followUpDraft = draft1
        context.insert(draft1)

        // Draft 2: jira draft (status=reviewed) linked to task1
        let draft2 = FollowUpDraft(
            taskID: task1.id,
            channelType: .jira,
            recipientOrTarget: "ARCH-421",
            subject: nil,
            body: """
            Rate limiting RFC reviewed. Feedback added as comments in ARCH-421. \
            Key concerns: burst handling window and per-tenant vs. global limits. \
            Ready for arch-review sign-off.
            """,
            status: .reviewed
        )
        draft2.task = task1
        context.insert(draft2)

        // Draft 3: email draft (status=approved) linked to task2
        let draft3 = FollowUpDraft(
            taskID: task2.id,
            channelType: .email,
            recipientOrTarget: "infra-leads@example.internal",
            subject: "Q2 Engineering Review — Infrastructure Decisions",
            body: """
            Hi Infrastructure Team,

            Following up from our Q2 Engineering Review. Summary of decisions that affect your roadmap:

            1. API rate limiting RFC is under arch review — decision expected by end of week.
            2. Staging environment blocker resolved — QA resumes immediately.
            3. Platform migration kicks off next sprint — see migration planning doc for details.

            Please reply with any questions or blockers.

            — TaskFlow
            """,
            status: .approved
        )
        draft3.task = task2
        context.insert(draft3)
    }

    // MARK: - Check for existing sample data

    /// Returns true if at least one Summary with source == "sample" exists in the store.
    static func hasSampleData(_ context: ModelContext) -> Bool {
        let descriptor = FetchDescriptor<Summary>(predicate: #Predicate { $0.source == "sample" })
        return (try? context.fetch(descriptor))?.isEmpty == false
    }
}
