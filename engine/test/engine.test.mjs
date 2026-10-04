// Unit tests for the shared engine. Pure Node, no dependencies:
//     node --test engine/test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

import {Chain, playAreaHeight, segmentGeometry} from '../physics.js';
import {DEFAULTS, PALETTE, deepCopy, mergeConfig, parseConfig, serializeConfig} from '../config.js';

const FPS = 60;
const DT = 1 / FPS;

function makeChain(overrides = {}, width = 1920, height = 1080) {
    const cfg = {...deepCopy(DEFAULTS), ...overrides};
    const bottom = playAreaHeight(cfg, height);
    const chain = new Chain(cfg, {anchorX: width / 2, anchorY: 0, left: 0, right: width, top: 0, bottom});
    return {cfg, chain};
}

/** Run frames until the chain sleeps; returns seconds elapsed. */
function runUntilAsleep(chain, maxSeconds = 120) {
    let frames = 0;
    while (chain.awake && frames < maxSeconds * FPS) {
        chain.frame(DT);
        frames++;
    }
    return frames / FPS;
}

// ------------------------------------------------------------------ statics
test('resting positions: each string stretched by the weight below it', () => {
    const {cfg, chain} = makeChain();
    const [b0, b1] = chain.bodies;
    const g = cfg.gravity;
    const [c0, c1] = cfg.balls;
    const y0 = c0.restLength + (c0.mass + c1.mass) * g / c0.k;
    const y1 = y0 + c1.restLength + c1.mass * g / c1.k;
    assert.equal(b0.x, 960);
    assert.ok(Math.abs(b0.y - y0) < 1e-9, `${b0.y} vs ${y0}`);
    assert.ok(Math.abs(b1.y - y1) < 1e-9, `${b1.y} vs ${y1}`);
    assert.equal(chain.awake, false, 'a fresh chain is asleep');
});

test('playAreaHeight: automatic from resting depth, explicit when set, clamped to the screen', () => {
    const cfg = deepCopy(DEFAULTS);
    assert.equal(playAreaHeight(cfg, 1080), 636);
    assert.equal(playAreaHeight({...cfg, swingHeight: 400}, 1080), 400);
    assert.equal(playAreaHeight(cfg, 300), 299);
});

test('segmentGeometry: straight when taut, sagging cubic when slack', () => {
    assert.equal(segmentGeometry(0, 0, 0, 200, 150).straight, true);
    const slack = segmentGeometry(0, 0, 0, 100, 150);
    assert.equal(slack.straight, false);
    assert.ok(slack.c1y > 0 && slack.c2y > slack.by - 0.01, 'control points hang below the endpoints');
});

// ------------------------------------------------------------------ dynamics
test('a disturbed chain settles back to equilibrium and sleeps', () => {
    const {chain} = makeChain();
    const b1 = chain.bodies[1];
    let t = 0;
    chain.beginDrag(1, b1.x, b1.y, t);
    for (let i = 1; i <= 20; i++) {
        t += DT;
        chain.dragTo(b1.eqX + i * 20, b1.eqY + i * 3, t);
        chain.frame(DT);
    }
    assert.ok(chain.bodies[0].x > 1100, 'the top ball is pulled along while the bottom one is dragged');
    chain.endDrag(t);
    const seconds = runUntilAsleep(chain);
    assert.ok(seconds > 5 && seconds < 30, `settled in ${seconds} s`);
    for (const b of chain.bodies) {
        assert.equal(b.x, b.eqX);
        assert.equal(b.y, b.eqY);
        assert.equal(b.vx, 0);
        assert.equal(b.vy, 0);
    }
    assert.equal(chain.awake, false);
});

