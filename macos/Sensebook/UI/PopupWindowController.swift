import AppKit
import SwiftUI

@MainActor
final class PopupWindowController: NSObject {
    private var window: NSPanel?
    private var host: NSHostingView<PopupView>?

    func show(
        selectedText: String,
        localGloss: String?,
        wordSense: String,
        sentenceGloss: String,
        loading: Bool,
        error: String?,
        stub: Bool = false
    ) {
        let content = PopupContent(
            selectedText: selectedText,
            localGloss: localGloss,
            wordSense: wordSense,
            sentenceGloss: sentenceGloss,
            loading: loading,
            error: error,
            stub: stub
        )
        present(content)
    }

    private func present(_ content: PopupContent) {
        let view = PopupView(
            content: content,
            onSettings: { [weak self] in
                self?.openSettings()
            },
            onClose: { [weak self] in
                self?.window?.orderOut(nil)
            }
        )

        if let host {
            host.rootView = view
        } else {
            let hosting = NSHostingView(rootView: view)
            host = hosting
            let panel = NSPanel(
                contentRect: NSRect(x: 0, y: 0, width: 380, height: 320),
                styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel, .utilityWindow],
                backing: .buffered,
                defer: false
            )
            panel.title = "Sensebook"
            panel.isFloatingPanel = true
            panel.level = .floating
            panel.hidesOnDeactivate = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.isReleasedWhenClosed = false
            panel.contentView = hosting
            window = panel
        }

        guard let window else { return }
        positionNearMouse(window)
        window.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
    }

    private func positionNearMouse(_ window: NSWindow) {
        let mouse = NSEvent.mouseLocation
        var frame = window.frame
        frame.size = window.contentView?.fittingSize ?? frame.size
        if frame.size.width < 360 { frame.size.width = 360 }
        if frame.size.height < 200 { frame.size.height = 280 }
        frame.origin.x = mouse.x - frame.width / 2
        frame.origin.y = mouse.y - frame.height - 12
        if let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main {
            let visible = screen.visibleFrame
            if frame.maxX > visible.maxX { frame.origin.x = visible.maxX - frame.width - 8 }
            if frame.minX < visible.minX { frame.origin.x = visible.minX + 8 }
            if frame.minY < visible.minY { frame.origin.y = mouse.y + 16 }
            if frame.maxY > visible.maxY { frame.origin.y = visible.maxY - frame.height - 8 }
        }
        window.setFrame(frame, display: true)
    }

    private func openSettings() {
        NSApp.activate(ignoringOtherApps: true)
        if #available(macOS 13.0, *) {
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        } else {
            NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        }
    }
}
