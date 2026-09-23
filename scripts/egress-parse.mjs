#!/usr/bin/env node
// HANDOFF item 6 / PLAN.md §2.3: classifies every socket address in an `strace -f` trace
// of the GUI shell's whole process tree (scripts/egress-audit.sh records it).
//
//   node scripts/egress-parse.mjs <trace.txt> [--allow-exe <path>]... [--json]
//
// Exit 0: no non-loopback attempt anywhere in the tree. Exit 1: at least one. Exit 2: the
// trace is unreadable or empty (an empty trace proves nothing, so it never passes).
//
// Rules (conservative on purpose; an attempt counts whether or not it succeeded, since
// the isolated namespace makes every real egress attempt fail):
// - AF_INET/AF_INET6 to loopback (127.0.0.0/8, ::1, ::ffff:127.x, 0.0.0.0/::): allowed,
//   EXCEPT port 53. A DNS query to a local stub (systemd-resolved's 127.0.0.53) is a
//   lookup that would leave the machine outside the namespace, so it counts as egress.
// - Any other AF_INET/AF_INET6 address: a violation.
// - AF_UNIX / AF_NETLINK: local. Unix socket paths are listed in the report, because a
//   local daemon (D-Bus, a portal) could relay traffic on the tree's behalf, and this
//   trace can't see past that hop. A reviewer reads the list.
// - Any other address family: a violation, since we can't prove it's local.
// - `--allow-exe` names an executable (the center seat's own `claude`, PLAN.md §2.3's
//   one permitted non-loopback connection) whose attempts are reported under
//   "attributed to an allowed child". They're never dropped from the report, and they
//   never fail the run.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINE = /^(\d+)\s+(?:[\d:.]+\s+)?(?:<\.\.\. )?(\w+)(?:\(| resumed>)(.*)$/;

function familyBlocks(args) {
  const out = [];
  const re = /sa_family=(AF_\w+)([^}]*)/g;
  for (const m of args.matchAll(re)) {
    const [, family, rest] = m;
    const port = /sin6?_port=htons\((\d+)\)/.exec(rest)?.[1];
    const v4 = /sin_addr=inet_addr\("([^"]+)"\)/.exec(rest)?.[1];
    const v6 = /inet_pton\(AF_INET6, "([^"]+)"/.exec(rest)?.[1];
    const path = /sun_path=(@?"[^"]*"|@[^,}]*)/.exec(rest)?.[1];
    out.push({ family, port: port === undefined ? null : Number(port), addr: v4 ?? v6 ?? null, path: path ?? null });
  }
  return out;
}

export function isLoopback(addr) {
  if (!addr) return false;
  const a = addr.toLowerCase();
  if (/^127\./.test(a) || a === '0.0.0.0') return true;
  if (a === '::1' || a === '::') return true;
  return /^::ffff:127\./.test(a) || /^::ffff:0\.0\.0\.0$/.test(a);
}

export function classify(block) {
  const { family, port, addr } = block;
  if (family === 'AF_UNIX' || family === 'AF_NETLINK' || family === 'AF_UNSPEC') return 'local';
  if (family === 'AF_INET' || family === 'AF_INET6') {
    if (port === 53) return 'violation';
    return isLoopback(addr) ? 'loopback' : 'violation';
  }
  return 'violation';
}

export function parseTrace(text, { allowExe = [] } = {}) {
  const exeOf = new Map(); // pid -> last successful execve path
  const events = [];
  let syscallLines = 0;
  for (const line of text.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [, pidStr, syscall, rest] = m;
    const pid = Number(pidStr);
    syscallLines++;
    if (syscall === 'execve') {
      const path = /^"([^"]+)"/.exec(rest)?.[1];
      if (path && !/= -1 /.test(rest)) exeOf.set(pid, path);
      continue;
    }
    if (!['connect', 'sendto', 'sendmsg', 'sendmmsg'].includes(syscall)) continue;
    for (const block of familyBlocks(rest)) {
      events.push({ pid, exe: exeOf.get(pid) ?? null, syscall, ...block, verdict: classify(block) });
    }
  }
  const allowed = new Set(allowExe.map((p) => resolve(p)));
  const isAllowed = (e) => e.exe !== null && allowed.has(resolve(e.exe));
  const bad = events.filter((e) => e.verdict === 'violation');
  return {
    syscallLines,
    events,
    violations: bad.filter((e) => !isAllowed(e)),
    allowedChildEgress: bad.filter(isAllowed),
    unixPaths: [...new Set(events.filter((e) => e.family === 'AF_UNIX' && e.path).map((e) => e.path))],
    loopback: events.filter((e) => e.verdict === 'loopback').length,
  };
}

const where = (e) => `${e.syscall} pid ${e.pid} (${e.exe ?? 'exe unknown: started before tracing'}) -> ${e.family} ${e.addr ?? ''}${e.port !== null ? `:${e.port}` : ''}`;

function main(argv) {
  const allowExe = [];
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow-exe') allowExe.push(argv[++i]);
    else if (argv[i] !== '--json') file = argv[i];
  }
  if (!file) {
    console.error('usage: egress-parse.mjs <trace.txt> [--allow-exe <path>]... [--json]');
    return 2;
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`egress audit: cannot read trace ${file}: ${e.message}`);
    return 2;
  }
  const r = parseTrace(text, { allowExe });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  if (r.syscallLines === 0) {
    console.error('egress audit: INCONCLUSIVE, the trace has no syscall lines (was anything traced?)');
    return 2;
  }
  console.log(`traced syscalls: ${r.syscallLines}; socket addresses seen: ${r.events.length}; loopback: ${r.loopback}`);
  if (r.unixPaths.length) console.log(`unix sockets contacted (review: a local daemon could relay):\n  ${r.unixPaths.join('\n  ')}`);
  if (r.allowedChildEgress.length) {
    console.log(`non-loopback attempts attributed to an allowed child (${r.allowedChildEgress.length}):\n  ${r.allowedChildEgress.map(where).join('\n  ')}`);
  }
  if (r.violations.length) {
    console.error(`egress audit FAILED: ${r.violations.length} non-loopback attempt(s) from the traced tree:\n  ${r.violations.map(where).join('\n  ')}`);
    return 1;
  }
  console.log('egress audit PASSED: zero non-loopback attempts from the traced process tree');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
