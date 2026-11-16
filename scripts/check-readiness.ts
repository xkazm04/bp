// check:readiness - readiness for whatever is selected (L1: packages/core/src/model/ready.ts, Engine.readyScope /
// readinessNow, the readiness callout).
//
// 1. Core, 5 features under one lens with maxAge 30 d (now 2026-10-31):
//    a clean with a fresh reading; b clean with a 45-day-old reading (and a fresh after-phase reading, which never counts);
//    c one step covered by a proposal that clears it; d two steps where one proposal falls short; e blocked (a rule on
//    the feature-bound stage alone) -> "1 of 5 clear · 1 unproven · 3 steps, 1 covered, 1 short · 1 blocked".
// 2. A cross-lens conflict: clearing one lens's latency step makes another lens (that wants latency high) read watch;
//    the conflict is said in words. Two lenses asking one field for incompatible bounds is said too.
// 3. Engine, on the Kettle map as a live product with its milestones removed (bp's own adopted map has none), on the Node
//    stand-in browser: G at a room opens the mode on that room (scope, dimming, readiness computed, hash ready=room:<id>);
//    G again closes it; at home on the Kettle sample (buildModel) G still reads the payments-ga milestone.
// Run: node scripts/check-readiness.ts   Exit 1 when any expectation fails.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { installEngineDom } from './lib/engine-dom.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_ENGINE_MUTATE || '[]') } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);

const { readiness, readinessLine } = await impCore('src/model/ready.ts');
const { evaluateLens } = await impCore('src/standard/health.ts');
const NOW = '2026-10-31';
const lat = { key: 'latency', label: 'Latency', type: 'number', unit: 'ms', metric: { method: 'probe', better: 'down' } };
const err = { key: 'errors', label: 'Errors', type: 'integer', metric: { method: 'probe', better: 'down' } };
const stg = { key: 'stage', label: 'Stage', type: 'enum', values: ['beta', 'live'], source: { feature: 'stage' } };
const perf = { id: 'perf', name: 'Performance', headline: lat, manifest: { fields: [lat, err, stg], health: { default: 'good', rules: [
  { when: { field: 'stage', eq: 'beta' }, health: 'bad', reason: 'Still in beta' },
  { when: { field: 'latency', gt: 300 }, health: 'bad', reason: 'Latency {latency} ms' },
  { when: { field: 'errors', gt: 5 }, health: 'watch', reason: '{errors} errors' },
] } } };
const feature = (id: string, lenses: Any[], v: Record<string, Any>, stage = 'live', extra: Record<string, Record<string, Any>> = {}) => {
  const lens: Any = {};
  for (const d of lenses) {
    const vals = { ...v, ...(extra[d.id] ?? {}) }, e = evaluateLens(d.manifest, { values: vals }, NOW, { feature: { stage } });
    lens[d.id] = { h: e.health, v: e.values, why: null, short: null, whyFields: [], ov: null, facet: { values: vals } };
  }
  return { id, stage, lens, revs: [] };
};
let mid = 0;
const r = (f: string, lens: string, metric: string, value: number, at: string, x: Any = {}) => ({ id: ++mid, run_id: 'r', feature: f, lens, metric, value, measured_at: at + 'T08:00:00Z', ...x });
const prop = (id: string, f: string, delta: number) => ({ id, run_id: 'r', feature: f, lens: 'perf', metric: 'latency', title: id, standard: 's', kind: 'fix', status: 'proposed', expected_delta: delta, created_at: NOW, updated_at: NOW });

