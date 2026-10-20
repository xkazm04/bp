// Checks how a live product's model follows its scan between map refreshes (src/lib/model/live-health.ts,
// live-feed.ts): a newer reading of a metric changes `sim.liveValue` and the lens health of THAT feature (the
// standard evaluator, General health and trouble with it) and of nothing else, at any `?scale`; an older
// reading changes nothing; an emptied store restores the map's own values; a newer map of the same shape
// refreshes the model in place (same Feature objects, same layout) and one that differs in shape says so.
// The Kettle sample map stands in for a live product's. Run: node scripts/check-live-health.ts  (Node's type
// stripping; scripts/overlays-loader.mjs transpiles src on the fly; BP_OVERLAYS_MUTATE seeds a defect, as in check-overlays). Exit 1 on any failure.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_OVERLAYS_MUTATE || '[]') } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const { buildLiveModel, applyScan, refreshLiveModel } = await impCore('src/model/live-feed.ts');
const { lineSuffix } = await impCore('src/model/product.ts');
const { emptyScan } = await impCore('src/scan/types.ts');
const { NUMERIC, generalHealth } = await impCore('src/standard/present.ts');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const map: Any = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
const events = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8');
const live = { slug: 'x', decide: async () => { throw new Error('unused'); } };
const NEW = '2999-01-01T00:00:00Z', OLD = '1999-01-01T00:00:00Z';
let nid = 0;
const row = (feature: string, lens: string, metric: string, value: number, at = NEW) => ({ id: ++nid, run_id: 'r1', feature, lens, metric, value, measured_at: at });
const scanOf = (...ms: Any[]) => ({ ...emptyScan(), measurements: ms });
const state = (M: Any) => M.P.features.map((f: Any) => JSON.stringify([f.id, f.health, f.trouble, Object.entries(f.lens).map(([l, x]: Any) => [l, x.h, x.v])]));

const M0 = buildLiveModel(map, events, emptyScan(), live, 1, () => 0);
const feats = M0.P.base.features;

