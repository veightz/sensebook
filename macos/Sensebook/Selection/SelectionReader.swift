import AppKit
import ApplicationServices

/// Reads the current selection via Accessibility (AX), with Cmd+C pasteboard fallback (Bob-like).
actor SelectionReader {
    static let shared = SelectionReader()

    func readSelectedText() async -> String {
        if let ax = readViaAccessibility(), !ax.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return ax
        }
        return await MainActor.run { Self.readViaPasteboardCopy() }
    }

    // MARK: - Accessibility

    private func readViaAccessibility() -> String? {
        let trusted = AXIsProcessTrustedWithOptions(
            [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        )
        guard trusted else { return nil }

        let system = AXUIElementCreateSystemWide()
        var focusedRef: CFTypeRef?
        let focusErr = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focusedRef)
        guard focusErr == .success, let focused = focusedRef else { return nil }
        let element = focused as! AXUIElement

        if let selected = copyStringAttribute(element, kAXSelectedTextAttribute as CFString),
           !selected.isEmpty {
            return selected
        }

        // Some apps expose selection via AXSelectedTextRange + AXValue
        var rangeRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rangeRef) == .success,
           let rangeValue = rangeRef {
            var selectedRef: CFTypeRef?
            if AXUIElementCopyParameterizedAttributeValue(
                element,
                kAXStringForRangeParameterizedAttribute as CFString,
                rangeValue,
                &selectedRef
            ) == .success,
               let s = selectedRef as? String,
               !s.isEmpty {
                return s
            }
        }
        return nil
    }

    private func copyStringAttribute(_ element: AXUIElement, _ attr: CFString) -> String? {
        var ref: CFTypeRef?
        let err = AXUIElementCopyAttributeValue(element, attr, &ref)
        guard err == .success, let ref else { return nil }
        return ref as? String
    }

    // MARK: - Pasteboard fallback (simulate ⌘C)

    @MainActor
    private static func readViaPasteboardCopy() -> String {
        let pb = NSPasteboard.general
        let saved = pb.pasteboardItems?.compactMap { item -> NSPasteboardItem? in
            let clone = NSPasteboardItem()
            for type in item.types {
                if let data = item.data(forType: type) {
                    clone.setData(data, forType: type)
                }
            }
            return clone
        }

        pb.clearContents()

        let src = CGEventSource(stateID: .hidSystemState)
        let keyDown = CGEvent(keyboardEventSource: src, virtualKey: 0x08, keyDown: true) // C
        let keyUp = CGEvent(keyboardEventSource: src, virtualKey: 0x08, keyDown: false)
        keyDown?.flags = .maskCommand
        keyUp?.flags = .maskCommand
        keyDown?.post(tap: .cghidEventTap)
        keyUp?.post(tap: .cghidEventTap)

        // Brief wait for the frontmost app to update the pasteboard
        let deadline = Date().addingTimeInterval(0.25)
        var text = ""
        while Date() < deadline {
            if let s = pb.string(forType: .string), !s.isEmpty {
                text = s
                break
            }
            Thread.sleep(forTimeInterval: 0.02)
        }

        pb.clearContents()
        if let saved, !saved.isEmpty {
            pb.writeObjects(saved)
        }
        return text
    }
}