test('higher damping settles faster', () => {
    const settle = damping => {
        const {chain} = makeChain({damping});
        const b0 = chain.bodies[0];
        b0.x += 300;
        b0.y += 100;
        chain.wake();
        return runUntilAsleep(chain);
    };
    const slow = settle(0.6), fast = settle(1.5);
    assert.ok(fast < slow, `${fast} < ${slow}`);
    assert.ok(slow > 10 && slow < 30, `c=0.6 -> ${slow} s`);
    assert.ok(fast > 4 && fast < 15, `c=1.5 -> ${fast} s`);
});

test('a throw is capped at maxThrowSpeed and a still release does not throw', () => {
    const {cfg, chain} = makeChain();
    const b0 = chain.bodies[0];
    let t = 0;
    chain.beginDrag(0, b0.x, b0.y, t);
    for (let i = 0; i < 5; i++) {
        t += 0.008;
        chain.dragTo(b0.x + 60, b0.y, t);
    }
    chain.endDrag(t);
    assert.ok(Math.abs(Math.hypot(b0.vx, b0.vy) - cfg.maxThrowSpeed) < 1e-6);

    const {chain: c2} = makeChain();
    const d = c2.bodies[0];
    c2.beginDrag(0, d.x, d.y, 0);
    c2.dragTo(d.x + 100, d.y, 0.016);
    c2.endDrag(0.016 + cfg.staleReleaseSec + 0.1);   // held still, then released
    assert.equal(d.vx, 0);
    assert.equal(d.vy, 0);
});

test('balls stay inside the play area', () => {
    const {chain} = makeChain();
    const b0 = chain.bodies[0];
    b0.vx = 4000;
    b0.vy = -3000;
    chain.wake();
    for (let i = 0; i < 10 * FPS; i++) {
        chain.frame(DT);
        for (const b of chain.bodies) {
            assert.ok(b.x >= b.radius - 1e-6 && b.x <= 1920 - b.radius + 1e-6, `x ${b.x}`);
            assert.ok(b.y >= b.radius - 1e-6 && b.y <= chain.area.bottom - b.radius + 1e-6, `y ${b.y}`);
            assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
        }
    }
});

test('a huge dt is clamped so the integrator cannot explode', () => {
    const {chain} = makeChain();
    chain.bodies[0].x += 200;
    chain.wake();
    for (let i = 0; i < 50; i++)
        chain.frame(2.0);
    for (const b of chain.bodies)
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Math.abs(b.vx) < 1e5);
});

// ---------------------------------------------------------------- collisions
test('ball collisions: a direct hit transfers momentum and leaves no overlap', () => {
    const {chain} = makeChain();
    const [red, blue] = chain.bodies;
    blue.x = red.x - 100;
    blue.y = red.y;
    blue.vx = 1500;
    chain.wake();
    let hit = false;
    for (let f = 0; f < 20 && !hit; f++) {
        chain.frame(DT);
        if (red.vx > 50)
            hit = true;
    }
    assert.ok(hit, 'the red ball was set in motion');
    assert.ok(blue.vx < 200, 'the lighter ball gives up most of its velocity');
    assert.ok(Math.hypot(red.x - blue.x, red.y - blue.y) >= red.radius + blue.radius - 0.01);
});

test('ball collisions off: balls pass through each other', () => {
    const {chain} = makeChain({ballCollisions: false});
    const [red, blue] = chain.bodies;
    blue.x = red.x - 100;
    blue.y = red.y;
    blue.vx = 1500;
    chain.wake();
    let minDist = Infinity;
    for (let f = 0; f < 20; f++) {
        chain.frame(DT);
        minDist = Math.min(minDist, Math.hypot(red.x - blue.x, red.y - blue.y));
    }
    assert.ok(minDist < red.radius + blue.radius - 5, `overlapped (min distance ${minDist.toFixed(1)})`);
});

