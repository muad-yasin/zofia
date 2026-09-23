// HANDOFF item 6 / PLAN.md §2.3. Three layers:
//  1. the trace classifier, on a hand-written strace fixture (always runs);
//  2. the runner's own plumbing (namespace, loopback-only, mock activity, early-exit
//     guard, verdict wiring) with a fake `strace` on PATH (always runs);
//  3. a positive control with real strace: a grandchild's egress attempt must fail the
//     run, attributed to its exe (skips until strace is installed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseTrace, classify } from '../../scripts/egress-parse.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const PARSE = join(REPO, 'scripts/egress-parse.mjs');
const AUDIT = join(REPO, 'scripts/egress-audit.sh');
const FIXTURE = join(import.meta.dirname, 'fixtures/trace-mixed.txt');
const hasStrace = spawnSync('sh', ['-c', 'command -v strace']).status === 0;

test('classifier: loopback and local are allowed, everything else is a violation', () => {
  const r = parseTrace(readFileSync(FIXTURE, 'utf8'));
  const bad = r.violations.map((e) => `${e.family} ${e.addr}:${e.port} ${e.exe}`);
  assert.deepEqual(bad, [
    'AF_INET 127.0.0.53:53 /usr/libexec/webkit2gtk-4.1/WebKitNetworkProcess', // DNS via the local stub is still a lookup
    'AF_INET 203.0.113.9:443 /usr/libexec/webkit2gtk-4.1/WebKitNetworkProcess', // from an <unfinished ...> line
    'AF_INET6 2001:db8::1:443 /home/u/.local/bin/claude', // sendmsg msg_name
    'AF_PACKET null:null null', // unknown family: can't prove it's local
  ]);
  assert.equal(r.loopback, 3, '127.0.0.1, ::1 and ::ffff:127.0.0.1');
  assert.deepEqual(r.unixPaths, ['"/run/user/1000/wayland-0"']);
});

test('classifier: a failed execve does not re-attribute a pid', () => {
  const r = parseTrace(readFileSync(FIXTURE, 'utf8'));
  assert.ok(r.events.every((e) => e.exe !== '/usr/bin/nothere'));
});

test('--allow-exe reports the allowed child separately and never hides it', () => {
  const r = parseTrace(readFileSync(FIXTURE, 'utf8'), { allowExe: ['/home/u/.local/bin/claude'] });
  assert.equal(r.allowedChildEgress.length, 1);
  assert.equal(r.violations.length, 3);
  const cli = spawnSync('node', [PARSE, FIXTURE, '--allow-exe', '/home/u/.local/bin/claude'], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.match(cli.stdout, /attributed to an allowed child \(1\)/);
});

test('classify edge cases', () => {
  assert.equal(classify({ family: 'AF_INET', addr: '127.1.2.3', port: 80 }), 'loopback');
  assert.equal(classify({ family: 'AF_INET', addr: '127.0.0.1', port: 53 }), 'violation');
  assert.equal(classify({ family: 'AF_INET6', addr: '::ffff:10.0.0.1', port: 443 }), 'violation');
  assert.equal(classify({ family: 'AF_INET', addr: null, port: 443 }), 'violation');
});

test('an empty or syscall-free trace is inconclusive (exit 2), never a pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zofia-egress-'));
  writeFileSync(join(dir, 't.txt'), '');
  assert.equal(spawnSync('node', [PARSE, join(dir, 't.txt')]).status, 2);
  assert.equal(spawnSync('node', [PARSE, join(dir, 'missing.txt')]).status, 2);
  const clean = join(dir, 'c.txt');
  writeFileSync(clean, '5 10:00:00.1 connect(3, {sa_family=AF_INET, sin_port=htons(1), sin_addr=inet_addr("127.0.0.1")}, 16) = 0\n');
  assert.equal(spawnSync('node', [PARSE, clean]).status, 0);
});

// A stand-in `strace` that runs the command untraced and writes a canned trace. It
// proves the runner's plumbing, not tracing itself (layer 3 does that).
function fakeStraceDir() {
  const bin = mkdtempSync(join(tmpdir(), 'zofia-fakestrace-'));
  const f = join(bin, 'strace');
  writeFileSync(f, `#!/usr/bin/env bash
out=""; while [ "$1" != "--" ]; do [ "$1" = "-o" ] && out="$2"; shift; done; shift
echo "1 10:00:00.1 execve(\\"/fake/$(basename "$1")\\", [], 0x0) = 0" > "$out"
if [ -n "$FAKE_BAD" ]; then  # written up front: the runner TERMs this stand-in at window end
  echo '1 10:00:00.2 connect(3, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("203.0.113.9")}, 16) = -1 ENETUNREACH' >> "$out"
fi
"$@"
`);
  chmodSync(f, 0o755);
  return bin;
}

function audit(args, env = {}) {
  const out = mkdtempSync(join(tmpdir(), 'zofia-egress-run-'));
  const r = spawnSync('bash', [AUDIT, '--out', out, '--self-test', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60000,
  });
  return { ...r, out };
}

