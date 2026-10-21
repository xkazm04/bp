// Pins the canvas render pipeline's units and invariants (apps/web/src/engine/render/*): the screen <-> raster
// geometry of view.ts, the static cache's resolution authority and zoom bucket, the sim patch's culling test,
// the pattern module's documented alphas and the 12 px glyph floor, the glyph sets' coverage of their own type
// unions, the stage and health bars' segment arithmetic, the track and key-plan colour rules, and the flag
// layer's hit test. It also measures the contrast of the text the plan draws over its own fills, in both
// themes, against the repo's declared 4.5:1 bar, and holds two source guards the render files earned.
//
// Why it exists: `python scripts/perf.py` needs a running server, so nothing else in the offline gate can see
// a change to this subsystem. Every expectation here is reachable in-process with no DOM.
//
// Two of the lists checked here are DERIVED FROM THE TYPE UNIONS that declare them
// (packages/core/src/standard/types.ts GlyphName, packages/core/src/scan/track.ts TrackStage), not from the
// renderer's own switch - a `switch` whose cases all `break` is not exhaustiveness-checked by TypeScript, so a
// glyph or track stage added to the union would otherwise draw nothing and pass every other gate.
//
// Run: node scripts/check-render-units.ts  (Node's type stripping; no build step). Exit 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);

const load = <T>(rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href) as Promise<T>;
const R = 'apps/web/src/engine/render/';
const V = await load<typeof import('../apps/web/src/engine/render/view.ts')>(R + 'view.ts');
const SC = await load<typeof import('../apps/web/src/engine/render/static-cache.ts')>(R + 'static-cache.ts');
const SW = await load<typeof import('../apps/web/src/engine/render/simwatch.ts')>(R + 'simwatch.ts');
const PT = await load<typeof import('../apps/web/src/engine/render/patterns.ts')>(R + 'patterns.ts');
const LG = await load<typeof import('../apps/web/src/engine/render/lens-glyph.ts')>(R + 'lens-glyph.ts');
const GL = await load<typeof import('../apps/web/src/engine/render/glyphs.ts')>(R + 'glyphs.ts');
const FL = await load<typeof import('../apps/web/src/engine/render/flags.ts')>(R + 'flags.ts');
const TR = await load<typeof import('../apps/web/src/engine/render/tracks.ts')>(R + 'tracks.ts');
const KP = await load<typeof import('../apps/web/src/engine/render/keyplan.ts')>(R + 'keyplan.ts');

type View = import('../apps/web/src/engine/render/view.ts').View;
type SRect = import('../apps/web/src/engine/render/view.ts').SRect;
type Theme = import('../apps/web/src/engine/theme.ts').Theme;
type GlyphName = import('../packages/core/src/standard/types.ts').GlyphName;
type TrackStage = import('../packages/core/src/scan/track.ts').TrackStage;
type AgentState = import('../packages/core/src/model/sim.ts').AgentState;

let passed = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) passed++; else failures.push(what); };
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

