#!/bin/bash
# Zofia observation-bridge shim (PLAN.md §2.1) — installed once per lifecycle hook
# (Stop/PreToolUse/PostToolUse/Notification, plus SessionStart/SessionEnd for the
# activity-state machine's terminal cases, and StopFailure/PermissionRequest/
# PostToolUseFailure for failed and blocked turns). It prints nothing, so it never
# answers a PermissionRequest; Claude Code shows its own prompt as before. Claude Code's hooks array already supports
# multiple independent handlers per event, so install.mjs appends this alongside
# whatever the owner already had — no wrapping needed here, unlike statusLine.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/common.sh"

input="$(cat)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty')"
now_ts=$(date +%s)

patch="$(printf '%s' "$input" | jq -c --argjson ppid "${PPID:-null}" --argjson now "$now_ts" '{
  pid: $ppid,
  latest_hook_event: {
    observed_at: $now,
    hook_event_name: .hook_event_name,
    tool_name: (.tool_name // null),
    notification_type: (.notification_type // null),
    end_reason: (.end_reason // null),
    error_type: (.error_type // null),
    start_reason: (.start_reason // null)
  },
  cwd: (.cwd // null),
  turn_started_at: (if .hook_event_name == "UserPromptSubmit" then $now else null end),
  turn_ended_at: (if .hook_event_name == "Stop" or .hook_event_name == "StopFailure" then $now else null end)
} | if .cwd == null then del(.cwd) else . end
  | if .turn_started_at == null then del(.turn_started_at) else . end
  | if .turn_ended_at == null then del(.turn_ended_at) else . end' 2>/dev/null)"

if [ -n "$patch" ]; then
  zofia_merge_state "$session_id" "$patch"
fi
exit 0
