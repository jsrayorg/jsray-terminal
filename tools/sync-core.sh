#!/bin/sh
# JSRay Terminal · sync bundled Core runtime and palettes from the Core repo.
#
# Usage:
#   sh tools/sync-core.sh              # expects Core repo at ../jsray
#   JSRAY_CORE_DIR=/path/to/jsray sh tools/sync-core.sh
set -e
cd "$(dirname "$0")/.."

CORE_DIR="${JSRAY_CORE_DIR:-../jsray}"
CORE_DIST="$CORE_DIR/dist"

if [ ! -f "$CORE_DIST/jsray.js" ]; then
  echo "error: Core dist not found at $CORE_DIST — run 'sh build.sh' in Core first." >&2
  exit 1
fi

mkdir -p vendor palettes
cp "$CORE_DIST/jsray.js" vendor/jsray.cjs
cp "$CORE_DIR/tokens.json" palettes/default.json
if [ -d "$CORE_DIR/themes" ]; then
  cp "$CORE_DIR"/themes/*.json palettes/ 2>/dev/null || true
fi

if command -v node >/dev/null 2>&1; then
  node tools/sync-core-version.mjs "$CORE_DIR"
else
  echo "warn: node not found — assets copied, bundledCore.version not updated." >&2
fi

echo "synced Core ($CORE_DIR) → vendor/ + palettes/"
