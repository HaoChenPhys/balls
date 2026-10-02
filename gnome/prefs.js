// Preferences entry point loaded by GNOME Shell
// (gnome-extensions prefs ball-on-a-string@local, or the Extensions app).
// The UI itself lives in prefsWidget.js.

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildPreferencesPage} from './prefsWidget.js';

export default class BallOnAStringPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(560, 760);
        window.add(buildPreferencesPage());
    }
}
