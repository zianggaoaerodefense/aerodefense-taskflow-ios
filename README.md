# TaskFlow — CTO Workflow iOS App

**Phase 1 — Local-only, SwiftUI + SwiftData**

A private native iPhone app for managing work summaries, action items, and follow-up drafts. Replaces fragile HTML dashboards. The app's local database is the source of truth.

---

## Quick Start

1. **Requirements:** Xcode 15+, iOS 17 Simulator or device
2. Open `TaskFlow.xcodeproj` in Xcode
3. Select an iPhone simulator (iOS 17+)
4. Build and run (`⌘R`)
5. Sample data loads automatically on first launch

> No Apple Developer account required for Simulator. A paid account is required to run on a physical device or submit to TestFlight.

---

## Architecture

```
TaskFlow/
├── TaskFlowApp.swift              # @main entry, SwiftData container
├── Info.plist
├── Assets.xcassets
│
├── Models/
│   ├── Summary.swift              # @Model: Summary + SummarySection
│   ├── TaskItem.swift             # @Model: TaskItem + TaskStatus/Priority/ResourceType enums
│   ├── FollowUpDraft.swift        # @Model: FollowUpDraft + ChannelType/DraftStatus enums
│   └── AppSettings.swift          # @Model: AppSettings singleton + ExportFormat enum
│
├── Services/
│   ├── SummaryParser.swift        # Deterministic markdown/text → sections parser
│   ├── TaskExtractionService.swift # Action-verb-based task extraction (no AI)
│   ├── FollowUpDraftService.swift  # Template-based follow-up draft generator
│   ├── ImportExportService.swift   # JSON + Markdown export/import with Codable DTOs
│   └── SecurityLockService.swift   # LocalAuthentication wrapper + SecurityLockView
│
├── ViewModels/
│   ├── SummaryViewModel.swift
│   ├── TaskBoardViewModel.swift
│   ├── FollowUpViewModel.swift
│   └── SettingsViewModel.swift
│
├── Views/
│   ├── RootTabView.swift           # Bottom tab navigation
│   ├── Summaries/
│   │   ├── SummaryListView.swift
│   │   ├── SummaryDetailView.swift
│   │   ├── AddSummaryView.swift
│   │   └── TaskExtractionPreviewView.swift
│   ├── Tasks/
│   │   ├── TaskBoardView.swift
│   │   ├── TaskCardView.swift
│   │   ├── TaskDetailView.swift
│   │   ├── EditTaskView.swift
│   │   └── TaskComponents.swift   # CardContainer, SectionHeaderRow
│   ├── FollowUps/
│   │   ├── FollowUpListView.swift
│   │   └── FollowUpDetailView.swift
│   ├── Settings/
│   │   └── SettingsView.swift
│   └── Components/
│       ├── StatusChip.swift
│       ├── PriorityBadge.swift
│       ├── ResourceTypeBadge.swift
│       └── SharedComponents.swift  # DraftStatusBadge, ChannelTypeIcon, EmptyStateView, etc.
│
└── Resources/
    └── SampleData.swift            # Sample summaries/tasks for preview (source = "sample")
```

---

## Data Schema (v1.0)

### Summary
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Unique |
| title | String | |
| dateCreated | Date | |
| dateUpdated | Date | |
| source | String? | "manual", "GPT memory", "import", "sample" |
| rawText | String | Full pasted/imported text |
| tags | [String] | |
| sections | [SummarySection] | Cascade delete |
| linkedTasks | [TaskItem] | |

### SummarySection
| Field | Type |
|-------|------|
| id | UUID |
| heading | String |
| body | String |
| extractedBullets | [String] |

### TaskItem
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| title | String | |
| details | String | |
| sourceSummaryID | UUID? | |
| sourceSummaryTitle | String? | Denormalized for display |
| status | TaskStatus | new / reviewed / waiting / done |
| priority | TaskPriority | low / normal / high / urgent |
| targetCompletionDate | Date? | |
| actualCompletionDate | Date? | |
| requesterName | String? | |
| requesterContact | String? | |
| resourceType | ResourceType | email / slack / jira / github / document / other |
| resourceLabel | String? | e.g. "ARCH-421" |
| resourceURL | String? | |
| notes | String | |
| createdAt / updatedAt / doneAt | Date | |
| followUpDraft | FollowUpDraft? | Auto-created on Done |

### FollowUpDraft
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | |
| taskID | UUID | |
| channelType | ChannelType | email / slack / jira / other |
| recipientOrTarget | String? | |
| subject | String? | Email only |
| body | String | Template-generated, user-editable |
| draftStatus | DraftStatus | draft / reviewed / approved / sentExternally / archived |
| createdAt / updatedAt / approvedAt | Date | |

