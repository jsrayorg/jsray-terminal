#!/bin/sh
# JSRay Terminal · sync bundled Core runtime and palettes from the Core repo.
#
# Usage:
#   sh tools/sync-core.sh                            # Core repo at ../jsray
#   JSRAY_CORE_DIR=/path/to/jsray sh tools/sync-core.sh
#   JSRAY_CORE_VERSION=0.0.1-beta.3 sh tools/sync-core.sh   # from npm, for CI
set -e
cd "$(dirname "$0")/.."

# Where the Core files come from.
#
# A sibling checkout is what a maintainer has locally, and is what lets
# sync-integrations.sh exercise an unreleased Core. No CI runner has one, so
# reading only a checkout meant nothing automatic could ever apply a Core fix —
# which is why a published fix could sit unpropagated here. Unpacking the
# published tarball gives the same files: Core publishes the dist and the
# palette sources that get vendored.
if [ -n "$JSRAY_CORE_VERSION" ]; then
  CORE_TMP=$(mktemp -d)
  trap 'rm -rf "$CORE_TMP"' EXIT
  ( cd "$CORE_TMP" && npm pack "@jsray/core@$JSRAY_CORE_VERSION" >/dev/null && tar xzf ./*.tgz )
  CORE_DIR="$CORE_TMP/package"
  echo "source: npm @jsray/core@$JSRAY_CORE_VERSION"
else
  CORE_DIR="${JSRAY_CORE_DIR:-../jsray}"
  echo "source: checkout $CORE_DIR"
fi
CORE_DIST="$CORE_DIR/dist"

if [ ! -f "$CORE_DIST/jsray.js" ]; then
  echo "error: Core dist not found at $CORE_DIST — run 'sh build.sh' in Core first." >&2
  exit 1
fi

mkdir -p vendor palettes
cp "$CORE_DIST/jsray.js" vendor/jsray.cjs
cp "$CORE_DIR/tokens.json" palettes/default.json
# Fail rather than skip. This used to be guarded by `if [ -d ... ]`, which
# meant a Core source without palette sources produced one palette instead of
# four — silently, and only visible to a user who went looking for a theme
# that had stopped existing.
if [ ! -d "$CORE_DIR/themes" ]; then
  echo "error: no palette sources at $CORE_DIR/themes" >&2
  echo "       a Core older than 0.0.1-beta.4 does not publish them to npm;" >&2
  echo "       sync from a checkout with JSRAY_CORE_DIR instead." >&2
  exit 1
fi
cp "$CORE_DIR"/themes/*.json palettes/

# The token vocabulary travels with the snapshot: it is what maps a tk-* class
# to a palette key, and what a user palette is validated against.
cp "$CORE_DIR/vocabulary.json" vocabulary.json

if command -v node >/dev/null 2>&1; then
  node tools/sync-core-version.mjs "$CORE_DIR"
else
  echo "warn: node not found — assets copied, bundledCore.version not updated." >&2
fi

echo "synced Core ($CORE_DIR) → vendor/ + palettes/"
