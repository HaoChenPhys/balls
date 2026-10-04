// Runs gnome/extension.js against the shell mock, with the real engine.
//     node --test gnome/test
//
// What this covers: lifecycle (enable/disable/rebuild leaves nothing behind),
// actor layout, the press/drag/release path through Clutter-style events, the
// frame loop stopping when the engine sleeps, config reload incl. visible on/off,
// the hidden-at-login rule, and that the repaint handlers run. What it cannot
// cover: the real GJS bindings; those are only exercised on a real GNOME Shell.
import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

import {makeShellMock, pointerEvent} from './shell-mock.mjs';
import {DEFAULTS, deepCopy} from '../../engine/config.js';

const clock = {now: 0};
const mock = makeShellMock(clock);
let currentConfig = deepCopy(DEFAULTS);
const writtenConfigs = [];           // what the extension wrote via writeConfig()
mock.modules['./configIO.js'] = {
    CONFIG_PATH: '/mock/ball-on-a-string.json',
    readConfig: () => [deepCopy(currentConfig), []],
    writeConfig: cfg => { currentConfig = deepCopy(cfg); writtenConfigs.push(deepCopy(cfg)); },
};
globalThis.__mods = mock.modules;

// Rewrite the platform imports of extension.js to the mock table; keep the
// engine import real (resolved against engine/). Each call imports a fresh
// copy of the module, i.e. simulates a fresh GNOME Shell session (login).
async function loadExtensionModule() {
    const here = new URL('.', import.meta.url);
    let src = readFileSync(new URL('../extension.js', here), 'utf8');
    src = src.replace(/^import (\* as )?([A-Za-z]+|\{[A-Za-z_, ]+\}) from '(gi:\/\/[^']+|cairo|resource:[^']+|\.\/configIO\.js)';/gm,
        "const $2 = globalThis.__mods['$3'];");
    const engineUrl = pathToFileURL(join(new URL('../../engine/physics.js', here).pathname)).href;
    src = src.replace("from './physics.js'", `from '${engineUrl}'`);
    const dir = mkdtempSync(join(tmpdir(), 'balls-ext-'));
    const file = join(dir, 'extension.mjs');
    writeFileSync(file, src);
    return (await import(pathToFileURL(file).href)).default;
}

let Extension;
before(async () => {
    Extension = await loadExtensionModule();
    // The shared module below is "logged in" with showOnLogin so that the
    // first enable() of each test builds the scene; the login rule itself is
    // exercised on fresh modules in the tests at the bottom.
    currentConfig.showOnLogin = true;
    const ext = new Extension();
    ext.enable();
    ext.disable();
    currentConfig = deepCopy(DEFAULTS);
    writtenConfigs.length = 0;
});

const lm = () => mock.layoutManager;
const frame = (ext, us = 16667) => { clock.now += us; ext._timeline.tick(); };

test('enable builds one string canvas and one actor per ball, asleep', () => {
    const ext = new Extension();
    ext.enable();
    assert.equal(lm().chrome.length, 3);
    assert.equal(ext._stringArea.width, 1920);
    assert.equal(ext._stringArea.height, 636);
    assert.equal(ext._stringArea.reactive, false);
    for (const a of ext._ballActors)
        assert.equal(a.reactive, true);
    assert.deepEqual(ext._ballActors.map(a => a.width), [40, 32]);
    assert.equal(ext._timeline.is_playing(), false);
    ext.disable();
    assert.equal(lm().chrome.length, 0);
});

test('press / drag / release drives the engine and the frame loop', () => {
    const ext = new Extension();
    ext.enable();
    const [, blueActor] = ext._ballActors;
    const [red, blue] = ext._chain.bodies;

    blueActor.emit('button-press-event', pointerEvent(1, blue.x, blue.y));
    assert.equal(ext._chain.dragIndex, 1);
    assert.equal(mock.grabs.at(-1).actor, blueActor, 'stage.grab taken on the pressed actor');
    assert.equal(ext._timeline.is_playing(), true);

    for (let i = 1; i <= 20; i++) {
        clock.now += 16000;
        blueActor.emit('motion-event', pointerEvent(1, blue.eqX + i * 20, blue.eqY + i * 3));
        ext._timeline.tick();
    }
    assert.ok(red.x > 1100, 'the top ball follows');
    assert.equal(blueActor.x, Math.round(blue.x - 16), 'actor tracks the body each frame');

    blueActor.emit('button-release-event', pointerEvent(1, 0, 0));
    assert.equal(ext._chain.dragIndex, -1);
    assert.equal(mock.grabs.at(-1).dismissed, true);

    let frames = 0;
    while (ext._timeline.is_playing() && frames < 60 * 120) { frame(ext); frames++; }
    assert.ok(frames / 60 > 5 && frames / 60 < 30, `settled in ${frames / 60} s`);
    assert.equal(ext._timeline.is_playing(), false, 'frame loop stopped when the engine slept');
    assert.equal(red.x, red.eqX);
    ext.disable();
});

