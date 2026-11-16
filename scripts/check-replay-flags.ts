// check:replay-flags - on a travelled date the plan draws the lens health replayed by today's rules (C3 engine half:
// apps/web/src/engine/replay.ts, render/flags.ts, render/plan.ts).
//
// The Kettle map as a live product (buildLiveModel), an Engine on the Node stand-in browser (scripts/lib/engine-dom.ts).
// One lens is made metric-only (its rules read one numeric field: "gt 100 -> bad"); a scan carries two dated readings
// for a feature X: 120 the day before a past week T, 60 between T and now.
//   - with no scan handed to the engine, a past date draws no flag at all (what the plan did before: nothing recorded);
//   - with the scan, at T the frame's flags include X under that lens (replayed bad), and the store says how many pairs
//     were replayed; a week after the 60 reading X carries no flag;
//   - back at now, the flags are exactly those of the trouble index (the now path is unchanged), and handing the scan
//     over changed nothing at now;
//   - the static raster's content key moves when the replay does (the marks re-raster), and the camera never moves.
// BP_REPLAY_STORE=<dir with app-structure.json, events.jsonl, scan.db> also prints how many flags that store would draw
// on BP_REPLAY_T (default 2026-10-30): read only, informational, not an expectation.
// Run: node scripts/check-replay-flags.ts   Exit 1 when any expectation fails.
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

// ---------------------------------------------------------------- informational: a real store, before the stand-in browser
const store = process.env.BP_REPLAY_STORE;
if (store) {
  const { snapshotOf } = await impCore('src/server/store.server.ts');
  const { buildLiveModel } = await impCore('src/model/live-feed.ts');
  const { replayTable } = await impCore('src/model/timeview.ts');
  const t = process.env.BP_REPLAY_T || '2026-10-30';
  const scan = snapshotOf(path.join(store, 'scan.db'));
  const ev = fs.existsSync(path.join(store, 'events.jsonl')) ? fs.readFileSync(path.join(store, 'events.jsonl'), 'utf8') : '';
  const M = buildLiveModel(JSON.parse(fs.readFileSync(path.join(store, 'app-structure.json'), 'utf8')), ev, scan, { slug: 'x', decide: async () => { throw new Error('unused'); } }, 1, () => 0);
  const tab = replayTable(M.P.features, M.P.lenses, scan, t, M.P.asOf);
  let pairs = 0, flags = 0, feats = 0;
  for (const [, row] of tab ?? []) { pairs += row.size; let any = false; for (const [, h] of row) if (h === 'bad' || h === 'watch') { flags++; any = true; } if (any) feats++; }
  console.log('store ' + store + ' on ' + t + ' (asOf ' + M.P.asOf + ', ' + scan.measurements.length + ' readings): ' + (tab ? pairs + ' replayed pairs, ' + flags + ' flags over ' + feats + ' features' : 'at or after now: the live model'));
}

const dom = installEngineDom();
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const { buildLiveModel } = await impCore('src/model/live-feed.ts');
const { emptyScan } = await impCore('src/scan/types.ts');
const { NUMERIC } = await impCore('src/standard/present.ts');
const { stageAt } = await impCore('src/model/aggregates.ts');
const { Engine } = await imp('engine/Engine.ts');
const { getVariant } = await imp('variants/registry.ts');

const map: Any = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
const events = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8');
const M = buildLiveModel(map, events, emptyScan(), { slug: 'x', decide: async () => { throw new Error('unused'); } }, 1, () => dom.now());
const E = new Engine({ canvas: dom.canvas, ui: dom.ui, root: dom.root, model: M, expression: getVariant('subtle').expression, intro: false });
if (M.sim.playing) E.togglePlay();
dom.settle();

const W: string[] = M.P.weeks, asOf: string = M.P.asOf;
const T = W[Math.max(0, W.length - 4)], LATER = W[W.length - 2];
const day = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// a lens with a numeric (unbound) field, made metric-only; X: a feature drawn on T with no trouble now under it
let lens: Any = null, key = '', X: Any = null;
for (const d of M.P.lenses) {
  const fld = d.manifest?.fields?.find((x: Any) => !x.source && NUMERIC.has(x.type)); if (!fld) continue;
  X = M.P.features.find((f: Any) => stageAt(f, T, asOf) && !f.trouble.some((t: Any) => t.lens === d.id));
  if (X) { lens = d; key = fld.key; break; }
}
expect(!!lens && !!X && T < LATER && LATER < asOf, 'the Kettle map has a lens with a numeric field and a feature drawn on ' + T + ' (and two past weeks to read)');

