// The settings window: a SwiftUI form bound to the ConfigStore. Every change
// is saved to ~/.config/ball-on-a-string.json and applied to the overlay
// immediately, mirroring the GNOME preferences window.

import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: ConfigStore

    var body: some View {
        Form {
            Section("General") {
                Toggle("Show the balls", isOn: $store.config.visible)
                    .help("Turn off to hide the toy. It stays hidden after login until turned on again.")
                slider("Anchor position", value: $store.config.anchorFrac, in: 0...1, step: 0.05, digits: 2,
                       help: "0 = left edge, 0.5 = centre, 1 = right edge")
                slider("Play area height", value: $store.config.swingHeight, in: 0...3000, step: 10, digits: 0,
                       help: "Pixels from the top edge the balls can reach; 0 = automatic")
                ColorRow(title: "String colour", color: $store.config.stringColor, withAlpha: true)
                slider("String width", value: $store.config.stringWidth, in: 0.5...10, step: 0.1, digits: 1)
            }

            Section("Physics") {
                slider("Gravity", value: $store.config.gravity, in: 0...20000, step: 100, digits: 0,
                       help: "Pixels per second squared")
                slider("Damping", value: $store.config.damping, in: 0...20, step: 0.1, digits: 2,
                       help: "Higher settles sooner: 0.6 ≈ 20 s, 1.5 ≈ 8 s")
                slider("Edge bounciness", value: $store.config.restitution, in: 0...1, step: 0.05, digits: 2,
                       help: "Velocity kept when hitting the screen edges or floor")
                slider("Maximum throw speed", value: $store.config.maxThrowSpeed, in: 100...20000, step: 100, digits: 0)
                Toggle("Ball collisions", isOn: $store.config.ballCollisions)
                slider("Ball bounciness", value: $store.config.ballRestitution, in: 0...1, step: 0.05, digits: 2,
                       help: "Velocity kept in ball-to-ball hits")
                    .disabled(!store.config.ballCollisions)
            }

            Section {
                ForEach($store.config.balls) { $ball in
                    BallSection(ball: $ball, index: index(of: ball.id), canRemove: store.config.balls.count > 1) {
                        store.removeBall(id: ball.id)
                    }
                }
                Button {
                    store.addBall()
                } label: {
                    Label("Add a ball below the last one", systemImage: "plus.circle")
                }
            } header: {
                Text("Balls")
            } footer: {
                Text("Top to bottom. Each string length and stiffness refers to the string above that ball. Keep a string longer than the two touching radii.")
                    .font(.footnote).foregroundStyle(.secondary)
            }

            Section {
                Button(role: .destructive) {
                    store.resetToDefaults()
                } label: {
                    Label("Reset everything to defaults", systemImage: "arrow.counterclockwise")
                }
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 480, minHeight: 520)
    }

    private func index(of id: UUID) -> Int {
        store.config.balls.firstIndex { $0.id == id } ?? 0
    }
}

private struct BallSection: View {
    @Binding var ball: BallConfig
    let index: Int
    let canRemove: Bool
    let onRemove: () -> Void

    var body: some View {
        DisclosureGroup {
            slider("Radius", value: $ball.radius, in: 3...150, step: 1, digits: 0, help: "Pixels")
            slider("Mass", value: $ball.mass, in: 0.05...50, step: 0.05, digits: 2)
            slider("String length", value: $ball.restLength, in: 10...2000, step: 5, digits: 0, help: "Pixels, unstretched")
            slider("String stiffness", value: $ball.k, in: 5...5000, step: 5, digits: 0, help: "Spring constant; higher = snappier")
            ColorRow(title: "Colour", color: $ball.color, withAlpha: false)
            Button(role: .destructive, action: onRemove) {
                Label("Remove this ball", systemImage: "trash")
            }
            .disabled(!canRemove)
            .help(canRemove ? "Remove" : "The chain needs at least one ball")
        } label: {
            HStack {
                Circle().fill(swiftColor(ball.color)).frame(width: 14, height: 14)
                Text("Ball \(index + 1)")
                Spacer()
                Text("radius \(Int(ball.radius)) px · mass \(ball.mass, specifier: "%.2f") · string \(Int(ball.restLength)) px")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

private struct ColorRow: View {
    let title: String
    @Binding var color: [Double]
    let withAlpha: Bool

    var body: some View {
        ColorPicker(title, selection: Binding(
            get: { swiftColor(color) },
            set: { newValue in
                let c = NSColor(newValue).usingColorSpace(.sRGB) ?? NSColor(newValue)
                var out = [round3(c.redComponent), round3(c.greenComponent), round3(c.blueComponent)]
                if withAlpha { out.append(round3(c.alphaComponent)) }
                color = out
            }), supportsOpacity: withAlpha)
    }
}

private func slider(_ title: String, value: Binding<Double>, in range: ClosedRange<Double>, step: Double,
                    digits: Int, help: String? = nil) -> some View {
    VStack(alignment: .leading, spacing: 2) {
        HStack {
            Text(title)
            Spacer()
            Text(String(format: "%.\(digits)f", value.wrappedValue))
                .monospacedDigit().foregroundStyle(.secondary)
        }
        Slider(value: value, in: range, step: step)
        if let help {
            Text(help).font(.footnote).foregroundStyle(.secondary)
        }
    }
    .padding(.vertical, 2)
}

private func swiftColor(_ c: [Double]) -> Color {
    Color(.sRGB, red: c[0], green: c[1], blue: c[2], opacity: c.count > 3 ? c[3] : 1)
}

private func round3(_ v: CGFloat) -> Double {
    (Double(v) * 1000).rounded() / 1000
}

/// Hosts SettingsView in a normal, resizable window; reused if already open.
final class SettingsWindowController {
    private var window: NSWindow?
    private let store: ConfigStore

    init(store: ConfigStore) { self.store = store }

    func show() {
        if window == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 720),
                             styleMask: [.titled, .closable, .resizable, .miniaturizable],
                             backing: .buffered, defer: false)
            w.title = "Ball on a String"
            w.contentViewController = NSHostingController(rootView: SettingsView(store: store))
            w.isReleasedWhenClosed = false
            w.center()
            window = w
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}