test('secondary button and events on a non-dragged ball propagate', () => {
    const ext = new Extension();
    ext.enable();
    const [redActor, blueActor] = ext._ballActors;
    assert.equal(redActor.emit('button-press-event', pointerEvent(3, 0, 0)), false);
    assert.equal(blueActor.emit('motion-event', pointerEvent(1, 0, 0)), false);
    ext.disable();
});

test('config reload: visible off removes everything, visible on with a new chain rebuilds', () => {
    const ext = new Extension();
    ext.enable();
    currentConfig.visible = false;
    mock.fireFileChanged();
    assert.equal(mock.timers.size, 1, 'reload is debounced into one timer');
    mock.fireTimers();
    assert.equal(lm().chrome.length, 0);
    assert.equal(ext._timeline, null);

    currentConfig.visible = true;
    currentConfig.balls = [{radius: 30, mass: 2, restLength: 200, k: 100, color: [0, 1, 0]}];
    mock.fireFileChanged();
    mock.fireTimers();
    assert.equal(lm().chrome.length, 2);
    assert.equal(ext._ballActors[0].width, 70);
    assert.ok(Math.abs(ext._chain.bodies[0].eqY - 244) < 1e-9);
    ext.disable();
    currentConfig = deepCopy(DEFAULTS);
});

test('repaint handlers run and dispose their Cairo context', () => {
    const ext = new Extension();
    ext.enable();
    let disposed = 0;
    const origGetContext = ext._stringArea.get_context;
    for (const a of [ext._stringArea, ...ext._ballActors]) {
        a.get_context = function () { const cr = origGetContext.call(this); const d = cr.$dispose.bind(cr); cr.$dispose = () => { disposed++; d(); }; return cr; };
        a.queue_repaint();
    }
    assert.equal(disposed, 3);
    ext.disable();
});

test('disable during a drag dismisses the grab and destroys all actors', () => {
    const ext = new Extension();
    ext.enable();
    const actors = [ext._stringArea, ...ext._ballActors];
    const b = ext._chain.bodies[0];
    ext._ballActors[0].emit('button-press-event', pointerEvent(1, b.x, b.y));
    ext.disable();
    assert.equal(mock.grabs.at(-1).dismissed, true);
    assert.ok(actors.every(a => a.destroyed));
    assert.equal(lm().chrome.length, 0);
    assert.equal(mock.fileMonitors.at(-1).cancelled, true);
    assert.equal(mock.timers.size, 0);
});

test('login: visible=true is reset to false in the config and nothing is built', async () => {
    const FreshExtension = await loadExtensionModule();
    currentConfig = deepCopy(DEFAULTS);           // visible: true, showOnLogin: false
    writtenConfigs.length = 0;
    const ext = new FreshExtension();
    ext.enable();
    assert.equal(lm().chrome.length, 0, 'starts hidden');
    assert.equal(ext._timeline, null);
    assert.equal(writtenConfigs.length, 1, 'hidden state recorded in the config file');
    assert.equal(writtenConfigs[0].visible, false);
    assert.equal(writtenConfigs[0].showOnLogin, false, 'only "visible" changes');
    assert.deepEqual(Object.keys(writtenConfigs[0]).sort(), Object.keys(DEFAULTS).sort());
    assert.ok(!mock.fileMonitors.at(-1).cancelled, 'still watching the config');

    // `balls on` edits the file -> the balls appear.
    currentConfig.visible = true;
    mock.fireFileChanged();
    mock.fireTimers();
    assert.equal(lm().chrome.length, 3);

    // Screen lock / unlock: disable() + enable() in the same session must not
    // hide them again or write the file again.
    ext.disable();
    assert.equal(lm().chrome.length, 0);
    ext.enable();
    assert.equal(lm().chrome.length, 3, 'unlock keeps the balls');
    assert.equal(writtenConfigs.length, 1);
    ext.disable();
    currentConfig = deepCopy(DEFAULTS);
});

test('login with showOnLogin=true keeps visible as it was and writes nothing', async () => {
    const FreshExtension = await loadExtensionModule();
    currentConfig = {...deepCopy(DEFAULTS), showOnLogin: true};
    writtenConfigs.length = 0;
    const ext = new FreshExtension();
    ext.enable();
    assert.equal(lm().chrome.length, 3);
    assert.equal(writtenConfigs.length, 0);
    ext.disable();
    currentConfig = deepCopy(DEFAULTS);
});

test('login with visible already false writes nothing', async () => {
    const FreshExtension = await loadExtensionModule();
    currentConfig = {...deepCopy(DEFAULTS), visible: false};
    writtenConfigs.length = 0;
    const ext = new FreshExtension();
    ext.enable();
    assert.equal(lm().chrome.length, 0);
    assert.equal(writtenConfigs.length, 0);
    ext.disable();
    currentConfig = deepCopy(DEFAULTS);
});
