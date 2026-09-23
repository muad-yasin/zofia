// HANDOFF item 7 / PLAN.md §5 acceptance. The runtime leg (a grok id rejected with the
// schema bypassed entirely) is src-tauri/src/provider_guard.rs's own `cargo test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validate, crossCheck, TS_OUT, RS_OUT } from '../../scripts/gen-providers.mjs';

const REPO = resolve(import.meta.dirname, '../..');
const GEN = join(REPO, 'scripts/gen-providers.mjs');
const REAL = JSON.parse(readFileSync(join(REPO, 'config/providers.json'), 'utf8'));

function run(cfg, ...flags) {
  const dir = mkdtempSync(join(tmpdir(), 'zofia-providers-'));
  const configPath = join(dir, 'providers.json');
  writeFileSync(configPath, JSON.stringify(cfg));
  const r = spawnSync('node', [GEN, '--config', configPath, '--root', dir, ...flags], { encoding: 'utf8' });
  return { dir, configPath, code: r.status, out: r.stdout + r.stderr };
}

const mutate = (fn) => {
  const c = structuredClone(REAL);
  fn(c);
  return c;
};

test('the real config validates and generates', () => {
  const r = run(REAL);
  assert.equal(r.code, 0, r.out);
  assert.ok(existsSync(join(r.dir, TS_OUT)) && existsSync(join(r.dir, RS_OUT)));
});

test('npm run build runs the schema check before anything else', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.build, /^node scripts\/gen-providers\.mjs && /);
});

for (const [name, fn] of [
  ['a grok model id', (c) => c.providers[0].models.push({ ...c.providers[0].models[0], id: 'grok-5' })],
  ['a Grok model id in mixed case', (c) => (c.providers[0].models[0].id = 'x-ai/GroK-4')],
  ['an xai provider', (c) => c.providers.push({ ...c.providers[0], id: 'xai', models: [{ ...c.providers[0].models[0], id: 'other' }] })],
  ['an x-ai/ prefixed model id', (c) => (c.providers[0].models[0].id = 'x-ai/some-model')],
  ['an alias pointing at grok', (c) => (c.aliases.fast = 'grok-5')],
  ['an alias named grok', (c) => (c.aliases.grok = 'sonnet')],
  ['a grok default model', (c) => (c.default_model.value = 'grok-5')],
  ['an x_ai/ prefixed model id', (c) => (c.providers[0].models[0].id = 'x_ai/some-model')],
  ['an x.ai/ prefixed model id', (c) => (c.providers[0].models[0].id = 'x.ai/some-model')],
  ['openrouter/auto', (c) => (c.providers[0].models[0].id = 'openrouter/auto')],
  ['openrouter/auto with a variant', (c) => (c.providers[0].models[0].id = 'OpenRouter/Auto:floor')],
]) {
  test(`schema rejects ${name}`, () => {
    const r = run(mutate(fn));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /forbidden by a "not" rule/);
  });
}

test('an effort level needs a measured-matrix tag; a level sourced UNKNOWN never ships', () => {
  const setLevels = (levels) => mutate((c) => (c.providers[0].models[0].effort_levels = levels));
  for (const [why, levels] of [
    ['free-text source', [{ level: 'high', source: 'I think so' }]],
    ['no source', [{ level: 'high' }]],
    ['source UNKNOWN (used to render as a real level)', [{ level: 'high', source: 'docs/field-availability.md#row-2' }, { level: 'low', source: 'UNKNOWN' }]],
    ['empty anchor', [{ level: 'high', source: 'docs/field-availability.md#' }]],
  ]) {
    const r = run(setLevels(levels));
    assert.equal(r.code, 1, `${why}: ${r.out}`);
  }
  const ok = run(setLevels([
    { level: 'high', source: 'docs/field-availability.md#row-2' },
    { level: 'medium', source: 'docs/field-availability.md#row-2' },
  ]));
  assert.equal(ok.code, 0, ok.out);
  assert.match(readFileSync(join(ok.dir, RS_OUT), 'utf8'), /\("sonnet", Some\(&\["high", "medium"\]\)\)/);
});

test('effort_key: UNKNOWN in both halves, or a real value with a measured tag', () => {
  const setKey = (key) => mutate((c) => (c.providers[0].launch.effort_key = key));
  for (const key of [
    { value: '--effort', source: 'UNKNOWN' },
    { value: 'UNKNOWN', source: 'docs/field-availability.md#row-2' },
    { value: '--effort', source: 'the docs' },
  ]) {
    assert.equal(run(setKey(key)).code, 1, JSON.stringify(key));
  }
  const unknown = run(setKey({ value: 'UNKNOWN', source: 'UNKNOWN' }));
  assert.equal(unknown.code, 0, unknown.out);
  assert.match(readFileSync(join(unknown.dir, RS_OUT), 'utf8'), /EFFORT_KEYS: &\[\(&str, Option<&str>\)\] = &\[\("anthropic", None\)\]/);
  const real = run(setKey({ value: '--effort', source: 'docs/field-availability.md#row-2' }));
  assert.equal(real.code, 0, real.out);
});

