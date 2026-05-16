import SwiftUI

// MARK: - PriorityBadge
//
// Compact badge for TaskPriority.
// Uses a small colored dot + label for fast visual scanability across the board.

struct PriorityBadge: View {
    let priority: TaskPriority

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(priority.color)
                .frame(width: 6, height: 6)
            Text(priority.label)
                .font(.caption2.weight(.semibold))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(priority.color.opacity(0.12))
        .foregroundStyle(priority.color)
        .clipShape(Capsule())
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    HStack(spacing: 8) {
        ForEach(TaskPriority.allCases, id: \.self) { priority in
            PriorityBadge(priority: priority)
        }
    }
    .padding()
}
#endif
