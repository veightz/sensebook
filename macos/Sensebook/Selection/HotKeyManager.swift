import AppKit
import Carbon.HIToolbox

/// Global hotkey via Carbon RegisterEventHotKey. Default: ⌥D (Option + D).
final class HotKeyManager {
    typealias Handler = () -> Void

    private let keyCode: UInt32
    private let modifiers: NSEvent.ModifierFlags
    private let handler: Handler
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private var installed = false

    /// Retained so the C callback can reach the Swift handler.
    fileprivate static var active: HotKeyManager?

    init(keyCode: UInt32, modifiers: NSEvent.ModifierFlags, handler: @escaping Handler) {
        self.keyCode = keyCode
        self.modifiers = modifiers
        self.handler = handler
    }

    func register() {
        guard !installed else { return }
        HotKeyManager.active = self

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let installStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            hotKeyEventHandler,
            1,
            &eventType,
            nil,
            &eventHandler
        )
        guard installStatus == noErr else { return }

        var carbonMods: UInt32 = 0
        if modifiers.contains(.command) { carbonMods |= UInt32(cmdKey) }
        if modifiers.contains(.option) { carbonMods |= UInt32(optionKey) }
        if modifiers.contains(.control) { carbonMods |= UInt32(controlKey) }
        if modifiers.contains(.shift) { carbonMods |= UInt32(shiftKey) }

        let hotKeyID = EventHotKeyID(signature: OSType(0x53424B31), id: 1) // 'SBK1'
        let reg = RegisterEventHotKey(
            keyCode,
            carbonMods,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        installed = reg == noErr
    }

    func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        if let eventHandler {
            RemoveEventHandler(eventHandler)
            self.eventHandler = nil
        }
        if HotKeyManager.active === self {
            HotKeyManager.active = nil
        }
        installed = false
    }

    fileprivate func fire() {
        handler()
    }

    deinit {
        unregister()
    }
}

private func hotKeyEventHandler(
    _ nextHandler: EventHandlerCallRef?,
    _ event: EventRef?,
    _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
    var hotKeyID = EventHotKeyID()
    let err = GetEventParameter(
        event,
        EventParamName(kEventParamDirectObject),
        EventParamType(typeEventHotKeyID),
        nil,
        MemoryLayout<EventHotKeyID>.size,
        nil,
        &hotKeyID
    )
    if err == noErr, hotKeyID.id == 1 {
        DispatchQueue.main.async {
            HotKeyManager.active?.fire()
        }
    }
    return noErr
}
