import SwiftUI

// MARK: - StatusChip
//
// Colored capsule pill showing a TaskStatus label.
// Flat Design 2.0: soft tinted background, bold foreground, capsule shape with
// a hairline stroke to give depth without heavy shadows.

struct StatusChip: View {
    let status: TaskStatus

    var body: some View {
        Text(status.label)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(status.color.opacity(0.18))
            .foregroundStyle(status.color)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(status.color.opacity(0.30), lineWidth: 0.5)
            )
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    HStack(spacing: 8) {
        ForEach(TaskStatus.allCases, id: \.self) { status in
            StatusChip(status: status)
        }
    }
    .padding()
}
#endif
