// Ball on a String: GNOME Shell 50 (Wayland) platform layer.
//
// All physics, input semantics and string geometry live in the shared engine
// (physics.js, copied in from ../engine by install.sh). This file only:
//   * creates the actors (one click-through string canvas, one small reactive
//     canvas per ball) and adds them with Main.layoutManager.addChrome(),
//   * forwards pointer events to the engine,
//   * runs the frame clock (Clutter.Timeline bound to the canvas) while the
//     engine is awake and paints what the engine reports,
//   * watches ~/.config/ball-on-a-string.json and rebuilds on change.
//
// Verified against the Mutter / GJS / gnome-shell "gnome-50" branches:
//   * Clutter.Timeline has a G_PARAM_CONSTRUCT "actor" property.
//   * On button press Clutter freezes the event-emission chain (implicit grab,
//     clutter-sprite.c) until release, so motion/release keep reaching the
//     pressed ball wherever the pointer goes; global.stage.grab() on top keeps
//     the ball in the chain and stops other actors from stealing events.
//   * global.stage.grab() returns a Clutter.Grab with dismiss()/is_revoked().
//   * Clutter.Event.get_coords() returns [x, y]; Clutter.BUTTON_PRIMARY === 1.
//   * St.DrawingArea.queue_repaint() is synchronous: call it once per frame,
//     never per input event. Only Cairo.Context has $dispose(); patterns don't.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Cairo from 'cairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Chain, playAreaHeight} from './physics.js';
import {CONFIG_PATH, readConfig} from './configIO.js';

const RELOAD_DEBOUNCE_MS = 300;

export default class BallOnAStringExtension extends Extension {
    enable() {
        this._cfg = null;
        this._chain = null;
        this._mon = null;
        this._stringArea = null;
        this._ballActors = [];        // one St.DrawingArea per body, same order
        this._timeline = null;
        this._timelineId = 0;
        this._grab = null;
        this._monitorsId = 0;
        this._configMonitor = null;
        this._configMonitorId = 0;
        this._reloadTimeoutId = 0;
        this._lastT = 0;

        // If anything below throws, remove what was already put on the stage
        // before re-raising: GNOME marks the extension ERROR and never calls
        // disable(), so anything left behind would stay until the next login.
        try {
            this._cfg = this._loadConfig();
            this._monitorsId = Main.layoutManager.connect(
                'monitors-changed', () => this._rebuild());
            this._watchConfig();
            this._build();
        } catch (e) {
            this._teardown();
            throw e;
        }
    }

    disable() {
        this._teardown();
    }

    // ---------------------------------------------------------------- config
    _loadConfig() {
        const [cfg, warnings] = readConfig();
        for (const w of warnings)
            log(`ball-on-a-string: ${w}`);
        return cfg;
    }

