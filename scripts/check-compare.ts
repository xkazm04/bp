// check:compare - compare two dates on the drawing (S2: packages/core/src/model/compare.ts, Engine.setCompare, the
// plan's compare marks and counts, the page's "Changed between" lines).
//
// 1. Core, on a 3-feature fixture between A = 2026-10-05 and B = 2026-10-25 (data now 2026-10-31):
//    f1 goes beta -> live on 10-15 and its latency reads 120 (10-01) then 180 (10-20); f2 is first measured on 10-12;
//    f3 has a reading (50 on 10-01) and stays beta. Exactly f1 and f2 are marked; f1's stage change and numeric move
//    are reported with both readings' dates; f2's reading is a first observation with no baseline (never a zero).
//    A reading after B (10-28) and a pack's after-phase reading (10-22) never count.
// 2. Engine, on the Kettle map as a live product on the Node stand-in browser: pinning A and travelling B leaves every
//    world rect (tiles, rooms, wings) and the camera exactly as they were; the comparison is non-empty; the hash
//    carries cmp=A and a new engine reading that hash restores the same baseline, date and changed count; Esc unpins.
// Run: node scripts/check-compare.ts   Exit 1 when any expectation fails.
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

// ---------------------------------------------------------------- 1. core
const { compareDates, compareLines } = await impCore('src/model/compare.ts');
{
  const NOW = '2026-10-31', A = '2026-10-05', B = '2026-10-25';
  const lat = { key: 'latency', label: 'Latency', type: 'number', unit: 'ms', metric: { method: 'static', better: 'down' } };
  const lens = { id: 'perf', name: 'Performance', headline: lat, manifest: { fields: [lat], health: { default: 'good', rules: [] } } };
  const feat = (id: string, revs: Any[], stage: string) => ({ id, stage, revs, lens: {} });
  const f1 = feat('f1', [{ stage: 'beta', date: '2026-09-01' }, { stage: 'live', date: '2026-10-15' }], 'live');
  const f2 = feat('f2', [{ stage: 'beta', date: '2026-09-01' }], 'beta');
  const f3 = feat('f3', [{ stage: 'beta', date: '2026-09-01' }], 'beta');
  let n = 0;
  const r = (feature: string, at: string, value: number, x: Any = {}) => ({ id: ++n, run_id: 'r', feature, lens: 'perf', metric: 'latency', value, measured_at: at + 'T10:00:00Z', ...x });
  const scan = { measurements: [
    r('f1', '2026-10-01', 120), r('f1', '2026-10-20', 180), r('f1', '2026-10-28', 999), r('f1', '2026-10-22', 5, { phase: 'after', proposal_id: 'p' }),
    r('f2', '2026-10-12', 42), r('f3', '2026-10-01', 50),
  ] };
  const c = compareDates([f1, f2, f3], [lens], scan, A, B, NOW);
  expect(JSON.stringify(c.ids) === '["f1","f2"]', 'exactly two features are marked: f1 and f2 (got ' + JSON.stringify(c.ids) + ')');
  const e1 = c.byId.get('f1'), e2 = c.byId.get('f2');
  expect(e1?.stage?.a === 'beta' && e1.stage.b === 'live', 'f1: the stage change beta -> live is reported');
  expect(e1?.moves.length === 1 && e1.moves[0].a.value === 120 && e1.moves[0].b.value === 180 && e1.moves[0].a.measured === '2026-10-01' && e1.moves[0].b.measured === '2026-10-20',
    'f1: the numeric move 120 (read 10-01) -> 180 (read 10-20); the 10-28 reading (after B) and the after-phase 5 never count (got ' + JSON.stringify(e1?.moves) + ')');
  expect(e2?.firsts.length === 1 && e2.moves.length === 0 && e2.firsts[0].b.value === 42 && !('a' in e2.firsts[0]), 'f2: a first observation (42 read 10-12), no move and no baseline value');
  expect(c.counts.stage === 1 && c.counts.moves === 1 && c.counts.firsts === 1, 'counts: 1 stage change, 1 move, 1 first observation');
  const words = (e: Any) => compareLines(e, () => 'Performance', (s: string) => s[0].toUpperCase() + s.slice(1), A, B, NOW).map((l: Any) => l.text);
  const w1 = words(e1), w2 = words(e2);
  expect(w1[0] === 'Stage: Beta on 2026-10-05 → Live on 2026-10-25', 'f1 words: the stage on each date (got ' + w1[0] + ')');
  expect(w1[1] === 'Performance · Latency: 120 ms (read 2026-10-01) → 180 ms (read 2026-10-20)', 'f1 words: both values with their reading dates (got ' + w1[1] + ')');
  expect(w2[0] === 'Performance · Latency: first observation 42 ms (read 2026-10-12); nothing was recorded by 2026-10-05', 'f2 words: labelled a first observation (got ' + w2[0] + ')');
  const atNow = compareDates([f1, f2, f3], [lens], scan, A, NOW, NOW).byId.get('f1');
  expect(atNow?.moves[0]?.b.value === 999, 'with B at now every current reading counts (the 10-28 reading, not the after-phase one)');
  expect(compareDates([f1, f2, f3], [lens], undefined, A, B, NOW).ids.join() === 'f1', 'with no scan only stages compare (Kettle): f1 alone');
}

