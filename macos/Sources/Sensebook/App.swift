import AppKit
import SwiftUI
import Carbon
import Vision

final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
@MainActor final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var store: Store!
    var panel: FloatingPanel!
    var item: NSStatusItem!
    var hotkeys: [EventHotKeyRef] = []
    var handler: EventHandlerRef?
    var capturing = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        store = Store()
        NSApp.setActivationPolicy(.accessory)
        panel = FloatingPanel(contentRect:NSRect(x:0,y:0,width:550,height:760),styleMask:[.titled,.closable,.resizable,.fullSizeContentView],backing:.buffered,defer:false)
        panel.title = "Sensebook"; panel.titleVisibility = .hidden; panel.titlebarAppearsTransparent = true
        panel.isReleasedWhenClosed = false; panel.isFloatingPanel = true; panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary]; panel.hidesOnDeactivate = false
        panel.minSize = NSSize(width:490,height:560); panel.delegate = self
        panel.contentView = NSHostingView(rootView:RootView(store:store,capture:{ [weak self] in self?.capture() },permission:{ [weak self] in self?.requestPermission() }))
        panel.center()
        item = NSStatusBar.system.statusItem(withLength:NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName:"text.bubble.fill",accessibilityDescription:"Sensebook")
        let menu = NSMenu()
        add(menu,"输入翻译  ⌘⇧Space",#selector(showInput))
        add(menu,"翻译剪贴板",#selector(clipboard))
        add(menu,"截图识别…",#selector(captureAction))
        menu.addItem(.separator()); add(menu,"查询足迹",#selector(history)); add(menu,"设置…",#selector(settings)); add(menu,"打开回顾网站",#selector(review))
        menu.addItem(.separator()); add(menu,"退出 Sensebook",#selector(quit)); item.menu = menu
        registerHotkeys(); NSApp.servicesProvider = self
        show()
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { show(); return true }
    func add(_ menu:NSMenu,_ title:String,_ action:Selector) { let row = NSMenuItem(title:title,action:action,keyEquivalent:""); row.target = self; menu.addItem(row) }
    func registerHotkeys() {
        var spec = EventTypeSpec(eventClass:OSType(kEventClassKeyboard),eventKind:UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, pointer -> OSStatus in
            guard let event, let pointer else { return noErr }
            var id = EventHotKeyID()
            GetEventParameter(event,EventParamName(kEventParamDirectObject),EventParamType(typeEventHotKeyID),nil,MemoryLayout<EventHotKeyID>.size,nil,&id)
            let app = Unmanaged<AppDelegate>.fromOpaque(pointer).takeUnretainedValue()
            let selected = id.id == 1
            Task { @MainActor in if selected { app.selection() } else { app.showInput() } }
            return noErr
        },1,&spec,Unmanaged.passUnretained(self).toOpaque(),&handler)
        for (id,code) in [(UInt32(1),UInt32(kVK_ANSI_D)),(UInt32(2),UInt32(kVK_Space))] {
            var ref: EventHotKeyRef?
            let status = RegisterEventHotKey(code,UInt32(cmdKey | shiftKey),EventHotKeyID(signature:0x53424F4B,id:id),GetApplicationEventTarget(),0,&ref)
            if status == noErr, let ref { hotkeys.append(ref) } else { store.message = "快捷键已被其他应用占用，可使用菜单栏入口。" }
        }
    }
    func show() { panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true) }
    @objc func showInput() { store.tab = "translate"; show() }
    @objc func clipboard() { store.paste(); show(); if !store.text.isEmpty { store.translate() } }
    @objc func history() { store.tab = "history"; show() }
    @objc func settings() { store.tab = "settings"; show() }
    @objc func review() { store.openWebsite() }
    @objc func quit() { NSApp.terminate(nil) }
    @objc func captureAction() { capture() }
    func windowShouldClose(_ sender: NSWindow) -> Bool { sender.orderOut(nil); return false }
    func windowDidResignKey(_ notification: Notification) { if !store.pinned && !capturing { panel.orderOut(nil) } }
    func requestPermission() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String:true] as CFDictionary
        if AXIsProcessTrustedWithOptions(options) { store.message = "辅助功能权限已开启，可在其他应用选中文字后按 ⌘⇧D。" }
        else { store.message = "在系统设置 → 隐私与安全性 → 辅助功能中允许 Sensebook，然后重启应用。"; if let url = URL(string:"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") { NSWorkspace.shared.open(url) } }
    }
    func selection() {
        let app = NSWorkspace.shared.frontmostApplication
        guard AXIsProcessTrusted() else { store.message = "读取选区需要辅助功能权限；也可复制后从菜单翻译剪贴板。"; store.tab = "settings"; show(); return }
        let system = AXUIElementCreateSystemWide(); var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(system,kAXFocusedUIElementAttribute as CFString,&raw) == .success, let raw, CFGetTypeID(raw) == AXUIElementGetTypeID() else { noSelection(); return }
        let element = unsafeBitCast(raw,to:AXUIElement.self)
        var subrole: CFTypeRef?
        AXUIElementCopyAttributeValue(element,kAXSubroleAttribute as CFString,&subrole)
        if (subrole as? String) == "AXSecureTextField" { noSelection(); return }
        var selected: CFTypeRef?
        AXUIElementCopyAttributeValue(element,kAXSelectedTextAttribute as CFString,&selected)
        guard let text = selected as? String, !text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { noSelection(); return }
        // 只提取选区附近的上下文，不保存整个文档，也不模拟 Cmd+C。
        var surrounding = "", rangeRaw: CFTypeRef?
        if AXUIElementCopyAttributeValue(element,kAXSelectedTextRangeAttribute as CFString,&rangeRaw) == .success, let rangeRaw, CFGetTypeID(rangeRaw) == AXValueGetTypeID() {
            let rangeValue = unsafeBitCast(rangeRaw,to:AXValue.self); var range = CFRange()
            if AXValueGetValue(rangeValue,.cfRange,&range) {
                var value: CFTypeRef?
                if AXUIElementCopyAttributeValue(element,kAXValueAttribute as CFString,&value) == .success, let full = value as? String {
                    let ns = full as NSString, start = max(0,range.location-350)
                    if range.location >= 0, range.location <= ns.length, start < ns.length { surrounding = ns.substring(with:NSRange(location:start,length:min(ns.length-start,min(range.length,12000)+700))) }
                }
            }
        }
        store.receive(text,context:surrounding,source:app?.localizedName ?? "当前应用"); show(); store.translate()
    }
    func noSelection() { store.receive("",source:"当前应用"); store.message = "没有读到选中文字。可以复制后粘贴，或用菜单栏截图识别。"; show() }
    @objc func translateSelection(_ pasteboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString>) {
        guard let value = pasteboard.string(forType:.string) else { return }
        store.receive(value,source:"系统服务"); show(); store.translate()
    }
    func capture() {
        guard !capturing else { return }; capturing = true; panel.orderOut(nil)
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("sensebook-\(UUID().uuidString).png")
        let process = Process(); process.executableURL = URL(fileURLWithPath:"/usr/sbin/screencapture"); process.arguments = ["-i","-x",path.path]
        process.terminationHandler = { [weak self] process in
            defer { try? FileManager.default.removeItem(at:path) }
            var text = "", failure: String?
            if process.terminationStatus == 0, FileManager.default.fileExists(atPath:path.path) {
                do {
                    let request = VNRecognizeTextRequest(); request.recognitionLevel = .accurate; request.usesLanguageCorrection = true
                    try VNImageRequestHandler(url:path).perform([request])
                    text = request.results?.compactMap { $0.topCandidates(1).first?.string }.joined(separator:"\n") ?? ""
                } catch { failure = "识别失败，请重新截图或直接输入。" }
            }
            let captured = text, errorMessage = failure
            Task { @MainActor in
                guard let self else { return }; self.capturing = false
                if !captured.isEmpty { self.store.receive(captured,source:"截图 · 本机 OCR"); self.store.message = "文字已识别。可修改或补充原句，再点击理解。" }
                else { self.store.message = errorMessage ?? "未取得截图文字。若未出现截图工具，请在系统设置允许屏幕录制后重启。" }
                self.show()
            }
        }
        do { try process.run() } catch { capturing = false; store.message = "无法启动系统截图工具。"; show() }
    }
}
@main struct SensebookApp {
    @MainActor static func main() { let app = NSApplication.shared; let delegate = AppDelegate(); app.delegate = delegate; withExtendedLifetime(delegate) { app.run() } }
}
