# Security policy

## Reporting a problem

Please report security problems privately, not in a public issue, pull request or
discussion. Use GitHub's private vulnerability reporting: the **Security** tab of this
repository, then **Report a vulnerability**. You will get an answer from the maintainer,
who works on this in spare time, so allow a week for a first reply.

Please include what you found, how to reproduce it, and which commit or build you used.
Do not include your own Claude Code state files, settings or transcripts unless you have
removed anything private from them first.

## What counts

Zofia's promises are narrow, so these are the things worth reporting:

- **Data leaving the machine.** Any network connection made by Zofia's own processes
  (the app, its webview, the shim scripts), or anything that would let a web page or
  another process pull data out of it.
- **Reading more than it says.** Zofia reading transcripts, credentials, prompts or file
  contents in its default configuration, or the shim scripts writing more than the fields
  listed in the README's Privacy section.
- **Driving a session it should only observe.** Any path that sends input to, restarts or
  stops a corner session, or that launches the real `claude` from the center seat while
  that seat is locked to the mock.
- **Local attacks through its files.** Another local user, or a crafted state file, making
  Zofia or the shim read, write or follow something outside its own directories, or
  corrupt `~/.claude/settings.json`.
- **The installer and uninstaller** losing or mangling a user's existing settings.

Out of scope: problems in Claude Code itself (report those to Anthropic, see
<https://code.claude.com/docs/en/legal-and-compliance>), in Tauri or WebKitGTK upstream,
and anything that needs an attacker who already runs code as your user.

## Supported versions

Zofia has not had a release yet. Fixes go to `master`. Once releases exist, only the
latest release gets security fixes.

## Verifying what you run

There are no signed release builds yet. Until there are, build from source and check the
commit you built. When releases start, each will ship with SHA-256 checksums and a
signature, and this file will say how to verify them.
