// Ball on a String: the shared engine.
//
// Pure JavaScript, no platform imports. The same file runs inside GNOME Shell
// (GJS, imported as an ES module) and inside the macOS app (JavaScriptCore,
// loaded as a classic script with the word "export" stripped). Anything that
// touches a screen, a window or an input device lives in the platform layers.
//
// Coordinates: pixels, x to the right, y DOWN, in whatever space the platform
// chooses (GNOME: stage/monitor coordinates; macOS: flipped screen points).
// Times: seconds, from any monotonic clock.
//
// Usage per frame:
//     const awake = chain.frame(dtSeconds);   // integrates + sleep logic
//     for (const b of chain.bodies) draw ball at (b.x, b.y) radius b.radius
//     for (const s of chain.segments()) stroke string (straight or cubic)
//     if (!awake) stop the frame clock; call chain.wake() on the next press.

/** Height of the play area for a chain at rest, used when cfg.swingHeight is 0. */
export function playAreaHeight(cfg, screenHeight) {
    if (cfg.swingHeight > 0)
        return cfg.swingHeight;
    let depth = 0;
    for (let i = 0; i < cfg.balls.length; i++) {
        let massBelow = 0;
        for (let j = i; j < cfg.balls.length; j++)
            massBelow += cfg.balls[j].mass;
        depth += cfg.balls[i].restLength + massBelow * cfg.gravity / cfg.balls[i].k;
    }
    return Math.round(Math.min(screenHeight - 1, depth * 1.8 + 120));
}

export class Chain {
    /**
     * @param {object} cfg    merged configuration (see config.js)
     * @param {object} area   {anchorX, anchorY, left, right, top, bottom}:
     *                        where the chain hangs and the box the balls may
     *                        occupy (bottom is the floor they bounce on).
     */
    constructor(cfg, area) {
        this.cfg = cfg;
        this.area = area;
        this.anchorX = area.anchorX;
        this.anchorY = area.anchorY;
        this.dragIndex = -1;
        this._dragOffX = 0;
        this._dragOffY = 0;
        this._lastDragT = 0;
        this._stillFor = 0;
        this._awake = false;

        let y = this.anchorY;
        this.bodies = cfg.balls.map((bcfg, i) => {
            let massBelow = 0;
            for (let j = i; j < cfg.balls.length; j++)
                massBelow += cfg.balls[j].mass;
            y += bcfg.restLength + massBelow * cfg.gravity / bcfg.k;
            return {
                index: i,
                radius: bcfg.radius,
                mass: bcfg.mass,
                restLength: bcfg.restLength,
                k: bcfg.k,
                color: bcfg.color,
                eqX: this.anchorX,
                eqY: y,
                x: this.anchorX,
                y,
                vx: 0,
                vy: 0,
            };
        });
    }

    get awake() {
        return this._awake;
    }

    /** Called by the platform when it starts the frame clock. */
    wake() {
        this._awake = true;
        this._stillFor = 0;
    }

    // --------------------------------------------------------------- frames
    /**
     * Advance the simulation by dt seconds (clamped). Returns true while the
     * chain is awake; returns false on the frame it falls asleep, after
     * snapping to rest, meaning the platform can stop its frame clock.
     */
    frame(dt) {
        if (dt <= 0)
            return this._awake;
        dt = Math.min(dt, this.cfg.maxDt);
        this._step(dt);

        if (this.dragIndex >= 0) {
            this._stillFor = 0;
            return true;
        }
        if (!this._isStill()) {
            this._stillFor = 0;
            return true;
        }
        if (this._isAtEquilibrium()) {
            for (const b of this.bodies) {
                b.x = b.eqX;
                b.y = b.eqY;
            }
            this._stillFor = this.cfg.sleepHold;
        } else {
            this._stillFor += dt;     // still, but e.g. resting on another ball
        }
        if (this._stillFor >= this.cfg.sleepHold) {
            for (const b of this.bodies) {
                b.vx = 0;
                b.vy = 0;
            }
            this._awake = false;
            return false;
        }
        return true;
    }

    _isStill() {
        for (const b of this.bodies) {
            if (Math.hypot(b.vx, b.vy) >= this.cfg.sleepSpeed)
                return false;
        }
        return true;
    }