// ---------------------------------------------------------------- a recording 2D context
/** Every canvas call the renderers make, recorded. `ops` counts the ones that put ink on the bitmap. */
interface Rec {
  ops: number; calls: string[]; dash: (number[] | readonly number[])[];
  fills: string[]; strokes: string[]; rects: number[][];
  globalAlpha: number; lineWidth: number; lineCap: string; lineJoin: string;
  fillStyle: string; strokeStyle: string; font: string; textAlign: string; textBaseline: string; letterSpacing: string;
}
function recCtx(): Rec & CanvasRenderingContext2D {
  const r: Partial<Rec> = {
    ops: 0, calls: [], dash: [], fills: [], strokes: [], rects: [],
    globalAlpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: 'left', textBaseline: 'alphabetic', letterSpacing: '0px',
  };
  const note = (name: string, ink: boolean) => (...a: unknown[]) => {
    r.calls!.push(name);
    if (ink) { r.ops!++; if (name.startsWith('fill')) r.fills!.push(String(r.fillStyle)); else r.strokes!.push(String(r.strokeStyle)); }
    if (name === 'fillRect' || name === 'strokeRect' || name === 'rect' || name === 'clearRect') r.rects!.push(a.map(Number));
    return undefined;
  };
  const o = r as Rec & Record<string, unknown>;
  for (const n of ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage']) o[n] = note(n, true);
  for (const n of ['beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'roundRect', 'clearRect', 'save', 'restore', 'clip', 'translate', 'scale', 'rotate', 'setTransform', 'measureText', 'createPattern'] as const) o[n] = note(n, false);
  o.setLineDash = (d: number[]) => { r.calls!.push('setLineDash'); r.dash!.push(d.slice()); };
  o.getLineDash = () => (r.dash!.length ? (r.dash![r.dash!.length - 1] as number[]) : []);
  o.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  o.measureText = (t: string) => ({ width: String(t).length * 7 });
  return o as unknown as Rec & CanvasRenderingContext2D;
}
const fresh = () => recCtx();

// ---------------------------------------------------------------- a theme with the real token values
const CSS = fs.readFileSync(path.join(ROOT, 'apps/web/src/app/globals.css'), 'utf8');
/** A token's value from globals.css: the first block is dark (`:root`), the second light (`[data-theme='light']`). */
function token(name: string, light: boolean): string {
  const re = new RegExp('--' + name + ':\\s*([^;]+);', 'g');
  const hits = [...CSS.matchAll(re)].map((m) => m[1].trim());
  if (!hits.length) throw new Error('globals.css has no --' + name);
  return light ? hits[Math.min(1, hits.length - 1)] : hits[0];
}
const rgba = (c: string): [number, number, number, number] => {
  c = c.trim();
  if (c[0] === '#') {
    const h = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) throw new Error('not a colour: ' + c);
  const p = m[1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2], p[3] ?? 1];
};
/** `src` composited over `dst` at src's own alpha times `a`. */
const over = (src: [number, number, number, number], dst: [number, number, number], a = 1): [number, number, number] => {
  const al = src[3] * a;
  return [dst[0] + (src[0] - dst[0]) * al, dst[1] + (src[1] - dst[1]) * al, dst[2] + (src[2] - dst[2]) * al];
};
const lum = (c: readonly number[]): number => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
/** WCAG contrast ratio between two opaque colours. */
const ratio = (a: readonly number[], b: readonly number[]): number => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
/** The ground a tile's text sits on, at the darkest pixel of a fill of `ink` at `alpha` over the tile base. */
function tileGround(light: boolean, inkAlpha: number): [number, number, number] {
  const paper = rgba(token('paper', light)), base = rgba(token('tile-base', light)), ink = rgba(token('ink', light));
  const b = over(base, [paper[0], paper[1], paper[2]]);
  return inkAlpha > 0 ? over([ink[0], ink[1], ink[2], 1], b, inkAlpha) : b;
}

function theme(light: boolean): Theme {
  const ink = rgba(token('ink', light));
  const t: Partial<Theme> = {
    mode: light ? 'light' : 'dark',
    paper: token('paper', light), ink: token('ink', light), inkHi: token('ink-hi', light),
    halo: token('halo', light), accent: token('accent', light), mint: token('mint', light), amber: token('amber', light),
    amberText: token('amber-2', light), mintText: token('mint-2', light), red: token('red', light), red2: token('red-2', light),
    delta: token('delta', light), glyphEdge: token('glyph-edge', light), labelBg: token('label-bg', light),
    tileBase: token('tile-base', light), poche: token('poche', light), chipBg: token('chip-bg', light), panel: token('panel-solid', light),
    inkRGB: [ink[0], ink[1], ink[2]] as const,
    sans: 'sans-serif', mono: 'monospace',
  };
  t.inkA = (a: number) => `rgba(${ink[0]},${ink[1]},${ink[2]},${a})`;
  t.alpha = (c: string, a: number) => { const p = rgba(c); return `rgba(${p[0]},${p[1]},${p[2]},${(p[3] * a).toFixed(3)})`; };
  t.pattern = () => null;
  return t as Theme;
}

// ---------------------------------------------------------------- view.ts: the screen <-> raster geometry
const view = (o: Partial<View> = {}): View => ({ x: 1200, y: 900, k: 0.7, FW: 1280, FH: 800, c0x: -100, c0y: -80, c1x: 1380, c1y: 880, ...o });
{
  const v = view();
  expect(near(V.sxv(v, v.x), v.FW / 2) && near(V.syv(v, v.y), v.FH / 2), 'view: the camera centre draws at the frame centre');
  expect(near(V.sxv(v, v.x + 100 / v.k) - V.sxv(v, v.x), 100), 'view: sxv scales world distance by k');
  expect(near(V.syv(v, v.y + 100 / v.k) - V.syv(v, v.y), 100), 'view: syv scales world distance by k');
  const out: SRect = { x: 0, y: 0, w: 0, h: 0 };
  const r = V.rs(v, { x: 500, y: 300, w: 800, h: 400 }, out);
  expect(r === out, 'view: rs fills the record it is given (the per-tile path allocates nothing)');
  expect(near(r.w, 800 * v.k) && near(r.h, 400 * v.k), 'view: rs scales the box by k');
  expect(near(r.x, V.sxv(v, 500)) && near(r.y, V.syv(v, 300)), 'view: rs puts the box at its screen origin');
  expect(V.rs(v, { x: 0, y: 0, w: 1, h: 1 }) !== V.rs(v, { x: 0, y: 0, w: 1, h: 1 }), 'view: rs without a record returns a fresh one');

  expect(V.onView(v, { x: 600, y: 400, w: 50, h: 50 }), 'view: onView keeps a rect at the frame centre');
  expect(!V.onView(v, { x: v.c0x - 200, y: 400, w: 50, h: 50 }), 'view: onView culls a rect left of the cull bound');
  expect(V.onView(v, { x: v.c0x - 200, y: 400, w: 50, h: 50 }, 200), 'view: onView honours its margin');
  expect(V.onView(v, { x: v.c1x, y: 400, w: 10, h: 10 }), 'view: onView keeps a rect touching the right cull bound');
  expect(!V.onView(v, { x: 600, y: v.c1y + 1, w: 10, h: 10 }), 'view: onView culls a rect below the bottom cull bound');
  expect(!V.onView(v, { x: 600, y: v.c0y - 11, w: 10, h: 10 }), 'view: onView culls a rect above the top cull bound');

  expect(V.smooth(2, 6, 1) === 0 && V.smooth(2, 6, 2) === 0, 'view: smooth is 0 at and below its start');
  expect(V.smooth(2, 6, 6) === 1 && V.smooth(2, 6, 9) === 1, 'view: smooth is 1 at and above its end');
  expect(near(V.smooth(2, 6, 4), 0.5), 'view: smooth is 0.5 at the midpoint');
  let mono = true;
  for (let i = 1; i <= 20; i++) if (V.smooth(0, 1, i / 20) < V.smooth(0, 1, (i - 1) / 20)) mono = false;
  expect(mono, 'view: smooth rises monotonically');
}

// ---------------------------------------------------------------- static-cache.ts: the resolution authority
{
  expect(SC.BUCKET === 1.5, `static-cache: the zoom bucket is 1.5 (got ${SC.BUCKET})`);
  expect(SC.deviceRes(1280, 800, 1) === 1, 'static-cache: deviceRes passes a dpr that fits the budget through');
  expect(SC.deviceRes(400, 300, 3) === 2, 'static-cache: deviceRes caps dpr at 2');
  expect(SC.deviceRes(1280, 800, 0) === 1, 'static-cache: deviceRes reads a missing dpr as 1');
  const big = SC.deviceRes(2560, 1600, 2);
  expect(big < 2 && near(2560 * 1600 * big * big, 6.5e6, 1e-6), `static-cache: deviceRes spends exactly the 6.5 Mpx screen budget (got ${big})`);
  let down = true, prev = SC.deviceRes(600, 400, 2);
  for (const w of [800, 1200, 1600, 2000, 2600, 3400]) { const r = SC.deviceRes(w, (w * 2) / 3, 2); if (r > prev + 1e-12) down = false; prev = r; }
  expect(down, 'static-cache: deviceRes never rises as the viewport grows');
  expect(SC.deviceRes(1, 1, 2) === 2, 'static-cache: a tiny viewport still gets the capped dpr');
}

// ---------------------------------------------------------------- simwatch.ts: the partial re-raster's culling
{
  const { patch, patchMiss } = SW;
  expect(patch.on === false && patch.n === 0, 'simwatch: no patch is armed at rest');
  expect(patchMiss(0, 0, 10, 10, 0) === false, 'simwatch: nothing is culled while no patch runs');
  const w = new SW.SimWatch();
  const rects = [{ x: 100, y: 100, w: 40, h: 20 }, { x: 300, y: 260, w: 30, h: 30 }];
  (w as unknown as { rects: SRect[]; n: number }).rects = rects;
  (w as unknown as { rects: SRect[]; n: number }).n = 2;
  w.arm();
  expect(patch.on && patch.n === 2, 'simwatch: arm publishes the rects to the plan');
  expect(patch.x0 === 100 && patch.y0 === 100 && patch.x1 === 330 && patch.y1 === 290, 'simwatch: arm computes the bounding box of its rects');
  expect(patchMiss(1000, 1000, 10, 10, 0) === true, 'simwatch: a rect outside the patch box is culled');
  expect(patchMiss(105, 105, 5, 5, 0) === false, 'simwatch: a rect inside a clip rect is kept');
  expect(patchMiss(200, 180, 5, 5, 0) === true, 'simwatch: a rect inside the box but between the clip rects is culled');
  expect(patchMiss(200, 180, 5, 5, 80) === false, 'simwatch: the margin grows the rect into a clip rect');
  w.disarm();
  expect(patch.on === false && patch.n === 0, 'simwatch: disarm takes the patch down');
  expect(new SW.SimWatch().collect({ M: { sim: { roll: {}, prog: {}, AGF: {} } } } as never) === 0, 'simwatch: a watch with no items collects no rects');
}

// ---------------------------------------------------------------- patterns.ts: the documented alphas and the 12 px floor
{
  expect(PT.FILL_A === 0.26, `patterns: the lens fill's ink is 0.26 alpha, as docs/blueprint-ui.md states (got ${PT.FILL_A})`);
  const th = theme(false), c = fresh();
  PT.lineFill(c, th, 'solid', 0, 0, 0.4, 20, 1, 1);
  expect(c.ops === 0, 'patterns: lineFill draws nothing in a rect under half a pixel wide');
  const c2 = fresh();
  PT.lineFill(c2, th, 'solid', 0, 0, 40, 20, 1, 0.004);
  expect(c2.ops === 0, 'patterns: lineFill draws nothing at a vanishing alpha');
  const c3 = fresh();
  PT.unknownFill(c3, th, 0, 0, 40, 20, 1, 0.004);
  expect(c3.ops === 0, 'patterns: unknownFill draws nothing at a vanishing alpha');
  const c4 = fresh();
  PT.unknownFill(c4, th, 0, 0, 6, 6, 1, 1);
  expect(c4.ops === 0, 'patterns: a body too small for a 12 px glyph gets no "?" at all');
  const c5 = fresh();
  PT.unknownFill(c5, th, 0, 0, 14, 16, 1, 1);
  expect(c5.calls.includes('fillText') && c5.textAlign === 'left' && c5.textBaseline === 'alphabetic',
    'patterns: a body too small for one texture cell gets a single centred "?" and restores the text state');
  const c6 = fresh();
  PT.unknownFill(c6, th, 0, 0, 14, 16, 1, 1);
  expect(/[0-9]+px/.test(c6.font) && parseFloat(c6.font.replace(/^.*?([0-9.]+)px.*$/, '$1')) >= 12,
    `patterns: the lone "?" never goes under the 12 px floor (font ${c6.font})`);
  expect(c6.globalAlpha === 1, 'patterns: unknownFill restores the caller\'s alpha');
}

// ---------------------------------------------------------------- lens-glyph.ts: every name in the union draws
/** The GlyphName union's members, read from the type that declares them - not from the renderer's own switch. */
function unionMembers(rel: string, name: string): string[] {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const m = new RegExp("export type " + name + "\\s*=\\s*([^;]+);").exec(src);
  if (!m) throw new Error(rel + ' declares no ' + name);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
{
  const names = unionMembers('packages/core/src/standard/types.ts', 'GlyphName') as GlyphName[];
  expect(names.length >= 7, `lens-glyph: the GlyphName union was read from its type (${names.length} names)`);
  for (const n of names) {
    const c = fresh();
    LG.glyph(c, n, 10, 20, 16, '#fff');
    expect(c.ops > 0, `lens-glyph: the shared glyph "${n}" puts ink on the canvas (a case added to the union but not to the switch draws nothing)`);
    expect(c.lineCap === 'butt', `lens-glyph: glyph "${n}" puts lineCap back to butt before it returns (the round cap it sets would leak into whatever the caller draws next)`);
  }
  const c = fresh();
  LG.glyph(c, null, 10, 20, 16, '#fff');
  expect(c.calls.includes('arc') && c.ops > 0, 'lens-glyph: a missing glyph falls back to a ring');
  const c2 = fresh();
  LG.glyph(c2, { path: 'M'.repeat(2049) }, 10, 20, 16, '#fff');
  expect(c2.calls.includes('arc'), 'lens-glyph: a custom path over 2048 characters falls back to the ring');
  const c3 = fresh();
  LG.glyph(c3, 'check', 0, 0, 8, '#fff');
  expect(near(c3.lineWidth, 1.1), `lens-glyph: a glyph under 9 px takes the 1.1 px hairline (got ${c3.lineWidth})`);
  const c4 = fresh();
  LG.glyph(c4, 'check', 0, 0, 40, '#fff', 1.8);
  expect(near(c4.lineWidth, 1.8), `lens-glyph: lwMax caps the stroke (got ${c4.lineWidth})`);
  const c5 = fresh();
  LG.glyph(c5, 'check', 0, 0, 12, '#fff', 8);
  expect(near(c5.lineWidth, 12 * 0.13), `lens-glyph: between the floor and the cap the stroke is 13% of the square (got ${c5.lineWidth})`);
}

// ---------------------------------------------------------------- glyphs.ts: bars, strokes and survey marks
{
  const th = theme(false);
  const sum = (c: Rec) => c.rects.filter((r) => r.length === 4).reduce((a, r) => a + r[2], 0);
  const c = fresh();
  GL.drawStageBar(c, th, 10, 20, 200, 8, { live: 3, flagged: 2, build: 1, paper: 4, none: 0, dep: 2 });
  expect(near(sum(c) - 199, 200, 1e-9), `glyphs: the stage bar's segments plus its frame span its width (got ${sum(c) - 199})`);
  const c2 = fresh();
  GL.drawStageBar(c2, th, 10, 20, 200, 8, { live: 0, flagged: 0, build: 0, paper: 0, none: 0, dep: 0 });
  expect(c2.calls.includes('strokeRect'), 'glyphs: an all-zero stage bar still draws its frame');
  const c3 = fresh();
  GL.drawHealthBar(c3, th, 10, 20, 200, 8, { good: 5, watch: 2, bad: 1, na: 2 });
  expect(near(sum(c3) - 199, 200, 1e-9), `glyphs: the health bar's segments plus its frame span its width (got ${sum(c3) - 199})`);
  const c4 = fresh();
  GL.stageFill(c4, th, null, 0, 0, 100, 40, 50, 50, true);
  expect(c4.ops === 0, 'glyphs: a feature not yet drawn gets no stage fill');
  for (const st of ['live', 'flagged', 'in-review', 'in-dev', 'deprecated'] as const) {
    const cc = fresh();
    GL.stageFill(cc, th, st, 0, 0, 100, 40, 50, 50, true);
    expect(cc.ops > 0 || st === 'in-review', `glyphs: the "${st}" stage paints a fill`);
  }
  const c5 = fresh();
  GL.stageStroke(c5, th, 'specified', 1, 1.5);
  expect(c5.dash.length === 1 && c5.dash[0].length === 2, 'glyphs: a specified stage is dashed');
  const c6 = fresh();
  GL.stageStroke(c6, th, 'live', 1, 1.5);
  expect(c6.dash.length === 1 && c6.dash[0].length === 0, 'glyphs: a real stage is solid');
  const c7 = fresh();
  GL.stageStroke(c7, th, null, 1, 1.5);
  expect(c7.globalAlpha < 1, 'glyphs: a feature not yet drawn strokes faint');
  const states: AgentState[] = ['working', 'waiting', 'blocked', 'failed', 'paused'];
  for (const st of states) {
    const cc = fresh();
    GL.glyphAgent(cc, th, 50, 50, st, 4, 1, 0, 1);
    expect(cc.ops > 0, `glyphs: the "${st}" agent has a survey mark`);
    expect(cc.globalAlpha === 1, `glyphs: the "${st}" agent mark restores the caller's alpha`);
  }
  expect(new Set(states.map((s) => GL.agentColor(th, s))).size >= 4, 'glyphs: agentColor tells the agent states apart');
  const c8 = fresh();
  GL.glyphPin(c8, th, 50, 50, 'high', true, 0.9, 3, 0, 1, '600 12px sans-serif');
  expect(c8.calls.includes('fillText') && c8.textAlign === 'left', 'glyphs: a pin with a count draws its bubble and restores textAlign');
  const c9 = fresh();
  GL.glyphPin(c9, th, 50, 50, 'low', false, 0.9, 0, 0.5, 1, '600 12px sans-serif');
  expect(c9.calls.includes('arc') && c9.lineCap === 'butt', 'glyphs: a ringing pin draws its ring and leaves lineCap at butt');
}

// ---------------------------------------------------------------- tracks.ts: every stage in the union is drawn
{
  expect(TR.TRACK_LABEL_W === 90, `tracks: the label's tile-width floor is 90 px (got ${TR.TRACK_LABEL_W})`);
  const r: SRect = { x: 100, y: 200, w: 300, h: 120 };
  const p = TR.trackMarkPos(r, 2);
  expect(p.x === r.x + 20 && p.y === r.y + r.h - 20, 'tracks: the glyph stands 10 px (times UI scale) in from the tile\'s bottom-left');
  expect(TR.trackMarkPos(r, 1) === p, 'tracks: trackMarkPos hands back one shared record (a frame allocates nothing)');
  const th = theme(false);
  const stages = unionMembers('packages/core/src/scan/track.ts', 'TrackStage') as TrackStage[];
  expect(stages.length >= 12, `tracks: the TrackStage union was read from its type (${stages.length} stages)`);
  const shapes = new Map<string, string>();
  for (const st of stages) {
    const c = fresh();
    TR.trackGlyph(c, th, st, 50, 50, 1);
    expect(c.ops > 0, `tracks: the "${st}" stage draws a glyph`);
    shapes.set(st, c.calls.join(',') + '|' + c.strokes.join(',') + '|' + c.fills.join(','));
  }
  // 'declined' and 'descoped' share the renderer's default ring on purpose; every other stage is distinct
  const dflt = [...shapes.entries()].filter(([, s]) => s === shapes.get('declined')).map(([k]) => k);
  expect(dflt.sort().join(',') === 'declined,descoped',
    `tracks: only declined and descoped share the generic ring - a stage added to the union would fall into it unnoticed (got ${dflt.sort().join(',')})`);
  expect(new Set(shapes.values()).size === stages.length - 1, `tracks: every other track stage draws a distinct mark (${new Set(shapes.values()).size} of ${stages.length - 1})`);
}

// ---------------------------------------------------------------- keyplan.ts: the swarm dot's colour rule
{
  const th = theme(false);
  expect(KP.keyDotColor(th, { status: 'working', paused: true }) === th.inkA(0.55), 'keyplan: a paused agent is neutral ink, whatever its status says');
  expect(KP.keyDotColor(th, { status: 'working', paused: false }) === th.mint, 'keyplan: a working agent is mint');
  expect(KP.keyDotColor(th, { status: 'waiting', paused: false }) === th.amber, 'keyplan: a waiting agent is amber');
  expect(KP.keyDotColor(th, { status: 'blocked', paused: false }) === th.red, 'keyplan: a blocked agent is red');
  expect(KP.keyDotColor(th, { status: 'failed', paused: false }) === th.red, 'keyplan: a failed agent is red');
}

// ---------------------------------------------------------------- flags.ts: the layer's switch and its hit test
{
  expect(FL.flagsOn() === true, 'flags: the layer is on when there is no page to ask');
  const F = { x: 100, y: 50, w: 40, h: 36, tipX: 120, tipY: 90, bad: true, lens: 'perf', fid: 'f1', fids: ['f1'], lenses: ['perf'], a: 1 };
  expect(FL.flagKey(F) === 'f1|perf', 'flags: a flag is known across frames by its feature and lens');
  const E = { U: 1 } as never;
  expect(FL.flagAt(E, [F], 120, 70) === F, 'flags: a point in the flag body hits it');
  expect(FL.flagAt(E, [F], 120, 92) === F, 'flags: the pointer area down to the tip hits the flag');
  expect(FL.flagAt(E, [F], 120, 96) === null, 'flags: a point below the tip misses');
  expect(FL.flagAt(E, [F], 98, 70) === F, 'flags: the hit test allows 3 px of slack');
  expect(FL.flagAt(E, [F], 96, 70) === null, 'flags: a point outside the slack misses');
  const G = { ...F, fid: 'f2' };
  expect(FL.flagAt(E, [F, G], 120, 70) === F, 'flags: the topmost flag of the frame wins the hit');
}

// ---------------------------------------------------------------- contrast: the text the plan draws over its own fills
// docs/blueprint-ui.md declares a 4.5:1 bar for text (the status colours' note, and "nothing the user must read
// is under 12 px"). These are the grounds the plan puts text on, at the DARKEST pixel of each fill.
{
  const BAR = 4.5;
  for (const light of [false, true]) {
    const name = light ? 'light' : 'dark';
    const th = theme(light);
    const inkHi = rgba(th.inkHi), halo = rgba(th.halo);
    // the in-dev stage hatch (glyphs.ts stageFill) is ink at 0.6; the in-review cross hatch is ink at 0.55
    for (const [what, a] of [['in-dev hatch', 0.6], ['in-review cross hatch', 0.55], ['live fill', 0.22], ['lens fill', PT.FILL_A]] as const) {
      const ground = tileGround(light, a);
      const bare = ratio([inkHi[0], inkHi[1], inkHi[2]], ground);
      const haloed = ratio([inkHi[0], inkHi[1], inkHi[2]], over(halo, ground));
      expect(haloed >= BAR, `contrast (${name}): the tile name haloed over the ${what} is ${haloed.toFixed(2)}:1, the bar is ${BAR}:1`);
      if (what === 'lens fill' || what === 'live fill') {
        expect(bare >= BAR, `contrast (${name}): the tile name over the ${what} is ${bare.toFixed(2)}:1 without a halo, the bar is ${BAR}:1`);
      }
    }
  }
}

// ---------------------------------------------------------------- report
if (failures.length) {
  for (const f of failures) console.log('FAIL  ' + f);
  console.log(`\n${passed} held, ${failures.length} failed`);
  process.exit(1);
}
console.log(`check-render-units: ${passed} render invariants hold`);
