// check:channel-seam - the lens channel seam (apps/web/src/engine/lens/contract.ts) passes what the shaped and bold
// variants need, so neither keeps a workaround:
//   - MarkArgs.d is the lens's dominance on the tile (E.mixS.topD for the top lens, 0 for every other one). Shaped's edge
//     marks (rollout gauge, ticket bites, spines, comb, crops, cut walls) read it. They used to read a module-level stash
//     that shape() filled, and the engine caches outlines: a sim patch reuses the cached path, skips shape(), and the
//     edge marks dropped off every patched tile.
//   - decor(ctx, a: DecorArgs) gets the camera origin and the plan (buildings, wall paths, text kit, sim). Bold's decor used
//     to read the running engine from window.__bp: nothing drew without it, and with two engines it drew the last one's.
// Cases run on a recording 2d context: one against the shaped operations channel alone, the rest against real Engines
// built over the sample model on the Node stand-in browser (scripts/lib/engine-dom.ts).
// Run: node scripts/check-channel-seam.ts   Exit 1 when any expectation fails.
// Control: BP_SEAM_MUTATE='[["file suffix","find","replace"]]' rewrites source as it loads, so a case can be seen red.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { installEngineDom } from './lib/engine-dom.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_SEAM_MUTATE || '[]') } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

/** A 2d context that draws nothing and records every call with its arguments. */
function recorder() {
  const log: { k: string; a: unknown[] }[] = [];
  const grad = () => ({ addColorStop() {} });
  const ctx: Any = new Proxy({ globalAlpha: 1 } as Any, {
    get(t: Any, k: string) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s: string) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return grad;
      if (k === 'createPattern') return () => ({ setTransform() {} });
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return (...a: unknown[]) => { log.push({ k, a }); };
    },
    set(t: Any, k: string, v: unknown) { t[k] = v; return true; },
  });
  return { ctx, log, count: (k: string) => log.filter((c) => c.k === k).length };
}

const dom = installEngineDom();
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const { buildModel } = await impCore('src/model/sample.ts');
const { Engine } = await imp('engine/Engine.ts');
const { drawDecor, resetOutlines } = await imp('engine/render/plan.ts');
const { loadVariant } = await imp('variants/registry.ts');
const { CHANNELS: SHAPED } = await imp('variants/shaped/channels.ts');
const { LENS_NAME } = await imp('variants/bold/palette.ts');
const { bl } = await imp('variants/base/legacy.ts');
const shaped = await loadVariant('shaped'), bold = await loadVariant('bold');

const sample = () => buildModel(1, () => dom.now(), null);
const mount = (M: Any, V: Any): Any => {
  const E = new Engine({ canvas: dom.canvas, ui: dom.ui, root: dom.root, model: M, expression: V.expression, intro: false });
  if (M.sim.playing) E.togglePlay();
  dom.settle();
  return E;
};
/** The raster view of the engine's camera (what static-cache hands paintPlan), with no pan margin. */
const viewOf = (E: Any, c = E.cam): Any => ({ x: c.x, y: c.y, k: c.k, FW: E.FW, FH: E.FH, c0x: 0, c0y: 0, c1x: E.FW, c1y: E.FH });

// ------------------------------------------------------------------------------------------------ 1. shaped, alone
// The operations channel, a production feature behind a flag at 40 %, dominance 1, and NO shape() call before marks.
{
  const r = recorder();
  const th: Any = { red: 'RED', amber: 'AMBER', inkA: (a: number) => 'ink' + a, labelBg: 'BG', alpha: (c: string, a: number) => c + '@' + a };
  const tile: Any = { form: 'tile', u: 1, k: 1, x: 0, y: 0, w: 160, h: 120, strip: { x: 6, y: 3, w: 148, h: 6 }, body: { x: 3, y: 3, w: 154, h: 114 }, text: true };
  const f: Any = { id: 'seam-f', lens: { operations: { v: { environment: 'production', flagKey: 'seam.flag', rolloutPct: 40, alerting: true }, h: 'good' } } };
  const live: Any = { rolloutPct: 40, progressPct: 0, value: () => undefined };
  // pillGeom at d = 1: X = 0.5, W = 159, r = min(59.5, 39.75, 22) = 22 -> the gauge runs 22..137, len 115, filled 46
  const len = 115;
  let threw = '';
  try { SHAPED.operations.marks({ ctx: r.ctx, r: { x: 7, y: -8, w: 80, h: 18 }, slot: null, lens: { id: 'operations' }, tile, f, w: 1, x: 1, compact: false, th, stage: 'flagged', now: true, live, accent: 'ACC', d: 1 }); }
  catch (e) { threw = (e as Error).message; }
  const gauge = r.log.filter((c) => c.k === 'fillRect' && Math.abs((c.a[2] as number) - len * 0.4) < 1e-6);
  expect(!threw && gauge.length === 1, `case 1: shaped operations marks with a.d = 1 and no prior shape() paints the rollout gauge (a fillRect ${len * 0.4} wide); got ${gauge.length}${threw ? ', threw ' + threw : ''}`);
}

