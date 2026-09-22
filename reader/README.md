# @zofia/reader

Week-1, Track A (`HANDOFF.md` item 1; `PLAN.md` §2). The session-state observation
bridge: a statusline/hook shim that captures what Claude Code exposes about a session,
plus the `zofia-reader` CLI that turns the capture into a nine-field `SessionSnapshot`,
every field carrying `{value, availability, source, observed_at}` — never a bare value.

## Layout

- `shim/` — the two scripts the installer registers (`statusline-wrapper.sh`,
  `hook-writer.sh`) and their shared locking helper (`common.sh`). See `shim/README.md`
  for the raw state-file schema they write.
- `src/deriveSnapshot.mjs` — turns raw captured state into the nine fields. Pure,
  fully unit-tested (`test/deriveSnapshot.test.mjs`), no filesystem access.
- `src/settingsPatch.mjs` — pure compute of the install/uninstall diff against a
  `settings.json` object. No filesystem access either.
- `bin/zofia-reader.mjs` — the CLI.
- `install/install.mjs`, `install/uninstall.mjs` — the reversible, diff-confirmed
  installer (`PLAN.md` §2.1). Default to `--dry-run`; require both `--apply` and
  `--yes` to actually write. `uninstall.mjs` refuses if `settings.json`'s whole-file
  hash has changed since install, rather than guessing what's safe to remove.

## Status: not yet installed anywhere real

Every test in `test/` runs against fixture files or a temp `settings.json` — nothing
here has been run against the owner's actual `~/.claude/settings.json`. `PLAN.md` §10
decision #2 requires his own confirmation that the install mechanism doesn't conflict
with what he already has configured before that happens. See `../DECISIONS.md`.

## Usage

```sh
# See exactly what would change, writes nothing:
node install/install.mjs

# Actually install (only after the owner has confirmed decision #2 above):
node install/install.mjs --apply --yes

# Once installed, after using Claude Code normally in another terminal for a bit:
node bin/zofia-reader.mjs --session <the other session's session_id>

# Reverse it:
node install/uninstall.mjs --apply --yes
```

## Tests

```sh
node --test
```
