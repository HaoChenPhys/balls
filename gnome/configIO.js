// GNOME-side file access for the shared config (engine/config.js).
// Used by extension.js (inside GNOME Shell) and prefsWidget.js (prefs process).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {DEFAULTS, deepCopy, parseConfig, serializeConfig} from './config.js';

export const CONFIG_PATH = GLib.build_filenamev(
    [GLib.get_user_config_dir(), 'ball-on-a-string.json']);

/** Read and merge the config file. Never throws. Returns [config, warnings]. */
export function readConfig() {
    const file = Gio.File.new_for_path(CONFIG_PATH);
    if (!file.query_exists(null))
        return [deepCopy(DEFAULTS), []];
    let text;
    try {
        const [, bytes] = file.load_contents(null);
        text = new TextDecoder().decode(bytes);
    } catch (e) {
        return [deepCopy(DEFAULTS), [`cannot read ${CONFIG_PATH}: ${e.message}; using defaults`]];
    }
    return parseConfig(text);
}

/** Write the config file atomically (temp file + rename). Throws on failure. */
export function writeConfig(cfg) {
    const file = Gio.File.new_for_path(CONFIG_PATH);
    GLib.mkdir_with_parents(file.get_parent().get_path(), 0o755);
    const bytes = new TextEncoder().encode(serializeConfig(cfg));
    file.replace_contents(bytes, null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