// ---------------------------------------------------------------- 1. five features
{
  const F: Any = {
    a: feature('a', [perf], { latency: 100, errors: 0 }),
    b: feature('b', [perf], { latency: 100, errors: 0 }),
    c: feature('c', [perf], { latency: 400, errors: 0 }),
    d: feature('d', [perf], { latency: 400, errors: 9 }),
    e: feature('e', [perf], { latency: 100, errors: 0 }, 'beta'),
  };
  const scan = { measurements: [
    r('a', 'perf', 'latency', 100, '2026-10-26'),
    r('b', 'perf', 'latency', 100, '2026-09-16'), r('b', 'perf', 'latency', 90, '2026-10-30', { phase: 'after', proposal_id: 'pb' }),
    r('c', 'perf', 'latency', 400, '2026-10-29'), r('d', 'perf', 'latency', 400, '2026-10-29'), r('e', 'perf', 'latency', 100, '2026-10-29'),
  ], proposals: [prop('pc', 'c', -150), prop('pd', 'd', -50)] };
  const R = readiness({ lenses: [perf], F }, scan, ['a', 'b', 'c', 'd', 'e'], { maxAgeDays: 30, now: NOW });
  const line = readinessLine(R);
  console.log('  fixture: ' + line);
  expect(line === '1 of 5 clear · 1 unproven · 3 steps, 1 covered, 1 short · 1 blocked', 'the 5-feature summary (got "' + line + '")');
  const kinds = R.features.map((f: Any) => f.id + ':' + f.kind).join(' ');
  expect(kinds === 'a:clear b:unproven c:steps d:steps e:blocked', 'per feature: a clear, b unproven, c and d steps, e blocked (got ' + kinds + ')');
  const b = R.features.find((f: Any) => f.id === 'b').lenses[0];
  expect(b.kind === 'unproven' && b.newest === '2026-09-16' && b.ageDays === 45, "b's newest current reading is the 45-day-old one; the fresh after-phase reading never counts (got " + JSON.stringify(b) + ')');
  const onlyAfter = readiness({ lenses: [perf], F }, { measurements: [r('a', 'perf', 'latency', 100, '2026-10-30', { phase: 'after', proposal_id: 'x' }), r('a', 'perf', 'latency', 100, '2026-08-01')], proposals: [] }, ['a'], { maxAgeDays: 30, now: NOW });
  expect(onlyAfter.clear === 0 && onlyAfter.unproven === 1, 'an after-phase reading alone never makes a feature clear (an old current one stays unproven)');
  const e = R.features.find((f: Any) => f.id === 'e').lenses[0];
  expect(e.kind === 'blocked' && /Stage alone/.test(e.why), 'e is blocked with clearPath\'s reason (got ' + JSON.stringify(e.why) + ')');
  console.log('  long:    ' + readinessLine(R, true));
}

// ---------------------------------------------------------------- 2. cross-lens conflicts
{
  const cost = { id: 'cost', name: 'Cost', headline: lat, manifest: { fields: [lat], health: { default: 'good', rules: [{ when: { field: 'latency', lt: 350 }, health: 'watch', reason: 'Overprovisioned at {latency} ms' }] } } };
  const F: Any = { x: feature('x', [perf, cost], { latency: 400, errors: 0 }) };
  const R = readiness({ lenses: [perf, cost], F }, { measurements: [], proposals: [] }, ['x'], { maxAgeDays: 30, now: NOW });
  const c = R.features[0].conflicts;
  console.log('  conflict: ' + JSON.stringify(c));
  expect(c.some((s: string) => s === 'Clearing Performance makes Cost watch') && R.conflicts === 1, 'clearing Performance (latency at most 300) makes Cost watch: reported in words');
  const slow = { id: 'slow', name: 'Slow', headline: lat, manifest: { fields: [lat], health: { default: 'good', rules: [{ when: { field: 'latency', lt: 500 }, health: 'bad', reason: 'Too fast' }] } } };
  const G: Any = { y: feature('y', [perf, slow], { latency: 400, errors: 0 }) };
  const c2 = readiness({ lenses: [perf, slow], F: G }, { measurements: [], proposals: [] }, ['y'], { maxAgeDays: 30, now: NOW }).features[0].conflicts;
  console.log('  conflict: ' + JSON.stringify(c2));
  expect(c2.some((s: string) => /^latency: Performance and Slow ask for at least 500 and at most 300: both cannot hold$/.test(s)), 'two lenses asking latency for incompatible bounds: said in words');
}