    _watchConfig() {
        const file = Gio.File.new_for_path(CONFIG_PATH);
        this._configMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._configMonitorId = this._configMonitor.connect('changed', () => {
            if (this._reloadTimeoutId)
                GLib.Source.remove(this._reloadTimeoutId);
            this._reloadTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RELOAD_DEBOUNCE_MS, () => {
                this._reloadTimeoutId = 0;
                this._cfg = this._loadConfig();
                this._rebuild();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _unwatchConfig() {
        if (this._reloadTimeoutId) {
            GLib.Source.remove(this._reloadTimeoutId);
            this._reloadTimeoutId = 0;
        }
        if (this._configMonitor) {
            if (this._configMonitorId) {
                try { this._configMonitor.disconnect(this._configMonitorId); } catch (e) { /* ignore */ }
            }
            try { this._configMonitor.cancel(); } catch (e) { /* ignore */ }
        }
        this._configMonitor = null;
        this._configMonitorId = 0;
    }

    // ------------------------------------------------------------- lifecycle
    _rebuild() {
        try {
            this._destroyScene();
            this._build();
        } catch (e) {
            logError(e, 'ball-on-a-string: rebuild failed');
            this._destroyScene();
        }
    }

    _build() {
        const mon = Main.layoutManager.primaryMonitor;
        const cfg = this._cfg;
        if (!mon || !cfg.visible || cfg.balls.length === 0)
            return;
        this._mon = {x: mon.x, y: mon.y, width: mon.width, height: mon.height};
        const m = this._mon;
        const height = playAreaHeight(cfg, m.height);

        this._chain = new Chain(cfg, {
            anchorX: m.x + m.width * cfg.anchorFrac,
            anchorY: m.y,
            left: m.x,
            right: m.x + m.width,
            top: m.y,
            bottom: m.y + height,
        });

        // String canvas: never reactive, so every pixel is click-through.
        this._stringArea = new St.DrawingArea({
            reactive: false,
            x: m.x,
            y: m.y,
            width: m.width,
            height,
        });
        this._stringArea.connect('repaint', a => this._paintStrings(a));
        Main.layoutManager.addChrome(this._stringArea,
            {affectsStruts: false, trackFullscreen: true});

        // Balls: small reactive canvases, painted once (on first allocation).
        this._ballActors = this._chain.bodies.map((body, i) => {
            const size = 2 * (body.radius + cfg.grabPad);
            const actor = new St.DrawingArea({reactive: true, width: size, height: size});
            actor.connect('repaint', a => this._paintBall(a, body));
            actor.connect('button-press-event', (a, e) => this._onPress(i, e));
            actor.connect('motion-event', (a, e) => this._onMotion(i, e));
            actor.connect('button-release-event', (a, e) => this._onRelease(i, e));
            Main.layoutManager.addChrome(actor,
                {affectsStruts: false, trackFullscreen: true});
            return actor;
        });

        // Frame clock, driven by the string canvas. Started on the first touch,
        // stopped again when the engine reports that everything has settled.
        this._timeline = new Clutter.Timeline({
            actor: this._stringArea,
            duration: 1000,
            repeat_count: -1,
        });
        this._timelineId = this._timeline.connect('new-frame', () => this._onFrame());

        this._syncVisuals();
    }

    _destroyScene() {
        this._releaseGrab();

        if (this._timeline) {
            try { this._timeline.stop(); } catch (e) { /* ignore */ }
            if (this._timelineId) {
                try { this._timeline.disconnect(this._timelineId); } catch (e) { /* ignore */ }
            }
        }
        this._timeline = null;
        this._timelineId = 0;

        for (const actor of this._ballActors)
            this._removeActor(actor);
        this._ballActors = [];
        this._removeActor(this._stringArea);
        this._stringArea = null;
        this._chain = null;
        this._mon = null;
    }

    _teardown() {
        this._unwatchConfig();
        if (this._monitorsId) {
            try { Main.layoutManager.disconnect(this._monitorsId); } catch (e) { /* ignore */ }
            this._monitorsId = 0;
        }
        this._destroyScene();
    }

    _removeActor(actor) {
        if (!actor)
            return;
        // removeChrome throws if addChrome itself failed earlier; destroy()
        // removes the actor from the stage regardless (and its signal handlers).
        try { Main.layoutManager.removeChrome(actor); } catch (e) { /* never tracked */ }
        try { actor.destroy(); } catch (e) { /* ignore */ }
    }

    _releaseGrab() {
        if (!this._grab)
            return;
        try { this._grab.dismiss(); } catch (e) { /* ignore */ }
        this._grab = null;
    }

    // ------------------------------------------------------------ frame loop
    _now() {
        return GLib.get_monotonic_time() / 1e6;
    }

    _wake() {
        if (!this._timeline || !this._chain)
            return;
        this._chain.wake();
        if (!this._timeline.is_playing()) {
            this._lastT = this._now();
            this._timeline.start();
        }
    }

    _onFrame() {
        if (!this._chain)
            return;
        const now = this._now();
        const dt = now - this._lastT;
        this._lastT = now;

        // The compositor may revoke our grab (e.g. another modal grab).
        if (this._chain.dragIndex >= 0 && this._grab) {
            let revoked = false;
            try { revoked = this._grab.is_revoked(); } catch (e) { /* ignore */ }
            if (revoked) {
                this._chain.cancelDrag();
                this._releaseGrab();
            }
        }

        const awake = this._chain.frame(dt);
        this._syncVisuals();
        if (!awake)
            this._timeline.stop();      // zero CPU until the next touch
    }

    _syncVisuals() {
        if (!this._stringArea || !this._chain)
            return;
        this._chain.bodies.forEach((b, i) => {
            const actor = this._ballActors[i];
            const half = actor.width / 2;
            actor.set_position(Math.round(b.x - half), Math.round(b.y - half));
        });
        this._stringArea.queue_repaint();
    }

    // ----------------------------------------------------------------- input
    _onPress(i, event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        if (!this._chain || this._chain.dragIndex >= 0)
            return Clutter.EVENT_STOP;
        try {
            this._grab = global.stage.grab(this._ballActors[i]);
        } catch (e) {
            // Clutter's implicit grab still delivers motion/release to us while
            // the button is held, so dragging works even without the seat grab.
            logError(e, 'ball-on-a-string: stage.grab failed');
            this._grab = null;
        }
        const [px, py] = event.get_coords();
        this._chain.beginDrag(i, px, py, this._now());
        this._wake();
        return Clutter.EVENT_STOP;
    }

    _onMotion(i, event) {
        if (!this._chain || this._chain.dragIndex !== i)
            return Clutter.EVENT_PROPAGATE;
        const [px, py] = event.get_coords();
        this._chain.dragTo(px, py, this._now());
        // No repaint here: queue_repaint() is synchronous. The running
        // timeline syncs visuals once per frame while dragging.
        return Clutter.EVENT_STOP;
    }

    _onRelease(i, event) {
        if (!this._chain || this._chain.dragIndex !== i)
            return Clutter.EVENT_PROPAGATE;
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        this._chain.endDrag(this._now());
        this._releaseGrab();
        this._wake();
        return Clutter.EVENT_STOP;
    }

    // --------------------------------------------------------------- drawing
    _paintBall(area, body) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const cx = w / 2, cy = h / 2, r = body.radius;
        const [R, G, B] = body.color;

        // Soft shadow, offset down-right.
        cr.setSourceRGBA(0, 0, 0, 0.22);
        cr.arc(cx + 1.5, cy + 2.5, r, 0, 2 * Math.PI);
        cr.fill();

        // Shaded sphere. Patterns are plain GC objects: no $dispose() on them.
        const grad = new Cairo.RadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1,
                                              cx, cy, r);
        grad.addColorStopRGBA(0, Math.min(1, R + 0.45), Math.min(1, G + 0.45), Math.min(1, B + 0.45), 1);
        grad.addColorStopRGBA(0.6, R, G, B, 1);
        grad.addColorStopRGBA(1, R * 0.55, G * 0.55, B * 0.55, 1);
        cr.setSource(grad);
        cr.arc(cx, cy, r, 0, 2 * Math.PI);
        cr.fill();

        // Rim light.
        cr.setSourceRGBA(1, 1, 1, 0.3);
        cr.setLineWidth(1);
        cr.arc(cx, cy, r - 0.5, 0, 2 * Math.PI);
        cr.stroke();

        cr.$dispose();
    }

    _paintStrings(area) {
        if (!this._chain || !this._mon)
            return;
        const cr = area.get_context();
        // The surface is already cleared by St before 'repaint' is emitted.
        const ox = this._mon.x, oy = this._mon.y;
        const cfg = this._cfg;

        cr.setSourceRGBA(...cfg.stringColor);
        cr.setLineWidth(cfg.stringWidth);
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (const s of this._chain.segments()) {
            cr.moveTo(s.ax - ox, s.ay - oy);
            if (s.straight)
                cr.lineTo(s.bx - ox, s.by - oy);
            else
                cr.curveTo(s.c1x - ox, s.c1y - oy, s.c2x - ox, s.c2y - oy, s.bx - ox, s.by - oy);
        }
        cr.stroke();

        // Anchor dot.
        cr.setSourceRGBA(...cfg.anchorColor);
        cr.arc(this._chain.anchorX - ox, this._chain.anchorY - oy + 1, cfg.anchorRadius, 0, 2 * Math.PI);
        cr.fill();

        cr.$dispose();
    }
}
