# Try it — running the Zofia AppImage yourself

*Written for the maintainer's own machine: "your clearance file", "item 8" and the
install dates below are his. If you are new here, start with the README's "Build from
source" and "Privacy" sections; there is no published AppImage yet.*

What this build is: HANDOFF items 1-7 and 9 (item 5 minus signing; item 8 waits on your
clearance file). The four corners watch Claude Code sessions you opened yourself. The center seat is a real terminal, but until item 8 (your own read of
Anthropic's terms) it only runs the test mock, never the real `claude`.

## 1. Get the AppImage

Built copy: `src-tauri/target/release/bundle/appimage/Zofia_0.2.0_amd64.AppImage`

To rebuild (about 5 minutes):

    npm run build:appimage

That runs `NO_STRIP=true tauri build --bundles appimage`. `NO_STRIP=true` is required on
Fedora 44 because linuxdeploy's `strip` can't read Fedora 44's libraries. The result is
bigger (~107 MB), not broken. Only Fedora 44 x86_64 is tested (`packaging/linux-support.md`).

## 2. Start it

From the repo root, in a terminal:

    ZOFIA_CENTER_COMMAND="$PWD/test/fixtures/mock-claude.sh" \
      src-tauri/target/release/bundle/appimage/Zofia_0.2.0_amd64.AppImage

`ZOFIA_CENTER_COMMAND` must be the absolute path of the committed mock. Anything else,
including `claude`, is refused until item 8. Without it the corners still work, and the
center seat shows why it won't launch.

If FUSE isn't available, add `--appimage-extract-and-run` at the end.

## 3. What you should see

A top bar ("Zofia", the five-hour usage, its reset countdown and the time, "Clear all corners", "Hide C&C"), four corners reading "no session assigned"
and listing the sessions they found,
and the C&C center seat in the middle with a "Working directory" box and a Launch
button. A bar at the top saying "… wiring failed" means something is broken. Please
note its text.

## 4. Watch a session in a corner

The corners read the state files the reader shim writes (installed 2026-09-22), one per
Claude Code session. Every empty corner lists the sessions it has found, newest first,
named by their folder (`SMO`, `Zofia`; two sessions in one folder get the id's first four
characters too), with what each is doing and when it last did something. Click one to
show it in that corner. A session started before 2026-09-24's shim update shows as
"session 1a2b3c4d" until its next event records its folder.

"Paste a session id instead" still takes an id by hand: the file names in
`$XDG_RUNTIME_DIR/zofia/sessions/`, without `.json`.

The corner fills in at once from that session's latest state, then updates on each new
event and re-checks every 15 seconds. Fields Zofia can't read are marked `UNKNOWN` and
are never guessed. Assignments come back after a restart of Zofia, until the next reboot;
"Clear all corners" forgets them.

Zofia only reads these files. It never types into, restarts, or stops a corner session.

## 5. The center seat (mock only)

Type a directory (e.g. `/tmp`) and click Launch. If the directory has its own
`.claude/settings*.json` or `.mcp.json`, you're shown those files first and have to
confirm. The pane shows `Model: sonnet · effort: medium` (owner decisions 4 and 2), read
back from the arguments the seat was actually launched with; the mock ignores both. The
mock prints the arguments it was given, then `MOCK-CLAUDE-READY`, then echoes each line you type as
`HEARD:<line>`. Ctrl+C prints `SIGINT-RECEIVED` and the mock keeps running. Typing `EXIT`
ends it, and Launch comes back. None of the terminal text is written to disk.

## 6. Quit cleanly

Close the window. That stops the center seat's process (and anything it started), and
leaves every corner session alone. If you started it from a terminal, Ctrl+C there works
too; the mock dies with the app.

## Known gaps

- The center seat is the mock until item 8. There's no model picker yet.
- Tested on Fedora 44 x86_64 only. No signed release yet (that needs your key; see TODO).
- Nothing here measures whether Zofia helps. It's an observation and terminal tool.
