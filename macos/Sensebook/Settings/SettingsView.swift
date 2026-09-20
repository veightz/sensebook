import AppKit
import SwiftUI

struct SettingsView: View {
    @ObservedObject private var settings = AppSettings.shared
    @State private var apiKey: String = ""
    @State private var baseURL: String = AppSettings.defaultBaseURL
    @State private var model: String = AppSettings.defaultModel
    @State private var thinking: Bool = false
    @State private var status: String = ""
    @State private var testing = false

    var body: some View {
        Form {
            Section("DeepSeek") {
                SecureField("API Key", text: $apiKey)
                Text("当前：\(AppSettings.maskKey(keyForMask()))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextField("Base URL", text: $baseURL)
                Text("须为 OpenAI 兼容的 /v1 根（会追加 /chat/completions）。默认 https://api.deepseek.com/v1")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                TextField("模型", text: $model)
                Toggle("启用 thinking（默认关）", isOn: $thinking)
            }

            Section("辅助功能（Accessibility）") {
                Text("""
                Sensebook 通过「辅助功能」读取其他 App 中的选中文字（划词翻译 ⌥D）。

                启用步骤：
                1. 系统设置 → 隐私与安全性 → 辅助功能
                2. 添加并打开 Sensebook
                3. 若刚安装无效：移除后重新添加，再重启本 App

                未授权时会尝试 ⌘C 剪贴板回退（可能干扰剪贴板）。
                """)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
                Button("打开系统「辅助功能」面板") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                        NSWorkspace.shared.open(url)
                    }
                }
            }

            Section("本地词库") {
                Text("版本 \(LocalDict.shared.dictVersion) · \(LocalDict.shared.dictCount) 词（ECDICT · MIT half10k）")
                    .font(.caption)
            }

            Section {
                HStack {
                    Button("保存") { save() }
                        .keyboardShortcut(.defaultAction)
                    Button("清除 Key") { clearKey() }
                    Button(testing ? "测试中…" : "测试连接") { testConnection() }
                        .disabled(testing)
                }
                if !status.isEmpty {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(status.contains("成功") ? .green : .primary)
                }
            }

            Section("关于") {
                let ver = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
                let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
                Text("Sensebook macOS M1 · \(ver) (\(build))")
                    .font(.caption)
                Text("包名 com.veightz.sensebook · 菜单栏 App（无 Dock）· 默认快捷键 ⌥D")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .onAppear {
            apiKey = settings.apiKeyField
            baseURL = settings.baseURL
            model = settings.model
            thinking = settings.thinkingEnabled
        }
    }

    private func keyForMask() -> String {
        if !apiKey.isEmpty { return apiKey }
        return settings.hasKey ? KeychainStore.loadAPIKey() : ""
    }

    private func save() {
        do {
            try settings.save(apiKey: apiKey, baseURL: baseURL, model: model, thinkingEnabled: thinking)
            status = "已保存（Key 写入钥匙串）"
        } catch {
            status = "保存失败：\(error.localizedDescription)"
        }
    }

    private func clearKey() {
        do {
            try settings.clearAPIKey()
            apiKey = ""
            status = "已清除 API Key（URL / 模型保留）"
        } catch {
            status = "清除失败：\(error.localizedDescription)"
        }
    }

    private func testConnection() {
        testing = true
        status = "测试中…"
        Task {
            let snap = DeepSeekClient.SettingsSnapshot(
                baseURL: baseURL,
                model: model.isEmpty ? AppSettings.defaultModel : model,
                apiKey: apiKey.isEmpty ? KeychainStore.loadAPIKey() : apiKey,
                thinkingEnabled: thinking
            )
            do {
                let out = try await DeepSeekClient.translate(settings: snap, text: "ping")
                await MainActor.run {
                    status = "成功：\(out.prefix(80))"
                    testing = false
                }
            } catch {
                await MainActor.run {
                    status = "失败：\(error.localizedDescription)"
                    testing = false
                }
            }
        }
    }
}
