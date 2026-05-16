import SwiftUI

// MARK: - ResourceTypeBadge
//
// Icon + label badge for ResourceType. Uses neutral secondary styling so it
// does not compete with priority or status chips on the same card.

struct ResourceTypeBadge: View {
    let resourceType: ResourceType

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: resourceType.icon)
                .font(.caption2)
            Text(resourceType.label)
                .font(.caption2.weight(.medium))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color(.systemFill))
        .foregroundStyle(.secondary)
        .clipShape(Capsule())
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    HStack(spacing: 8) {
        ForEach(ResourceType.allCases, id: \.self) { resourceType in
            ResourceTypeBadge(resourceType: resourceType)
        }
    }
    .padding()
}
#endif
