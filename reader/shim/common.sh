#!/bin/bash
# Shared helpers for Zofia's statusline/hook shim scripts (PLAN.md §2.1 transport).
# Sourced, never executed directly.

# Without XDG_RUNTIME_DIR the fallback is per-user (/tmp/zofia-<uid>), never a shared
# /tmp/zofia another local user could pre-create (audit F10, 2026-09-23). Must match
# reader/src/sessionState.mjs and src-tauri/src/session_reader.rs exactly.
zofia_sessions_dir() {
  if [ -n "${ZOFIA_SESSIONS_DIR:-}" ]; then
    echo "$ZOFIA_SESSIONS_DIR"
  elif [ -n "${XDG_RUNTIME_DIR:-}" ]; then
    echo "$XDG_RUNTIME_DIR/zofia/sessions"
  else
    echo "/tmp/zofia-$(id -u)/sessions"
  fi
}

# A session_id becomes a file name, so only a plain token is accepted: no "/", no "..".
# Claude Code's ids are UUIDs.
zofia_valid_session_id() {
  [[ "$1" =~ ^[A-Za-z0-9_-]{1,128}$ ]]
}

# The directory must be ours and 0700 after the chmod, and nobody else may be able to
# swap it out: its parent is ours, or sticky like /tmp itself (only an entry's owner can
# rename it there). A directory someone else created or controls is never written into.
zofia_dir_is_private() {
  local dir="$1" parent
  parent="$(dirname "$dir")"
  [ -O "$dir" ] && { [ -O "$parent" ] || [ -k "$parent" ]; } && [ "$(stat -c %a "$dir" 2>/dev/null)" = "700" ]
}

# Merges the JSON object $2 into session $1's state file, under an flock so a
# statusline invocation and a hook invocation racing each other can never truncate or
# corrupt the file (the inotify-watched transport PLAN.md §2.1 describes depends on
# every write being one complete, valid JSON document). A malformed patch is dropped
# silently rather than corrupting the last-known-good state.
#
# The merge is top-level only (`+`, not jq's recursive `*`): each writer owns one whole
# key (`latest_statusline`, `latest_hook_event`) and replaces it outright. A deep merge
# kept a sub-field the new payload no longer carries, e.g. `rate_limits.five_hour` after
# Claude Code drops it, and presented it as fresh (audit F2, 2026-09-23; PLAN.md §2.2).
zofia_merge_state() {
  local session_id="$1" patch="$2"
  zofia_valid_session_id "$session_id" || return 0
  local dir; dir="$(zofia_sessions_dir)"
  mkdir -p "$dir" 2>/dev/null
  chmod 0700 "$dir" 2>/dev/null
  zofia_dir_is_private "$dir" || return 0
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
      '($old + $patch) | .updated_at = (now | floor) | .first_seen_at = (.first_seen_at // (now | floor))' 2>/dev/null) || return 0
    [ -n "$merged" ] || return 0
    local tmp="$file.tmp.$$"
    printf '%s\n' "$merged" > "$tmp" && mv -f "$tmp" "$file" && chmod 0600 "$file"
  ) 200>"$lock"
}
