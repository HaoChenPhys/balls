// Driven by prefs-xvfb.sh: builds the real preferences page, pokes its
// widgets, and asserts on the config file it writes. Exits non-zero on failure.
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {buildPreferencesPage} from './prefsWidget.js';
import {CONFIG_PATH} from './configIO.js';

let failures = 0;
const check = (cond, msg) => {
    print(`${cond ? 'ok ' : 'FAIL'} ${msg}`);
    if (!cond)
        failures++;
};
const spin = ms => {
    const until = GLib.get_monotonic_time() + ms * 1000;
    const ctx = GLib.MainContext.default();
    while (GLib.get_monotonic_time() < until)
        ctx.iteration(false);
};
const readCfg = () => {
    const [, bytes] = Gio.File.new_for_path(CONFIG_PATH).load_contents(null);
    return JSON.parse(new TextDecoder().decode(bytes));
};

Adw.init();
const win = new Adw.PreferencesWindow({default_width: 560, default_height: 760});
const page = buildPreferencesPage();
win.add(page);
win.present();
spin(500);

const all = [];
const walk = w => { all.push(w); for (let c = w.get_first_child(); c; c = c.get_next_sibling()) walk(c); };
const rescan = () => { all.length = 0; walk(win); };
rescan();
const rowByTitle = t => all.find(w => w instanceof Adw.PreferencesRow && w.title === t);

check(!Gio.File.new_for_path(CONFIG_PATH).query_exists(null), 'opening the window writes nothing');
for (const t of ['Show the balls', 'Anchor position', 'Gravity', 'Damping', 'Ball collisions', 'Ball 1', 'Ball 2', 'Reset to defaults'])
    check(rowByTitle(t) !== undefined, `row "${t}" exists`);

rowByTitle('Radius').value = 25;
rowByTitle('Gravity').value = 1500;
rowByTitle('Show the balls').active = false;
spin(400);
let c = readCfg();
check(c.balls[0].radius === 25, 'radius written');
check(c.gravity === 1500, 'gravity written');
check(c.visible === false, 'visible written');

all.find(w => w instanceof Gtk.Button && w.icon_name === 'list-add-symbolic').emit('clicked');
spin(400);
c = readCfg();
check(c.balls.length === 3, 'add ball -> 3 balls');

rescan();
const trash = all.filter(w => w instanceof Gtk.Button && w.icon_name === 'user-trash-symbolic');
trash[0].emit('clicked');
spin(400);
c = readCfg();
check(c.balls.length === 2 && c.balls[0].radius === 11, 'remove first ball');

rescan();
const colorBtn = all.find(w => w instanceof Gtk.ColorDialogButton);
const rgba = new Gdk.RGBA();
rgba.parse('#00cc44');
colorBtn.rgba = rgba;
spin(400);
c = readCfg();
check(c.stringColor[1] === 0.8 && c.stringColor.length === 4, 'colour written with alpha');

all.find(w => w instanceof Gtk.Button && w.label === 'Reset').emit('clicked');
spin(400);
c = readCfg();
check(c.gravity === 2200 && c.visible === true && c.balls.length === 2, 'reset restores defaults');

win.close();
spin(100);
print(failures === 0 ? 'all prefs checks passed' : `${failures} prefs check(s) FAILED`);
imports.system.exit(failures === 0 ? 0 : 1);
