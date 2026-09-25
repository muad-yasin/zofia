# Changelog

All notable changes are listed here, newest first. Versions follow
[Semantic Versioning](https://semver.org/); while the version is 0.x, a minor bump may
change behaviour.

## Unreleased

### Changed
- The app identifier is now `de.sower_industries.zofia` (was `de.sower.zofia`). The
  webview's data directory moves with it. If you ran a local 0.1 or 0.2 build, the old
  `~/.local/share/de.sower.zofia/` holds webview cache only and can be deleted. Corner
  assignments are unaffected (they live in `$XDG_RUNTIME_DIR/zofia/`).
- Sample and test data use neutral project names.

## 0.2.0 (2026-09-25, not released as a build)

"Ready for strangers": the repo can be read, built and installed by someone who isn't the
maintainer. There is still no downloadable build.

### Added
- **A "needs you" queue** in the top bar. It lists sessions that wait on you: blocked first,
  then failed, then "your turn", each with the longest wait first. The window title shows
  the count, the corner gets a frame, an off-screen tab gets a mark, and a click or Alt+N
  jumps to the session. Focusing a failed or your-turn corner takes it off the queue. A
  blocked one stays until it moves on.
- **Honest waiting states.** "blocked: permission" / "blocked: question", "your turn", and
  "failed: <error type>" (such as `rate_limit`), each with its own glyph and colour.
- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue templates, this changelog.
- README rewritten for people who are not the maintainer. A Privacy section lists every
  file Zofia installs, reads and writes. New notes: Windows users run it under WSL2
  (untested), and macOS isn't supported yet.
- `src-tauri/src/platform.rs`: every OS-specific call in one module. Linux behaviour is
  unchanged. Windows and macOS compile but are not supported.

### Changed
- The installer registers three more hooks (`StopFailure`, `PermissionRequest`,
  `PostToolUseFailure`), ten in all. **Re-run the installer** to get them; it adds only
  what is missing.
- The model guard refuses Kimi/Moonshot ids too, as it already refused xAI/Grok and
  `openrouter/auto`.

### Fixed
- After an API error such as a rate limit, a corner read "processing" and kept counting
  for as long as the session lived. It now reads "failed: rate_limit".
- A finished turn read "working for …" again once Claude Code's idle-prompt notification
  arrived. It now keeps "worked for …".
- Re-installing from a checkout whose path doesn't contain "zofia" wrapped Zofia's own
  status line a second time.
- The installer ignored `CLAUDE_CONFIG_DIR` and always patched `~/.claude/settings.json`.
- The shim installer no longer says Claude Code's footer is unaffected when no status line
  existed before. Claude Code hides most footer key hints whenever any status line is set.
- The frontend tests pin a 24-hour locale, so they pass on en-US machines, and stop the
  preview server they start, so the run no longer hangs at the end.

## 0.1.0 (not released)

First build: four read-only corners fed by the status-line and hook shim, the center seat
against a test mock, a Fedora 44 AppImage, and a zero-egress audit of the app's process
tree (2026-09-23). Public since 2026-09-25: Apache-2.0 at first, MIT later the same day.
