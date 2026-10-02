#!/usr/bin/env bash
# Runs the real preferences window (GTK 4 + libadwaita) under a virtual
# display, drives its widgets and checks the JSON it writes.
#
# Needs: gjs gir1.2-adw-1 gir1.2-gtk-4.0 xvfb   (apt install ...)
# Usage: gnome/test/prefs-xvfb.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
for tool in gjs xvfb-run; do
    command -v "$tool" >/dev/null || { echo "skip: $tool not installed"; exit 0; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/cfg"
# Assemble the files the way install.sh does (flat directory).
cp "$ROOT/engine/physics.js" "$ROOT/engine/config.js" \
   "$ROOT/gnome/configIO.js" "$ROOT/gnome/prefsWidget.js" "$WORK/"
cp "$HERE/prefs-xvfb.js" "$WORK/test.js"

cd "$WORK"
XDG_CONFIG_HOME="$WORK/cfg" xvfb-run -a -s "-screen 0 1280x1024x24" gjs -m test.js 2>&1 \
    | grep -v "libEGL\|session bus\|dbus-launch\|^$"
