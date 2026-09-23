#!/usr/bin/env node
// PLAN.md §5 / HANDOFF item 7. Validates config/providers.json against
// config/providers.schema.json, then writes the two generated files every other part of
// Zofia reads from: src/generated/providers.ts and src-tauri/src/generated/providers.rs
// (both gitignored). One source, so the TS and Rust id lists cannot drift apart.
//
//   node scripts/gen-providers.mjs            validate + write
//   node scripts/gen-providers.mjs --check    validate + fail if either written file is stale
//   --config <path>  --root <dir>             tests point these at fixtures / a temp dir
//
// No dependencies: the validator below implements the JSON Schema keywords the schema
// uses and throws on any other keyword, so the schema can never lean on a rule that
// silently isn't enforced.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TS_OUT = 'src/generated/providers.ts';
export const RS_OUT = 'src-tauri/src/generated/providers.rs';

const KNOWN = new Set([
  '$comment', '$defs', '$ref', 'type', 'required', 'properties', 'additionalProperties',
  'propertyNames', 'items', 'minItems', 'enum', 'const', 'pattern', 'not', 'anyOf', 'allOf',
]);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

// Returns a list of "path: message" strings; empty means valid.
export function validate(value, schema, root = schema, path = '$') {
  const errs = [];
  for (const k of Object.keys(schema)) {
    if (!KNOWN.has(k)) throw new Error(`schema uses unsupported keyword "${k}" at ${path}`);
  }
  if (schema.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(schema.$ref);
    if (!m || !root.$defs?.[m[1]]) throw new Error(`unresolvable $ref ${schema.$ref}`);
    errs.push(...validate(value, root.$defs[m[1]], root, path));
  }
  const t = typeOf(value);
  if (schema.type) {
    const ok = schema.type === t || (schema.type === 'number' && t === 'integer');
    if (!ok) return [...errs, `${path}: expected ${schema.type}, got ${t}`];
  }
  if ('const' in schema && value !== schema.const) {
    errs.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errs.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.pattern && t === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
    errs.push(`${path}: ${JSON.stringify(value)} does not match /${schema.pattern}/`);
  }
  if (schema.not && validate(value, schema.not, root, path).length === 0) {
    errs.push(`${path}: ${JSON.stringify(value)} is forbidden by a "not" rule`);
  }
  if (schema.allOf) {
    for (const s of schema.allOf) errs.push(...validate(value, s, root, path));
  }
  if (schema.anyOf) {
    const branches = schema.anyOf.map((s) => validate(value, s, root, path));
    if (!branches.some((b) => b.length === 0)) {
      errs.push(`${path}: matches none of anyOf (${branches.map((b) => b[0]).join(' | ')})`);
    }
  }
  if (t === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errs.push(`${path}: needs at least ${schema.minItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((v, i) => errs.push(...validate(v, schema.items, root, `${path}[${i}]`)));
    }
  }
  if (t === 'object') {
    for (const r of schema.required ?? []) {
      if (!(r in value)) errs.push(`${path}: missing required "${r}"`);
    }
    for (const [k, v] of Object.entries(value)) {
      const p = `${path}.${k}`;
      if (schema.propertyNames) errs.push(...validate(k, schema.propertyNames, root, `${p} (name)`));
      if (schema.properties && k in schema.properties) {
        errs.push(...validate(v, schema.properties[k], root, p));
      } else if (schema.additionalProperties === false) {
        errs.push(`${path}: unexpected property "${k}"`);
      } else if (typeof schema.additionalProperties === 'object') {
        errs.push(...validate(v, schema.additionalProperties, root, p));
      }
    }
  }
  return errs;
}

// Cross-entry rules a per-value schema cannot express.
// A real effort value's source: a non-empty anchor in item 1's measured matrix.
const MEASURED_TAG = /^docs\/field-availability\.md#\S+$/;

export function crossCheck(cfg) {
  const errs = [];
  const seen = new Set();
  for (const p of cfg.providers) {
    if (seen.has(`p:${p.id}`)) errs.push(`duplicate provider id "${p.id}"`);
    seen.add(`p:${p.id}`);
    // Repeats the schema's effort rules on purpose: an unmeasured value must never render
    // as a real one, even if the hand-written validator has a gap.
    const key = p.launch.effort_key;
    if ((key.value === 'UNKNOWN') !== (key.source === 'UNKNOWN')) {
      errs.push(`provider "${p.id}": effort_key must be UNKNOWN in both value and source, or a real value with a measured tag`);
    } else if (key.value !== 'UNKNOWN' && !MEASURED_TAG.test(key.source)) {
      errs.push(`provider "${p.id}": effort_key source "${key.source}" is not a docs/field-availability.md#<anchor> tag`);
    }
    for (const m of p.models) {
      if (seen.has(`m:${m.id}`)) errs.push(`duplicate model id "${m.id}"`);
      seen.add(`m:${m.id}`);
      if (m.effort_levels === 'UNKNOWN') continue;
      for (const e of m.effort_levels) {
        if (e.level === 'UNKNOWN' || !MEASURED_TAG.test(e.source ?? '')) {
          errs.push(`model "${m.id}": effort level "${e.level}" has no measured tag (source "${e.source}"); write effort_levels: "UNKNOWN" instead`);
        }
      }
    }
  }
  if (!seen.has(`m:${cfg.default_model.value}`)) {
    errs.push(`default_model "${cfg.default_model.value}" is not a declared model id`);
  }
  const dm = cfg.providers.flatMap((p) => p.models).find((m) => m.id === cfg.default_model.value);
  if (dm && Array.isArray(dm.effort_levels) && !dm.effort_levels.some((e) => e.level === cfg.default_effort.value)) {
    errs.push(`default_effort "${cfg.default_effort.value}" is not a measured effort level of default model "${dm.id}"`);
  }
  for (const [name, target] of Object.entries(cfg.aliases)) {
    if (seen.has(`m:${name}`)) errs.push(`alias "${name}" shadows a model id`);
    if (!seen.has(`m:${target}`)) errs.push(`alias "${name}" points at undeclared model "${target}"`);
  }
  return errs;
}

