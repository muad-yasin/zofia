# Item 6 — zero-egress acceptance run, 2026-09-23

**Verdict: PASS** for §2.3's shell leg. Over a 600-second window, the AppImage's whole
process tree made zero non-loopback connection attempts. The second leg, a real
center-seat child's provider traffic attributed to its own PID, isn't covered here.
It needs the real `claude` (item 8).

## What ran

- **Artifact:** `Zofia_0.1.0_amd64.AppImage`, sha256 `ce52e3c5…a219da`, built 03:48 from
  `01846de`. The commits since then change tests, docs, and one generated constant nothing
  reads (`DEFAULT_EFFORT`, `4be93a1`). None of them changes what the app does.
- **Command:** `test/appimage/run-egress.sh`. It runs `scripts/egress-audit.sh`
  (default 600s, no `--self-test`) in the clean Fedora 44 image
  (`Containerfile.egress`: the smoke image plus strace, iproute and jq) under Xvfb. The
  container runs with `--network=none`. Inside it, the audit adds its own user+net+pid
  namespaces with loopback only. Settings: `APPIMAGE_EXTRACT_AND_RUN=1` and
  `ZOFIA_CENTER_COMMAND=` the committed mock. Nothing opened on the owner's desktop.
- **Trace:** `strace -I 1 -f` over the whole PID tree, recording
  connect/sendto/sendmsg/sendmmsg/execve/clone. It covers AppRun → `zofia` →
  WebKitNetworkProcess and WebKitWebProcess, plus the helpers (`gsettings`, …).
- **Mock corner activity:** the real shim scripts wrote `mock-a`/`mock-b` state every 5s
  for the whole window (115 cycles).

## Result

```
traced syscalls: 789; socket addresses seen: 11; loopback: 0
trace covers 11:33:59.393370 -> 11:43:13.001043 (554s)
unix sockets contacted (review: a local daemon could relay):
  @"/tmp/.X11-unix/X99"
  "/tmp/.X11-unix/X99"
  "/run/dbus/system_bus_socket"
egress audit PASSED: zero non-loopback attempts from the traced process tree
```

- **All 11 addresses are AF_UNIX:** 6 are X11 (Xvfb) and 5 are the D-Bus system bus.
  All 5 bus connects failed with ENOENT, because the image runs no bus daemon.
  None of the 650 `sendmsg` calls carries an inet address.
- **The app ran for the whole window** (no early-exit marker). The 554s span is simply
  first-to-last traced syscall: an idle shell makes none of these calls at the end.
- **Raw trace:** `test/runs/egress-20260923T133356/` (gitignored, on this machine).

## Before the run

- **Real-strace positive control** (`test/egress/egress.test.mjs`): it used to skip, and
  now passes. A grandchild's connect to 203.0.113.9:443 fails the run and is attributed
  to its exe.
- **Harness bug, fixed:** when a command outlived the window, the run hung forever.
  bash starts a background job with SIGINT ignored, and `strace -o FILE PROG` blocks
  fatal signals by default (`-I 3`), so `kill -INT` never stopped strace. The fix is
  `strace -I 1` plus TERM, with a regression test.
- **Harness gap, fixed:** a run whose mock activity never reached disk still passed. The
  first container attempt had no `jq`, so the shims wrote nothing. That case is now
  INCONCLUSIVE. `npm run test:egress` passes 12/12.

## What this doesn't show

- **The mock center seat never ran during the window.** Launching it takes the UI's
  launch button. The only scripted route is WebDriver, and a WebDriver-started app sits
  outside the traced tree. So the tree traced here is the idle shell with live corner
  activity. The mock seat's own path is covered by the item 5 smoke instead, which runs
  with `--network=none`.
- **Nothing about the real CLI's traffic** (item 8, `--allow-exe` is ready for it).
- **The owner's own desktop session isn't covered:** no host D-Bus, no Wayland, and no
  IBus. The AppImage bundles its own WebKitGTK, so the network-relevant code is the same,
  but a desktop's session bus could relay in ways this image can't show. The parser lists
  every unix socket contacted for exactly that review.
