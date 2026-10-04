#!/usr/bin/env bash
# Build Ball on a String for macOS and assemble a double-clickable .app.
#
# Needs the Xcode command-line tools (xcode-select --install), nothing else.
#   ./build.sh              -> build/Ball on a String.app
#   ./build.sh --install    -> also copy it to /Applications and launch it
#   ./build.sh --uninstall  -> quit the app and remove it from /Applications
#                              (keeps ~/.config/ball-on-a-string.json; add
#                              --purge to delete that too)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"      # .../macos
ROOT="$(cd "$HERE/.." && pwd)"                            # repo root
APP_NAME="Ball on a String"
APP="$HERE/build/$APP_NAME.app"
CONFIG="$HOME/.config/ball-on-a-string.json"

if [ "${1:-}" = "--uninstall" ]; then
    # Ask the running app to quit (it saves its config on the way out). Only
    # when it is actually running: osascript would otherwise try to find it.
    if pgrep -x BallOnAString >/dev/null 2>&1; then
        osascript -e "tell application \"$APP_NAME\" to quit" 2>/dev/null || pkill -x BallOnAString || true
        sleep 1
    fi
    for d in "/Applications/$APP_NAME.app" "$APP"; do
        if [ -e "$d" ]; then
            rm -rf "$d"; echo "Removed $d"
        fi
    done
    if [ "${2:-}" = "--purge" ]; then
        rm -f "$CONFIG" && echo "Removed $CONFIG"
    elif [ -e "$CONFIG" ]; then
        echo "Kept your settings in $CONFIG (re-run with --uninstall --purge to delete them)"
    fi
    echo "Done. If you had added the app under System Settings > General > Login Items, remove it there too."
    exit 0
fi
case "${1:-}" in ""|--install) ;; *) echo "usage: $0 [--install | --uninstall [--purge]]" >&2; exit 1 ;; esac

for f in "$ROOT/engine/physics.js" "$ROOT/engine/config.js"; do
    [ -f "$f" ] || { echo "error: missing $f" >&2; exit 1; }
done

echo "Compiling..."
# (the XCTest/xcrun warning from command-line-tools-only installs is harmless: no tests here)
(cd "$HERE" && swift build -c release 2>&1 | grep -v "XCTest\|xcrun: error" | tail -3)
BIN="$(cd "$HERE" && swift build -c release --show-bin-path)/BallOnAString"
[ -x "$BIN" ] || { echo "error: build produced no executable" >&2; exit 1; }

echo "Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/BallOnAString"
cp "$HERE/Info.plist" "$APP/Contents/"
cp "$ROOT/engine/physics.js" "$ROOT/engine/config.js" "$APP/Contents/Resources/"
printf 'APPL????' > "$APP/Contents/PkgInfo"
# Ad-hoc signature so Gatekeeper is content with a locally built app.
codesign --force --sign - "$APP" 2>/dev/null || true

if [ "${1:-}" = "--install" ]; then
    rm -rf "/Applications/$APP_NAME.app"
    cp -R "$APP" /Applications/
    echo "Installed to /Applications/$APP_NAME.app"
    open "/Applications/$APP_NAME.app"
else
    cat <<EOF
Done. Launch with:
    open "$APP"
or install to /Applications and launch:
    ./build.sh --install

It lives in the menu bar (a small circle icon): Show Balls, Settings…, Quit.
To start it at login: System Settings > General > Login Items > "+" and pick
the app. Settings are stored in ~/.config/ball-on-a-string.json, the same
format as the GNOME version.
EOF
fi
