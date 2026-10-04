// Ball on a String: shared configuration schema.
//
// Pure JavaScript, no platform imports: the defaults and the merge/validation
// logic used by every platform layer. Reading and writing the actual file is
// platform-specific (gnome/configIO.js, macos/.../ConfigStore.swift); both use
//     ~/.config/ball-on-a-string.json
// so a config can be copied between machines unchanged.

// Colours are [r, g, b] (balls) or [r, g, b, a] (string, anchor) in 0..1.
export const DEFAULTS = {
    visible: true,           // false => the app/extension stays loaded but shows nothing
    showOnLogin: false,      // false => the GNOME extension resets visible to false at login,
                             //          so the balls appear only after an explicit `balls on`

    // Where the chain is attached along the top edge: 0 = left, 0.5 = centre, 1 = right.
    anchorFrac: 0.5,
    anchorRadius: 3,                          // px, the little dot at the top
    anchorColor: [0.95, 0.95, 0.97, 0.95],

    // The chain, top to bottom. Each entry describes a ball AND the string
    // above it (from the anchor for the first ball, from the previous ball
    // otherwise). One entry = the classic single-ball toy.
    balls: [
        {radius: 15, mass: 1.0, restLength: 150, k: 180, color: [0.90, 0.22, 0.25]},
        {radius: 11, mass: 0.6, restLength: 110, k: 180, color: [0.25, 0.45, 0.90]},
    ],
    grabPad: 5,              // px of extra clickable margin around each ball

    // Physics (screen pixels, seconds).
    gravity: 2200,           // px/s^2
    damping: 0.6,            // linear velocity damping (0.6 -> ~20 s to settle, 1.5 -> ~8 s)
    substeps: 4,             // physics iterations per rendered frame
    maxDt: 1 / 30,           // s, clamp so a stalled frame cannot explode the sim
    restitution: 0.55,       // fraction of normal velocity kept on edge/floor hits
    ballCollisions: true,    // balls bounce off each other instead of passing through
    ballRestitution: 0.8,    // bounciness of ball-ball hits (1 = perfectly elastic)
    restingSpeed: 40,        // px/s; slower contacts don't bounce (lets a ball rest on another)
    collisionPasses: 2,      // separation passes per substep
    maxThrowSpeed: 4000,     // px/s
    velSmoothing: 0.4,       // 0..1, weight of the newest pointer-velocity sample
    staleReleaseSec: 0.08,   // pointer held still this long before release => no throw
    sleepSpeed: 4,           // px/s; below this every ball counts as still
    sleepDist: 0.4,          // px from equilibrium for an immediate snap-to-rest
    sleepHold: 1.0,          // s of stillness elsewhere before the loop stops anyway

    // Play area: height of the string canvas = floor the balls bounce on.
    // 0 = automatic from the chain's resting depth.
    swingHeight: 0,

    stringWidth: 1.6,
    stringColor: [0.85, 0.87, 0.92, 0.85],
};

// Colours handed to balls added through a settings UI.
export const PALETTE = [
    [0.90, 0.22, 0.25], [0.25, 0.45, 0.90], [0.95, 0.75, 0.10],
    [0.20, 0.70, 0.40], [0.70, 0.35, 0.85], [0.95, 0.50, 0.15],
];

export function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Merge a user-supplied object onto the defaults, dropping unknown keys and
 * wrong-typed values. Never throws. Returns [config, warnings].
 */
export function mergeConfig(user) {
    const cfg = deepCopy(DEFAULTS);
    const warnings = [];
    if (typeof user !== 'object' || user === null || Array.isArray(user)) {
        warnings.push('config must be a JSON object; using defaults');
        return [cfg, warnings];
    }
    for (const [key, value] of Object.entries(user)) {
        if (!(key in DEFAULTS)) {
            warnings.push(`ignoring unknown key "${key}"`);
            continue;
        }
        if (key === 'balls') {
            if (!Array.isArray(value) || value.length === 0) {
                warnings.push('"balls" must be a non-empty array; keeping defaults');
                continue;
            }
            // Missing per-ball fields fall back to the first default ball.
            cfg.balls = value.map(b => ({...DEFAULTS.balls[0], ...(typeof b === 'object' && b ? b : {})}));
            continue;
        }
        const wrongType = typeof value !== typeof DEFAULTS[key] ||
            Array.isArray(value) !== Array.isArray(DEFAULTS[key]);
        if (wrongType) {
            warnings.push(`key "${key}" has the wrong type; keeping default`);
            continue;
        }
        cfg[key] = value;
    }
    return [cfg, warnings];
}

/**
 * Parse config file text and merge it. Never throws: unparsable text yields
 * the defaults plus a warning. Shared by both platforms.
 */
export function parseConfig(text) {
    let user;
    try {
        user = JSON.parse(text);
    } catch (e) {
        return [deepCopy(DEFAULTS), [`config is not valid JSON (${e.message}); using defaults`]];
    }
    return mergeConfig(user);
}

/** Pretty-printed text for writing the config file. */
export function serializeConfig(cfg) {
    return `${JSON.stringify(cfg, null, 2)}\n`;
}
