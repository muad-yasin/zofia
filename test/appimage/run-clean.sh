#!/usr/bin/env bash
# PLAN.md §6 / HANDOFF.md item 5 acceptance, run in a clean Fedora 44 image under Xvfb with
# application networking blocked (--network=none; loopback only, which the WebDriver uses).
# Two launch paths: FUSE (device + SYS_ADMIN granted) and --appimage-extract-and-run
# (no FUSE device at all). Build the image first:
#   podman build -t zofia-appimage-smoke -f test/appimage/Containerfile test/appimage
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APPIMAGE="${1:-$ROOT/src-tauri/target/release/bundle/appimage/Zofia_0.1.0_amd64.AppImage}"
REL="${APPIMAGE#"$ROOT"/}"
OUT="${SMOKE_OUT_DIR:-/tmp/zofia-smoke-out}"   # screenshots land here on the host
mkdir -p "$OUT"
status=0

run() {
  local label="$1"; shift
  echo "=== $label ==="
  podman run --rm --network=none --userns=keep-id "$@" \
    -v "$ROOT:/zofia:ro,Z" -v "$OUT:/out:Z" -e SMOKE_OUT_DIR=/out -w /zofia zofia-appimage-smoke \
    xvfb-run -a -s "-screen 0 1600x1000x24" \
    node test/appimage/smoke.mjs "/zofia/$REL" ${EXTRA:-} || status=1
}

run "FUSE path" --device /dev/fuse --cap-add SYS_ADMIN
EXTRA=--extract-and-run run "extract-and-run, no FUSE device"
exit $status
