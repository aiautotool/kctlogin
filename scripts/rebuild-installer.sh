#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[KCTLogin] Cleaning old build output..."
rm -rf dist dist-server release

echo "[KCTLogin] Building app..."
npm run build

echo "[KCTLogin] Creating macOS installer..."
npx electron-builder --mac dmg

echo "[KCTLogin] Installer files:"
find release -maxdepth 1 -type f \( -name "*.dmg" -o -name "*.zip" -o -name "*.blockmap" \) -print
