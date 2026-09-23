#!/usr/bin/env bash
# Deterministic fake `claude` for HANDOFF.md item 4's acceptance test (PLAN.md §3):
# "against a deterministic fake claude ... typed input reaches the fake byte-for-byte"
# and "an interruption key (Esc/Ctrl+C) actually delivered — not output streaming
# alone." Not a simulation of Claude Code's real output — only proves Zofia's own PTY
# plumbing (WS -> Rust -> PTY master -> this process's stdin) actually delivers raw
# keystrokes, not just line-buffered text.
#
# Puts its own controlling terminal (this process's stdin, which portable-pty gives it
# as the PTY slave) into non-canonical mode, the same way a real interactive CLI does —
# without this, the kernel's line discipline buffers input until a newline arrives, so a
# lone ESC byte with nothing after it would never reach `read` at all, making the ESC
# test meaningless. isig is explicitly turned ON (real bug found while building this:
# portable-pty's own pty-creation default is not guaranteed ISIG-on, so a Ctrl+C byte
# could silently become just another buffered character instead of a real SIGINT if left
# at whatever default was inherited) — intr is pinned to ^C explicitly for the same
# reason, not trusting an inherited default for the one thing the SIGINT test depends on.
stty -icanon -echo isig intr ^C min 1 time 0 2>/dev/null || true

trap 'echo "SIGINT-RECEIVED"' INT
# `--ignore-hup` stands in for a real CLI that installs its own SIGHUP handler and keeps
# running: PtySeat::stop must still end it (escalation), not just report failure.
if [ "${1:-}" = "--ignore-hup" ]; then
  trap 'echo "SIGHUP-IGNORED"' HUP
fi
# `--with-grandchild` stands in for a real CLI's own tool subprocess: stop() must end it too.
if [ "${1:-}" = "--with-grandchild" ]; then
  ( trap '' HUP; exec sleep 300 ) &
  echo "GRANDCHILD:$!"
fi
# `--with-setsid-grandchild` leaves the seat's process group the way a daemonizing tool
# would: stop() must still end it.
if [ "${1:-}" = "--with-setsid-grandchild" ]; then
  ( trap '' HUP; exec setsid sleep 300 ) &
  echo "GRANDCHILD:$!"
fi
# `--write-claude-md` writes into its workdir at once, before printing READY.
if [ "${1:-}" = "--write-claude-md" ]; then
  echo "written by the seat at startup" > CLAUDE.md
fi

# One ARG: line per argument, so a test can assert the exact argv the center seat built
# (its tool-policy flags, PLAN.md §3).
for arg in "$@"; do printf 'ARG:%s\n' "$arg"; done

echo "MOCK-CLAUDE-READY"

buffer=""
while IFS= read -r -n 1 -d '' char; do
  if [ "$char" = $'\x1b' ]; then
    echo "ESC-RECEIVED"
  elif [ "$char" = $'\n' ] || [ "$char" = $'\r' ]; then
    [ "$buffer" = "SIZE" ] && stty size
    # `EXIT` stands in for the real CLI's /exit: the seat ends on its own, not via stop().
    [ "$buffer" = "EXIT" ] && { echo "MOCK-CLAUDE-EXITING"; exit 0; }
    echo "HEARD:${buffer}"
    buffer=""
  else
    buffer="${buffer}${char}"
  fi
done
echo "MOCK-CLAUDE-EOF"
