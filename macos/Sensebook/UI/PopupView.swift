import SwiftUI

struct PopupContent: Equatable {
    var selectedText: String = ""
    var localGloss: String? = nil
    var wordSense: String = ""
    var sentenceGloss: String = ""
    var loading: Bool = false
    var error: String? = nil
    var stub: Bool = false
}

struct PopupView: View {
    let content: PopupContent
    var onSettings: () -> Void
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Sensebook")
                    .font(.headline)
                Spacer()
                if content.loading {
                    ProgressView()
                        .controlSize(.small)
                }
                Button("设置") { onSettings() }
                    .buttonStyle(.borderless)
                Button("关闭") { onClose() }
                    .buttonStyle(.borderless)
            }

            Group {
                Text("选中")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(content.selectedText.isEmpty ? "（无）" : content.selectedText)
                    .font(.body)
                    .textSelection(.enabled)
                    .lineLimit(4)
            }

            Divider()

            section(title: "本地词库", body: content.localGloss ?? "—")
            section(title: "词义", body: content.wordSense.isEmpty ? "—" : content.wordSense)
            section(title: "搭配效果", body: content.sentenceGloss.isEmpty ? "—" : content.sentenceGloss)

            if content.stub {
                Text("未配置 API Key：当前为本地 stub。可在设置中填写 DeepSeek Key。")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
            if let err = content.error {
                Text("错误：\(err)")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }

            Text("快捷键 ⌥D · 需辅助功能权限以读取选区")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(width: 360, alignment: .leading)
    }

    @ViewBuilder
    private func section(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(body)
                .font(.callout)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
