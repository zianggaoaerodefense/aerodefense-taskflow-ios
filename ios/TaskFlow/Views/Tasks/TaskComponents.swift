import SwiftUI

// StatusChip, PriorityBadge, and ResourceTypeBadge are defined in
// Views/Components/StatusChip.swift, PriorityBadge.swift, and
// ResourceTypeBadge.swift respectively.

// MARK: - CardContainer
//
// Reusable rounded card background used throughout the Tasks feature area.

struct CardContainer<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(16)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: .black.opacity(0.06), radius: 8, x: 0, y: 2)
    }
}

// MARK: - SectionHeaderRow
//
// Status section header with colored dot, name, and a count badge.

struct SectionHeaderRow: View {
    let status: TaskStatus
    let count: Int

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(status.color)
                .frame(width: 10, height: 10)

            Text(status.label)
                .font(.headline)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)

            Spacer()

            Text("\(count)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 9)
                .padding(.vertical, 3)
                .background(Color(.tertiarySystemFill))
                .clipShape(Capsule())
        }
    }
}
