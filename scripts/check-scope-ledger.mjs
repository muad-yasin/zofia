#!/usr/bin/env node
// HANDOFF item 9: PLAN.md's Scope ledger must account for every proposal id the plan cites.
//
//   node scripts/check-scope-ledger.mjs [plan.md] [--strict]
//
// Errors (exit 1): an id cited outside the ledger with no ledger entry; a ledger entry
// listed twice; a ledger bullet that doesn't parse as "- ID - status - note"; no ledger.
// Ledger-only ids (an entry the plan never cites outside the ledger) are a warning, and
// an error with --strict. The real PLAN.md has three of those (see DECISIONS.md,
// 2026-09-23), so a hard failure would contradict item 9's own "zero on the real
// PLAN.md" acceptance.
//
// A proposal id is SEAT-N where SEAT is either a seat already named in the ledger or any
// uppercase token that carries a digit (every council seat name does: GLM53, FABLE51),
// so "UTF-8" or "ISO-8601" is never mistaken for one.

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATUSES = ['accepted', 'withdrawn', 'rejected', 'deferred'];

export function checkLedger(text) {
  const errors = [];
  const warnings = [];
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## Scope ledger\s*$/.test(l));
  if (start < 0) return { errors: ['no "## Scope ledger" section'], warnings, ledger: [] };
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;

  const ledger = new Map();
  for (let i = start + 1; i < end; i++) {
    const l = lines[i];
    if (!l.startsWith('- ')) continue;
    const m = /^- ([A-Z][A-Z0-9]*-\d+) - ([a-z]+) - \S/.exec(l);
    if (!m || !STATUSES.includes(m[2])) {
      errors.push(`line ${i + 1}: ledger entry doesn't parse as "- ID - ${STATUSES.join('|')} - note": ${l.slice(0, 80)}`);
      continue;
    }
    if (ledger.has(m[1])) errors.push(`line ${i + 1}: ${m[1]} is listed twice (first on line ${ledger.get(m[1])})`);
    else ledger.set(m[1], i + 1);
  }

  const seats = [...new Set([...ledger.keys()].map((id) => id.replace(/-\d+$/, '')))];
  const seatAlt = seats.length ? `${seats.join('|')}|` : '';
  const idRe = new RegExp(`\\b((?:${seatAlt}[A-Z][A-Z0-9]*\\d[A-Z0-9]*)-\\d+)\\b`, 'g');

  const cited = new Map(); // id -> first line cited outside the ledger
  lines.forEach((l, i) => {
    if (i >= start && i < end) return;
    for (const [, id] of l.matchAll(idRe)) if (!cited.has(id)) cited.set(id, i + 1);
  });

  for (const [id, line] of cited) {
    if (!ledger.has(id)) errors.push(`line ${line}: ${id} is cited but has no Scope ledger entry`);
  }
  for (const [id, line] of ledger) {
    if (!cited.has(id)) warnings.push(`line ${line}: ${id} is in the Scope ledger but never cited outside it`);
  }
  return { errors, warnings, ledger: [...ledger.keys()] };
}

function main(argv) {
  const strict = argv.includes('--strict');
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const path = resolve(argv.find((a) => !a.startsWith('--')) ?? join(repo, 'PLAN.md'));
  const { errors, warnings, ledger } = checkLedger(readFileSync(path, 'utf8'));
  const fail = [...errors, ...(strict ? warnings : [])];
  for (const w of strict ? [] : warnings) console.warn(`warning: ${w}`);
  if (fail.length) {
    console.error(`scope ledger check FAILED (${path}):\n  ${fail.join('\n  ')}`);
    return 1;
  }
  console.log(`scope ledger OK: ${ledger.length} entries, every cited id accounted for (${path})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
