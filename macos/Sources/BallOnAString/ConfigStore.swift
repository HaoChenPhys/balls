// The configuration as seen from Swift: a Codable mirror of engine/config.js
// DEFAULTS (field names must match), loaded through the engine's shared
// validation and written back as JSON to the same file the GNOME version
// uses, ~/.config/ball-on-a-string.json.

import Combine
import Foundation

struct BallConfig: Codable, Identifiable, Equatable {
    var id = UUID()                     // UI identity only, not written to disk
    var radius: Double
    var mass: Double
    var restLength: Double
    var k: Double
    var color: [Double]

    enum CodingKeys: String, CodingKey { case radius, mass, restLength, k, color }
}

struct Config: Codable, Equatable {
    var visible: Bool
    var showOnLogin: Bool      // used by the GNOME layer; kept here so saving never drops it
    var anchorFrac: Double
    var anchorRadius: Double
    var anchorColor: [Double]
    var balls: [BallConfig]
    var grabPad: Double
    var gravity: Double
    var damping: Double
    var substeps: Double
    var maxDt: Double
    var restitution: Double
    var ballCollisions: Bool
    var ballRestitution: Double
    var restingSpeed: Double
    var collisionPasses: Double
    var maxThrowSpeed: Double
    var velSmoothing: Double
    var staleReleaseSec: Double
    var sleepSpeed: Double
    var sleepDist: Double
    var sleepHold: Double
    var swingHeight: Double
    var stringWidth: Double
    var stringColor: [Double]
}

final class ConfigStore: ObservableObject {
    static let path: URL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".config").appendingPathComponent("ball-on-a-string.json")

    @Published var config: Config {
        didSet { if !suppressNextChange && config != oldValue { scheduleSave() } }
    }

    /// Called (on the main thread) whenever the config changed, from the UI or
    /// from an external edit of the file.
    var onChange: ((Config) -> Void)?

    private let engine: Engine
    private var saveWork: DispatchWorkItem?
    private var pollTimer: Timer?
    private var knownModificationDate: Date?
    private var suppressNextChange = false

    init(engine: Engine) throws {
        self.engine = engine
        self.config = try ConfigStore.load(engine: engine)
        self.knownModificationDate = ConfigStore.modificationDate()
        // Poll the file's modification date: cheap, and robust against editors
        // that replace the file (which breaks vnode watchers).
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.pollFile()
        }
    }

    deinit { pollTimer?.invalidate() }

    // MARK: - load / save

    private static func load(engine: Engine) throws -> Config {
        var text = "{}"
        if let data = try? Data(contentsOf: path), let s = String(data: data, encoding: .utf8) {
            text = s
        }
        let (json, warnings) = engine.parseConfig(text)
        for w in warnings { NSLog("ball-on-a-string: %@", w) }
        return try JSONDecoder().decode(Config.self, from: Data(json.utf8))
    }

    private static func modificationDate() -> Date? {
        return (try? FileManager.default.attributesOfItem(atPath: path.path))?[.modificationDate] as? Date
    }

    private func scheduleSave() {
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveNow() }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
        onChange?(config)
    }

    func saveNow() {
        saveWork?.cancel()
        saveWork = nil
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            var data = try encoder.encode(config)
            data.append(0x0A)
            let dir = ConfigStore.path.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try data.write(to: ConfigStore.path, options: .atomic)
            knownModificationDate = ConfigStore.modificationDate()
        } catch {
            NSLog("ball-on-a-string: could not write config: %@", "\(error)")
        }
    }

    /// Reload from disk (external edit) without writing it back.
    func reloadFromDisk() {
        guard let fresh = try? ConfigStore.load(engine: engine) else { return }
        knownModificationDate = ConfigStore.modificationDate()
        if fresh != config {
            saveWork?.cancel()
            saveWork = nil
            // Assign without triggering a save: temporarily detach didSet logic.
            suppressNextChange = true
            config = fresh
            suppressNextChange = false
            onChange?(config)
        }
    }

    private func pollFile() {
        let date = ConfigStore.modificationDate()
        if date != knownModificationDate {
            reloadFromDisk()
        }
    }

    // MARK: - helpers for the UI

    func resetToDefaults() {
        if let fresh = try? JSONDecoder().decode(Config.self, from: Data(engine.defaultsJSON().utf8)) {
            config = fresh
        }
    }

    func addBall() {
        let palette = engine.palette()
        var ball = config.balls.last ?? BallConfig(radius: 15, mass: 1, restLength: 150, k: 180, color: palette[0])
        ball.id = UUID()
        ball.color = palette[config.balls.count % palette.count]
        config.balls.append(ball)
    }

    func removeBall(id: UUID) {
        guard config.balls.count > 1 else { return }
        config.balls.removeAll { $0.id == id }
    }
}
