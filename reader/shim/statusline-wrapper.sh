#!/bin/bash
# Zofia observation-bridge shim (PLAN.md §2.1) — installed as the statusLine command.
#
# If the owner already had a statusLine command configured, install.mjs sets
# ZOFIA_ORIGINAL_STATUSLINE_CMD as an env-var prefix on this script's own command
# string, and this wrapper invokes it with the *original*, unmodified input and passes
# its stdout through unchanged — Zofia never replaces what the owner already had
# (PLAN.md §2.1: "wraps it").
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/common.sh"

input="$(cat)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
now_ts=$(date +%s)

patch="$(printf '%s' "$input" | jq -c --argjson ppid "${PPID:-null}" --argjson now "$now_ts" '{
  pid: $ppid,
  latest_statusline: {
    observed_at: $now,
    model: .model,
    effort: .effort,
    rate_limits: .rate_limits,
    context_window: .context_window,
    cost: .cost
  }
}' 2>/dev/null)"

if [ -n "$patch" ]; then
  zofia_merge_state "$session_id" "$patch"
fi

if [ -n "${ZOFIA_ORIGINAL_STATUSLINE_CMD:-}" ]; then
  printf '%s' "$input" | eval "$ZOFIA_ORIGINAL_STATUSLINE_CMD"
fi
# No prior statusLine configured: print nothing, so Claude Code falls back to its own
# default footer rather than Zofia inventing a visible line the owner never asked for.
