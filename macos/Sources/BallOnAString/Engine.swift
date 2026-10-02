// Bridge to the shared JavaScript engine (engine/physics.js, engine/config.js)
// through JavaScriptCore, the JS engine that ships with macOS.
//
// The engine files are ES modules (they use `export`). JavaScriptCore's
// classic script loader does not know that keyword, so the word is stripped
// before evaluation; everything else is loaded unchanged.

import Foundation
import JavaScriptCore

enum EngineError: Error, CustomStringConvertible {
    case fileNotFound(String)
    case jsException(String)

    var description: String {
        switch self {
        case .fileNotFound(let name):
            return "engine file \(name) not found (run build.sh, or `swift run` from the macos/ folder of the repository)"
        case .jsException(let message):
            return "JavaScript error: \(message)"
        }
    }
}

final class Engine {
    let context: JSContext
    private var lastException: String?

    init() throws {
        guard let context = JSContext() else { throw EngineError.jsException("could not create JSContext") }
        self.context = context
        context.exceptionHandler = { [weak self] _, exception in
            let text = exception?.toString() ?? "unknown"
            self?.lastException = text
            NSLog("ball-on-a-string: JS exception: %@", text)
        }
        // Give the engine `log`/`console.log` so any diagnostics reach Console.app.
        let log: @convention(block) (String) -> Void = { NSLog("ball-on-a-string(js): %@", $0) }
        context.setObject(log, forKeyedSubscript: "log" as NSString)

        for name in ["config.js", "physics.js"] {
            let url = try Engine.locate(name)
            var source = try String(contentsOf: url, encoding: .utf8)
            source = source.replacingOccurrences(of: "(?m)^export ", with: "", options: .regularExpression)
            context.evaluateScript(source, withSourceURL: url)
            if let e = lastException { throw EngineError.jsException("\(name): \(e)") }
        }
        // Fail loudly at startup rather than with cryptic errors later.
        for name in ["DEFAULTS", "PALETTE", "parseConfig", "playAreaHeight", "Chain"] where global(name).isUndefined {
            throw EngineError.jsException("\(name) is not defined after loading the engine files")
        }
    }

    /// Where the engine files live: the app bundle's Resources when running as
    /// an .app, otherwise the repository's engine/ folder (for `swift run`).
    private static func locate(_ name: String) throws -> URL {
        var candidates: [URL] = []
        if let res = Bundle.main.resourceURL {
            candidates.append(res.appendingPathComponent(name))
        }
        // #filePath = .../macos/Sources/BallOnAString/Engine.swift
        let thisFile = URL(fileURLWithPath: #filePath)
        let repoRoot = thisFile.deletingLastPathComponent()   // BallOnAString
            .deletingLastPathComponent()                      // Sources
            .deletingLastPathComponent()                      // macos
            .deletingLastPathComponent()                      // repo root
        candidates.append(repoRoot.appendingPathComponent("engine").appendingPathComponent(name))
        for url in candidates where FileManager.default.fileExists(atPath: url.path) {
            return url
        }
        throw EngineError.fileNotFound(name)
    }

    // MARK: - config.js

    /// Parse config text with the shared validation; returns the merged
    /// config as JSON text plus any warnings.
    func parseConfig(_ text: String) -> (json: String, warnings: [String]) {
        let result = global("parseConfig").call(withArguments: [text])!
        let cfg = result.atIndex(0)!
        let warnings = result.atIndex(1)!.toArray() as? [String] ?? []
        let json = global("JSON").invokeMethod("stringify", withArguments: [cfg])!.toString()!
        return (json, warnings)
    }

    func defaultsJSON() -> String {
        return parseConfig("{}").json
    }

    func palette() -> [[Double]] {
        return global("PALETTE").toArray() as? [[Double]] ?? [[0.9, 0.22, 0.25]]
    }

    // MARK: - physics.js

    func playAreaHeight(configJSON: String, screenHeight: Double) -> Double {
        let cfg = jsObject(fromJSON: configJSON)
        return global("playAreaHeight")
            .call(withArguments: [cfg, screenHeight])!.toDouble()
    }

    func makeChain(configJSON: String, area: ChainArea) -> Chain {
        let cfg = jsObject(fromJSON: configJSON)
        let areaDict: [String: Double] = [
            "anchorX": area.anchorX, "anchorY": area.anchorY,
            "left": area.left, "right": area.right, "top": area.top, "bottom": area.bottom,
        ]
        let js = global("Chain").construct(withArguments: [cfg, areaDict])!
        return Chain(js: js)
    }

    /// Look up a top-level name from the engine scripts. Must be done by
    /// evaluating the name, not via objectForKeyedSubscript on the global
    /// object: in a classic script, top-level `const` and `class` declarations
    /// (DEFAULTS, PALETTE, Chain) live in the script scope and are NOT
    /// properties of the global object, while `function` declarations are.
    private func global(_ name: String) -> JSValue {
        return context.evaluateScript(name)
    }

    private func jsObject(fromJSON text: String) -> JSValue {
        return global("JSON").invokeMethod("parse", withArguments: [text])!
    }
}

struct ChainArea {
    var anchorX: Double, anchorY: Double
    var left: Double, right: Double, top: Double, bottom: Double
}

struct Body {
    var x: Double, y: Double
    var radius: Double
    var color: [Double]
}

struct Segment {
    var ax: Double, ay: Double, bx: Double, by: Double
    var straight: Bool
    var c1x: Double = 0, c1y: Double = 0, c2x: Double = 0, c2y: Double = 0
}

/// Thin Swift face over a JS `Chain` instance. Positions are in engine
/// coordinates (pixels, y down, origin chosen by the caller).
final class Chain {
    let js: JSValue

