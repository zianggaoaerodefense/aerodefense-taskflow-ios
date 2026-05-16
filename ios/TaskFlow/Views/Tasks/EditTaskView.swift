import SwiftUI
import SwiftData

// MARK: - EditTaskView
//
// Modal sheet for creating a new TaskItem or editing an existing one.
// When `task` is nil a fresh TaskItem is inserted into the ModelContext on save.
// When `task` is non-nil, its properties are mutated in place.

struct EditTaskView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    // If nil, the user is creating a new task.
    let task: TaskItem?

    // MARK: Form state

    @State private var title = ""
    @State private var details = ""
    @State private var notes = ""
    @State private var status: TaskStatus = .new
    @State private var priority: TaskPriority = .normal
    @State private var resourceType: ResourceType = .other
    @State private var resourceLabel = ""
    @State private var resourceURL = ""
    @State private var requesterName = ""
    @State private var requesterContact = ""
    @State private var hasTargetDate = false
    @State private var targetDate = Date()
    @State private var hasActualDate = false
    @State private var actualDate = Date()

    private var isEditing: Bool { task != nil }
    private var canSave: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty }

    // MARK: - Init

    init(task: TaskItem?) {
        self.task = task

        // Pre-populate fields from existing task
        if let t = task {
            _title            = State(initialValue: t.title)
            _details          = State(initialValue: t.details)
            _notes            = State(initialValue: t.notes)
            _status           = State(initialValue: t.status)
            _priority         = State(initialValue: t.priority)
            _resourceType     = State(initialValue: t.resourceType)
            _resourceLabel    = State(initialValue: t.resourceLabel ?? "")
            _resourceURL      = State(initialValue: t.resourceURL ?? "")
            _requesterName    = State(initialValue: t.requesterName ?? "")
            _requesterContact = State(initialValue: t.requesterContact ?? "")
            if let due = t.targetCompletionDate {
                _hasTargetDate = State(initialValue: true)
                _targetDate    = State(initialValue: due)
            }
            if let actual = t.actualCompletionDate {
                _hasActualDate = State(initialValue: true)
                _actualDate    = State(initialValue: actual)
            }
        }
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Form {
                // ── Core ──────────────────────────────────────────────────────
                Section("Task") {
                    TextField("Title", text: $title)
                    TextEditor(text: $details)
                        .frame(minHeight: 80)
                        .overlay(
                            Group {
                                if details.isEmpty {
                                    Text("Details (optional)")
                                        .foregroundStyle(.tertiary)
                                        .padding(.leading, 4)
                                        .padding(.top, 8)
                                        .allowsHitTesting(false)
                                }
                            },
                            alignment: .topLeading
                        )
                }

                // ── Status & Priority ─────────────────────────────────────────
                Section("Status & Priority") {
                    Picker("Status", selection: $status) {
                        ForEach(TaskStatus.allCases, id: \.self) { s in
                            Label(s.label, systemImage: statusIcon(s)).tag(s)
                        }
                    }
                    Picker("Priority", selection: $priority) {
                        ForEach(TaskPriority.allCases, id: \.self) { p in
                            Text(p.label).tag(p)
                        }
                    }
                }

                // ── Resource ──────────────────────────────────────────────────
                Section("Resource") {
                    Picker("Type", selection: $resourceType) {
                        ForEach(ResourceType.allCases, id: \.self) { rt in
                            Label(rt.label, systemImage: rt.icon).tag(rt)
                        }
                    }
                    TextField("Label (optional)", text: $resourceLabel)
                        .autocorrectionDisabled()
                    TextField("URL (optional)", text: $resourceURL)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .autocapitalization(.none)
                }

                // ── Requester ─────────────────────────────────────────────────
                Section("Requester") {
                    TextField("Name (optional)", text: $requesterName)
                    TextField("Contact (optional)", text: $requesterContact)
                        .keyboardType(.emailAddress)
                        .autocorrectionDisabled()
                        .autocapitalization(.none)
                }

                // ── Dates ──────────────────────────────────────────────────────
                Section("Dates") {
                    Toggle("Target completion date", isOn: $hasTargetDate)
                    if hasTargetDate {
                        DatePicker(
                            "Target date",
                            selection: $targetDate,
                            displayedComponents: .date
                        )
                    }
                    Toggle("Actual completion date", isOn: $hasActualDate)
                    if hasActualDate {
                        DatePicker(
                            "Actual date",
                            selection: $actualDate,
                            displayedComponents: .date
                        )
                    }
                }

                // ── Notes ──────────────────────────────────────────────────────
                Section("Notes") {
                    TextEditor(text: $notes)
                        .frame(minHeight: 80)
                        .overlay(
                            Group {
                                if notes.isEmpty {
                                    Text("Internal notes (optional)")
                                        .foregroundStyle(.tertiary)
                                        .padding(.leading, 4)
                                        .padding(.top, 8)
                                        .allowsHitTesting(false)
                                }
                            },
                            alignment: .topLeading
                        )
                }
            }
            .navigationTitle(isEditing ? "Edit Task" : "New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { commitSave() }
                        .disabled(!canSave)
                        .fontWeight(.semibold)
                }
            }
        }
    }

    // MARK: - Save logic

    private func commitSave() {
        if let existing = task {
            applyFields(to: existing)
        } else {
            let fresh = TaskItem(
                title: title.trimmingCharacters(in: .whitespaces),
                details: details,
                status: status,
                priority: priority,
                targetCompletionDate: hasTargetDate ? targetDate : nil,
                actualCompletionDate: hasActualDate ? actualDate : nil,
                requesterName: nilIfEmpty(requesterName),
                requesterContact: nilIfEmpty(requesterContact),
                resourceType: resourceType,
                resourceLabel: nilIfEmpty(resourceLabel),
                resourceURL: nilIfEmpty(resourceURL),
                notes: notes
            )
            modelContext.insert(fresh)
        }
        dismiss()
    }

    private func applyFields(to t: TaskItem) {
        t.title                = title.trimmingCharacters(in: .whitespaces)
        t.details              = details
        t.notes                = notes
        t.status               = status
        t.priority             = priority
        t.resourceType         = resourceType
        t.resourceLabel        = nilIfEmpty(resourceLabel)
        t.resourceURL          = nilIfEmpty(resourceURL)
        t.requesterName        = nilIfEmpty(requesterName)
        t.requesterContact     = nilIfEmpty(requesterContact)
        t.targetCompletionDate = hasTargetDate ? targetDate : nil
        t.actualCompletionDate = hasActualDate ? actualDate : nil
        t.updatedAt            = Date()
    }

    private func nilIfEmpty(_ s: String) -> String? {
        let trimmed = s.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func statusIcon(_ s: TaskStatus) -> String {
        switch s {
        case .new:      return "circle"
        case .reviewed: return "eye.circle"
        case .waiting:  return "clock"
        case .done:     return "checkmark.circle.fill"
        }
    }
}
