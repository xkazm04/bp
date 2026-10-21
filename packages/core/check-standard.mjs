#!/usr/bin/env node
// The standard's catalog, as a gate. Without it the catalog is a hand-maintained list that nothing
// reconciles with the directory it copies, and a drift reads as a working product:
//   catalog   packages/core/src/standard/catalog.ts lists exactly the manifests in docs/standard/lenses/ —
//             same count, each id equal to its file's stem, and each entry the file's own JSON. The
//             directory is the ground truth (packages/schema/generate.mjs and scripts/validate-structure.mjs
//             both read it with readdir); catalog.ts is seven hand-written imports, so an eighth manifest
//             would validate everywhere and still be missing from BUILTIN_LENSES, which is what a v2 map
//             reads its "available but unmeasured" lenses from.
// Run: node packages/core/check-standard.mjs   (plain node; type stripping loads the .ts modules)
// Exit 1 on any failed expectation, else 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const load = (p) => import(pathToFileURL(path.join(HERE, p)).href);
const { BUILTIN_LENSES } = await load('src/standard/catalog.ts');
const { loadStructure } = await load('src/standard/load.ts');
const { rollupHealth } = await load('src/standard/health.ts');

let held = 0;
const failures = [];
const expect = (ok, what) => { if (ok) held++; else failures.push(what); };

// ------------------------------------------------------------------ catalog: the directory is the list
{
  const dir = 'docs/standard/lenses';
  const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.json')).sort();
  expect(files.length > 0, `${dir}: no manifest files found`);
  expect(BUILTIN_LENSES.length === files.length,
    `catalog: BUILTIN_LENSES has ${BUILTIN_LENSES.length} manifests, ${dir} has ${files.length} (${files.join(', ')})`);
  const byId = new Map(BUILTIN_LENSES.map((m) => [m.id, m]));
  expect(byId.size === BUILTIN_LENSES.length, 'catalog: BUILTIN_LENSES has a duplicate id');
  for (const f of files) {
    const stem = f.slice(0, -'.json'.length);
    const m = byId.get(stem);
    expect(!!m, `catalog: ${dir}/${f} is not in BUILTIN_LENSES (add the import to src/standard/catalog.ts)`);
    if (!m) continue;
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'));
    expect(json.id === stem, `${dir}/${f}: id ${JSON.stringify(json.id)} is not the file's stem`);
    expect(JSON.stringify(m) === JSON.stringify(json), `catalog: the entry for "${stem}" is not ${dir}/${f}'s own JSON`);
    expect(m.$schema === 'lens-manifest/1', `catalog: "${stem}" is not a lens-manifest/1`);
  }
  for (const m of BUILTIN_LENSES) {
    expect(fs.existsSync(path.join(ROOT, dir, m.id + '.json')), `catalog: "${m.id}" has no manifest in ${dir}`);
  }
}

