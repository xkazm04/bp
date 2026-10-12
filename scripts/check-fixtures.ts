// Holds the validator and the evaluator to what docs/standard/app-structure-v3.md §12 says the fixtures in
// docs/standard/schema/fixtures/ do: the valid ones pass, each invalid one fails FOR ITS STATED REASON, and
// valid-applies-when.json evaluates to the healths the spec lists. Without this, a validator change that
// drops an error (or the evaluator changing precedence) passes every other gate.
// Run: node scripts/check-fixtures.ts  (Node's type stripping; no build step). Exit 1 when any expectation fails.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explain, lensHealth, rollupHealth } from '../src/lib/standard/health.ts';
import { loadStructure } from '../src/lib/standard/load.ts';
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
  [[`${FIX}/malformed-missing-values.json`], 1, 'an unknown value is omitted, never written as null'],
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

// ------------------------------------------------------------------ missing values (malformed-missing-values.json)
// Spec 8.3 rules 1, 6, 7 and 8.4: null is missing (not a measurement, "unknown" in a reason), a key the manifest
// does not declare is no measurement, and a rule without `short` falls back to the lens name. The file is
// schema-invalid on purpose (null is malformed data), so the loader and evaluator must still read it.
{
  const mm = JSON.parse(fs.readFileSync(path.join(ROOT, FIX, 'malformed-missing-values.json'), 'utf8')) as AppStructure;
  const pl = mm.lenses![0];
  const WANT: Record<string, [Health, string | null]> = {
    'null-value': ['unmeasured', null], 'undeclared-key': ['unmeasured', null],
    'absent-in-reason': ['bad', '6 incidents in unknown'], 'null-in-reason': ['bad', '6 incidents in unknown'], 'short-given': ['watch', '2 incidents'],
  };
  const loaded = loadStructure(mm, null, { lenses: null });
  const lf = (slug: string) => loaded.features.find((x) => x.slug === slug)!;
  for (const [slug, [want, why]] of Object.entries(WANT)) {
    const facet = mm.facets?.[slug]?.[pl.id];
    const h = lensHealth(pl.manifest, facet, today);
    expect(h === want, `missing-values ${slug}: health ${h}, expected ${want}`);
    expect(explain(pl.manifest, facet) === why, `missing-values ${slug}: reason ${JSON.stringify(explain(pl.manifest, facet))}, expected ${JSON.stringify(why)}`);
    const l = lf(slug).lens[pl.id];
    expect(l.h === want && l.why === why, `missing-values ${slug}: loader read ${l.h} / ${JSON.stringify(l.why)}`);
  }
  const sh = (slug: string) => lf(slug).lens[pl.id].short;
  expect(sh('absent-in-reason') === 'Probe', `missing-values: a rule without short falls back to the lens name, got ${JSON.stringify(sh('absent-in-reason'))}`);
  expect(sh('short-given') === 'Some incidents', `missing-values: a given short is kept, got ${JSON.stringify(sh('short-given'))}`);
  expect(sh('null-value') === null, 'missing-values: an unmeasured feature has no short');
  expect(lf('absent-in-reason').trouble[0]?.short === 'Probe', 'missing-values: Trouble.short carries the fallback');
}

const total = held + failures.length;
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${held} of ${total} fixture expectations hold`);
process.exit(failures.length ? 1 : 0);
