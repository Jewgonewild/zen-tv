#!/bin/bash
# Package launcher/, sign it with your Samsung certificate profile, install it on the TV and open it.
# Needs Developer Mode on the TV (with this computer's IP as the host) and settings.json.
#   --no-open   install only, so whatever is playing keeps playing
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OPEN=1
[ "${1:-}" = "--no-open" ] && OPEN=0

[ -f "$ROOT/settings.json" ] || { echo "No settings.json: run python3 install.py (or copy settings.example.json)"; exit 1; }
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$ROOT/settings.json" 2>/dev/null ||
  { echo "settings.json isn't valid JSON: fix it, or rerun python3 install.py"; exit 1; }
# A value from settings.json (path passed as an argument, so any folder name is safe), or a default
setting() {
  python3 -c 'import json,os,sys
v = json.load(open(sys.argv[1])).get(sys.argv[2]) or sys.argv[3]
print(os.path.expanduser(str(v)))' "$ROOT/settings.json" "$1" "$2"
}
TV="$(setting tvIp '')"
PROFILE="$(setting certificateProfile ZenTV)"
TIZEN_HOME="$(setting tizenStudio '~/tizen-studio')"
TIZEN="$TIZEN_HOME/tools/ide/bin/tizen"
SDB="$TIZEN_HOME/tools/sdb"
APP_ID="ZenTVHome1.Launcher"
REMOTE_WGT="/home/owner/share/tmp/sdk_tools/tmp/ZenTV.wgt"
[ -n "$TV" ] || { echo "Set tvIp in settings.json to your TV's IP address"; exit 1; }
[ -x "$TIZEN" ] || { echo "Tizen Studio CLI not found at $TIZEN (set tizenStudio in settings.json)"; exit 1; }

# A fresh build folder each run, removed however the script ends: it holds the TMDB key (config.js),
# which is written straight into it and never into the repo
BUILD="$(mktemp -d /tmp/zentv-build.XXXXXX)"
trap 'rm -rf "$BUILD"' EXIT

rsync -a --exclude '.DS_Store' --exclude 'config.js' "$ROOT/launcher/" "$BUILD/"
python3 "$ROOT/scripts/zentv.py" config "$BUILD"
# The name and icon in the TV's app list: settings.json "appName" and "icon"
python3 "$ROOT/scripts/zentv.py" package "$BUILD"

PKG_LOG="$("$TIZEN" package -t wgt -s "$PROFILE" -- "$BUILD" 2>&1)" || { echo "$PKG_LOG"; echo "Packaging failed"; exit 1; }
WGT="$(ls "$BUILD"/*.wgt 2>/dev/null | head -1)" # named after the app's name
[ -n "$WGT" ] || { echo "$PKG_LOG"; echo "Packaging produced no .wgt (is the certificate profile \"$PROFILE\" active?)"; exit 1; }
echo "Packaged $(du -h "$WGT" | cut -f1)"
# the TV installer chokes on spaces in the file name
[ "$WGT" = "$BUILD/ZenTV.wgt" ] || cp "$WGT" "$BUILD/ZenTV.wgt"

# Reconnect fresh: the local sdb server goes stale whenever the TV restarts
"$SDB" kill-server >/dev/null 2>&1 || true
"$SDB" start-server >/dev/null 2>&1 || true
if ! "$SDB" connect "$TV" 2>&1 | grep -q "connected to"; then
  echo "Can't reach the TV at $TV. Is it on, with Developer Mode set to this computer's IP (and restarted since)?"
  exit 1
fi
"$SDB" -s "$TV:26101" push "$BUILD/ZenTV.wgt" "$REMOTE_WGT" 2>&1 | tail -1

INSTALL_LOG="$("$SDB" -s "$TV:26101" shell 0 vd_appinstall "$APP_ID" "$REMOTE_WGT" 2>&1 || true)"
if ! echo "$INSTALL_LOG" | grep -q "install completed"; then
  echo "$INSTALL_LOG" | grep -E "install failed|error" || echo "$INSTALL_LOG" | tail -5
  echo "Install failed; the TV still has the previous version"
  exit 1
fi
echo "Installed"
if [ "$OPEN" = 1 ]; then
  "$SDB" -s "$TV:26101" shell 0 was_execute "$APP_ID" 2>&1 | grep -E "launched|fail" || echo "Asked the TV to open it"
else
  echo "Not opened (--no-open)"
fi