// ------------------------------------------------------------------------------- 2-3. shaped on a real engine: d, patch
{
  const E = mount(sample(), shaped);
  const ops = E.M.L.tiles.find((T: Any) => { const o = bl(T.f).operations; return o.environment === 'production' && o.flag && T.w > 0; });
  expect(!!ops, 'setup: the sample model has a production feature behind a flag');
  // wrap every channel so the marks calls (their lens, the d they get, the ctx calls they make) and shape calls are seen
  const seen: { l: string; f: string; d: unknown; top: unknown; topD: number; n: number }[] = [];
  let shapes = 0, rec: ReturnType<typeof recorder> | null = null;
  const orig = E.channel.bind(E), wrapped = new Map<string, Any>();
  E.channel = (l: string) => {
    const ch = orig(l); if (!ch) return ch;
    let w = wrapped.get(l);
    if (!w) {
      w = { ...ch, marks(a: Any) { const n0 = rec ? rec.log.length : 0; ch.marks(a); seen.push({ l, f: a.f.id, d: a.d, top: E.mixS.top, topD: E.mixS.topD, n: (rec ? rec.log.length : 0) - n0 }); } };
      if (ch.shape) w.shape = (...xs: Any[]) => { shapes++; return ch.shape(...xs); };
      wrapped.set(l, w);
    }
    return w;
  };
  const paint = (full: boolean, v: Any) => {
    rec = recorder(); seen.length = 0; shapes = 0;
    if (full) { E.watch.begin(); resetOutlines(E); }
    E.paintPlan(rec.ctx, v);
    return { marks: seen.filter((s) => s.l === 'operations' && s.f === ops?.f.id).map((s) => ({ ...s })), all: seen.map((s) => ({ ...s })), shapes };
  };
  if (ops) {
    // frame the feature as a fixture about 220 px wide: tiles, not ribbons
    const k = 220 / ops.w, v = { x: ops.x + ops.w / 2, y: ops.y + ops.h / 2, k, FW: E.FW, FH: E.FH, c0x: 0, c0y: 0, c1x: E.FW, c1y: E.FH };
    E.setView('operations', true); dom.settle();
    const raster = paint(true, v), patch = paint(false, v);
    const D = E.mixS.topD;
    expect(E.mixS.top === 'operations' && D > 0.99, `setup: the operations view settles with operations on top (top ${E.mixS.top}, d ${D})`);
    expect(raster.marks.length === 1 && patch.marks.length === 1, `setup: the flagged feature's operations marks run once per paint (raster ${raster.marks.length}, patch ${patch.marks.length})`);
    expect(raster.shapes > 0 && patch.shapes === 0, `setup: the patch reuses the cached outlines, so shape() is not called (raster ${raster.shapes}, patch ${patch.shapes})`);
    const pm = patch.marks[0], rm = raster.marks[0];
    expect(!!pm && pm.d === D, `case 2: the patch paint's marks get a.d === E.mixS.topD (${pm?.d} vs ${D})`);
    expect(!!pm && !!rm && rm.n > 0 && pm.n === rm.n, `case 2: the edge gauge is drawn in both paints: the same ctx call count for the tile's operations marks (raster ${rm?.n}, patch ${pm?.n})`);
    // case 3, mid-tween: operations on top with a partial dominance, the other lenses still present on the tile
    E.setView('general', true); dom.settle();
    E.setView('operations');
    for (let i = 0; i < 120 && !(E.mixS.top === 'operations' && E.mixS.topD > 0.2); i++) dom.flush(8);
    const mid = paint(true, v).all, Dm = E.mixS.topD;
    const topOk = mid.filter((s) => s.l === E.mixS.top).every((s) => s.d === Dm), others = mid.filter((s) => s.l !== E.mixS.top);
    expect(E.mixS.top === 'operations' && Dm > 0.001 && Dm < 0.999 && others.length > 0, `setup: mid-tween operations leads with a partial dominance and other lenses still draw (d ${Dm}, others ${others.length})`);
    expect(mid.length > 0 && topOk && others.every((s) => s.d === 0), `case 3: lensMarks sets a.d = topD for the top lens and 0 for every other lens (bad: ${mid.filter((s) => (s.l === E.mixS.top ? s.d !== Dm : s.d !== 0)).slice(0, 3).map((s) => s.l + '=' + s.d).join(', ')})`);
    E.setView('general', true); dom.settle();
    const gen = paint(true, v).all;
    expect(gen.length > 0 && gen.every((s) => s.d === 0), `case 3: in General every lens gets a.d = 0 (${gen.length} calls, bad: ${gen.filter((s) => s.d !== 0).slice(0, 3).map((s) => s.l + '=' + s.d).join(', ')})`);
  }
  E.destroy?.();
}

