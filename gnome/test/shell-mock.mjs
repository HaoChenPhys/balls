// A minimal stand-in for the GNOME Shell / GJS environment, enough to execute
// extension.js in Node: St.DrawingArea, Clutter.Timeline, Main.layoutManager,
// global.stage.grab, GLib timers and the Gio file monitor. It mirrors the
// behaviours the extension relies on (see the comments in extension.js), but
// it is a mock: the real bindings are only exercised on a real shell.

export class MockActor {
    constructor(props = {}) {
        Object.assign(this, {x: 0, y: 0, width: 0, height: 0, reactive: false}, props);
        this._handlers = {};
        this.destroyed = false;
    }
    connect(signal, fn) {
        (this._handlers[signal] ??= []).push(fn);
        return Object.keys(this._handlers).length * 100 + this._handlers[signal].length;
    }
    disconnect() {}
    set_position(x, y) { this.x = x; this.y = y; }
    queue_repaint() { this._handlers.repaint?.forEach(fn => fn(this)); }
    destroy() { this.destroyed = true; }
    get_context() { return new MockCairoContext(); }
    get_surface_size() { return [this.width, this.height]; }
    emit(signal, event) {
        let result;
        for (const fn of this._handlers[signal] ?? [])
            result = fn(this, event);
        return result;
    }
}

export class MockCairoContext {
    constructor() { this.disposed = false; }
    $dispose() { this.disposed = true; }
}
for (const m of ['setSourceRGBA', 'arc', 'fill', 'setLineWidth', 'setLineCap', 'moveTo', 'lineTo', 'curveTo', 'stroke', 'setSource'])
    MockCairoContext.prototype[m] = function () {};

class MockGradient { addColorStopRGBA() {} }

export class MockTimeline {
    constructor(props) {
        Object.assign(this, props);
        if (!(props.actor instanceof MockActor))
            throw new Error('Clutter.Timeline needs an actor');
        this.playing = false;
        this._handlers = {};
    }
    connect(signal, fn) { (this._handlers[signal] ??= []).push(fn); return 1; }
    disconnect() {}
    is_playing() { return this.playing; }
    start() { this.playing = true; }
    stop() { this.playing = false; }
    tick() { this._handlers['new-frame']?.forEach(fn => fn()); }
}

/**
 * Build the mock module table. `clock` is an object with a `now` field in
 * microseconds that tests advance by hand.
 */
export function makeShellMock(clock) {
    const layoutManager = {
        primaryMonitor: {x: 0, y: 0, width: 1920, height: 1080},
        chrome: [],
        connect() { return 7; },
        disconnect() {},
        addChrome(actor, params) {
            if ('affectsInputRegion' in params)
                throw new Error('Unrecognized parameter "affectsInputRegion"');
            this.chrome.push(actor);
        },
        removeChrome(actor) {
            const i = this.chrome.indexOf(actor);
            if (i < 0)
                throw new Error('not tracked');
            this.chrome.splice(i, 1);
        },
    };
    const timers = new Map();
    let timerId = 0;
    const fileMonitors = [];
    const mock = {
        layoutManager,
        timers,
        fileMonitors,
        fireTimers() { for (const [id, cb] of [...timers]) { timers.delete(id); cb(); } },
        fireFileChanged() { for (const m of fileMonitors) m.fire(); },
        grabs: [],
        modules: {
            'gi://Clutter': {Timeline: MockTimeline, BUTTON_PRIMARY: 1, EVENT_STOP: true, EVENT_PROPAGATE: false},
            'gi://GLib': {
                get_monotonic_time: () => clock.now,
                PRIORITY_DEFAULT: 0,
                SOURCE_REMOVE: false,
                timeout_add: (prio, ms, cb) => { timers.set(++timerId, cb); return timerId; },
                Source: {remove: id => timers.delete(id)},
            },
            'gi://Gio': {
                FileMonitorFlags: {NONE: 0},
                File: {
                    new_for_path: () => ({
                        query_exists: () => false,
                        monitor_file: () => {
                            const m = {_h: [], connect(s, fn) { this._h.push(fn); return 1; }, disconnect() {}, cancel() { this.cancelled = true; }, fire() { if (!this.cancelled) this._h.forEach(fn => fn()); }};
                            fileMonitors.push(m);
                            return m;
                        },
                    }),
                },
            },
            'gi://St': {DrawingArea: MockActor},
            'cairo': {RadialGradient: MockGradient, LineCap: {ROUND: 1}},
            'resource:///org/gnome/shell/ui/main.js': {layoutManager},
            'resource:///org/gnome/shell/extensions/extension.js': {Extension: class {}},
        },
    };
    globalThis.global = {
        stage: {
            grab(actor) {
                const g = {actor, dismissed: false, dismiss() { this.dismissed = true; }, is_revoked: () => false};
                mock.grabs.push(g);
                return g;
            },
        },
    };
    globalThis.log = () => {};
    globalThis.logError = (e, msg) => { throw new Error(`${msg}: ${e}`); };
    return mock;
}

/** Pointer event stand-in. */
export const pointerEvent = (button, x, y) => ({get_button: () => button, get_coords: () => [x, y]});
