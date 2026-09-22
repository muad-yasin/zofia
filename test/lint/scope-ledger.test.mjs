// HANDOFF item 9 acceptance: non-zero on a deliberately broken fixture, zero on the real PLAN.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { checkLedger } from '../../scripts/check-scope-ledger.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const LINT = join(REPO, 'scripts/check-scope-ledger.mjs');
const lint = (...args) => spawnSync('node', [LINT, ...args], { encoding: 'utf8' });

const plan = (body, ledger) => `# P\n\n## 1. Body\n\n${body}\n\n## Scope ledger\n\n${ledger}\n\n## Assumptions\n\nNone.\n`;

test('exits non-zero on the deliberately broken fixture', () => {
  const r = lint(join(REPO, 'test/lint/fixtures/plan-broken-ledger.md'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GLM53-4 is cited but has no Scope ledger entry/);
  assert.doesNotMatch(r.stderr, /UTF-8|ISO-8601/);
});

test('exits zero on the real PLAN.md', () => {
  const r = lint();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scope ledger OK: 21 entries/);
});

test('an id under a seat already in the ledger is caught even without a digit in the seat', () => {
  const { errors } = checkLedger(plan('See ALPHA-2.', '- ALPHA-1 - accepted - x.'));
  assert.deepEqual(errors, ['line 5: ALPHA-2 is cited but has no Scope ledger entry']);
});

test('duplicate, malformed and unknown-status ledger lines are errors', () => {
  const { errors } = checkLedger(plan('GLM53-1.', [
    '- GLM53-1 - accepted - x.',
    '- GLM53-1 - withdrawn - again.',
    '- GLM53-2 accepted, no dashes',
    '- GLM53-3 - maybe - unknown status',
  ].join('\n')));
  assert.equal(errors.length, 3, errors.join('\n'));
  assert.match(errors[0], /GLM53-1 is listed twice/);
});

test('a ledger-only id warns by default and fails with --strict', () => {
  const { errors, warnings } = checkLedger(plan('GLM53-1.', '- GLM53-1 - accepted - x.\n- GLM53-2 - withdrawn - y.'));
  assert.deepEqual(errors, []);
  assert.match(warnings[0], /GLM53-2 is in the Scope ledger but never cited outside it/);
  assert.equal(lint('--strict').status, 1, 'the real PLAN.md has ledger-only ids');
});

test('a plan with no Scope ledger fails', () => {
  assert.deepEqual(checkLedger('# P\n\nGLM53-1\n').errors, ['no "## Scope ledger" section']);
});