test('a ball pushed on top of another comes to rest there and the chain sleeps', () => {
    const {chain} = makeChain();
    const [red, blue] = chain.bodies;
    let t = 0;
    chain.beginDrag(1, blue.x, blue.y, t);
    for (let i = 1; i <= 60; i++) {
        t += DT;
        chain.dragTo(blue.eqX, blue.eqY - i * 6, t);
        chain.frame(DT);
    }
    chain.endDrag(t);
    const seconds = runUntilAsleep(chain);
    assert.ok(seconds < 60, `slept after ${seconds} s`);
    assert.equal(chain.awake, false);
    assert.ok(blue.y < red.y, 'blue rests above red');
    assert.ok(Math.abs(Math.hypot(red.x - blue.x, red.y - blue.y) - (red.radius + blue.radius)) < 0.5);
});

test('cancelDrag drops the ball with no throw', () => {
    const {chain} = makeChain();
    const b0 = chain.bodies[0];
    chain.beginDrag(0, b0.x, b0.y, 0);
    chain.dragTo(b0.x + 200, b0.y, 0.016);
    chain.cancelDrag();
    assert.equal(chain.dragIndex, -1);
    assert.equal(b0.vx, 0);
    assert.ok(chain.awake);
});

// -------------------------------------------------------------------- config
test('mergeConfig: overrides, per-ball fallbacks, warnings for junk', () => {
    const [cfg, warnings] = mergeConfig({damping: 1.5, balls: [{radius: 30}], bogus: 1, gravity: 'fast'});
    assert.equal(cfg.damping, 1.5);
    assert.equal(cfg.balls.length, 1);
    assert.equal(cfg.balls[0].radius, 30);
    assert.equal(cfg.balls[0].mass, DEFAULTS.balls[0].mass);
    assert.equal(cfg.gravity, DEFAULTS.gravity);
    assert.ok(warnings.some(w => w.includes('bogus')));
    assert.ok(warnings.some(w => w.includes('gravity')));
});

test('mergeConfig: empty balls list and non-object input fall back to defaults', () => {
    assert.equal(mergeConfig({balls: []})[0].balls.length, 2);
    assert.equal(mergeConfig([1, 2])[0].damping, DEFAULTS.damping);
    assert.equal(mergeConfig(null)[1].length, 1);
});

test('parseConfig / serializeConfig round-trip; broken JSON yields defaults plus a warning', () => {
    const [cfg] = parseConfig(serializeConfig({...deepCopy(DEFAULTS), visible: false}));
    assert.equal(cfg.visible, false);
    assert.equal(cfg.showOnLogin, false, 'hidden at login is the default');
    assert.equal(parseConfig('{"showOnLogin": true}')[0].showOnLogin, true);
    assert.equal(parseConfig('{"showOnLogin": "yes"}')[1].length, 1, 'wrong type is rejected with a warning');
    const [bad, warnings] = parseConfig('{ nope');
    assert.equal(bad.damping, DEFAULTS.damping);
    assert.equal(warnings.length, 1);
    assert.ok(PALETTE.length >= 3);
});

// --------------------------------------------- the way macOS loads the engine
test('engine files load as classic scripts with "export" stripped (JavaScriptCore path)', () => {
    const ctx = vm.createContext({log: () => {}});
    for (const f of ['config.js', 'physics.js']) {
        const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/^export /gm, '');
        vm.runInContext(src, ctx, {filename: f});
    }
    // Top-level const/class live in the script scope, not on the global object:
    // the Swift bridge must look names up by evaluating them (regression test).
    assert.equal(typeof ctx.Chain, 'undefined');
    assert.equal(typeof vm.runInContext('Chain', ctx), 'function');
    assert.equal(typeof vm.runInContext('PALETTE', ctx), 'object');
    const r = vm.runInContext('parseConfig(\'{"damping": 1.5}\')', ctx);
    assert.equal(r[0].damping, 1.5);
    const chain = vm.runInContext(
        'new Chain(JSON.parse(JSON.stringify(DEFAULTS)), {anchorX: 720, anchorY: 0, left: 0, right: 1440, top: 0, bottom: 600})', ctx);
    assert.equal(chain.bodies.length, 2);
    assert.equal(chain.segments().length, 2);
});