// ---------------------------------------------------------------- 3. the engine
const dom = installEngineDom();
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const { buildLiveModel } = await impCore('src/model/live-feed.ts');
const { buildModel } = await impCore('src/model/sample.ts');
const { emptyScan } = await impCore('src/scan/types.ts');
const { Engine } = await imp('engine/Engine.ts');
const { getVariant } = await imp('variants/registry.ts');
{
  const map: Any = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
  delete map.milestones; for (const f of map.features ?? []) delete f.milestone;
  const events = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8').split('\n').filter((l) => !l.includes('"milestone"')).join('\n');
  const M = buildLiveModel(map, events, emptyScan(), { slug: 'x', decide: async () => { throw new Error('unused'); } }, 1, () => dom.now());
  const E = new Engine({ canvas: dom.canvas, ui: dom.ui, root: dom.root, model: M, expression: getVariant('subtle').expression, intro: false });
  if (M.sim.playing) E.togglePlay();
  dom.settle();
  // camera flights run on motion's own clock: land them on the fake one (as check-place-words does)
  { const cam = E.cam, land = cam.flyTo.bind(cam); let t = 0; cam.flyTo = (to: Any) => { clearTimeout(t); cam.stopFly(); cam.flying = true; t = setTimeout(() => { cam.flying = false; land(to, 0); }, 300) as unknown as number; }; }
  expect(M.P.milestones.length === 0 && M.P.features.every((f: Any) => !f.milestone), 'the live map has no milestones');
  E.walk(1); dom.settle(); dom.advance(1000); dom.settle();
  const room = (E as Any).place.find((c: Any) => c.t === 'room')?.o;
  expect(!!room, 'the camera is in a room after a walk (' + room?.name + ')');
  dom.key('g'); dom.settle(); dom.advance(1000); dom.settle();
  const sc = E.S.scope, R = E.readinessNow();
  expect(E.S.ga === true && sc?.kind === 'room' && sc.id === room?.id && sc.ids.length === room?.feats.length, 'G over a room opens the mode on that room (got ' + JSON.stringify(sc && { kind: sc.kind, id: sc.id, n: sc.ids.length }) + ')');
  expect(!!R && R.n === room?.feats.length, 'its readiness is computed for every feature of the room (' + (R ? readinessLine(R, true) : 'none') + ')');
  const outside = M.P.features.find((f: Any) => !sc?.ids.includes(f.id));
  expect(!!E.dimFn && E.dimFn(M.P.F[sc!.ids[0]]) === true && !!outside && E.dimFn(outside) === false, 'the plan dims everything outside the scope');
  dom.advance(2000);
  expect((dom.win.location.hash as string).includes('ready=room:' + encodeURIComponent(room?.id)), 'the hash carries the scope (' + dom.win.location.hash + ')');
  expect(R === E.readinessNow(), 'readiness is cached between reads (computed on discrete changes only)');
  dom.key('g'); dom.settle();
  expect(E.S.ga === false && E.S.scope === null && E.dimFn === null, 'G again closes the mode');
  E.destroy();
}
{
  dom.win.location.hash = '';
  const M = buildModel(1, () => dom.now());
  const E = new Engine({ canvas: dom.canvas, ui: dom.ui, root: dom.root, model: M, expression: getVariant('subtle').expression, intro: false });
  if (M.sim.playing) E.togglePlay();
  dom.settle();
  dom.key('g'); dom.settle();
  const sc = E.S.scope, R = E.readinessNow();
  expect(E.S.ga && sc?.kind === 'ms' && sc.id === 'payments-ga' && sc.ids.length === M.P.features.filter((f: Any) => f.milestone === 'payments-ga').length, 'Kettle at home: G reads the payments-ga milestone as before (got ' + JSON.stringify(sc && { kind: sc.kind, id: sc.id }) + ')');
  console.log('  kettle payments-ga: ' + (R ? readinessLine(R, true) : 'none'));
  E.destroy();
}

if (failures.length) { console.error('check:readiness FAILED (' + failures.length + '):\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('check:readiness: ' + held + ' expectations held');
process.exit(0);