function rsStr(s) {
  // Ids and levels are pattern-restricted to plain ASCII; this guards the rest anyway.
  if (!/^[\x20-\x7e]*$/.test(s)) throw new Error(`non-ASCII string in Rust output: ${s}`);
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const HEADER = 'GENERATED by scripts/gen-providers.mjs from config/providers.json. Do not edit; run `npm run gen:providers`.';

export function render(cfg) {
  const models = cfg.providers.flatMap((p) =>
    p.models.map((m) => ({
      id: m.id,
      provider: p.id,
      label: m.label,
      effortLevels: m.effort_levels === 'UNKNOWN' ? null : m.effort_levels.map((e) => e.level),
    })),
  );
  const providers = cfg.providers.map((p) => ({
    id: p.id,
    label: p.label,
    launchKind: p.launch.kind,
    effortKey: p.launch.effort_key.value === 'UNKNOWN' || p.launch.effort_key.source === 'UNKNOWN' ? null : p.launch.effort_key.value,
  }));
  const aliases = Object.entries(cfg.aliases);

  const ts = `// ${HEADER}
// A null effortLevels / effortKey means UNKNOWN: not yet measured (docs/field-availability.md).

export const PROVIDER_IDS = ${JSON.stringify(providers.map((p) => p.id))} as const;
export const MODEL_IDS = ${JSON.stringify(models.map((m) => m.id))} as const;
export const DEFAULT_MODEL = ${JSON.stringify(cfg.default_model.value)};
export const DEFAULT_EFFORT = ${JSON.stringify(cfg.default_effort.value)};
export const ALIASES: Readonly<Record<string, string>> = ${JSON.stringify(Object.fromEntries(aliases))};

export interface ProviderEntry { id: string; label: string; launchKind: string; effortKey: string | null }
export interface ModelEntry { id: string; provider: string; label: string; effortLevels: string[] | null }

export const PROVIDERS: readonly ProviderEntry[] = ${JSON.stringify(providers, null, 2)};
export const MODELS: readonly ModelEntry[] = ${JSON.stringify(models, null, 2)};
`;

  const opt = (v) => (v === null ? 'None' : `Some(${rsStr(v)})`);
  const rs = `// ${HEADER}
// A None effort entry means UNKNOWN: not yet measured (docs/field-availability.md).

pub const PROVIDER_IDS: &[&str] = &[${providers.map((p) => rsStr(p.id)).join(', ')}];
pub const MODEL_IDS: &[&str] = &[${models.map((m) => rsStr(m.id)).join(', ')}];
pub const DEFAULT_MODEL: &str = ${rsStr(cfg.default_model.value)};
pub const DEFAULT_EFFORT: &str = ${rsStr(cfg.default_effort.value)};
pub const ALIASES: &[(&str, &str)] = &[${aliases.map(([a, t]) => `(${rsStr(a)}, ${rsStr(t)})`).join(', ')}];
/// (provider id, effort launch key)
pub const EFFORT_KEYS: &[(&str, Option<&str>)] = &[${providers.map((p) => `(${rsStr(p.id)}, ${opt(p.effortKey)})`).join(', ')}];
/// (model id, effort levels)
pub const MODEL_EFFORT: &[(&str, Option<&[&str]>)] = &[${models
    .map((m) => `(${rsStr(m.id)}, ${m.effortLevels === null ? 'None' : `Some(&[${m.effortLevels.map(rsStr).join(', ')}])`})`)
    .join(', ')}];
`;
  return { ts, rs };
}

export function load(configPath, schemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  const errs = validate(cfg, schema);
  if (errs.length === 0) errs.push(...crossCheck(cfg));
  return { cfg, errs };
}

function main(argv) {
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : dflt;
  };
  const root = resolve(arg('--root', REPO));
  const configPath = resolve(arg('--config', join(REPO, 'config/providers.json')));
  const schemaPath = join(REPO, 'config/providers.schema.json');

  const { cfg, errs } = load(configPath, schemaPath);
  if (errs.length) {
    console.error(`providers config INVALID (${configPath}):\n  ${errs.join('\n  ')}`);
    return 1;
  }
  const out = render(cfg);
  const files = [[join(root, TS_OUT), out.ts], [join(root, RS_OUT), out.rs]];

  if (argv.includes('--check')) {
    const stale = files.filter(([f, body]) => !existsSync(f) || readFileSync(f, 'utf8') !== body);
    if (stale.length) {
      console.error(`generated provider files are STALE or missing; run \`npm run gen:providers\`:\n  ${stale.map(([f]) => f).join('\n  ')}`);
      return 1;
    }
    console.log('generated provider files are current');
    return 0;
  }
  for (const [f, body] of files) {
    mkdirSync(dirname(f), { recursive: true });
    if (!existsSync(f) || readFileSync(f, 'utf8') !== body) writeFileSync(f, body);
  }
  console.log(`providers config valid; wrote ${TS_OUT} and ${RS_OUT}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