test('crossCheck alone (schema bypassed) still refuses an unmeasured effort value', () => {
  const lvl = mutate((c) => (c.providers[0].models[0].effort_levels = [{ level: 'low', source: 'UNKNOWN' }]));
  assert.ok(crossCheck(lvl).some((e) => /no measured tag/.test(e)));
  const key = mutate((c) => (c.providers[0].launch.effort_key = { value: '--effort', source: 'UNKNOWN' }));
  assert.ok(crossCheck(key).some((e) => /effort_key/.test(e)));
  assert.deepEqual(crossCheck(REAL), []);
});

test('every effort value in the real config is UNKNOWN or tagged to the measured matrix', () => {
  const tags = [REAL.providers.map((p) => p.launch.effort_key.source)];
  for (const p of REAL.providers) {
    for (const m of p.models) {
      if (m.effort_levels === 'UNKNOWN') continue;
      tags.push(m.effort_levels.map((e) => e.source));
    }
  }
  for (const t of tags.flat()) assert.match(t, /^(UNKNOWN|docs\/field-availability\.md#\S+)$/);
});

test('default effort is the owner\'s Medium (decision 2), and must be a measured level once levels exist', () => {
  assert.equal(REAL.default_effort.value, 'medium');
  assert.equal(run(mutate((c) => delete c.default_effort)).code, 1);
  const measured = (c) => {
    c.providers[0].models.find((m) => m.id === c.default_model.value).effort_levels = [
      { level: 'high', source: 'docs/field-availability.md#effort' },
    ];
  };
  assert.ok(crossCheck(mutate(measured)).some((e) => /default_effort "medium"/.test(e)));
  assert.equal(run(mutate(measured)).code, 1);
});

test('cross-entry rules: duplicates, undeclared targets, shadowing aliases', () => {
  for (const fn of [
    (c) => c.providers[0].models.push({ ...c.providers[0].models[0] }),
    (c) => (c.aliases.main = 'no-such-model'),
    (c) => (c.aliases.opus = 'sonnet'),
    (c) => (c.default_model.value = 'no-such-model'),
  ]) {
    assert.equal(run(mutate(fn)).code, 1);
  }
});

test('generated TS and Rust list byte-identical ids', () => {
  const r = run(mutate((c) => (c.aliases.main = 'sonnet')));
  const ts = readFileSync(join(r.dir, TS_OUT), 'utf8');
  const rs = readFileSync(join(r.dir, RS_OUT), 'utf8');
  for (const name of ['PROVIDER_IDS', 'MODEL_IDS']) {
    const tsIds = JSON.parse(new RegExp(`${name} = (\\[.*?\\]) as const`).exec(ts)[1]);
    const rsIds = JSON.parse(new RegExp(`${name}: &\\[&str\\] = &(\\[.*?\\]);`).exec(rs)[1]);
    assert.deepEqual(tsIds, rsIds, name);
    assert.ok(tsIds.length > 0);
  }
  assert.match(ts, /"main":"sonnet"/);
  assert.match(rs, /\("main", "sonnet"\)/);
});

test('stale-files lint fails when providers.json changes without regenerating', () => {
  const r = run(REAL);
  const check = (cfgPath) => spawnSync('node', [GEN, '--check', '--config', cfgPath, '--root', r.dir]).status;
  assert.equal(check(r.configPath), 0);
  writeFileSync(r.configPath, JSON.stringify(mutate((c) => (c.providers[0].models[0].label = 'edited'))));
  assert.equal(check(r.configPath), 1);
  const fresh = mkdtempSync(join(tmpdir(), 'zofia-providers-'));
  assert.equal(spawnSync('node', [GEN, '--check', '--root', fresh]).status, 1, 'missing files count as stale');
});

test('no hand-maintained ALLOWED_PROVIDERS list in src/', () => {
  const r = spawnSync('grep', ['-r', 'ALLOWED_PROVIDERS', join(REPO, 'src')], { encoding: 'utf8' });
  assert.equal(r.stdout, '');
});

test('the validator refuses a schema keyword it does not implement', () => {
  assert.throws(() => validate('x', { type: 'string', maxLength: 3 }), /unsupported keyword "maxLength"/);
});

test('the real repo generated files are current', () => {
  execFileSync('node', [GEN], { cwd: REPO });
  assert.equal(spawnSync('node', [GEN, '--check'], { cwd: REPO }).status, 0);
});
