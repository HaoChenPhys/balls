# Ball on a String

[![CI](https://github.com/gubazoltan/balls/actions/workflows/ci.yml/badge.svg)](https://github.com/gubazoltan/balls/actions/workflows/ci.yml)

A desktop fidget toy: balls on elastic strings hang from the top of the
screen, above your windows. Grab, pull, fling. Clicks anywhere else pass
through to the window underneath.

Works on GNOME (Wayland) and macOS.

```
engine/   the physics, shared by both platforms
gnome/    GNOME Shell extension
macos/    Mac app
```

## Install on GNOME

1. Get the project: `git clone https://github.com/gubazoltan/balls`
2. Install: `balls/gnome/install.sh`
3. Log out and back in once.

The toy is a GNOME Shell extension. Control it from a terminal:

```bash
balls on          # show
balls off         # hide
balls settings    # settings window
balls log         # if something goes wrong
```

After logging in the balls are hidden until you run `balls on`. If you
would rather have them come back as you left them, turn on "Show at login"
in `balls settings`.

After changing code: run `gnome/install.sh` again and log out/in.
Changing settings never needs that.

To remove it: `balls/gnome/install.sh --uninstall` (add `--purge` to delete
your settings file as well).

## Install on macOS

1. Get the project: `git clone https://github.com/gubazoltan/balls`
2. Install: `cd balls/macos && ./build.sh --install`
3. First time only, before step 2: `xcode-select --install`
   (Macs ship without a compiler; this adds one. A dialog pops up, takes a few minutes.)

The toy is a small app in the menu bar (top right, a small circle, no Dock
icon). Control it from there:

```
Show Balls        # show / hide (stays hidden after reboot)
Settings…         # settings window
Quit
```

To start it automatically at login: System Settings › General › Login Items › "+".

After changing code: quit the app, run `./build.sh --install` again.
Changing settings never needs that.

To remove it: `./build.sh --uninstall` (add `--purge` to delete your settings
file as well), and take it out of Login Items if you added it there.

## Tests

```bash
node --test 'engine/test/*.test.mjs'     # physics and config (needs Node 22)
node --test 'gnome/test/*.test.mjs'      # extension against a mocked shell
gnome/test/prefs-xvfb.sh                 # real GTK settings window (needs gjs, libadwaita, xvfb)
cd macos && swift test                   # Swift <-> engine bridge (needs Xcode's XCTest)
```

GitHub Actions runs all of these plus the macOS build on every push.

## License

Apache License 2.0 — see `LICENSE`. Copyright 2026 Zoltan Guba.
