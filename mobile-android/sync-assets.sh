#!/usr/bin/env bash
# Copy the built React UI into the Android app's assets so the WebView can load it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/ui/dist"
DST="$ROOT/mobile-android/app/src/main/assets/app"
if [ ! -d "$SRC" ]; then
  echo "ui/dist not found; run 'cd ui && npm run build' first" >&2
  exit 1
fi
rm -rf "$DST"
mkdir -p "$DST"
cp -R "$SRC"/. "$DST"/
echo "Synced $SRC -> $DST"
