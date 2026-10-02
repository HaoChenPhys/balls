# Ball on a String

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
balls off         # hide (stays hidden after reboot)
balls settings    # settings window
balls log         # if something goes wrong
```

After changing code: run `gnome/install.sh` again and log out/in.
Changing settings never needs that.

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

## License

Apache License 2.0 — see `LICENSE`. Copyright 2026 Zoltan Guba.