test('runner: the command sees only loopback, mock activity is written, verdicts are wired', () => {
  const PATH = `${fakeStraceDir()}:${process.env.PATH}`;
  const probe = join(mkdtempSync(join(tmpdir(), 'zofia-probe-')), 'links.txt');
  // Runs for the whole window, so no early exit; records what the namespace looks like.
  const cmd = ['bash', '-c', `ip -brief link > ${probe}; id -u >> ${probe}; sleep 30`];

  const clean = audit(['--duration', '7', '--', ...cmd], { PATH });
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /PASSED/);
  const seen = readFileSync(probe, 'utf8').trim().split('\n');
  assert.deepEqual(seen.map((l) => l.split(/\s+/)[0]), ['lo', String(process.getuid())], 'only loopback, and our own uid, not root');
  const sessions = readdirSync(join(clean.out, 'sessions')).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(sessions, ['mock-a.json', 'mock-b.json']);

  const bad = audit(['--duration', '2', '--', ...cmd], { PATH, FAKE_BAD: '1' });
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /203\.0\.113\.9:443/);
});

test('runner: a command that exits early is INCONCLUSIVE unless --allow-early-exit', () => {
  const PATH = `${fakeStraceDir()}:${process.env.PATH}`;
  const r = audit(['--duration', '2', '--', 'true'], { PATH });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /INCONCLUSIVE/);
  assert.equal(audit(['--duration', '2', '--allow-early-exit', '--', 'true'], { PATH }).status, 0);
});

test('real strace: a grandchild egress attempt fails the run, attributed to its exe', { skip: hasStrace ? false : 'strace not installed (sudo dnf install strace)' }, () => {
  const script = `
    const net = require('net');
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      net.connect(srv.address().port, '127.0.0.1').on('connect', () => {
        if (process.env.EGRESS) net.connect(443, '203.0.113.9').on('error', () => {});
        setTimeout(() => process.exit(0), 300);
      });
    });`;
  const cmd = ['sh', '-c', `sh -c 'exec node -e "$0"' "${script.replace(/"/g, '\\"')}"`];
  const bad = audit(['--duration', '3', '--allow-early-exit', '--', ...cmd], { EGRESS: '1' });
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /203\.0\.113\.9:443/);
  assert.match(bad.stderr, /node/);
  const clean = audit(['--duration', '3', '--allow-early-exit', '--', ...cmd]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.ok(existsSync(join(clean.out, 'trace.txt')));
});

// Item 6 acceptance run, 2026-09-23: kill -INT never reached strace (a background job
// ignores SIGINT), so a command outliving the window hung the run forever.
test('real strace: a command that outlives the window is stopped when the window ends', { skip: hasStrace ? false : 'strace not installed (sudo dnf install strace)' }, () => {
  const started = Date.now();
  const r = audit(['--duration', '3', '--', 'sleep', '300']);
  assert.equal(r.error, undefined, 'the run hung past its window');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(Date.now() - started < 30000);
});

// Item 6 audit #1, 2026-09-23: Fedora resolves through resolved's unix socket first.
test('a connect to a local resolver socket counts as DNS egress', () => {
  const trace = [
    '7 10:00:00.1 connect(3, {sa_family=AF_UNIX, sun_path="/run/systemd/resolve/io.systemd.Resolve"}, 42) = 0',
    '7 10:00:00.2 connect(4, {sa_family=AF_UNIX, sun_path="/run/nscd/socket"}, 19) = -1 ENOENT',
    '7 10:00:00.3 connect(5, {sa_family=AF_UNIX, sun_path="/run/user/1000/bus"}, 21) = 0',
  ].join('\n');
  const r = parseTrace(trace);
  assert.equal(r.violations.length, 2);
  assert.ok(r.unixPaths.includes('"/run/user/1000/bus"'));
});

// Item 6 audit #2: a thread or un-exec'd child keeps its parent's exe; --allow-exe is realpath'd.
test('threads and forked children inherit exe attribution, and --allow-exe compares real paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zofia-egress-exe-'));
  const real = join(dir, 'claude-2.1.280');
  writeFileSync(real, '');
  const link = join(dir, 'claude');
  spawnSync('ln', ['-s', real, link]);
  const trace = [
    `200 10:00:00.1 execve("${real}", ["claude"], 0x0) = 0`,
    '200 10:00:00.2 clone3({flags=CLONE_VM|CLONE_THREAD, exit_signal=0}, 88) = 201',
    '201 10:00:00.3 connect(9, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("203.0.113.9")}, 16) = -1 ENETUNREACH',
    '200 10:00:00.4 clone(child_stack=NULL, flags=SIGCHLD) = 202',
    '202 10:00:00.5 connect(9, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("203.0.113.9")}, 16) = -1 ENETUNREACH',
  ].join('\n');
  const r = parseTrace(trace, { allowExe: [link] });
  assert.equal(r.violations.length, 0, JSON.stringify(r.violations));
  assert.equal(r.allowedChildEgress.length, 2);
  assert.deepEqual(r.span, { first: '10:00:00.1', last: '10:00:00.5', seconds: 0 });
});

// Item 6 audit #3: a zero or garbage window can't produce a PASS.
test('runner: a garbage or short --duration is refused outside self-tests', () => {
  for (const d of ['abc', '0', '599', '']) {
    const r = spawnSync('bash', [AUDIT, '--duration', d, '--', 'true'], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${d}: ${r.stderr}`);
  }
});