### AppSettings (singleton)
| Field | Type | Default |
|-------|------|---------|
| requireFaceID | Bool | false |
| appDisplayName | String | "TaskFlow" |
| exportFormatPreference | ExportFormat | json |
| agentSyncEnabled | Bool | false (Phase 2 placeholder) |
| defaultTaskPriority | TaskPriority | normal |
| defaultResourceType | ResourceType | other |

---

## JSON Export Format

```json
{
  "schemaVersion": "1.0",
  "exportedAt": "2025-01-01T00:00:00Z",
  "summaries": [...],
  "tasks": [...],
  "followUpDrafts": [...]
}
```

Dates use ISO 8601. Import merges by inserting new objects; existing records are not deduplicated automatically.

---

## Security

- **Local only.** No network calls, no analytics, no telemetry in Phase 1.
- **No secrets.** No API keys, tokens, or credentials in the codebase.
- **Face ID / Passcode** lock via `LocalAuthentication`. Toggle in Settings.
- **Export warning** shown before any data export (files may contain sensitive work information).
- **No UserDefaults** for sensitive content — all task/summary data in SwiftData (on-device encrypted store).
- **Sensitive data handling:** treat summaries and tasks as internal/confidential. Do not commit exported JSON files.

---

## GPT / AI Agent Compatibility

Phase 1 is deliberately local and offline. A GPT management agent can interact via:

1. **Export → Process → Import:** Export JSON from the app, pass to a GPT agent for analysis or enrichment, re-import the modified JSON.
2. **Markdown export:** Individual summaries and their tasks can be exported as clean Markdown for LLM context.

**The app database is the source of truth. ChatGPT memory is not.**

### Future agent integration TODOs

```swift
// TODO: Phase 2 — Backend API endpoint for agent sync
// TODO: Phase 2 — Gmail draft integration (requires OAuth, OAuth credentials via environment only)
// TODO: Phase 2 — Slack draft send via Slack API (requires Bot token, stored in Keychain)
// TODO: Phase 2 — Jira issue lookup and comment post via Jira REST API
// TODO: Phase 2 — GPT-powered task extraction (replace deterministic parser with API call, opt-in)
// TODO: Phase 2 — Approval/send workflow with confirmation UI before any external transmission
// TODO: Phase 2 — iCloud sync option (CloudKit container, user consent required)
```

Services are intentionally kept separate and stateless so a future agent can call them directly:
- `TaskExtractionService.extractSuggestions(from:)` — swap implementation for GPT in Phase 2
- `FollowUpDraftService.generateDraft(for:)` — swap templates for GPT-generated text
- `ImportExportService` — clean boundary for agent data handoff

---

## TestFlight Deployment

Phase 1 does not include CI/CD. When ready:

1. **Apple Developer account** required ($99/year)
2. Keep repo **private** (contains internal work context in sample data)
3. Options:
   - **Xcode Cloud** (simplest — built into Xcode 13+)
   - **GitHub Actions + Fastlane** (`match` for code signing, `gym` for build, `pilot` for upload)
   - **Codemagic** (CI/CD SaaS with iOS support)
4. **Never commit:**
   - `.p12` / `.mobileprovision` files
   - Apple credentials (`APPLE_ID`, `APP_SPECIFIC_PASSWORD`, `ASC_API_KEY`)
   - Use repository secrets / environment variables for all credentials
5. `PRODUCT_BUNDLE_IDENTIFIER` is `com.taskflow.app` — change before provisioning

---

## Configuration

### Change the app name
Update `appDisplayName` in Settings (persisted in AppSettings). To change the binary name, update `PRODUCT_NAME` in `project.pbxproj` and `CFBundleDisplayName` in `Info.plist`.

### Change bundle identifier
Edit `PRODUCT_BUNDLE_IDENTIFIER` in `project.pbxproj` (both Debug and Release configurations).

### Deployment target
iOS 17.0 (required for SwiftData and `@Observable`). Update `IPHONEOS_DEPLOYMENT_TARGET` in both build configurations to change.

---

## Phase 1 Limitations (by design)

| Feature | Status |
|---------|--------|
| Gmail sending | Not implemented — draft only |
| Slack sending | Not implemented — draft only |
| Jira API write | Not implemented — link + draft only |
| Cloud sync | Not implemented |
| Push notifications | Not implemented |
| AI-powered extraction | Not implemented — deterministic parser only |
| App Store / TestFlight | Not configured — requires Apple Developer account |
| Analytics | Intentionally absent |

---

## Development Notes

- `@Observable` macro requires iOS 17+
- SwiftData `@Model` classes must be `final class`
- `@Relationship` inverse declarations prevent orphaned records
- `AppSettings` is a singleton — fetch first record, insert default if empty (handled in `SettingsViewModel.loadOrCreateSettings`)
- Sample data is identified by `source == "sample"` and can be cleared without affecting user data
