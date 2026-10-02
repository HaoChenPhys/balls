#!/usr/bin/env bash
# Build Ball on a String for macOS and assemble a double-clickable .app.
#
# Needs the Xcode command-line tools (xcode-select --install), nothing else.
#   ./build.sh            -> build/Ball on a String.app
#   ./build.sh --install  -> also copy it to /Applications and launch it
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"      # .../macos
ROOT="$(cd "$HERE/.." && pwd)"                            # repo root
APP_NAME="Ball on a String"
APP="$HERE/build/$APP_NAME.app"

for f in "$ROOT/engine/physics.js" "$ROOT/engine/config.js"; do
    [ -f "$f" ] || { echo "error: missing $f" >&2; exit 1; }
done

echo "Compiling..."
(cd "$HERE" && swift build -c release 2>&1 | tail -3)
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
