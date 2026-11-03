// check:trouble-index - a feature that turns bad AFTER load is flagged and counted (apps/web/src/engine/trouble.ts).
//
// The defect it pins: live readings re-judge health in place (live-health.ts restate: the same Feature objects get a
// new `trouble`; applyScan bumps sim.healthV), but the flag layer cached its troubled features by the identity of
// P.features ("the list never changes after load") and the Overview's "Trouble by lens" counts were memoized on M.P.
// Neither identity moves on a scan, so a feature that went bad after load had no flag and no count until a reload.
//
// How: the Kettle map as a live product (buildLiveModel, the way check-live-health builds it), an Engine mounted on the
// Node stand-in browser (scripts/lib/engine-dom.ts), then a real scan (applyScan + engine.feed, what BlueprintApp does)
// with one reading that turns a healthy feature X bad under one lens. After a frame:
//   - the frame's flags (layoutFlags, read from the engine's last frame) include X under that lens;
//   - the count the Overview prints for that lens (engine.trouble.counts()) rose by exactly 1;
//   - the store slice the Overview selects (troubleV) moved, so React re-renders the counts.
// Run: node scripts/check-trouble-index.ts   Exit 1 when any expectation fails.
// Control: BP_ENGINE_MUTATE='[["Engine.ts","find","replace"]]' rewrites source as it loads (see check-engine-harness).
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

const dom = installEngineDom();
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const { buildLiveModel, applyScan, liveSwarm } = await impCore('src/model/live-feed.ts');
const { emptyScan } = await impCore('src/scan/types.ts');
const { NUMERIC } = await impCore('src/standard/present.ts');
const { Engine } = await imp('engine/Engine.ts');
const { getVariant } = await imp('variants/registry.ts');

const map: Any = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
const events = fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8');
const live = { slug: 'x', decide: async () => { throw new Error('unused'); } };
let nid = 0;
const scanOf = (feature: string, lens: string, metric: string, value: number) =>
  ({ ...emptyScan(), measurements: [{ id: ++nid, run_id: 'r1', feature, lens, metric, value, measured_at: '2999-01-01T00:00:00Z' }] });

// X: a feature with no trouble at all, and a reading that makes one of its lenses bad (found by trying values on a scratch model)
const TRIALS = [-1, 0, 1, 10, 50, 90, 100, 1000, 100000];
let hit: { id: string; lens: string; key: string; v: number } | null = null;
{
  const M0 = buildLiveModel(map, events, emptyScan(), live, 1, () => 0);
  search: for (const f of M0.P.features) {
    if (f.trouble.length) continue;
    for (const d of M0.P.lenses) for (const fld of d.manifest.fields) {
      if (fld.source || !NUMERIC.has(fld.type) || f.lens[d.id]?.v[fld.key] === undefined) continue;
      for (const v of TRIALS) {
        applyScan(M0, scanOf(f.id, d.id, fld.key, v));
        const bad = f.lens[d.id].h === 'bad' && f.trouble.length === 1 && f.trouble[0].lens === d.id;
        applyScan(M0, emptyScan());
        if (bad) { hit = { id: f.id, lens: d.id, key: fld.key, v }; break search; }
      }
    }
  }
}
expect(!!hit, 'the Kettle map has a healthy feature that one reading turns bad (the check needs one)');

if (hit) {
  const M = buildLiveModel(map, events, emptyScan(), live, 1, () => dom.now());
  const E = new Engine({ canvas: dom.canvas, ui: dom.ui, root: dom.root, model: M, expression: getVariant('subtle').expression, intro: false });
  if (M.sim.playing) E.togglePlay();
  dom.settle();
  const X = M.P.F[hit.id];
  const flagged = () => ((E as Any).flags as Any[]).some((F) => F.fids.includes(X.id) && F.lenses.includes(hit!.lens));
  const anyFlags = () => ((E as Any).flags as Any[]).length;
  const count = (): number | undefined => (E as Any).trouble?.counts?.()[hit!.lens]?.bad ?? ((E as Any).trouble ? 0 : undefined);
  expect(anyFlags() > 0, 'the home frame draws flags at all (' + anyFlags() + '), so a missing flag below means something');
  expect(X.trouble.length === 0 && !flagged(), 'before the scan ' + X.id + ' is healthy and carries no flag');
  const c0 = count(), v0 = (E.S as Any).troubleV;
  expect(typeof c0 === 'number', 'the engine owns a trouble index whose per-lens counts the Overview prints (engine.trouble.counts())');
  const P0 = M.P;

  // the scan, the way BlueprintApp feeds one: readings over the facets, then the swarm
  applyScan(M, scanOf(hit.id, hit.lens, hit.key, hit.v));
  E.feed(liveSwarm(M.P, { ...emptyScan(), measurements: [] }));
  dom.settle();
  expect(X.trouble.some((t: Any) => t.lens === hit!.lens && t.h === 'bad'), 'the scan turned ' + X.id + ' bad under ' + hit.lens + ' (in place)');
  expect(M.P === P0, 'the scan left M.P (the old Overview memo key) the same object, which is why a memo on it went stale');
  expect(flagged(), 'after the scan layoutFlags includes ' + X.id + ' under ' + hit.lens);
  const c1 = count();
  expect(typeof c0 === 'number' && c1 === c0 + 1, 'the Overview count of ' + hit.lens + ' bad rose by exactly 1 (' + c0 + ' -> ' + c1 + ')');
  expect(v0 !== undefined && (E.S as Any).troubleV !== v0, 'the store slice the Overview selects (troubleV) moved, so its counts re-render (' + v0 + ' -> ' + (E.S as Any).troubleV + ')');

  // and back: the reading withdrawn, the flag and the count go with it
  applyScan(M, emptyScan());
  E.feed(liveSwarm(M.P, { ...emptyScan(), measurements: [] }));
  dom.settle();
  expect(!flagged() && count() === c0, 'the reading withdrawn, ' + X.id + ' loses its flag and the count returns to ' + c0);
  E.destroy();
}

for (const f of failures) console.log('FAIL  ' + f);
console.log((failures.length ? 'FAILED' : 'ok') + ' - trouble index: ' + held + ' expectations held' + (failures.length ? ', ' + failures.length + ' failed' : '') + (hit ? ' (X = ' + hit.id + ' under ' + hit.lens + ')' : ''));
process.exit(failures.length ? 1 : 0);
