// The preferences UI for Ball on a String, built with GTK 4 + libadwaita.
// Kept free of GNOME Shell imports so it can be exercised in plain gjs;
// prefs.js is the thin adapter GNOME Shell loads. Defaults and validation
// come from the shared engine (config.js); file access from configIO.js.
//
// Every change is written to ~/.config/ball-on-a-string.json (debounced).
// The running extension watches that file and rebuilds itself, so edits here
// show up on screen immediately; nothing needs reloading.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {DEFAULTS, PALETTE, deepCopy} from './config.js';
import {readConfig, writeConfig} from './configIO.js';

const SAVE_DELAY_MS = 150;

export function buildPreferencesPage() {
    const [cfg] = readConfig();
    const page = new Adw.PreferencesPage({
        title: 'Ball on a String',
        icon_name: 'applications-games-symbolic',
    });

    let saveId = 0;
    const save = () => {
        if (saveId)
            GLib.Source.remove(saveId);
        saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
            saveId = 0;
            try {
                writeConfig(cfg);
            } catch (e) {
                logError(e, 'ball-on-a-string: could not write config');
            }
            return GLib.SOURCE_REMOVE;
        });
    };
    // Flush a pending save if the page goes away before the timer fires.
    page.connect('unrealize', () => {
        if (saveId) {
            GLib.Source.remove(saveId);
            saveId = 0;
            try { writeConfig(cfg); } catch (e) { /* ignore */ }
        }
    });

    let groups = [];
    const rebuild = () => {
        for (const g of groups)
            page.remove(g);
        groups = [
            buildGeneralGroup(cfg, save),
            buildPhysicsGroup(cfg, save),
            buildBallsGroup(cfg, save, rebuild),
            buildResetGroup(cfg, save, rebuild),
        ];
        for (const g of groups)
            page.add(g);
    };
    rebuild();

    // Let callers (tests) poke at the state.
    page._cfg = cfg;
    page._rebuild = rebuild;
    return page;
}

// ---------------------------------------------------------------- groups
function buildGeneralGroup(cfg, save) {
    const group = new Adw.PreferencesGroup({title: 'General'});

    group.add(switchRow('Show the balls',
        'Turn off to hide the toy. It stays hidden after logging in until turned on again.',
        cfg.visible, v => { cfg.visible = v; save(); }));

    group.add(spinRow('Anchor position', '0 = left edge, 0.5 = centre, 1 = right edge',
        cfg.anchorFrac, 0, 1, 0.05, 2, v => { cfg.anchorFrac = v; save(); }));

    group.add(spinRow('Play area height', 'Pixels from the top edge the balls can reach; 0 = automatic',
        cfg.swingHeight, 0, 5000, 10, 0, v => { cfg.swingHeight = v; save(); }));

    group.add(colorRow('String colour', cfg.stringColor, true,
        c => { cfg.stringColor = c; save(); }));

    group.add(spinRow('String width', 'Pixels',
        cfg.stringWidth, 0.5, 10, 0.1, 1, v => { cfg.stringWidth = v; save(); }));

    return group;
}

function buildPhysicsGroup(cfg, save) {
    const group = new Adw.PreferencesGroup({title: 'Physics'});

    group.add(spinRow('Gravity', 'Pixels per second squared',
        cfg.gravity, 0, 20000, 100, 0, v => { cfg.gravity = v; save(); }));

    group.add(spinRow('Damping', 'Higher settles sooner: 0.6 ≈ 20 s, 1.5 ≈ 8 s',
        cfg.damping, 0, 20, 0.1, 2, v => { cfg.damping = v; save(); }));

    group.add(spinRow('Edge bounciness', 'Velocity kept when hitting the screen edges or floor (0–1)',
        cfg.restitution, 0, 1, 0.05, 2, v => { cfg.restitution = v; save(); }));

    group.add(spinRow('Maximum throw speed', 'Pixels per second',
        cfg.maxThrowSpeed, 100, 20000, 100, 0, v => { cfg.maxThrowSpeed = v; save(); }));

    const collisions = switchRow('Ball collisions', 'Balls bounce off each other instead of passing through',
        cfg.ballCollisions, v => { cfg.ballCollisions = v; save(); });
    group.add(collisions);

    const bounce = spinRow('Ball bounciness', 'Velocity kept in ball-to-ball hits (0–1)',
        cfg.ballRestitution, 0, 1, 0.05, 2, v => { cfg.ballRestitution = v; save(); });
    collisions.bind_property('active', bounce, 'sensitive', 0 /* GObject.BindingFlags.DEFAULT */);
    bounce.sensitive = cfg.ballCollisions;
    group.add(bounce);

    return group;
}

