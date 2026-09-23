#!/usr/bin/env bash
# Real-window gap tests (test/appimage/live-gaps.mjs) in the same clean image as the smoke,
# with application networking off (--network=none; loopback only, which the WebDriver
# uses) and the extract-and-run path. Build the image first (see run-clean.sh), and
# rebuild the AppImage after any Rust or mock change (npm run build:appimage): the item 8
# gate compares the mock's compiled-in bytes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APPIMAGE="${1:-$ROOT/src-tauri/target/release/bundle/appimage/Zofia_0.1.0_amd64.AppImage}"
REL="${APPIMAGE#"$ROOT"/}"
podman run --rm --network=none --userns=keep-id \
  -v "$ROOT:/zofia:ro,Z" -w /zofia zofia-appimage-smoke \
  xvfb-run -a -s "-screen 0 1600x1000x24" \
  node test/appimage/live-gaps.mjs "/zofia/$REL"
