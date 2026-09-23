# Linux support — what is actually declared (PLAN.md §6)

Only what has been measured is listed here. No "universal Linux support" claim.

## Declared, as of 2026-09-23 (item 5, first AppImage)

| | |
|---|---|
| Distribution | Fedora 44 Workstation only |
| Architecture | x86_64 only |
| glibc | 2.43 (build host; the AppImage needs at least this) |
| WebKitGTK | 4.1, 2.52.5, bundled inside the AppImage |
| Build host | Fedora 44, rustc 1.98.1, @tauri-apps/cli 2.11.5 |
| Clean test image | `registry.fedoraproject.org/fedora:44` @ `sha256:b4488a77fd2b96513fc8c18b502df7fbf19dad9e77d9a430c0163c574654822c`, plus `test/appimage/Containerfile` |

Both launch paths pass the smoke test in the clean image under Xvfb with `--network=none`:
FUSE (`/dev/fuse` + `SYS_ADMIN`) and `APPIMAGE_EXTRACT_AND_RUN=1` without a FUSE device.

## How to build and test

    npm run build:appimage     # NO_STRIP=true tauri build --bundles appimage
    podman build -t zofia-appimage-smoke -f test/appimage/Containerfile test/appimage
    npm run test:appimage      # both launch paths, screenshots in /tmp/zofia-smoke-out

`NO_STRIP=true` is required on Fedora 44: linuxdeploy's bundled `strip` can't read the
`.relr.dyn` sections of Fedora 44's libraries and the bundle step fails without it.
Result: a larger artifact (~107 MB), not a broken one.

## Not done yet

- **Signature verifies before launch** (§6). Needs a signing key kept outside the app and
  the repo: the owner's key and the owner's decision. No key has been generated.
- **An older baseline.** Built on Fedora 44, the artifact needs glibc 2.43, so older
  distributions won't run it. Widening that means building in an older container and
  testing each distribution named here. Nothing beyond Fedora 44 is declared until then.
- **Checksums, dependency inventory, license notices** for a release. Not started; this is
  the first build, not a release.
- **Missing-Claude-Code setup screen** (§6). Until item 8, the seat never launches the
  real CLI anyway; the screen belongs with item 8.
- **Pinned tooling.** The linuxdeploy AppImage is fetched by the Tauri CLI into
  `~/.cache/tauri/` and isn't pinned by digest yet.
