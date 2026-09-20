import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var hotKey: HotKeyManager?
    private var popup: PopupWindowController?
    private let settings = AppSettings.shared

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupStatusItem()
        popup = PopupWindowController()
        registerHotKey()
        _ = LocalDict.shared // warm dict on launch
    }

    func applicationWillTerminate(_ notification: Notification) {
        hotKey?.unregister()
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            if let image = NSImage(systemSymbolName: "character.book.closed", accessibilityDescription: "Sensebook") {
                image.isTemplate = true
                button.image = image
            } else {
                button.title = "SB"
            }
            button.toolTip = "Sensebook — ⌥D 划词翻译"
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "划词翻译 (⌥D)", action: #selector(translateSelection), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "设置…", action: #selector(openSettings), keyEquivalent: ","))
        menu.addItem(NSMenuItem(title: "辅助功能说明…", action: #selector(showAccessibilityHelp), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "退出 Sensebook", action: #selector(quit), keyEquivalent: "q"))
        for entry in menu.items {
            entry.target = self
        }
        item.menu = menu
        statusItem = item
    }

    private func registerHotKey() {
        hotKey = HotKeyManager(keyCode: 0x02, modifiers: .option) { [weak self] in
            self?.translateSelection()
        }
        hotKey?.register()
    }

    @objc private func translateSelection() {
        Task { @MainActor in
            let text = await SelectionReader.shared.readSelectedText()
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                popup?.show(
                    selectedText: "",
                    localGloss: nil,
                    wordSense: "未读到选中文本",
                    sentenceGloss: "请先选中文字，并确认已授予「辅助功能」权限（设置 → 辅助功能说明）。",
                    loading: false,
                    error: nil
                )
                return
            }
            await runLookup(for: trimmed)
        }
    }

    @MainActor
    private func runLookup(for text: String) async {
        let isShort = LocalDict.isShortWord(text)
        let local: LocalDict.Entry? = isShort ? LocalDict.shared.lookup(text)?.entry : nil
        let localLine: String? = {
            guard let e = local else {
                return isShort ? "本地词库未命中" : "整句：跳过本地词库"
            }
            if let pos = e.pos, !pos.isEmpty {
                return "\(pos) \(e.gloss)"
            }
            return e.gloss
        }()

        popup?.show(
            selectedText: text,
            localGloss: localLine,
            wordSense: "查询中…",
            sentenceGloss: "查询中…",
            loading: true,
            error: nil
        )

        let snap = settings.snapshot()
        do {
            let result = try await DeepSeekClient.enrich(
                settings: snap,
                word: isShort ? text : text,
                sentence: text,
                source: "macOS selection"
            )
            popup?.show(
                selectedText: text,
                localGloss: localLine,
                wordSense: result.aiWordSense.isEmpty ? "（空）" : result.aiWordSense,
                sentenceGloss: result.aiSentenceGloss.isEmpty ? "（空）" : result.aiSentenceGloss,
                loading: false,
                error: nil,
                stub: result.stub
            )
        } catch {
            popup?.show(
                selectedText: text,
                localGloss: localLine,
                wordSense: "—",
                sentenceGloss: "—",
                loading: false,
                error: error.localizedDescription
            )
        }
    }

    @objc private func openSettings() {
        NSApp.activate(ignoringOtherApps: true)
        if #available(macOS 13.0, *) {
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        } else {
            NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        }
    }

    @objc private func showAccessibilityHelp() {
        let alert = NSAlert()
        alert.messageText = "启用辅助功能（Accessibility）"
        alert.informativeText = """
        Sensebook 需要「辅助功能」权限才能读取其他 App 中的选中文字（与 Bob 等划词工具相同）。

        操作步骤：
        1. 打开 系统设置 → 隐私与安全性 → 辅助功能
        2. 点击「+」或打开列表中的开关，添加 Sensebook
        3. 确保开关已打开
        4. 若刚安装或刚签名，可先移除再重新添加，然后重新启动 Sensebook

        也可点击下方按钮直接打开系统辅助功能面板。
        全局快捷键默认 ⌥D（Option + D）。
        """
        alert.addButton(withTitle: "打开系统设置")
        alert.addButton(withTitle: "关闭")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                NSWorkspace.shared.open(url)
            }
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