// ------------------------------------------------------------------ warnings: every repair or drop leaves one
// The loader reports what it repaired or dropped in `warnings`. One map here walks every repair-or-drop path it
// used to take in silence: a swallowed drop in a LOADER is how a product silently becomes wrong instead of
// failing, so each one has to name itself. The control below is the Kettle map, which must warn 0 times — a rule
// that fires on valid input is as wrong as one that never fires.
{
  const probeLens = {
    id: 'com.probe.lens', version: '0.1.0', source: 'project', enabled: true,
    manifest: {
      $schema: 'lens-manifest/1', id: 'com.probe.lens', version: '0.1.0', name: 'Probe',
      reader: { role: 'a probe', density: 'cosy' },
      fields: [{ key: 'n', type: 'integer', label: 'N' }],
      presentation: { evidence: ['n', 'nope'], measures: 'gone', glyph: 'not-a-glyph', line: 'squiggle' },
      health: {
        default: 'good', rollup: { method: 'worst-of' }, applies_when: { field: 'absent', present: true },
        rules: [{ when: { field: 'ghost', gt: 1 }, health: 'bad', reason: 'r' }],
      },
    },
  };
  const probeMap = {
    $schema: 'app-structure/3',
    project: { slug: 'probe', name: 'Probe' },
    generated_at: '2026-01-01T00:00:00Z',
    lenses: [probeLens],
    domains: [{ slug: 'd', name: 'D' }],
    capabilities: [{ slug: 'c', domain: 'd', name: 'C' }],
    features: [{
      slug: 'f', name: 'F', capability: 'c',
      depends_on: ['ghost-feature'], blocked_by: ['phantom-feature'],
      parts: [{ done: true }], notes: ['a string, not a note'],
      variations: [{ slug: 'v', name: 'V', audience: 'a', extends: 'a string', params: [1, 2] }],
    }, { slug: 'g', name: 'G', capability: 'c', depends_on: ['g'], blocked_by: ['g'] }],
    kpis: [{ name: 'no slug' }, 'not an object'],
    extensions: { 'com.probe': { people: [{ name: 'no id' }], activity: [{ type: 'commit' }] } },
  };
  const probeEvents = 'not json at all\n{"type":"stage","feature":"f","to":"live"}\n{"at":"2026-01-01T00:00:00Z","type":"stage","feature":"f","to":"live"}\n';
  let st;
  try { st = loadStructure(probeMap, probeEvents); } catch (e) {
    failures.push(`warnings: the probe map threw instead of degrading: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (st) {
    const has = (frag) => expect(st.warnings.some((w) => w.includes(frag)),
      `warnings: none containing ${JSON.stringify(frag)}; got ${JSON.stringify(st.warnings)}`);
    for (const frag of [
      'events log: 1 line is not JSON',
      'events log: 1 line has no at and type',
      'feature "f": depends_on names unknown feature "ghost-feature"',
      'feature "f": blocked_by names unknown feature "phantom-feature"',
      'feature "f": parts[0] has no name',
      'feature "f": notes[0] is not an object',
      'feature "f": variation "v" extends is not an array; ignored',
      'feature "f": variation "v" params has entries that are not strings; dropped',
      'feature "g": depends_on names itself; dropped',
      'feature "g": blocked_by names itself; dropped',
      'kpis[0] has no slug',
      'kpis[1] has no slug',
      'extensions: 1 person entry has no id',
      'extensions: 1 activity entry has no at',
      'lens "com.probe.lens": reader.density "cosy" is unknown',
      'lens "com.probe.lens": presentation.line "squiggle" is unknown',
      'lens "com.probe.lens": presentation.glyph "not-a-glyph" is unknown',
      'lens "com.probe.lens": presentation.evidence names unknown field "nope"',
      'lens "com.probe.lens": presentation.measures names unknown field "gone"',
      'lens "com.probe.lens": rule 1 names unknown field "ghost"',
      'lens "com.probe.lens": applies_when names unknown field "absent"',
    ]) has(frag);
    // the degraded read still holds: the warning is added to the repair, never instead of it
    expect(st.events.length === 1, `warnings: ${st.events.length} events parsed, expected 1 of 3 lines`);
    expect(st.features[0].dependsOn.length === 0 && st.features[0].blockedBy.length === 0, 'warnings: unknown links are still dropped');
    const g = st.features.find((f) => f.id === 'g');
    expect(!!g && g.dependsOn.length === 0 && g.usedBy.length === 0 && g.blockedBy.length === 0, `warnings: a self-dependency left dependsOn ${JSON.stringify(g && g.dependsOn)} usedBy ${JSON.stringify(g && g.usedBy)} blockedBy ${JSON.stringify(g && g.blockedBy)}`);
    expect(st.features[0].parts.length === 0 && st.features[0].notes.length === 0, 'warnings: malformed parts and notes are still dropped');
    expect(st.kpis.length === 0 && st.people.length === 0, 'warnings: KPIs without a slug and people without an id are still dropped');
    const d = st.allLenses[0];
    expect(st.allLenses.length === 1 && d.density === 'standard' && d.line === 'solid' && d.glyph === null && d.measures === null
      && d.evidence.length === 1 && d.evidence[0].key === 'n', 'warnings: the lens still falls back to its defaults');
    // a custom glyph path the validator would refuse is reported too, not only an unknown name
    const bad = JSON.parse(JSON.stringify(probeLens));
    bad.manifest.presentation.glyph = { path: 'drop table lenses' };
    const st2 = loadStructure({ ...probeMap, lenses: [bad] }, null);
    expect(st2.warnings.some((w) => w.includes('presentation.glyph.path was rejected')), `warnings: a rejected glyph path left ${JSON.stringify(st2.warnings)}`);
  }
}

// ------------------------------------------------------------------ the as-of stamp: repaired, never thrown
// The loader's contract (src/standard/load.ts loadStructure) is that only a map which is not an object or not
// v2/v3 throws; everything else degrades with a warning. The as-of stamp feeds addDays and the week replay, so a
// stamp that is not a date used to leave the loader as a RangeError.
{
  const map = (generated_at, extra = {}) => ({
    $schema: 'app-structure/3', project: { slug: 'p', name: 'P' }, generated_at,
    domains: [{ slug: 'd', name: 'D' }], capabilities: [{ slug: 'c', domain: 'd', name: 'C' }],
    features: [{ slug: 'f', name: 'F', capability: 'c' }], ...extra,
  });
  const dated = /^\d{4}-\d{2}-\d{2}$/;
  for (const [stamp, events] of [['soon', null], ['2026-13-45', null], ['', 'not json\n'], ['tuesday', '{"at":"later","type":"noop"}\n']]) {
    let st;
    try { st = loadStructure(map(stamp), events); } catch (e) {
      failures.push(`as-of: generated_at ${JSON.stringify(stamp)} threw ${e instanceof Error ? e.message : String(e)} instead of degrading`);
      continue;
    }
    expect(dated.test(st.asOf), `as-of: generated_at ${JSON.stringify(stamp)} left asOf ${JSON.stringify(st.asOf)}`);
    expect(st.weeks.length >= 1 && st.weeks.every((w) => dated.test(w)), `as-of: generated_at ${JSON.stringify(stamp)} left weeks ${JSON.stringify(st.weeks)}`);
    if (stamp) expect(st.warnings.some((w) => w.includes('is not a date')), `as-of: generated_at ${JSON.stringify(stamp)} was repaired with no warning`);
  }
  // a dated stamp is still taken as given, and still warns about nothing
  const ok = loadStructure(map('2026-01-01T09:30:00Z'), null);
  expect(ok.asOf === '2026-01-01' && ok.asOfTime === '2026-01-01T09:30:00Z' && ok.warnings.length === 0, `as-of: a valid stamp read as ${ok.asOf} / ${JSON.stringify(ok.warnings)}`);
}

// ------------------------------------------------------------------ a rollup never reads better than its parts
// The schema requires `watch` and `bad` on a share rollup (lens-manifest-1.schema.json $defs.rollup), but a map
// carries its own copy of each manifest and nothing re-validates that at load. A rollup must never answer a
// health better than the features under it because a threshold was missing.
{
  const m = (rollup) => ({ id: 'com.probe.r', version: '0.1.0', name: 'R', reader: { density: 'standard' },
    fields: [{ key: 'w', type: 'integer', label: 'W' }], presentation: { glyph: 'bars', line: 'solid' },
    health: { default: 'good', rollup, rules: [] } });
  const all = ['bad', 'bad', 'bad'];
  expect(rollupHealth(m({ method: 'share' }), all) === 'bad', `rollup: share with no thresholds read [bad,bad,bad] as ${rollupHealth(m({ method: 'share' }), all)}`);
  expect(rollupHealth(m({ method: 'share', watch: 0.2 }), all) === 'bad', 'rollup: share with only a watch threshold');
  expect(rollupHealth(m({ method: 'share', watch: 0.2, bad: 0.34 }), all) === 'bad', 'rollup: a complete share rollup still reads bad');
  expect(rollupHealth(m({ method: 'share', watch: 0.2, bad: 0.34 }), ['good', 'good', 'watch']) === 'watch', 'rollup: a complete share rollup still reads its thresholds');
  expect(rollupHealth(m({ method: 'weighted', by: 'nope' }), all) === 'bad', 'rollup: weighted by a field nothing carries falls back to worst-of');
  expect(rollupHealth(m({ method: 'worst-of' }), ['good', 'watch']) === 'watch', 'rollup: worst-of unchanged');
}

// ------------------------------------------------------------------ the door: a rollup the schema refuses is not loaded
// lens-manifest-1.schema.json $defs.rollup requires `watch` and `bad` (numbers) on share and `by` on weighted, and
// allows three methods. The loader is the only reader of the manifest copy a map carries, so it enforces the same
// rules at the door: a refused rollup drops the lens with its reason, like every other manifest problem. One row
// per rule; the valid rows must keep loading.
{
  const base = (rollup) => ({
    $schema: 'app-structure/3', project: { slug: 'r', name: 'R' }, generated_at: '2026-01-01T00:00:00Z',
    lenses: [{ id: 'com.probe.r', version: '0.1.0', source: 'project', enabled: true, manifest: {
      $schema: 'lens-manifest/1', id: 'com.probe.r', version: '0.1.0', name: 'R', reader: { density: 'standard' },
      fields: [{ key: 'w', type: 'integer', label: 'W' }], presentation: { glyph: 'bars', line: 'solid' },
      health: { default: 'good', rollup, rules: [] } } }],
    domains: [{ slug: 'd', name: 'D' }], capabilities: [{ slug: 'c', domain: 'd', name: 'C' }],
    features: [{ slug: 'f', name: 'F', capability: 'c' }],
  });
  const rows = [
    ['share with no thresholds', { method: 'share' }, 'health.rollup share needs numeric watch and bad'],
    ['share with only watch', { method: 'share', watch: 0.2 }, 'health.rollup share needs numeric watch and bad'],
    ['share with a string threshold', { method: 'share', watch: '0.2', bad: 0.4 }, 'health.rollup share needs numeric watch and bad'],
    ['weighted with no by', { method: 'weighted' }, 'health.rollup weighted needs a by field'],
    ['weighted with a non-string by', { method: 'weighted', by: 3 }, 'health.rollup weighted needs a by field'],
    ['an unknown method', { method: 'median' }, 'health.rollup.method "median" is not worst-of, share or weighted'],
  ];
  for (const [name, rollup, reason] of rows) {
    const st = loadStructure(base(rollup), null);
    expect(st.allLenses.length === 0, `rollup door: ${name} still loaded the lens`);
    expect(st.warnings.some((w) => w.includes(`lens "com.probe.r": ${reason}; the lens is dropped`)), `rollup door: ${name} left ${JSON.stringify(st.warnings)}`);
  }
  for (const [name, rollup] of [['worst-of', { method: 'worst-of' }], ['a complete share', { method: 'share', watch: 0.2, bad: 0.4 }], ['weighted by a field', { method: 'weighted', by: 'w' }]]) {
    const st = loadStructure(base(rollup), null);
    expect(st.allLenses.length === 1 && st.warnings.length === 0, `rollup door: ${name} was refused: ${JSON.stringify(st.warnings)}`);
  }
}

// ------------------------------------------------------------------ the lens toggle: an id nothing matches says so
// `?lenses=-security,+com.kettle.cost` is user input. An id the map has no lens for does nothing, and a typo is
// indistinguishable from a lens that would not turn off, so the ignored ids have to be named — per toggle, since
// one base serves every toggle.
{
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
  const events = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8');
  const of = (toggle) => loadStructure(map, events, { lenses: toggle });
  const typo = of('-securty');
  expect(typo.warnings.some((w) => w.includes('the lens toggle names unknown lens "securty"')), `toggle: a typo left ${JSON.stringify(typo.warnings)}`);
  const two = of('-securty,+com.kettle.cst');
  expect(two.warnings.some((w) => w.includes('names unknown lenses "securty", "com.kettle.cst"')), `toggle: two typos left ${JSON.stringify(two.warnings)}`);
  // and the real ids still work, still silently, and the base is not polluted for the next toggle
  const real = of('-security');
  expect(real.warnings.length === 0, `toggle: a real id warned ${JSON.stringify(real.warnings)}`);
  expect(!real.LENS.security.manifest || real.lenses.every((d) => d.id !== 'security'), 'toggle: -security did not disable the lens');
  expect(of(null).warnings.length === 0, 'toggle: the warning leaked into the untoggled load');
  expect(of('-securty').warnings.length === 1, 'toggle: the warning is not appended twice on a cache hit');

  // a toggle naming the lens it just dropped is reported as unknown too, and the drop is still reported
  expect(typo.lenses.length === real.lenses.length + 1, 'toggle: a typo leaves every lens enabled');
}

// ------------------------------------------------------------------ the control: valid input warns 0 times
{
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
  const events = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8');
  const st = loadStructure(map, events);
  expect(st.warnings.length === 0, `control: the Kettle map warns ${st.warnings.length} times: ${JSON.stringify(st.warnings.slice(0, 6))}`);
  expect(st.features.length > 100 && st.lenses.length > 1, 'control: the Kettle map did not load');
}

for (const f of failures) console.log('FAIL  ' + f);
console.log(failures.length
  ? `check-standard: ${failures.length} failed, ${held} held`
  : `check-standard: ${held} expectations held (${BUILTIN_LENSES.length} built-in manifests; the loader names every repair it makes)`);
process.exit(failures.length ? 1 : 0);