// ---------------------------------------------------------------- 2. engine
const dom = installEngineDom();
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const { buildLiveModel } = await impCore('src/model/live-feed.ts');
const { emptyScan } = await impCore('src/scan/types.ts');
const { Engine } = await imp('engine/Engine.ts');
const { getVariant } = await imp('variants/registry.ts');
const map: Any = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
const events = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8');
const mk = () => {
  const M = buildLiveModel(map, events, emptyScan(), { slug: 'x', decide: async () => { throw new Error('unused'); } }, 1, () => dom.now());
  const E = new Engine({ canvas: dom.canvas, ui: dom.ui, root: dom.root, model: M, expression: getVariant('subtle').expression, intro: false });
  if (M.sim.playing) E.togglePlay();
  dom.settle();
  return E;
};
const E = mk(), L = E.M.L, W: string[] = E.M.P.weeks;
const rects = () => JSON.stringify([L.tiles, L.rooms, L.wings].map((xs: Any[]) => xs.map((o) => [o.id, o.x, o.y, o.w, o.h])));
const cam = () => [E.cam.x, E.cam.y, E.cam.k].join(',');
const r0 = rects(), c0 = cam();
const A = W[Math.max(0, W.length - 12)], B = W[W.length - 2];
E.setCompare(A); dom.settle(); E.setTime(B); dom.settle();
expect(E.S.cmpA === A && E.S.t === B && !!E.cmp && E.cmp.ids.length > 0 && E.S.cmpN === E.cmp.ids.length, 'pinned A = ' + A + ', travelled B = ' + B + ': ' + (E.cmp?.ids.length ?? 0) + ' features changed, the store agrees (' + E.S.cmpN + ')');
expect(rects() === r0 && cam() === c0, 'every world rect and the camera are unchanged by pinning A and moving B');
E.setTime(W[W.length - 3]); E.setCompare(W[W.length - 5]); dom.settle();
expect(rects() === r0 && cam() === c0, 'moving both endpoints again: rects and camera still unchanged');
E.setCompare(A); E.setTime(B); dom.settle(); dom.advance(2000); dom.settle();
const hash = dom.win.location.hash as string, n0 = E.S.cmpN;
expect(hash.includes('cmp=' + A) && hash.includes('t=' + B), 'the hash carries the baseline and the date (' + hash + ')');
E.destroy();
const E2 = mk();
expect(E2.S.cmpA === A && E2.S.t === B && E2.S.cmpN === n0, 'a new engine on that hash restores A, B and the same changed count (' + E2.S.cmpA + ', ' + E2.S.t + ', ' + E2.S.cmpN + ')');
dom.key('a');
expect(E2.S.cmpA === null && !E2.cmp, 'A unpins');
dom.key('a');
expect(E2.S.cmpA === B, 'A pins the travelled date as the baseline');
dom.key('Escape');
expect(E2.S.cmpA === null, 'Esc unpins the comparison');
E2.destroy();

if (failures.length) { console.error('check:compare FAILED (' + failures.length + '):\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('check:compare: ' + held + ' expectations held');
process.exit(0);
