# Changelog

All notable changes are listed here, newest first. Versions follow
[Semantic Versioning](https://semver.org/); while the version is 0.x, a minor bump may
change behaviour.

## Unreleased

### Added
- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue templates, this changelog.
- README rewritten for people who are not the maintainer, with a Privacy section listing
  every file Zofia installs, reads and writes.

### Fixed
- The shim installer no longer says Claude Code's footer is unaffected when no status line
  existed before. Claude Code hides most footer key hints whenever any status line is set.
- The frontend tests pin a 24-hour locale, so they pass on en-US machines, and stop the
  preview server they start, so the run no longer hangs at the end.

## 0.1.0 (not released)

First build: four read-only corners fed by the status-line and hook shim, the center seat
against a test mock, a Fedora 44 AppImage, and a zero-egress audit of the app's process
tree (2026-09-23). Public since 2026-09-25: Apache-2.0 at first, MIT later the same day.
