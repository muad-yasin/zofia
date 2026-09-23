#!/usr/bin/env bash
# HANDOFF item 6 acceptance: scripts/egress-audit.sh (PLAN.md §2.3) against the packaged
# AppImage, under Xvfb in the clean image, so the 10-minute window never opens on the
# owner's desktop. The container runs with --network=none; the audit adds its own net + PID
# namespaces inside it (unmask=ALL lets the nested --mount-proc mount /proc). The center
# seat is the committed mock. Build both images first (see Containerfile.egress).
#   test/appimage/run-egress.sh [APPIMAGE] [-- extra egress-audit.sh args, e.g. --duration 60 --self-test]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APPIMAGE="$ROOT/src-tauri/target/release/bundle/appimage/Zofia_0.1.0_amd64.AppImage"
if [ $# -gt 0 ] && [ "$1" != "--" ]; then APPIMAGE="$1"; shift; fi
[ "${1:-}" = "--" ] && shift
REL="${APPIMAGE#"$ROOT"/}"
RUN="egress-$(date +%Y%m%dT%H%M%S)"
mkdir -p "$ROOT/test/runs/$RUN"
podman run --rm --network=none --userns=keep-id \
  --security-opt unmask=ALL --security-opt label=disable \
  -v "$ROOT:/zofia:ro" -v "$ROOT/test/runs/$RUN:/out" -w /zofia \
  -e APPIMAGE_EXTRACT_AND_RUN=1 -e ZOFIA_CENTER_COMMAND=/zofia/test/fixtures/mock-claude.sh \
  zofia-appimage-egress \
  xvfb-run -a -s "-screen 0 1600x1000x24" \
  bash scripts/egress-audit.sh --out /out "$@" -- "/zofia/$REL"
