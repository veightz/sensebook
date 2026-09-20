import SwiftUI

@main
struct SensebookApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        // Menu-bar–only app: no Dock / main window (LSUIElement).
        Settings {
            SettingsView()
                .frame(minWidth: 420, minHeight: 360)
        }
    }
}
