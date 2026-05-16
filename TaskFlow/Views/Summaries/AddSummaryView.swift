import SwiftUI
import SwiftData

// MARK: - AddSummaryView

struct AddSummaryView: View {
    let viewModel: SummaryViewModel
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var rawText = ""
    @State private var source = "manual"
    @State private var tagsInput = ""   // comma-separated

    private let sourceOptions: [(label: String, tag: String)] = [
        ("Manual",     "manual"),
        ("GPT Memory", "GPT memory"),
        ("Import",     "import"),
        ("Email",      "email"),
        ("Slack",      "slack"),
    ]

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var parsedTags: [String] {
        tagsInput
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    var body: some View {
        NavigationStack {
            Form {

                // MARK: Summary Info
                Section {
                    TextField("Title", text: $title)
                        .font(.body)

                    Picker("Source", selection: $source) {
                        ForEach(sourceOptions, id: \.tag) { option in
                            Text(option.label).tag(option.tag)
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        TextField("Tags (comma separated)", text: $tagsInput)
                            .autocorrectionDisabled()
                            .autocapitalization(.none)
                            .font(.body)

                        if !parsedTags.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(parsedTags, id: \.self) { tag in
                                        SummaryTagChip(text: tag)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                } header: {
                    Text("Summary Info")
                } footer: {
                    Text("Tags help you filter and find summaries quickly.")
                        .foregroundStyle(.secondary)
                }

                // MARK: Content
                Section {
                    ZStack(alignment: .topLeading) {
                        if rawText.isEmpty {
                            Text("Paste or type the summary content here…")
                                .foregroundStyle(Color(.placeholderText))
                                .font(.body)
                                .padding(.top, 8)
                                .padding(.leading, 4)
                                .allowsHitTesting(false)
                        }
                        TextEditor(text: $rawText)
                            .frame(minHeight: 200)
                            .font(.body)
                    }
                } header: {
                    Text("Content")
                } footer: {
                    Text("The app will automatically parse sections and extract action items.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Add Summary")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard canSave else { return }
                        viewModel.addSummary(
                            title: title.trimmingCharacters(in: .whitespaces),
                            rawText: rawText,
                            source: source,
                            tags: parsedTags,
                            context: modelContext
                        )
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(!canSave)
                }
            }
        }
    }
}
