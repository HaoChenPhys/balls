// The on-screen part: one click-through window for the strings and one small
// mouse-accepting window per ball, all floating above normal windows, plus a
// display link that drives the engine while it is awake.
//
// Coordinates: AppKit screen coordinates have the origin at the bottom-left
// of the primary screen with y going up. The engine uses y going down from
// the top of the usable area (just below the menu bar), so every point is
// converted with `toEngine` / `toScreen`.

import AppKit
import QuartzCore

final class OverlayController {
    private let engine: Engine
    private var chain: Chain?
    private var stringWindow: NSWindow?
    private var stringView: StringView?
    private var ballWindows: [NSWindow] = []
    private var displayLink: CADisplayLink?
    private var lastTime: CFTimeInterval = 0
    private var configJSON = "{}"
    private var config: Config?

    // Mapping between engine space and screen space.
    private var originX: CGFloat = 0     // screen x of engine x = 0
    private var topY: CGFloat = 0        // screen y of engine y = 0

    init(engine: Engine) {
        self.engine = engine
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
    }

    // MARK: - lifecycle

    func apply(_ config: Config) {
        self.config = config
        teardown()
        guard config.visible, !config.balls.isEmpty else { return }
        guard let data = try? JSONEncoder().encode(config), let json = String(data: data, encoding: .utf8) else { return }
        configJSON = json
        build()
    }

    @objc private func screensChanged() {
        if let config { apply(config) }
    }

    private func build() {
        guard let config, let screen = NSScreen.screens.first else { return }
        let frame = screen.frame
        let usable = screen.visibleFrame          // excludes the menu bar
        originX = frame.minX
        topY = usable.maxY
        let width = Double(frame.width)
        let height = engine.playAreaHeight(configJSON: configJSON, screenHeight: Double(usable.height))

        let chain = engine.makeChain(configJSON: configJSON, area: ChainArea(
            anchorX: width * config.anchorFrac, anchorY: 0,
            left: 0, right: width, top: 0, bottom: height))
        self.chain = chain

        // String canvas: ignores the mouse entirely, so it is click-through.
        let stringRect = NSRect(x: originX, y: topY - CGFloat(height), width: CGFloat(width), height: CGFloat(height))
        let sw = OverlayController.makeWindow(frame: stringRect)
        sw.ignoresMouseEvents = true
        let sv = StringView(frame: NSRect(origin: .zero, size: stringRect.size))
        sv.controller = self
        sw.contentView = sv
        sw.orderFrontRegardless()
        stringWindow = sw
        stringView = sv

        // Balls: small windows that do take the mouse.
        ballWindows = chain.bodies.enumerated().map { index, body in
            let size = CGFloat(2 * (body.radius + config.grabPad))
            let w = OverlayController.makeWindow(frame: NSRect(x: 0, y: 0, width: size, height: size))
            w.ignoresMouseEvents = false
            let v = BallView(frame: NSRect(x: 0, y: 0, width: size, height: size))
            v.controller = self
            v.index = index
            v.radius = CGFloat(body.radius)
            v.color = body.color
            w.contentView = v
            w.orderFrontRegardless()
            return w
        }

        // Frame clock bound to the string view (macOS 14+). Paused until touched.
        let link = sv.displayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        link.isPaused = true
        displayLink = link

        syncVisuals()
    }

    private func teardown() {
        displayLink?.invalidate()
        displayLink = nil
        for w in ballWindows { w.orderOut(nil); w.contentView = nil }
        ballWindows = []
        stringWindow?.orderOut(nil)
        stringWindow?.contentView = nil
        stringWindow = nil
        stringView = nil
        chain = nil
    }

    private static func makeWindow(frame: NSRect) -> NSWindow {
        let w = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false
        w.level = .floating
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        w.isReleasedWhenClosed = false
        w.isMovableByWindowBackground = false
        return w
    }

    // MARK: - coordinate mapping

    func toEngine(_ p: NSPoint) -> (Double, Double) {
        return (Double(p.x - originX), Double(topY - p.y))
    }

    private func screenOrigin(forBallAt x: Double, _ y: Double, size: CGFloat) -> NSPoint {
        return NSPoint(x: originX + CGFloat(x) - size / 2, y: topY - CGFloat(y) - size / 2)
    }

    // MARK: - frame loop

    private var now: Double { CACurrentMediaTime() }

    private func wake() {
        guard let chain, let link = displayLink else { return }
        chain.wake()
        if link.isPaused {
            lastTime = now
            link.isPaused = false
        }
    }

    @objc private func tick(_ link: CADisplayLink) {
        guard let chain else { return }
        let t = now
        let dt = t - lastTime
        lastTime = t
        let awake = chain.frame(dt)
        syncVisuals()
        if !awake { link.isPaused = true }      // zero CPU until the next touch
    }

    private func syncVisuals() {
        guard let chain else { return }
        for (i, body) in chain.bodies.enumerated() where i < ballWindows.count {
            let w = ballWindows[i]
            w.setFrameOrigin(screenOrigin(forBallAt: body.x, body.y, size: w.frame.width))
        }
        stringView?.needsDisplay = true
    }

