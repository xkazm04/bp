// Holds the validator and the evaluator to what docs/standard/app-structure-v3.md §12 says the fixtures in
// docs/standard/schema/fixtures/ do: the valid ones pass, each invalid one fails FOR ITS STATED REASON, and
// valid-applies-when.json evaluates to the healths the spec lists. Without this, a validator change that
// drops an error (or the evaluator changing precedence) passes every other gate.
// Run: node scripts/check-fixtures.ts  (Node's type stripping; no build step). Exit 1 when any expectation fails.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lensHealth, rollupHealth } from '../src/lib/standard/health.ts';
import type { AppStructure, Health } from '../src/lib/standard/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = 'docs/standard/schema/fixtures';
const VALIDATOR = path.join(ROOT, 'scripts/validate-structure.mjs');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

// ------------------------------------------------------------------ the validator (spec §12 "Fixtures")
// [args, expected exit code, text the output must contain: the stated reason, not just any failure]
const RUNS: [string[], 0 | 1, string][] = [
  [[`${FIX}/valid-map.json`, '--events', `${FIX}/valid-map.events.jsonl`], 0, '2 of 2 valid'],
  [[`${FIX}/valid-applies-when.json`], 0, 'value "stage" is bound to feature stage; a stored value is ignored'],
  [[`${FIX}/invalid-stage.json`], 1, '.stage: must be one of: idea, specified, in-dev, in-review, flagged, live, deprecated (got "shipped")'],
  [[`${FIX}/invalid-lens-id.json`], 1, 'a custom lens (source "project") needs a reverse-DNS id'],
  [[`${FIX}/invalid-two-operators.json`], 1, 'has 2 operators'],
  [[`${FIX}/invalid-core-field.json`], 1, 'a field can bind only to the core feature fields'],
];
for (const [args, code, text] of RUNS) {
  const r = spawnSync(process.execPath, [VALIDATOR, ...args], { cwd: ROOT, encoding: 'utf8' });
  const name = path.basename(args[0]);
  expect(r.status === code, `${name}: validator exit ${r.status}, expected ${code}`);
  expect(r.stdout.includes(text), `${name}: output lacks the stated reason ${JSON.stringify(text)}`);
}
// Every fixture on disk is covered above: a new fixture without an expectation is a failure, not a pass.
const covered = new Set(RUNS.flatMap(([a]) => a.filter((x) => x.startsWith(FIX)).map((x) => path.basename(x))));
for (const f of fs.readdirSync(path.join(ROOT, FIX))) expect(covered.has(f), `${f}: a fixture with no expectation in scripts/check-fixtures.ts`);

// ------------------------------------------------------------------ the evaluator (valid-applies-when.json)
// "Read on any date": the override on loyalty-points runs to 2099, so a far date and today agree.
const map = JSON.parse(fs.readFileSync(path.join(ROOT, FIX, 'valid-applies-when.json'), 'utf8')) as AppStructure;
const lens = map.lenses![0];
const HEALTH: Record<string, Health> = { 'book-a-class': 'bad', 'loyalty-points': 'na', 'spot-selection': 'watch', 'class-packs': 'na', 'virtual-classes': 'unmeasured' };
const today = new Date().toISOString().slice(0, 10);
const got = map.features!.map((f) => {
  const h = lensHealth(lens.manifest, map.facets?.[f.slug]?.[lens.id], today, { feature: f });
  expect(h === HEALTH[f.slug], `valid-applies-when ${f.slug}: health ${h}, expected ${HEALTH[f.slug]}`);
  return h;
});
expect(map.features!.length === Object.keys(HEALTH).length, `valid-applies-when: ${map.features!.length} features, expected ${Object.keys(HEALTH).length}`);
const rolled = rollupHealth(lens.manifest, got);
expect(rolled === 'bad', `valid-applies-when rollup: ${rolled}, expected bad`);

const total = held + failures.length;
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${held} of ${total} fixture expectations hold`);
process.exit(failures.length ? 1 : 0);