// ------------------------------------------------------------------------------------------------------ 4. grep cases
{
  const shapesSrc = fs.readFileSync(path.join(SRC, 'variants/shaped/shapes.ts'), 'utf8');
  const chSrc = fs.readFileSync(path.join(SRC, 'variants/shaped/channels.ts'), 'utf8');
  expect(!/\btakeD\b/.test(shapesSrc) && !/\bstash\b/.test(shapesSrc) && !/^(?:const|let|var)\s+\w+\s*=\s*\{/m.test(shapesSrc), 'case 4: shaped/shapes.ts exports no takeD and holds no module-level stash');
  expect(/\ba\.d\b/.test(chSrc) && !/\btakeD\b/.test(chSrc), 'case 4: shaped/channels.ts reads a.d (and no takeD)');
}

// ------------------------------------------------------------------------------------------ 5-6. bold decor, no __bp
{
  const win = globalThis.window as Any;
  /** Paint the decor of engine E's lens `l` through plan.ts's drawDecor; returns the recorder. */
  const decorOf = (E: Any, l: string) => {
    E.setView(l, true); dom.settle();
    const r = recorder(); drawDecor(E, r.ctx, viewOf(E)); return r;
  };
  // frame one building at a zoom where its title block fits (the paper under a shorter wing), on engine A
  const A = mount(sample(), bold);
  const lens = 'business', no = LENS_NAME[lens].no;
  /** Building rects of an engine, in the screen px of view v. */
  const rects = (E: Any, v: Any) => E.M.L.blds.map((B: Any) => ({ x: v.FW / 2 + (B.x - v.x) * v.k, y: v.FH / 2 + (B.y - v.y) * v.k, w: B.w * v.k, h: B.h * v.k }));
  const inside = (p: { x: number; y: number }, rs: Any[]) => rs.some((q: Any) => p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h);
  delete win.__bp;
  const r5 = decorOf(A, lens);
  const draws = r5.count('stroke') + r5.count('fillText');
  expect(win.__bp === undefined && draws > 0, `case 5: with window.__bp undefined, bold decor still draws the field and title block (${r5.count('stroke')} strokes, ${r5.count('fillText')} fillText)`);
  // case 6: engine B (a different model, the sample at scale 3: different buildings) is constructed after A, so window.__bp points at B
  const titlesOf = (E: Any, v: Any) => { const r = recorder(); drawDecor(E, r.ctx, v); return r.log.filter((c) => c.k === 'fillText' && c.a[0] === no).map((c) => ({ x: c.a[1] as number, y: c.a[2] as number })); };
  const key = (ps: { x: number; y: number }[]) => ps.map((p) => p.x.toFixed(2) + ',' + p.y.toFixed(2)).sort().join(' ');
  A.setView(lens, true); dom.settle();
  const vA = viewOf(A);
  win.__bp = A; const refA = titlesOf(A, vA);
  const B = mount(buildModel(3, () => dom.now(), null), bold);
  B.setView(lens, true); dom.settle();
  win.__bp = B; const refB = titlesOf(B, viewOf(B));
  const titles = titlesOf(A, vA);
  const aR = rects(A, vA);
  expect(refA.length > 0 && key(refA) !== key(refB), `setup: A and B draw title blocks in different places (${refA.length} vs ${refB.length})`);
  expect(titles.length > 0 && titles.every((p) => inside(p, aR)), `case 6: with window.__bp at engine B, every title block A's decor draws lies in A's buildings (${titles.length} title blocks, ${titles.filter((p) => !inside(p, aR)).length} outside)`);
  expect(key(titles) === key(refA), `case 6: with window.__bp at engine B, A's decor draws A's title blocks, none at B's (got ${key(titles)}; A ${key(refA)}; B ${key(refB)})`);
  A.destroy?.(); B.destroy?.();
}

// ------------------------------------------------------------------------------------------------------ 7. grep + guard
{
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const hits = walk(path.join(SRC, 'variants')).filter((p) => fs.readFileSync(p, 'utf8').includes('__bp'));
  expect(hits.length === 0, 'case 7: no variant source (.ts/.tsx under apps/web/src/variants) reads __bp: ' + hits.map((p) => path.relative(ROOT, p)).join(', '));
}

if (failures.length) { console.error('check:channel-seam FAILED\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log(`check:channel-seam: ${held} expectations held`);
