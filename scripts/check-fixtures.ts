// The one fixture gate (check:standard-fixtures delegates here). Holds the validator and the evaluator to what docs/standard/app-structure-v3.md §12 says the fixtures in
// packages/schema/schema/fixtures/ do: the valid ones pass, each invalid one fails FOR ITS STATED REASON, and
// valid-applies-when.json evaluates to the healths the spec lists. Without this, a validator change that
// drops an error (or the evaluator changing precedence) passes every other gate.
// Run: node scripts/check-fixtures.ts  (Node's type stripping; no build step). Exit 1 when any expectation fails.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explain, lensHealth, rollupHealth } from '../packages/core/src/standard/health.ts';
import { loadStructure } from '../packages/core/src/standard/load.ts';
import type { AppStructure, Health } from '../packages/core/src/standard/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = 'packages/schema/schema/fixtures';
// the default run validates every built-in and every custom lens manifest; count them rather than pin a number
const LENS_FILES = ['docs/standard/lenses', 'docs/standard/lenses-custom']
  .reduce((n, d) => n + fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.json')).length, 0);
const VALIDATOR = path.join(ROOT, 'scripts/validate-structure.mjs');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

// ------------------------------------------------------------------ the validator (spec §12 "Fixtures")
// [args, expected exit code, texts the output must contain (the stated reasons, not just any failure);
// a text starting with "!" must be ABSENT]. Each new validator rule has a fixture here that trips it.
const VALID = `${FIX}/valid-map.json`, GAPS = `${FIX}/warn-validator-gaps.json`;
const RUNS: [string[], 0 | 1, ...string[]][] = [
  [[VALID, '--events', `${FIX}/valid-map.events.jsonl`], 0, '2 of 2 valid'],
  [[`${FIX}/valid-applies-when.json`], 0, 'value "stage" is bound to feature stage; a stored value is ignored'],
  [[`${FIX}/malformed-missing-values.json`], 1, 'an unknown value is omitted, never written as null'],
  [[`${FIX}/malformed-loader.json`], 1, 'manifest: missing required key "reader"'],
  [[`${FIX}/invalid-stage.json`], 1, '.stage: must be one of: idea, specified, in-dev, in-review, flagged, live, deprecated (got "shipped")'],
  [[`${FIX}/invalid-lens-id.json`], 1, 'a custom lens (source "project") needs a reverse-DNS id'],
  [[`${FIX}/invalid-two-operators.json`], 1, 'has 2 operators'],
  [[`${FIX}/invalid-core-field.json`], 1, 'a field can bind only to the core feature fields'],
  // validator gaps: warnings (exit 0) for a stored value under a KPI-bound key, an unknown field in `short`, operands of the
  // wrong type, ordering a boolean, a mixed `in` list; and no "expired" note, because the override is read on the map's as-of date
  [[GAPS, '--events', `${FIX}/warn-validator-gaps.events.jsonl`], 0,
    'value "spend" is bound to KPI "sms-spend"; a stored value is ignored', 'rule 1 short names unknown field {missing}',
    'compares boolean "specDrift" with "true" (string)', 'compares integer "level" with "3" (string) using gt', 'orders boolean "specDrift" with gte',
    'compares enum "mode" with 2 (number)', 'lens "com.kettle.removed" is not in the map\'s lenses[]', '!override expired'],
  [['--events', `${FIX}/invalid-event-feature-added.events.jsonl`], 1, 'to: must be one of: idea, specified'],
  [[`${FIX}/invalid-min-on-string.json`], 1, '"min" and "max" are only allowed on numeric fields'],
  // a composed (steps) scan: a script, the conform skill and a judgement; a script yielding an undeclared field fails
  [[`${FIX}/valid-steps-lens.json`], 0, '1 of 1 valid'],
  [[`${FIX}/invalid-steps-yields.json`], 1, 'scan step 1 yields "leadsLanded", which is not a numeric metric field'],
  [[VALID, GAPS, '--events', `${FIX}/valid-map.events.jsonl`], 1, '--events is checked against one map, but 2 maps were given'],
  [[], 0, 'com.kettle.cost.json (lens-manifest/1)', `${LENS_FILES} of ${LENS_FILES} valid`],
];
for (const [args, code, ...texts] of RUNS) {
  const r = spawnSync(process.execPath, [VALIDATOR, ...args], { cwd: ROOT, encoding: 'utf8' });
  const name = path.basename(args.find((a) => a.startsWith(FIX)) ?? '(default run)');
  expect(r.status === code, `${name}: validator exit ${r.status}, expected ${code}`);
  for (const t of texts) {
    const neg = t.startsWith('!'), want = neg ? t.slice(1) : t;
    expect(r.stdout.includes(want) !== neg, `${name}: output ${neg ? 'has' : 'lacks'} ${JSON.stringify(want)}`);
  }
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

// ------------------------------------------------------------------ the spec §14 example (valid-map.json)
// "Reading it on 2026-10-09", line by line; the fixture is the example, so the spec cannot drift from what runs.
{
  const m14 = JSON.parse(fs.readFileSync(path.join(ROOT, FIX, 'valid-map.json'), 'utf8')) as AppStructure;
  const [sec, cost] = m14.lenses!;
  const F = (slug: string) => m14.features!.find((x) => x.slug === slug)!;
  const ctx = (slug: string) => ({ feature: F(slug), kpis: m14.kpis });
  const facet = (slug: string, l: typeof sec) => m14.facets?.[slug]?.[l.id];
  const D = 'failed-payment-dunning', R = 'recurring-billing-engine';
  const read = (slug: string, l: typeof sec, day: string) => lensHealth(l.manifest, facet(slug, l), day, ctx(slug));
  expect(read(D, sec, '2026-10-09') === 'watch', '§14 dunning/security on 10-09: the override says watch');
  expect(explain(sec.manifest, facet(D, sec), ctx(D)) === 'In production (flagged) without a finished security review', '§14 dunning/security: the rules say bad, "In production (flagged) ..."');
  expect(read(D, sec, '2026-10-16') === 'watch', '§14 dunning/security on 10-16: the override runs through its last day');
  expect(read(D, sec, '2026-10-17') === 'bad', '§14 dunning/security on 10-17: the rules apply again');
  expect(read(D, cost, '2026-10-09') === 'watch', '§14 dunning/cost: watch from the KPI-bound smsSpendUsd');
  expect(explain(cost.manifest, facet(D, cost), ctx(D)) === 'SMS spend 310 USD this month', '§14 dunning/cost: the reason reads the KPI value');
  expect(read(R, cost, '2026-10-09') === 'unmeasured', '§14 recurring/cost: no facet, unmeasured');
  const secRoll = rollupHealth(sec.manifest, [R, D].map((s) => read(s, sec, '2026-10-09')));
  expect(secRoll === 'watch', `§14 security rollup over the capability: ${secRoll}, expected watch`);
  const l14 = loadStructure(m14, null);
  expect(l14.warnings.length === 0 && !l14.LENS.business && m14.facets![R].business !== undefined, '§14 the business facet is orphaned (no lens, kept in the map) and the map loads clean');
  expect(l14.features.find((x) => x.slug === D)!.lens[sec.id].h === 'watch', '§14 the loader agrees with the evaluator');
}

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

// ------------------------------------------------------------------ the loader on malformed input (malformed-loader.json)
// Schema-invalid on purpose: the loader must degrade with a warning per problem (first duplicate wins), never throw.
{
  const bad = JSON.parse(fs.readFileSync(path.join(ROOT, FIX, 'malformed-loader.json'), 'utf8')) as AppStructure;
  const st = loadStructure(bad, null);
  const has = (frag: string) => expect(st.warnings.some((w) => w.includes(frag)), `malformed-loader: no warning containing ${JSON.stringify(frag)}; got ${JSON.stringify(st.warnings)}`);
  for (const frag of [
    'duplicate domains slug "booking"', 'duplicate capabilities slug "classes"', 'unknown domain "nowhere"', 'duplicate features slug "book-a-class"',
    'stage "shipped"', 'priority "P9"', 'status "paused"', 'milestone is not a string', 'built_by is not an array', 'depends_on is not an array', 'notes is not an array',
    'variations[0] needs a slug, name and audience', 'duplicate variation slug "chain"', 'milestone "m1": status "done"',
    'duplicate lens id "com.kettle.probe"', 'lens "com.kettle.broken": reader is missing', 'lenses[3] needs an id and a manifest',
    'facet waitlist/com.kettle.probe is not an object',
  ]) has(frag);
  const f1 = st.features.find((x) => x.slug === 'book-a-class')!;
  expect(st.features.filter((x) => x.slug === 'book-a-class').length === 1 && f1.name === 'Book a class', 'malformed-loader: the first duplicate feature wins');
  expect(st.domains.filter((d) => d.id === 'booking').length === 1 && st.domains.find((d) => d.id === 'booking')!.name === 'Booking', 'malformed-loader: the first duplicate domain wins');
  expect(st.allLenses.length === 1 && st.allLenses[0].manifest.version === '0.1.0', 'malformed-loader: one lens survives, the first of the duplicate id');
  expect(f1.stage === null && f1.priority === null && f1.status === 'active' && f1.milestone === null, 'malformed-loader: bad enums read as unknown / defaults');
  expect(f1.builtBy.length === 0 && f1.notes.length === 0 && f1.dependsOn.length === 0, 'malformed-loader: non-array lists read as empty');
  expect(f1.variations.length === 1 && f1.variations[0].slug === 'chain' && f1.variations[0].name === 'Chain', 'malformed-loader: only the first well-formed variation is kept');
  expect(st.features.find((x) => x.slug === 'waitlist')!.capability === 'unplaced', 'malformed-loader: a feature of a dropped capability lands in Unplaced');
  expect(st.milestones[0].state === 'planned', 'malformed-loader: an unknown milestone status reads as planned');
  expect(f1.lens['com.kettle.probe'].h === 'watch', 'malformed-loader: the surviving lens still evaluates');
  // Kettle-shaped input is clean, and total failures still throw
  expect(loadStructure(map, null).warnings.length === 0, 'valid-applies-when: a valid map loads with no warnings');
  for (const [name, v] of [['not an object', 5], ['null', null], ['an array', []], ['neither v2 nor v3', { $schema: 'app-structure/9' }]] as const) {
    let threw = false;
    try { loadStructure(v, null); } catch { threw = true; }
    expect(threw, `loader: ${name} must still throw`);
  }
  // the cache keys on every option that changes the result
  const ev = ['2019-01-01', '2020-01-01'].map((d) => JSON.stringify({ at: d + 'T00:00:00Z', type: 'noop' })).join('\n');
  const w3 = loadStructure(map, ev, { weeks: 3 }), w9 = loadStructure(map, ev, { weeks: 9 });
  expect(w3.weeks.length !== w9.weeks.length && w3 !== w9, 'loader cache: weeks changes the result');
  const v2 = { version: 2, use_cases: [{ name: 'Thing' }] };
  const catA = [lens.manifest], catB: typeof catA = [];
  const a = loadStructure(v2, null, { catalog: catA }), b = loadStructure(v2, null, { catalog: catB });
  expect(a.allLenses.length === 1 && b.allLenses.length === 0, 'loader cache: catalog changes the result');
  expect(loadStructure(v2, null, { catalog: catA }) === a, 'loader cache: the same map, events and options hit the cache');
}

const total = held + failures.length;
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${held} of ${total} fixture expectations hold`);
process.exit(failures.length ? 1 : 0);
