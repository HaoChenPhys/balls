// Tests for the Swift <-> JavaScriptCore bridge and the Config mirror.
// Run with `swift test` from macos/ (needs Xcode or a runner with XCTest;
// the bare command-line tools do not include XCTest).
//
// These would have caught the "undefined is not an object" startup failure:
// `Chain` and `PALETTE` are script-scope declarations in a classic script and
// must be looked up by evaluation, not as global-object properties.

import XCTest
@testable import BallOnAString

final class EngineTests: XCTestCase {
    func testEngineLoadsAndExposesEveryName() throws {
        let engine = try Engine()
        for name in ["DEFAULTS", "PALETTE", "parseConfig", "playAreaHeight", "Chain"] {
            XCTAssertFalse(engine.context.evaluateScript(name).isUndefined, "\(name) should be defined")
        }
        XCTAssertGreaterThanOrEqual(engine.palette().count, 3)
    }

    func testParseConfigMergesAndWarns() throws {
        let engine = try Engine()
        let (json, warnings) = engine.parseConfig(#"{"damping": 1.5, "balls": [{"radius": 30}], "bogus": 1}"#)
        let cfg = try JSONDecoder().decode(Config.self, from: Data(json.utf8))
        XCTAssertEqual(cfg.damping, 1.5)
        XCTAssertEqual(cfg.balls.count, 1)
        XCTAssertEqual(cfg.balls[0].radius, 30)
        XCTAssertEqual(cfg.balls[0].mass, 1.0, "missing per-ball fields fall back to the default ball")
        XCTAssertTrue(warnings.contains { $0.contains("bogus") })
    }

    func testBrokenConfigYieldsDefaults() throws {
        let engine = try Engine()
        let (json, warnings) = engine.parseConfig("{ nope")
        let cfg = try JSONDecoder().decode(Config.self, from: Data(json.utf8))
        XCTAssertEqual(cfg.gravity, 2200)
        XCTAssertEqual(warnings.count, 1)
    }

    func testDefaultsDecodeIntoConfigAndRoundTrip() throws {
        let engine = try Engine()
        let cfg = try JSONDecoder().decode(Config.self, from: Data(engine.defaultsJSON().utf8))
        XCTAssertTrue(cfg.visible)
        XCTAssertEqual(cfg.balls.count, 2)
        // Encode -> parse through the engine -> decode: nothing lost, no warnings.
        let encoded = try JSONEncoder().encode(cfg)
        let (json, warnings) = engine.parseConfig(String(decoding: encoded, as: UTF8.self))
        XCTAssertTrue(warnings.isEmpty, "\(warnings)")
        let again = try JSONDecoder().decode(Config.self, from: Data(json.utf8))
        XCTAssertEqual(again.balls.map(\.radius), cfg.balls.map(\.radius))
        XCTAssertEqual(again.stringColor, cfg.stringColor)
    }

    func testChainBuildsRunsAndSleeps() throws {
        let engine = try Engine()
        let json = engine.defaultsJSON()
        let height = engine.playAreaHeight(configJSON: json, screenHeight: 900)
        XCTAssertEqual(height, 636)
        let chain = engine.makeChain(configJSON: json, area: ChainArea(
            anchorX: 720, anchorY: 0, left: 0, right: 1440, top: 0, bottom: height))
        XCTAssertEqual(chain.bodies.count, 2)
        XCTAssertEqual(chain.segments().count, 2)
        XCTAssertFalse(chain.awake)
        XCTAssertEqual(chain.bodies[0].x, 720)
        XCTAssertEqual(chain.bodies[0].y, 150 + 1.6 * 2200 / 180, accuracy: 1e-9)

        // Drag the bottom ball sideways, release, run until asleep.
        let start = chain.bodies[1]
        XCTAssertTrue(chain.beginDrag(1, x: start.x, y: start.y, t: 0))
        XCTAssertEqual(chain.dragIndex, 1)
        var t = 0.0
        for i in 1...20 {
            t += 1.0 / 60
            chain.dragTo(x: start.x + Double(i) * 20, y: start.y, t: t)
            chain.frame(1.0 / 60)
        }
        chain.endDrag(t: t)
        XCTAssertEqual(chain.dragIndex, -1)
        var frames = 0
        while chain.awake && frames < 60 * 120 {
            chain.frame(1.0 / 60)
            frames += 1
        }
        XCTAssertFalse(chain.awake)
        XCTAssertGreaterThan(frames, 60 * 3)
        XCTAssertLessThan(frames, 60 * 60)
        XCTAssertEqual(chain.bodies[0].x, 720, accuracy: 1e-6)
    }
}
