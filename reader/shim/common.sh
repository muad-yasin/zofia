#!/bin/bash
# Shared helpers for Zofia's statusline/hook shim scripts (PLAN.md §2.1 transport).
# Sourced, never executed directly.

zofia_sessions_dir() {
  local runtime_dir="${XDG_RUNTIME_DIR:-/tmp}"
  echo "${ZOFIA_SESSIONS_DIR:-$runtime_dir/zofia/sessions}"
}

# Deep-merges the JSON object $2 into session $1's state file, under an flock so a
# statusline invocation and a hook invocation racing each other can never truncate or
# corrupt the file (the inotify-watched transport PLAN.md §2.1 describes depends on
# every write being one complete, valid JSON document). A malformed patch is dropped
# silently rather than corrupting the last-known-good state.
zofia_merge_state() {
  local session_id="$1" patch="$2"
  [ -n "$session_id" ] || return 0
  local dir; dir="$(zofia_sessions_dir)"
  mkdir -p "$dir" 2>/dev/null
  chmod 0700 "$dir" 2>/dev/null
  local file="$dir/$session_id.json"
  local lock="$dir/.$session_id.lock"
  (
    flock -x 200
    local existing="{}"
    if [ -s "$file" ]; then
      existing="$(cat "$file" 2>/dev/null || echo '{}')"
      # A corrupted state file self-heals to {} rather than permanently wedging every
      # future write behind a parse failure.
      echo "$existing" | jq -e . >/dev/null 2>&1 || existing="{}"
    fi
    local merged
    merged=$(jq -n --argjson old "$existing" --argjson patch "$patch" \
      '($old * $patch) | .updated_at = (now | floor) | .first_seen_at = (.first_seen_at // (now | floor))' 2>/dev/null) || return 0
    [ -n "$merged" ] || return 0
    local tmp="$file.tmp.$$"
    printf '%s\n' "$merged" > "$tmp" && mv -f "$tmp" "$file" && chmod 0600 "$file"
  ) 200>"$lock"
}