    _isAtEquilibrium() {
        for (const b of this.bodies) {
            if (Math.hypot(b.x - b.eqX, b.y - b.eqY) >= this.cfg.sleepDist)
                return false;
        }
        return true;
    }

    // -------------------------------------------------------------- physics
    _step(dt) {
        const cfg = this.cfg;
        const n = cfg.substeps;
        const h = dt / n;
        const {damping: c, gravity: g, restitution: e} = cfg;
        const bodies = this.bodies;
        const N = bodies.length;
        const fx = new Array(N), fy = new Array(N);

        for (let s = 0; s < n; s++) {
            // Gravity and damping on every body.
            for (let i = 0; i < N; i++) {
                const b = bodies[i];
                fx[i] = -c * b.vx;
                fy[i] = b.mass * g - c * b.vy;
            }
            // Each string pulls its ball and whatever it hangs from, never pushes.
            for (let i = 0; i < N; i++) {
                const b = bodies[i];
                const px = i === 0 ? this.anchorX : bodies[i - 1].x;
                const py = i === 0 ? this.anchorY : bodies[i - 1].y;
                const rx = b.x - px, ry = b.y - py;
                const d = Math.hypot(rx, ry);
                if (d > b.restLength) {
                    const f = b.k * (d - b.restLength);
                    const ux = rx / d, uy = ry / d;
                    fx[i] -= f * ux;
                    fy[i] -= f * uy;
                    if (i > 0) {
                        fx[i - 1] += f * ux;
                        fy[i - 1] += f * uy;
                    }
                }
            }
            // Semi-implicit Euler: velocity first, then position. The dragged
            // ball is kinematic (its position comes from the pointer).
            for (let i = 0; i < N; i++) {
                if (i === this.dragIndex)
                    continue;
                const b = bodies[i];
                b.vx += (fx[i] / b.mass) * h;
                b.vy += (fy[i] / b.mass) * h;
                b.x += b.vx * h;
                b.y += b.vy * h;
                this._clampToArea(b, e);
            }
            if (cfg.ballCollisions && N > 1) {
                for (let p = 0; p < cfg.collisionPasses; p++)
                    this._resolveBallCollisions();
            }
        }
    }

    _clampToArea(b, e) {
        const a = this.area, r = b.radius;
        if (b.x < a.left + r) { b.x = a.left + r; b.vx = Math.abs(b.vx) * e; }
        else if (b.x > a.right - r) { b.x = a.right - r; b.vx = -Math.abs(b.vx) * e; }
        if (b.y < a.top + r) { b.y = a.top + r; b.vy = Math.abs(b.vy) * e; }
        else if (b.y > a.bottom - r) { b.y = a.bottom - r; b.vy = -Math.abs(b.vy) * e; }
    }

    // Rigid-disc collisions between every pair of balls: push overlapping
    // balls apart (split by inverse mass) and exchange a normal impulse with
    // restitution. Slow contacts are inelastic so a ball can rest on another.
    // The dragged ball has infinite mass.
    _resolveBallCollisions() {
        const bodies = this.bodies;
        const N = bodies.length;
        const e = this.cfg.ballRestitution;

        for (let i = 0; i < N - 1; i++) {
            const a = bodies[i];
            const invMa = i === this.dragIndex ? 0 : 1 / a.mass;
            for (let j = i + 1; j < N; j++) {
                const b = bodies[j];
                const minD = a.radius + b.radius;
                let dx = b.x - a.x, dy = b.y - a.y;
                let d = Math.hypot(dx, dy);
                if (d >= minD)
                    continue;
                if (d < 1e-6) {
                    dx = 0; dy = 1; d = 1;
                }
                const invMb = j === this.dragIndex ? 0 : 1 / b.mass;
                const invSum = invMa + invMb;
                if (invSum === 0)
                    continue;
                const nx = dx / d, ny = dy / d;

                const pen = minD - d;
                a.x -= nx * pen * (invMa / invSum);
                a.y -= ny * pen * (invMa / invSum);
                b.x += nx * pen * (invMb / invSum);
                b.y += ny * pen * (invMb / invSum);

                const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                if (rvn >= 0)
                    continue;
                const bounce = -rvn < this.cfg.restingSpeed ? 0 : e;
                const imp = -(1 + bounce) * rvn / invSum;
                a.vx -= imp * nx * invMa;
                a.vy -= imp * ny * invMa;
                b.vx += imp * nx * invMb;
                b.vy += imp * ny * invMb;
            }
        }
        // Re-clamp in case a correction pushed a ball out of the area.
        for (let i = 0; i < N; i++) {
            if (i !== this.dragIndex)
                this._clampToArea(bodies[i], 1);
        }
    }