function buildBallsGroup(cfg, save, rebuild) {
    const group = new Adw.PreferencesGroup({
        title: 'Balls',
        description: 'Top to bottom. Each string length and stiffness refers to the string above that ball.',
    });

    const addButton = new Gtk.Button({
        icon_name: 'list-add-symbolic',
        tooltip_text: 'Add a ball below the last one',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    addButton.connect('clicked', () => {
        const last = cfg.balls[cfg.balls.length - 1];
        cfg.balls.push({...deepCopy(last), color: nextColor(cfg.balls.length)});
        save();
        rebuild();
    });
    group.set_header_suffix(addButton);

    cfg.balls.forEach((ball, i) => {
        const row = new Adw.ExpanderRow({
            title: `Ball ${i + 1}`,
            subtitle: ballSubtitle(ball),
            expanded: cfg.balls.length <= 2,
        });
        const refresh = () => { row.subtitle = ballSubtitle(ball); save(); };

        const swatch = colorSwatch(ball.color);
        row.add_prefix(swatch);

        row.add_row(spinRow('Radius', 'Pixels',
            ball.radius, 3, 150, 1, 0, v => { ball.radius = v; refresh(); }));
        row.add_row(spinRow('Mass', '',
            ball.mass, 0.05, 50, 0.05, 2, v => { ball.mass = v; refresh(); }));
        row.add_row(spinRow('String length', 'Pixels, unstretched. Keep it longer than the two touching radii.',
            ball.restLength, 10, 2000, 5, 0, v => { ball.restLength = v; refresh(); }));
        row.add_row(spinRow('String stiffness', 'Spring constant; higher = snappier',
            ball.k, 5, 5000, 5, 0, v => { ball.k = v; refresh(); }));
        row.add_row(colorRow('Colour', ball.color, false, c => {
            ball.color = c;
            setSwatchColor(swatch, c);
            refresh();
        }));

        const removeRow = new Adw.ActionRow({title: 'Remove this ball'});
        const removeButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'destructive-action'],
            sensitive: cfg.balls.length > 1,
            tooltip_text: cfg.balls.length > 1 ? 'Remove' : 'The chain needs at least one ball',
        });
        removeButton.connect('clicked', () => {
            cfg.balls.splice(i, 1);
            save();
            rebuild();
        });
        removeRow.add_suffix(removeButton);
        removeRow.activatable_widget = removeButton;
        row.add_row(removeRow);

        group.add(row);
    });

    return group;
}

function buildResetGroup(cfg, save, rebuild) {
    const group = new Adw.PreferencesGroup();
    const row = new Adw.ActionRow({
        title: 'Reset to defaults',
        subtitle: 'Restores every setting above, including the balls',
    });
    const button = new Gtk.Button({
        label: 'Reset',
        valign: Gtk.Align.CENTER,
        css_classes: ['destructive-action'],
    });
    button.connect('clicked', () => {
        const fresh = deepCopy(DEFAULTS);
        for (const key of Object.keys(cfg))
            delete cfg[key];
        Object.assign(cfg, fresh);
        save();
        rebuild();
    });
    row.add_suffix(button);
    row.activatable_widget = button;
    group.add(row);
    return group;
}

// ---------------------------------------------------------------- widgets
function spinRow(title, subtitle, value, lower, upper, step, digits, onChange) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 10,
            value,
        }),
    });
    row.connect('notify::value', () => onChange(roundTo(row.value, digits)));
    return row;
}

function switchRow(title, subtitle, active, onChange) {
    const row = new Adw.SwitchRow({title, subtitle, active});
    row.connect('notify::active', () => onChange(row.active));
    return row;
}

function colorRow(title, color, withAlpha, onChange) {
    const row = new Adw.ActionRow({title});
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({with_alpha: withAlpha, modal: true}),
        valign: Gtk.Align.CENTER,
    });
    button.rgba = toRGBA(color);
    button.connect('notify::rgba', () => onChange(fromRGBA(button.rgba, withAlpha)));
    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
}

function colorSwatch(color) {
    const swatch = new Gtk.DrawingArea({
        content_width: 18,
        content_height: 18,
        valign: Gtk.Align.CENTER,
    });
    swatch._color = color;
    swatch.set_draw_func((area, cr, w, h) => {
        const [r, g, b] = area._color;
        cr.setSourceRGBA(r, g, b, 1);
        cr.arc(w / 2, h / 2, Math.min(w, h) / 2 - 1, 0, 2 * Math.PI);
        cr.fill();
        cr.$dispose();
    });
    return swatch;
}

function setSwatchColor(swatch, color) {
    swatch._color = color;
    swatch.queue_draw();
}

// ---------------------------------------------------------------- helpers
function ballSubtitle(b) {
    return `radius ${b.radius} px · mass ${b.mass} · string ${b.restLength} px`;
}

function nextColor(i) {
    return PALETTE[i % PALETTE.length];
}

function roundTo(v, digits) {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
}

function toRGBA(color) {
    const rgba = new Gdk.RGBA();
    rgba.red = color[0];
    rgba.green = color[1];
    rgba.blue = color[2];
    rgba.alpha = color.length > 3 ? color[3] : 1;
    return rgba;
}

function fromRGBA(rgba, withAlpha) {
    const c = [rgba.red, rgba.green, rgba.blue].map(v => roundTo(v, 3));
    if (withAlpha)
        c.push(roundTo(rgba.alpha, 3));
    return c;
}
