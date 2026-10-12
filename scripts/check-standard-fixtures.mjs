#!/usr/bin/env node
// Gate: the outcomes app-structure-v3.md section 12 states for the schema fixtures in
// docs/standard/schema/fixtures. Two valid files validate (the map with its event log, the
// applies-when map), four invalid ones fail for a named reason, and valid-applies-when reads
// book-a-class bad, loyalty-points na, spot-selection watch, class-packs na, virtual-classes
// unmeasured, rollup bad. Exits 1 on any mismatch. Run: node scripts/check-standard-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lensHealth, rollupHealth } from '../src/lib/standard/health.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'docs/standard/schema/fixtures');
const VALIDATOR = path.join(ROOT, 'scripts/validate-structure.mjs');

let failed = 0;
const total = 12;
function expect(label, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (${detail})`}`);
}

function validate(args) {
  const r = spawnSync(process.execPath, [VALIDATOR, ...args], { encoding: 'utf8', cwd: ROOT });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// 1-2: files that must validate
const map = validate([path.join(FIX, 'valid-map.json'), '--events', path.join(FIX, 'valid-map.events.jsonl')]);
expect('valid-map.json (+ events) validates', map.code === 0, `exit ${map.code}`);
const aw = validate([path.join(FIX, 'valid-applies-when.json')]);
expect('valid-applies-when.json validates', aw.code === 0, `exit ${aw.code}`);

// 3-6: files that must fail, each for its named reason
const MUST_FAIL = [
  ['invalid-stage.json', 'must be one of: idea'],
  ['invalid-lens-id.json', 'needs a reverse-DNS id'],
  ['invalid-two-operators.json', 'has 2 operators'],
  ['invalid-core-field.json', 'a field can bind only to the core feature fields'],
];
for (const [file, reason] of MUST_FAIL) {
  const r = validate([path.join(FIX, file)]);
  expect(`${file} fails: ${reason}`, r.code === 1 && r.out.includes(reason), `exit ${r.code}, reason ${r.out.includes(reason) ? 'found' : 'missing'}`);
}

// 7-12: valid-applies-when through the evaluator
const doc = JSON.parse(fs.readFileSync(path.join(FIX, 'valid-applies-when.json'), 'utf8'));
const lens = doc.lenses[0];
const today = '2026-01-01';
const healths = {};
for (const f of doc.features) {
  healths[f.slug] = lensHealth(lens.manifest, doc.facets?.[f.slug]?.[lens.id], today, { feature: { stage: f.stage, tier: f.tier } });
}
const WANT = { 'book-a-class': 'bad', 'loyalty-points': 'na', 'spot-selection': 'watch', 'class-packs': 'na', 'virtual-classes': 'unmeasured' };
for (const [slug, want] of Object.entries(WANT)) {
  expect(`${slug} reads ${want}`, healths[slug] === want, `got ${healths[slug]}`);
}
const roll = rollupHealth(lens.manifest, Object.values(healths));
expect('rollup reads bad', roll === 'bad', `got ${roll}`);

console.log(`\n${total - failed} of ${total} fixture outcomes hold`);
process.exit(failed ? 1 : 0);
