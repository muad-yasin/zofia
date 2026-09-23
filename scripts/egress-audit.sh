#!/usr/bin/env bash
# HANDOFF item 6 / PLAN.md §2.3 zero-egress audit. Runs CMD (the Zofia AppImage) inside
# an isolated network namespace that has only loopback, with a private PID namespace so
# every process CMD spawns stays in scope, and traces connect/sendto/sendmsg/execve
# across that whole process tree with `strace -f`. While it runs, it writes mock corner
# activity through the real shim scripts. Then scripts/egress-parse.mjs judges the trace.
#
#   scripts/egress-audit.sh [--duration SECS] [--out DIR] [--allow-exe PATH]... -- CMD [ARGS...]
#
# Defaults: 600s (§2.3's 10 minutes); out = test/runs/egress-<timestamp> (gitignored).
# For the AppImage, set APPIMAGE_EXTRACT_AND_RUN=1 (FUSE doesn't mount inside a user
# namespace) and ZOFIA_CENTER_COMMAND to the mock (test/fixtures/mock-claude.sh). Both
# are inherited. The GUI uses the caller's display: a Wayland or X socket path works
# across a network namespace.
#
# Needs: strace, unshare (util-linux >= 2.38 for --map-user), ip. No root: an
# unprivileged user namespace provides the isolation.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
duration=600
out=""
allow=()
allow_early_exit=0
self_test=0
while [ $# -gt 0 ]; do
  case "$1" in
    --duration) duration="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --allow-exe) allow+=(--allow-exe "$2"); shift 2 ;;
    --allow-early-exit) allow_early_exit=1; shift ;;  # self-tests run short commands
    --self-test) self_test=1; shift ;;                  # permits a window under 600s
    --) shift; break ;;
    *) echo "egress-audit: unknown argument $1 (put the command after --)" >&2; exit 2 ;;
  esac
done
# §2.3 asks for 10 minutes; anything shorter is only for the harness's own self-tests.
case "$duration" in ''|*[!0-9]*) echo "egress-audit: --duration must be a whole number of seconds, got '$duration'" >&2; exit 2 ;; esac
if [ "$duration" -lt 600 ] && [ "$self_test" -eq 0 ]; then
  echo "egress-audit: --duration $duration is shorter than PLAN.md §2.3's 600s (only the harness's self-tests, with --self-test, may go shorter)" >&2
  exit 2
fi
[ $# -gt 0 ] || { echo "usage: egress-audit.sh [--duration S] [--out DIR] [--allow-exe P]... -- CMD..." >&2; exit 2; }
for tool in strace unshare ip jq; do  # jq: the shim scripts behind the mock activity
  command -v "$tool" >/dev/null || { echo "egress-audit: '$tool' is not installed (Fedora: sudo dnf install $tool)" >&2; exit 2; }
done

out="${out:-$REPO/test/runs/egress-$(date +%Y%m%dT%H%M%S)}"
mkdir -p "$out"
trace="$out/trace.txt"
sessions="$out/sessions"
mkdir -p "$sessions"
uid="$(id -u)"
gid="$(id -g)"

# Mock corner activity (§2.3 "mock corner activity"): the real shim scripts, writing
# state for two fake sessions every 5s, into a sessions dir the app is pointed at.
mock_activity() {
  local n=0
  while true; do
    n=$((n + 1))
    for s in mock-a mock-b; do
      printf '{"session_id":"%s","model":{"display_name":"Mock"},"rate_limits":{"five_hour":{"used_percentage":%d,"resets_at":%d}},"cost":{"total_cost_usd":0.%02d}}' \
        "$s" $((n % 100)) $(( $(date +%s) + 3600 )) $((n % 100)) | ZOFIA_SESSIONS_DIR="$sessions" bash "$REPO/reader/shim/statusline-wrapper.sh" >/dev/null
      printf '{"session_id":"%s","hook_event_name":"PreToolUse","tool_name":"Bash"}' "$s" \
        | ZOFIA_SESSIONS_DIR="$sessions" bash "$REPO/reader/shim/hook-writer.sh"
    done
    sleep 5
  done
}
export -f mock_activity
export REPO sessions trace duration

# Outer namespace: net + pid + a user ns where we're root, just long enough to bring up
# loopback. Inner: a nested user ns mapping us back to our own uid, so CMD doesn't run
# as "root" (apps refuse to, or behave differently). When the outer shell exits, the
# PID namespace ends and takes every leftover process with it.
set +e
unshare --user --map-root-user --net --pid --fork --mount-proc bash -c '
  ip link set lo up || { echo "egress-audit: could not bring up loopback" >&2; exit 2; }
  exec unshare --user --map-user='"$uid"' --map-group='"$gid"' bash -c '"'"'
    ZOFIA_SESSIONS_DIR="$sessions" strace -I 1 -f -tt -s 256 -e trace=connect,sendto,sendmsg,sendmmsg,execve,clone,clone3,fork,vfork -o "$trace" -- "$@" &
    tracer=$!
    mock_activity & mock=$!
    sleep "$duration"
    kill -0 "$tracer" 2>/dev/null || touch "$trace.exited-early"
    kill "$mock" 2>/dev/null
    # TERM, and strace -I 1: bash starts a background job with SIGINT ignored, and
    # strace given -o FILE PROG blocks fatal signals by default (-I 3), so the old
    # kill -INT never stopped it and the run hung past its window. PID 1 exiting below
    # kills the detached tree.
    kill -TERM "$tracer" 2>/dev/null  # strace detaches and flushes the trace
    wait "$tracer" 2>/dev/null
    exit 0
  '"'"' _ "$@"
' _ "$@"
ns_status=$?
set -e
[ "$ns_status" -eq 0 ] || { echo "egress-audit: namespace run failed ($ns_status)" >&2; exit 2; }

echo "trace: $trace"
if [ -e "$trace.exited-early" ] && [ "$allow_early_exit" -eq 0 ]; then
  echo "egress-audit: INCONCLUSIVE, the command exited before ${duration}s were up (a crashed app trivially sends nothing). See $trace." >&2
  exit 2
fi
# §2.3 asks for mock corner activity; a window with none proves less than it claims.
for s in mock-a mock-b; do
  [ -s "$sessions/$s.json" ] || { echo "egress-audit: INCONCLUSIVE, no mock activity reached $sessions/$s.json (the shim scripts failed)" >&2; exit 2; }
done
node "$REPO/scripts/egress-parse.mjs" "$trace" "${allow[@]}"