// a (feature, lens, key, value) whose reading changes that lens's health: found by trying numeric fields
const TRIALS = [-1, 0, 1, 10, 50, 90, 100, 1000, 100000];
let hit: Any = null;
search: for (const f of feats) for (const d of M0.P.lenses) for (const fld of d.manifest.fields) {
  if (fld.source || !NUMERIC.has(fld.type) || f.lens[d.id].v[fld.key] === undefined) continue;
  for (const v of TRIALS) {
    if (v === f.lens[d.id].v[fld.key]) continue;
    const was = f.lens[d.id].h, gen = f.health;
    applyScan(M0, scanOf(row(f.id, d.id, fld.key, v)));
    const changed = f.lens[d.id].h !== was, general = f.health !== gen;
    applyScan(M0, emptyScan());
    // (read before the revert below)
    if (changed) { if (general) { hit = { id: f.id, lens: d.id, key: fld.key, v, was }; break search; } }
  }
}
// the fallback would hide a model that never restates General health
expect(!!hit, 'the sample has a numeric field whose reading flips a lens health and the feature General health (the check needs one)');
if (hit) {
  const { id, lens, key, v } = hit;
  for (const scale of [1, 2]) {
    const M = buildLiveModel(map, events, emptyScan(), live, scale, () => 0);
    const sf = (b: number) => id + lineSuffix(scale, b);
    const before = state(M), own = M.P.F[sf(0)], h0 = own.lens[lens].h, val0 = M.sim.liveValue(own, lens, key);
    const touched = applyScan(M, scanOf(row(id, lens, key, v)));
    const after = state(M);
    expect(touched.length === 1 && touched[0] === id, `scale ${scale}: a reading touches only its feature (${touched.join(',')})`);
    for (let b = 0; b < scale; b++) {
      const f = M.P.F[sf(b)];
      expect(f.lens[lens].h !== h0, `scale ${scale}: health of ${f.id}/${lens} changed`);
      expect(M.sim.liveValue(f, lens, key) === v && val0 !== v, `scale ${scale}: liveValue of ${f.id} is the reading`);
      expect(f.lens[lens].v[key] === v, `scale ${scale}: the sheet's lens values and liveValue agree`);
      const hs = M.P.lenses.map((l: Any) => f.lens[l.id].h);
      expect(f.health === generalHealth(hs) && f.trouble.length === hs.filter((x: string) => x === 'bad' || x === 'watch').length, `scale ${scale}: General health and trouble of ${f.id} follow its lenses`);
    }
    const changed = before.map((x: string, i: number) => (x === after[i] ? -1 : i)).filter((i: number) => i >= 0).map((i: number) => M.P.features[i].id.replace(/-[A-Z]$/, ''));
    expect(changed.length > 0 && changed.every((x: string) => x === id), `scale ${scale}: no other feature changed (${[...new Set(changed)].join(',')})`);
    expect(M.agg.healthOf('t', [M.P.F[sf(0)]], lens)[M.P.F[sf(0)].lens[lens].h] === 1, `scale ${scale}: the aggregates read the new health`);
    // the same table again, an older reading, a newer one (appended: a delta)
    const t1 = scanOf(row(id, lens, key, v));
    applyScan(M, t1);
    const older = { ...t1, measurements: [...t1.measurements, row(id, lens, key, hit.v === 0 ? 1 : 0, OLD)] };
    expect(applyScan(M, older).length <= 1 && M.sim.liveValue(M.P.F[sf(0)], lens, key) === v, `scale ${scale}: an older reading changes nothing`);
    const newer = { ...older, measurements: [...older.measurements, row(id, lens, key, 77, '2999-06-01T00:00:00Z')] };
    expect(applyScan(M, newer).length === 1 && M.sim.liveValue(M.P.F[sf(0)], lens, key) === 77, `scale ${scale}: a newer delta row replaces it`);
    applyScan(M, emptyScan());
    expect(state(M).join() === before.join(), `scale ${scale}: an emptied store restores the map's own values`);
  }

  // a reading older than the map's own facet value does not override it
  const M = buildLiveModel(map, events, emptyScan(), live, 1, () => 0), f = M.P.F[hit.id];
  const own = f.lens[hit.lens].v[hit.key];
  applyScan(M, scanOf(row(hit.id, hit.lens, hit.key, hit.v, OLD)));
  expect(f.lens[hit.lens].v[hit.key] === own, 'a reading older than the facet leaves the facet value');

  // a newer map of the same shape: in place
  const M2 = buildLiveModel(map, events, scanOf(row(hit.id, hit.lens, hit.key, hit.v)), live, 1, () => 0);
  const objs = M2.P.features.slice(), L = M2.L, ids = M2.P.features.map((x: Any) => x.id).join();
  const map2: Any = JSON.parse(JSON.stringify(map));
  map2.facets[hit.id][hit.lens].values[hit.key] = hit.v;
  map2.facets[hit.id][hit.lens].measured_at = '2999-02-01T00:00:00Z';
  const r = refreshLiveModel(M2, map2, events, scanOf(row(hit.id, hit.lens, hit.key, hit.v)), null);
  expect(!r.structural, 'a map of the same shape is not structural');
  expect(M2.P.features.every((x: Any, i: number) => x === objs[i]) && M2.L === L && M2.P.features.map((x: Any) => x.id).join() === ids, 'the refresh keeps the Feature objects and the layout');
  expect(M2.P.F[hit.id].lens[hit.lens].v[hit.key] === hit.v, 'the refreshed map carries the value');
  const map3: Any = JSON.parse(JSON.stringify(map));
  map3.features = map3.features.slice(1);
  expect(refreshLiveModel(M2, map3, events, emptyScan(), null).structural, 'a feature removed from the map is structural');
}

if (failures.length) { console.log('check-live-health FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`check-live-health: ${held} expectations held (a reading changes one feature's liveValue and health, older ones and other features do not move, a newer map refreshes in place)`);
