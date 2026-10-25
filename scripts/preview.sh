#!/bin/bash
# Preview the launcher in a desktop browser (http://localhost:5178): arrow keys, Enter = OK,
# Escape or Backspace = Back.
# Apps don't open in the browser; everything else (rows, search, profiles) does.
# Only this computer can open it (127.0.0.1): config.js holds your TMDB key while it runs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
trap 'rm -f "$ROOT/launcher/config.js"' EXIT
python3 "$ROOT/scripts/zentv.py" config "$ROOT/launcher"
echo "Open http://localhost:5178 (Ctrl+C to stop; launcher/config.js is removed on exit)"
cd "$ROOT/launcher" && python3 -m http.server 5178 --bind 127.0.0.1
