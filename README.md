# Zofia

A Linux desktop app that shows several Claude Code terminal sessions on one screen.
You open up to four Claude Code sessions in your own terminals, as usual. Zofia shows
each one in a corner of its window: model, effort, context used, five-hour usage and
its reset time, what the session is doing right now, and when it was last active.
Sessions that wait on you (a permission prompt, a question, a failed turn, a finished
turn) are listed in the top bar, oldest wait first, one click away.

![How Zofia sees your sessions: your Claude Code terminals write a status line and hook events to local state files, and Zofia shows each session as a read-only card](docs/media/zofia-how-it-works-v2.gif)

<!-- GIF 2 goes here (supplied separately): docs/media/<name>.gif -->

**Status: early and unreleased (0.1.0).** There is no downloadable build yet; you build
it from source. It is tested on Fedora 44 x86_64 only. The center seat (a sixth pane for
chatting with a Claude Code process Zofia starts itself) currently runs only a built-in
test mock, never the real `claude`. Nothing here claims Zofia makes you or your agents
more productive; nobody has measured that.

Zofia is an independent project. It is not made, endorsed or supported by Anthropic.
"Claude" and "Claude Code" are Anthropic's names for their products.

## What it does, and what it does not

- **Corners are read-only.** Zofia never types into, restarts or stops a session you
  opened. It reads small state files that your own sessions write (see Privacy).
- **Nothing leaves your machine.** No telemetry, no analytics, no update checks, no
  network calls of its own. An egress audit of the app's whole process tree recorded
  zero non-loopback connection attempts over a 10-minute window
  (`docs/EGRESS-AUDIT-2026-09-23.md`, which also lists what that audit did not cover).
- **It does not read your transcripts** (your conversation history) or your Claude
  credentials.

## Privacy: what Zofia installs, reads and writes

To see inside your sessions, Zofia needs one opt-in step: a small installer adds a
status-line command and ten hooks to your Claude Code user settings,
`~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json` if you set that variable). It shows you the full diff and changes nothing unless you pass
`--apply --yes`. After that, every Claude Code session you start runs two short shell
scripts from `reader/shim/` in your checkout.

| What | Where | Contents |
|---|---|---|
| Your settings, changed | `~/.claude/settings.json` | `statusLine` set to Zofia's wrapper (an existing status line keeps running and showing, wrapped); a hook for `Stop`, `StopFailure`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `SessionStart`, `SessionEnd`, `UserPromptSubmit` added beside yours. The hooks print nothing, so they never answer a permission prompt for you |
| Backup and install record | `~/.claude/zofia/` (mode 0700; under `$CLAUDE_CONFIG_DIR` if set) | a copy of your settings from before the install, and what was added, for uninstall |
| One state file per session | `$XDG_RUNTIME_DIR/zofia/sessions/<session_id>.json` (0700 dir, 0600 files; RAM-backed, gone at reboot) | the session's process id, working folder, model, effort, rate-limit usage, context usage, cost figures, the name (not the input) of the last tool or hook event, and for a turn that ended on an API error its category (such as `rate_limit`). No prompts, no replies, no error messages, no file contents, no tool arguments |
| Corner assignments | `$XDG_RUNTIME_DIR/zofia/assignments.json` | which session you put in which corner |

Without `XDG_RUNTIME_DIR` the files go to `/tmp/zofia-<your uid>/` instead.

Two side effects you should know about before installing:

- Claude Code hides most of its footer key hints (such as "esc to interrupt") whenever
  any status line is configured. If you had no status line before, you will notice that.
- The hooks run on every tool call in every session, so they need `bash`, `jq` and
  `flock` installed. If `jq` is missing they silently write nothing.

**Uninstall** with `node reader/install/uninstall.mjs --apply --yes` (drop the flags to
preview). It restores your previous status line and removes only Zofia's hooks. If
`settings.json` changed since the install, it refuses and points you at the backup, so
you can edit the file yourself. **Uninstall before you delete or move the checkout:** the
hooks point at scripts inside it.

## Build from source

You need Node.js (22 works), a Rust toolchain, and the system libraries Tauri v2 needs on
Linux (WebKitGTK 4.1 and friends; see Tauri's own "Prerequisites" page for your
distribution), plus `xdg-utils`, which the AppImage bundler insists on. Then:

    npm ci
    npm run build:appimage        # the AppImage lands in src-tauri/target/release/bundle/appimage/

`build:appimage` sets `NO_STRIP=true` because the bundler's `strip` cannot read Fedora 44's
libraries. To install the observation bridge described above:

    node reader/install/install.mjs                 # shows the diff, writes nothing
    node reader/install/install.mjs --apply --yes   # installs

Then open Claude Code in a terminal or two and start the AppImage. Each empty corner
lists the sessions it found; click one to show it. `docs/TRY-IT.md` has the longer
walkthrough (written for the maintainer's machine, so some paths are his).

## Windows and macOS

Zofia is Linux-only for now. **On Windows, use WSL2**: run Claude Code and Zofia inside
the same WSL2 distribution (WSLg shows the window). This is untested. A native Windows
build is not planned for now: its webview (WebView2) makes network calls of its own, which
would break the "nothing leaves your machine" rule. macOS is not supported yet.

## Claude Code's terms

Zofia runs on your own Claude Code install, signed in with your own account; it never
sees your credentials. Reading your own sessions' status is what Claude Code's status line
and hooks are documented for. Starting and driving a `claude` process from a GUI (the
center seat) is a different question on a Free, Pro or Max plan: Anthropic's Consumer
Terms bar access "through automated or non-human means" unless they permit it, and its
Claude Code legal page says subscription limits assume "ordinary, individual usage". That
is why the center seat is locked to a mock for now. Read the terms yourself before you use
any tool like this on a subscription: <https://www.anthropic.com/legal/consumer-terms>
and <https://code.claude.com/docs/en/legal-and-compliance>. This is not legal advice.

## Tests

    npx playwright install chromium   # once, for the frontend tests
    npm test                      # frontend, headless Chromium via Playwright
    (cd reader && node --test)    # the observation bridge
    (cd src-tauri && cargo test)  # the Rust backend

## Security, contributing, licence

- Found a security problem? See `SECURITY.md`. Please do not open a public issue for it.
- `CONTRIBUTING.md` says how to propose a change; `CODE_OF_CONDUCT.md` applies everywhere.
- MIT licence, see `LICENSE`. Changes are listed in `CHANGELOG.md`.

## Repo layout

- `reader/`: the observation bridge (shim scripts, installer, a CLI that prints one
  session's state). `src/`: the frontend (vanilla TypeScript). `src-tauri/`: the Rust
  backend. `test/`: end-to-end, AppImage, egress and config tests.
- `docs/`: measured reference facts (`field-availability.md`, the egress audit).
- `PLAN.md`, `HANDOFF.md`, `PROGRESS.md`, `DECISIONS.md`, `BUILT.md`, `ROADMAP.md`,
  `TODO.md`: the build record. The project is built with Claude Code sessions, and
  `CLAUDE.md` is the instruction file those sessions read, so these files speak of "the
  owner" (the maintainer) and of numbered build items.