    // ---------------------------------------------------------------- input
    /** Pointer pressed on ball i at (px, py) at time t. Returns false if busy. */
    beginDrag(i, px, py, t) {
        if (this.dragIndex >= 0 || i < 0 || i >= this.bodies.length)
            return false;
        const b = this.bodies[i];
        this.dragIndex = i;
        this._dragOffX = b.x - px;
        this._dragOffY = b.y - py;
        b.vx = 0;
        b.vy = 0;
        this._lastDragT = t;
        this.wake();
        return true;
    }

    /** Pointer moved to (px, py) at time t while dragging. */
    dragTo(px, py, t) {
        if (this.dragIndex < 0)
            return;
        const b = this.bodies[this.dragIndex];
        const a = this.area, r = b.radius;
        const nx = Math.min(a.right - r, Math.max(a.left + r, px + this._dragOffX));
        const ny = Math.min(a.bottom - r, Math.max(a.top + r, py + this._dragOffY));
        const dt = t - this._lastDragT;
        if (dt > 0.0005) {
            const s = this.cfg.velSmoothing;
            b.vx = b.vx * (1 - s) + ((nx - b.x) / dt) * s;
            b.vy = b.vy * (1 - s) + ((ny - b.y) / dt) * s;
            this._lastDragT = t;
        }
        b.x = nx;
        b.y = ny;
    }

    /** Pointer released at time t: the ball keeps its (capped) velocity. */
    endDrag(t) {
        if (this.dragIndex < 0)
            return;
        const b = this.bodies[this.dragIndex];
        if (t - this._lastDragT > this.cfg.staleReleaseSec) {
            b.vx = 0;        // held still before letting go => drop, don't throw
            b.vy = 0;
        }
        const speed = Math.hypot(b.vx, b.vy);
        if (speed > this.cfg.maxThrowSpeed) {
            const s = this.cfg.maxThrowSpeed / speed;
            b.vx *= s;
            b.vy *= s;
        }
        this.dragIndex = -1;
        this.wake();
    }

    /** The platform lost the pointer (grab revoked): drop with no throw. */
    cancelDrag() {
        if (this.dragIndex < 0)
            return;
        const b = this.bodies[this.dragIndex];
        b.vx = 0;
        b.vy = 0;
        this.dragIndex = -1;
        this.wake();
    }

    // -------------------------------------------------------------- drawing
    /**
     * Geometry of every string, anchor -> ball 0 -> ball 1 -> ... Each entry
     * has the endpoints and, when the string is slack, cubic Bezier control
     * points for a sagging curve; straight otherwise.
     */
    segments() {
        const out = [];
        let px = this.anchorX, py = this.anchorY;
        for (const b of this.bodies) {
            out.push(segmentGeometry(px, py, b.x, b.y, b.restLength));
            px = b.x;
            py = b.y;
        }
        return out;
    }
}

export function segmentGeometry(ax, ay, bx, by, L) {
    const d = Math.hypot(bx - ax, by - ay);
    if (d >= L || d < 1e-3)
        return {ax, ay, bx, by, straight: true};
    // Slack: a sagging quadratic curve written as a cubic. Sag chosen so the
    // curve length is roughly the rest length (parabola approximation).
    const sag = Math.sqrt(3 * d * (L - d) / 8);
    const qx = (ax + bx) / 2, qy = (ay + by) / 2 + 2 * sag;
    return {
        ax, ay, bx, by,
        straight: false,
        c1x: ax + (2 / 3) * (qx - ax), c1y: ay + (2 / 3) * (qy - ay),
        c2x: bx + (2 / 3) * (qx - bx), c2y: by + (2 / 3) * (qy - by),
    };
}
