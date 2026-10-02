// Ball on a String, macOS. A menu-bar-only app (no Dock icon, see Info.plist
// LSUIElement) that owns the overlay, the settings window and the config.

import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var engine: Engine!
    private var store: ConfigStore!
    private var overlay: OverlayController!
    private var settings: SettingsWindowController!
    private var statusItem: NSStatusItem!
    private var showItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            engine = try Engine()
            store = try ConfigStore(engine: engine)
        } catch {
            let alert = NSAlert()
            alert.messageText = "Ball on a String could not start"
            alert.informativeText = "\(error)"
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        overlay = OverlayController(engine: engine)
        settings = SettingsWindowController(store: store)
        setUpStatusItem()

        store.onChange = { [weak self] config in
            self?.overlay.apply(config)
            self?.showItem.state = config.visible ? .on : .off
        }
        overlay.apply(store.config)
        showItem.state = store.config.visible ? .on : .off
    }

    func applicationWillTerminate(_ notification: Notification) {
        store?.saveNow()
    }

    // MARK: - menu bar

    private func setUpStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "circle.fill", accessibilityDescription: "Ball on a String")
            button.toolTip = "Ball on a String"
        }
        let menu = NSMenu()
        showItem = NSMenuItem(title: "Show Balls", action: #selector(toggleVisible), keyEquivalent: "")
        showItem.target = self
        menu.addItem(showItem)
        let settingsItem = NSMenuItem(title: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Ball on a String", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        statusItem.menu = menu
    }

    @objc private func toggleVisible() {
        store.config.visible.toggle()
    }

    @objc private func openSettings() {
        settings.show()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)      // menu bar only, no Dock icon
app.run()
