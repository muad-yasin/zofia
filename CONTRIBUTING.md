# Contributing to Zofia

Thanks for looking. Zofia is small and maintained in spare time, so a short issue before a
large pull request saves everyone work.

## Before you open a pull request

- **Bugs:** open an issue with the steps, what you expected and what happened. Say which
  distribution and version you run. Paste error text, not screenshots of it.
- **Features:** open an issue first. Some directions are decided already (see "Fixed
  rules" below) and some are planned but not started (other providers, local models,
  other operating systems); the issue is where we find out which.
- **Security problems** go through `SECURITY.md`, never a public issue.

## Fixed rules

These are not style preferences; a change that breaks one will not be merged.

- **Nothing leaves the machine.** No telemetry, analytics, crash reporting, update checks
  or any other network call made by Zofia itself.
- **Corners stay read-only.** Zofia observes sessions the user opened; it never types into,
  restarts or stops them.
- **No transcript reading by default.** Reading a session's conversation may only ever be
  an opt-in setting.
- **No claims that Zofia makes anyone more productive** in the README, docs or UI until
  something has actually been measured.
- **No xAI/Grok or Kimi/Moonshot model ids**, and no router that may pick one (such as
  `openrouter/auto`), anywhere in the code or config. The model guard refuses them.
- **Your own work only.** Do not paste code or text from other projects. Ideas are fine;
  describe them in your own words.

## Making the change

    npm ci
    npm test                      # frontend
    (cd reader && node --test)    # observation bridge
    (cd src-tauri && cargo test)  # backend

Run all three before you push. Add a test for what you changed. Keep one change per pull
request, and say in the description which of the tests above you ran.

The repo's planning files (`PLAN.md`, `HANDOFF.md`, `DECISIONS.md` and friends) are the
maintainer's build record; you do not need to update them. `CHANGELOG.md` is the
exception: add a line under "Unreleased" for anything a user would notice.

## Licence

Zofia is MIT-licensed (`LICENSE`). By opening a pull request you agree that your
contribution is licensed under the same MIT terms.
