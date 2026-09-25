# Zofia observation-bridge shim

Two scripts, installed via `../install/install.mjs` (installed on the owner's real
`~/.claude/settings.json` since 2026-09-22, reinstalled 2026-09-23 — see `../../DECISIONS.md`).
The installed commands point at this folder, so an edit here is live in every session at
its next event:

- `statusline-wrapper.sh` — installed as the `statusLine` command. Wraps any pre-existing
  one (invokes it, passes its stdout through unchanged) rather than replacing it.
- `hook-writer.sh` — installed once per lifecycle hook (`Stop`, `PreToolUse`,
  `PostToolUse`, `Notification`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`). Appended alongside
  whatever the owner already had registered for that event; nothing is wrapped or
  replaced, since Claude Code's hooks array already supports multiple handlers.

Both write into the same per-session state file, merged under an `flock` (see
`common.sh`) so a statusline tick and a hook firing at the same instant can't corrupt
each other's write.

## Raw state file schema

Path: `$XDG_RUNTIME_DIR/zofia/sessions/<session_id>.json` (dir `0700`, file `0600`,
tmpfs — nothing persists across reboot). `reader/src/deriveSnapshot.mjs` is the only
code in this folder that reads this file and turns it into the nine-field `SessionSnapshot`
the CLI renders; `src-tauri/src/session_reader.rs` is its Rust port for the GUI.

```jsonc
{
  "pid": 12345,                 // $PPID as seen by the shim script — the Claude Code
                                 // process that invoked it. Used for a real liveness
                                 // check (kill -0), never a timeout guess.
  "updated_at": 1700000000,     // set on every write
  "first_seen_at": 1700000000,  // set once, on the first write only
  "cwd": "/home/u/code/webshop", // the session's folder (statusline workspace.current_dir
                                 // or hook cwd); names it in the corner picker. A payload
                                 // without one keeps the last.
  "turn_started_at": 1700000000, // set on UserPromptSubmit only: the turn the duration
                                 // line times ("working for" / "worked for")

  "latest_statusline": {        // present once at least one statusline tick has fired
    "observed_at": 1700000000,
    "model": { "id": "...", "display_name": "..." },
    "effort": { "level": "high" } ,       // absent -> null (see Claude Code docs)
    "rate_limits": { "five_hour": { "used_percentage": 12.5, "resets_at": 1700003600 } },
    "context_window": { "used_percentage": 8, "total_input_tokens": 1000, "total_output_tokens": 50 },
    "cost": { "total_cost_usd": 0.42, "total_duration_ms": 5000, "total_api_duration_ms": 1200 }
  },

  "latest_hook_event": {        // present once at least one hook has fired
    "observed_at": 1700000000,
    "hook_event_name": "PreToolUse",
    "tool_name": "Bash",           // PreToolUse/PostToolUse only, else null
    "notification_type": null,     // Notification only
    "end_reason": null,            // SessionEnd only
    "start_reason": null           // SessionStart only
  }
}
```

Every field here is a *raw capture*, not yet the provenance-tagged shape the plan
requires — `deriveSnapshot.mjs` is where `{value, availability, source, observed_at}`
gets built, deliberately kept separate so the shim scripts stay small and boring.