if (lens && X) {
  lens.manifest = { ...lens.manifest, health: { default: 'good', rules: [{ when: { field: key, gt: 100 }, health: 'bad', reason: key + ' {' + key + '} is over 100' }] } };
  const m = (id: number, value: number, at: string) => ({ id, run_id: 'r' + id, feature: X.id, lens: lens.id, metric: key, value, measured_at: at + 'T09:00:00Z' });
  const scan = { ...emptyScan(), measurements: [m(1, 120, day(T, -1)), m(2, 60, day(T, 2)), { ...m(3, 500, day(T, -10)), proposal_id: 'p', phase: 'after' }] };
  const flags = (): Any[] => (E as Any).flags;
  const has = () => flags().some((F) => F.fids.includes(X.id) && F.lenses.includes(lens.id));
  const sig = () => JSON.stringify(flags().map((F) => [F.fids.slice().sort(), F.lenses.slice().sort()]).sort());
  const cam = () => [E.cam.x, E.cam.y, E.cam.k].join(',');
  const go = (t: string) => { E.setTime(t); dom.settle(); };

  const nowFlags = sig(), nowN = flags().length, cam0 = cam();
  expect(nowN > 0, 'the home frame at now draws flags (' + nowN + ')');
  const fromIndex = new Set<string>(); for (const f of E.trouble.all()) fromIndex.add(f.id);
  expect(flags().every((F) => F.fids.every((id: string) => fromIndex.has(id))), 'at now every flag stands on a feature of the trouble index');

  // no scan: a past date draws nothing (today's behaviour), and says nothing was replayed
  go(T);
  expect(E.S.t === T && flags().length === 0 && E.S.replayed === 0, 'no scan, at ' + T + ': no flag at all (got ' + flags().length + ') and replayed 0 (got ' + E.S.replayed + ')');
  const k0 = (E as Any).staticKey();

  // the scan: replayed bad at T
  E.setScan(scan); dom.settle();
  expect(has(), 'with the scan, at ' + T + ': ' + X.id + ' is flagged under ' + lens.id + ' (120 read on ' + day(T, -1) + ', gt 100 -> bad)');
  expect(E.S.replayed >= 1, 'the store counts the replayed pairs (got ' + E.S.replayed + ')');
  expect(E.replay.row(X.id)?.lens.get(lens.id) === 'bad' && E.replay.row(X.id)?.health === 'bad', 'the replayed row: ' + lens.id + ' bad, General bad');
  expect((E as Any).staticKey() !== k0, 'the static raster key moved with the replay (the trouble marks re-raster)');
  expect(flags().every((F) => F.fids.every((id: string) => E.replay.row(id)?.trouble.length)), 'on a past date every flag stands on a replayed bad / watch pair');

  // after the 60 reading: replayed good, no flag
  go(LATER);
  expect(!has() && E.replay.row(X.id)?.lens.get(lens.id) === 'good', 'at ' + LATER + ' (60 read on ' + day(T, 2) + '): replayed good, no flag on ' + X.id);
  // the after-phase 500 never counts: before the 120 reading there is nothing to replay for X
  go(W[Math.max(0, W.indexOf(T) - 1)]);
  expect(!E.replay.row(X.id), 'a week before ' + T + ' only the after-phase reading (500) exists: not replayed, no row');

  // back at now: unchanged
  go(asOf);
  expect(E.S.replayed === 0 && sig() === nowFlags, 'back at now: replayed 0 and exactly the flags drawn before the scan (' + flags().length + ' vs ' + nowN + ')');
  expect(cam() === cam0, 'the camera never moved (' + cam() + ')');

  // the engine reads its scan from setScan only; BlueprintApp hands the live scan over where it applies it
  const app = fs.readFileSync(path.join(SRC, 'components/BlueprintApp.tsx'), 'utf8');
  expect(/applyScan\(engine\.M, live\.scan\);\s*\n\s*engine\.setScan\(live\.scan\)/.test(app), 'BlueprintApp hands each live scan to engine.setScan beside applyScan');
}

if (failures.length) { console.error('check:replay-flags FAILED (' + failures.length + '):\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('check:replay-flags: ' + held + ' expectations held');
process.exit(0);
