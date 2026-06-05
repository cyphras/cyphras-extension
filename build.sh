#!/bin/bash

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT/dist"

echo "Building Cyphras Extension..."
cd "$ROOT"
npm run build

echo ""
echo "Build complete!"
echo ""
echo "dist/:"
ls "$DIST_DIR"