    init(js: JSValue) { self.js = js }

    var anchorX: Double { js.forProperty("anchorX").toDouble() }
    var anchorY: Double { js.forProperty("anchorY").toDouble() }
    var dragIndex: Int { Int(js.forProperty("dragIndex").toInt32()) }
    var awake: Bool { js.forProperty("awake").toBool() }

    var bodies: [Body] {
        guard let raw = js.forProperty("bodies").toArray() as? [[String: Any]] else { return [] }
        return raw.map { b in
            Body(x: num(b["x"]), y: num(b["y"]), radius: num(b["radius"]),
                 color: (b["color"] as? [Any])?.map { num($0) } ?? [1, 1, 1])
        }
    }

    func segments() -> [Segment] {
        guard let raw = js.invokeMethod("segments", withArguments: []).toArray() as? [[String: Any]] else { return [] }
        return raw.map { s in
            var seg = Segment(ax: num(s["ax"]), ay: num(s["ay"]), bx: num(s["bx"]), by: num(s["by"]),
                              straight: (s["straight"] as? Bool) ?? true)
            if !seg.straight {
                seg.c1x = num(s["c1x"]); seg.c1y = num(s["c1y"])
                seg.c2x = num(s["c2x"]); seg.c2y = num(s["c2y"])
            }
            return seg
        }
    }

    /// Advance by dt seconds. Returns false on the frame the chain falls asleep.
    @discardableResult
    func frame(_ dt: Double) -> Bool { js.invokeMethod("frame", withArguments: [dt]).toBool() }
    func wake() { js.invokeMethod("wake", withArguments: []) }
    @discardableResult
    func beginDrag(_ i: Int, x: Double, y: Double, t: Double) -> Bool {
        js.invokeMethod("beginDrag", withArguments: [i, x, y, t]).toBool()
    }
    func dragTo(x: Double, y: Double, t: Double) { js.invokeMethod("dragTo", withArguments: [x, y, t]) }
    func endDrag(t: Double) { js.invokeMethod("endDrag", withArguments: [t]) }
    func cancelDrag() { js.invokeMethod("cancelDrag", withArguments: []) }

    private func num(_ v: Any?) -> Double {
        if let d = v as? Double { return d }
        if let n = v as? NSNumber { return n.doubleValue }
        return 0
    }
}