    // MARK: - input (from BallView, in screen coordinates)

    func press(ball index: Int, at p: NSPoint) {
        guard let chain, chain.dragIndex < 0 else { return }
        let (x, y) = toEngine(p)
        chain.beginDrag(index, x: x, y: y, t: now)
        wake()
    }

    func drag(to p: NSPoint) {
        guard let chain, chain.dragIndex >= 0 else { return }
        let (x, y) = toEngine(p)
        chain.dragTo(x: x, y: y, t: now)
    }

    func release() {
        guard let chain, chain.dragIndex >= 0 else { return }
        chain.endDrag(t: now)
        wake()
    }

    // MARK: - drawing data for the views

    var segments: [Segment] { chain?.segments() ?? [] }
    var anchor: (Double, Double)? { chain.map { ($0.anchorX, $0.anchorY) } }
    var currentConfig: Config? { config }
}

// MARK: - views

/// Draws the strings and the anchor dot. Flipped so engine coordinates
/// (y down from the top of the window) can be used directly.
final class StringView: NSView {
    weak var controller: OverlayController?

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        guard let controller, let cfg = controller.currentConfig else { return }
        let path = NSBezierPath()
        path.lineWidth = CGFloat(cfg.stringWidth)
        path.lineCapStyle = .round
        for s in controller.segments {
            path.move(to: NSPoint(x: s.ax, y: s.ay))
            if s.straight {
                path.line(to: NSPoint(x: s.bx, y: s.by))
            } else {
                path.curve(to: NSPoint(x: s.bx, y: s.by),
                           controlPoint1: NSPoint(x: s.c1x, y: s.c1y),
                           controlPoint2: NSPoint(x: s.c2x, y: s.c2y))
            }
        }
        color(cfg.stringColor).setStroke()
        path.stroke()

        if let (ax, ay) = controller.anchor {
            let r = CGFloat(cfg.anchorRadius)
            color(cfg.anchorColor).setFill()
            NSBezierPath(ovalIn: NSRect(x: CGFloat(ax) - r, y: CGFloat(ay) + 1 - r, width: 2 * r, height: 2 * r)).fill()
        }
    }
}

/// Draws one ball and forwards mouse events. AppKit keeps sending drags to
/// the view where the press started even after the pointer leaves it, which
/// is exactly the grab behaviour the engine expects.
final class BallView: NSView {
    weak var controller: OverlayController?
    var index = 0
    var radius: CGFloat = 15
    var color: [Double] = [0.9, 0.22, 0.25]

    override var isFlipped: Bool { true }

    /// Deliver the first click directly instead of using it to activate the
    /// window: the toy must never steal focus from the app you are working in.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let cx = bounds.midX, cy = bounds.midY, r = radius
        let (R, G, B) = (CGFloat(color[0]), CGFloat(color[1]), CGFloat(color[2]))

        // Soft shadow, offset down-right.
        NSColor(white: 0, alpha: 0.22).setFill()
        NSBezierPath(ovalIn: NSRect(x: cx + 1.5 - r, y: cy + 2.5 - r, width: 2 * r, height: 2 * r)).fill()

        // Shaded sphere.
        let light = NSColor(red: min(1, R + 0.45), green: min(1, G + 0.45), blue: min(1, B + 0.45), alpha: 1)
        let mid = NSColor(red: R, green: G, blue: B, alpha: 1)
        let dark = NSColor(red: R * 0.55, green: G * 0.55, blue: B * 0.55, alpha: 1)
        let gradient = NSGradient(colorsAndLocations: (light, 0), (mid, 0.6), (dark, 1))!
        let sphere = NSBezierPath(ovalIn: NSRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r))
        // relativeCenterPosition is in -1...1 across the oval's bounds.
        gradient.draw(in: sphere, relativeCenterPosition: NSPoint(x: -0.35, y: -0.4))

        // Rim light.
        NSColor(white: 1, alpha: 0.3).setStroke()
        let rim = NSBezierPath(ovalIn: NSRect(x: cx - r + 0.5, y: cy - r + 0.5, width: 2 * r - 1, height: 2 * r - 1))
        rim.lineWidth = 1
        rim.stroke()
    }

    private func screenPoint(_ event: NSEvent) -> NSPoint {
        guard let window else { return .zero }
        return window.convertPoint(toScreen: event.locationInWindow)
    }

    override func mouseDown(with event: NSEvent) {
        controller?.press(ball: index, at: screenPoint(event))
    }

    override func mouseDragged(with event: NSEvent) {
        controller?.drag(to: screenPoint(event))
    }

    override func mouseUp(with event: NSEvent) {
        controller?.release()
    }
}

private func color(_ c: [Double]) -> NSColor {
    return NSColor(red: CGFloat(c[0]), green: CGFloat(c[1]), blue: CGFloat(c[2]),
                   alpha: c.count > 3 ? CGFloat(c[3]) : 1)
}
