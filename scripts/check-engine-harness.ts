// check:engine-harness - the first gate that EXECUTES apps/web/src/engine/Engine.ts (the UI's largest file).
// The three older gates that name it (check-live-steer, check-live-tracks, timeline/check-keys) read it as text.
//
// How: scripts/overlays-loader.mjs already transpiles src/** and resolves '@/'; what Node lacks is a browser. This file
// installs the smallest one an Engine can be constructed against - a canvas whose 2d context RECORDS calls and draws
// nothing, a document / window pair of EventTargets (so keydown and popstate are really dispatched through bind()),
// matchMedia, a fake clock (timers, performance.now, requestAnimationFrame), location and history - and builds one Engine
// over the real sample model (packages/core sample, the swarm included).
//
// It pins what needs no pixels: the store's notify path, computeHome, the hit boxes (measured by scanning the pointer
// over a grid, not by copying the arithmetic), goUp's Esc ladder, onKey's refusals and map, and the hash writer / reader.
// It does NOT pin toast()'s signature or any colour; the canvas stub records calls rather than pretending to draw.
//
// Control: BP_ENGINE_MUTATE='[["Engine.ts","find","replace"]]' rewrites source text as it loads ([file suffix, find,
// replace] literals), so each assertion can be seen red on a seeded defect without touching the tree.
// Run: node scripts/check-engine-harness.ts   Exit 1 when any expectation fails.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_ENGINE_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

// ---------------------------------------------------------------------------------------------- the browser stand-in
let clock = 1000;                                   // the fake clock, ms
let timerId = 0;
const timers = new Map<number, { at: number; fn: () => void }>();
let rafQ: ((t: number) => void)[] = [];
let rafCount = 0;
const setT = (fn: () => void, ms = 0) => { const id = ++timerId; timers.set(id, { at: clock + ms, fn }); return id; };
const clearT = (id: number) => { timers.delete(id); };
/** Move the clock by `ms`, firing due timers in order. */
function advance(ms: number) {
  const end = clock + ms;
  for (;;) {
    let nx: [number, { at: number; fn: () => void }] | null = null;
    for (const e of timers) if (e[1].at <= end && (!nx || e[1].at < nx[1].at)) nx = e;
    if (!nx) break;
    timers.delete(nx[0]); clock = Math.max(clock, nx[1].at); nx[1].fn();
  }
  clock = end;
}

const calls: string[] = [];                        // every method the 2d context was asked to run
const grad = () => ({ addColorStop() {} });
const ctx2d: Any = new Proxy({}, {
  get(t: Any, k: string) {
    if (k in t) return t[k];
    if (k === 'measureText') return (s: string) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return grad;
    if (k === 'createPattern') return () => ({ setTransform() {} });
    if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    return (...a: unknown[]) => { calls.push(k); void a; };
  },
  set(t: Any, k: string, v: unknown) { t[k] = v; return true; },
});
class El {
  tagName: string; width = 300; height = 150; style: Any; dataset: Any = {}; children: El[] = [];
  private L = new Map<string, Set<(e: Any) => void>>();
  isContentEditable = false; parent: El | null = null; matchSel: string[] = [];
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    const props = new Map<string, string>();
    this.style = new Proxy({ setProperty: (n: string, v: string) => props.set(n, v), getPropertyValue: (n: string) => props.get(n) ?? '' }, { get: (t: Any, k: string) => t[k], set: (t: Any, k: string, v: unknown) => { t[k] = v; return true; } });
  }
  getContext() { return ctx2d; }
  addEventListener(ev: string, fn: (e: Any) => void) { if (!this.L.has(ev)) this.L.set(ev, new Set()); this.L.get(ev)!.add(fn); }
  removeEventListener(ev: string, fn: (e: Any) => void) { this.L.get(ev)?.delete(fn); }
  dispatch(ev: string, e: Any) { for (const f of [...(this.L.get(ev) ?? [])]) f(e); }
  getBoundingClientRect() { return { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight }; }
  setPointerCapture() {}
  /** A key target: matches a selector if its `matchSel` list contains it (the harness lists which controls it stands for). */
  closest(sel: string) { for (let n: El | null = this; n; n = n.parent) if (n.matchSel.some((s) => sel.includes(s))) return n; return null; }
  focus() {}
}
const root = new El('div'), ui = new El('div'), canvas = new El('canvas');
const docEl = new El('html');
const loc: Any = { pathname: '/', search: '', hash: '' };
const hist: { kind: 'push' | 'replace'; url: string }[] = [];
const history = {
  state: null,
  pushState(_s: unknown, _t: string, url: string) { hist.push({ kind: 'push', url }); loc.hash = url.slice(url.indexOf('#') >= 0 ? url.indexOf('#') : url.length); },
  replaceState(_s: unknown, _t: string, url: string) { hist.push({ kind: 'replace', url }); loc.hash = url.slice(url.indexOf('#') >= 0 ? url.indexOf('#') : url.length); },
};
let coarse = false;
const mq = (q: string) => ({ matches: q.includes('pointer: coarse') ? coarse : false, addEventListener() {}, removeEventListener() {} });
// the globals.css tokens an Engine reads; the harness only needs them to be present, never right
const TOKENS: Record<string, string> = { '--paper': '#071a33', '--ink': '#dff0ff', '--mint': '#6ff2c8', '--amber': '#ffc35a', '--red': '#ff6a58' };
const doc: Any = Object.assign(new El('document'), {
  createElement: (t: string) => new El(t), documentElement: docEl, fonts: { ready: new Promise(() => {}) },
});
const win: Any = Object.assign(new El('window'), { location: loc, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, setTimeout: setT, clearTimeout: clearT, setInterval: (fn: () => void) => setT(fn, 1e9), clearInterval: clearT });
const g = globalThis as Any;
const def = (k: string, v: unknown) => Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
def('window', win); def('document', doc); def('location', loc); def('history', history); def('matchMedia', mq);
def('setTimeout', setT); def('clearTimeout', clearT); def('setInterval', (fn: () => void) => setT(fn, 1e9)); def('clearInterval', clearT);
def('requestAnimationFrame', (fn: (t: number) => void) => { rafQ.push(fn); rafCount++; return rafQ.length; });
def('cancelAnimationFrame', () => { rafQ = []; });
def('getComputedStyle', () => ({ getPropertyValue: (n: string) => TOKENS[n] ?? '' }));
def('MutationObserver', class { observe() {} disconnect() {} });
def('Image', class { onload: (() => void) | null = null; set src(_v: string) {} });
def('performance', { now: () => clock });
def('DOMMatrix', class { m: number[]; constructor(m: number[] = []) { this.m = m; } });
// Path2D: every builder method is a no-op that returns nothing (the paths are only handed to the recording context)
def('Path2D', class { constructor() { return new Proxy(this, { get: (t: Any, k: string) => (k in t ? t[k] : () => {}) }); } });

// ---------------------------------------------------------------------------------------------- the engine under test
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const { buildModel } = await impCore('src/model/sample.ts');
const { Engine } = await imp('engine/Engine.ts');
const DYN = await imp('engine/render/dynamic.ts');
const { getVariant } = await imp('variants/registry.ts');
const expression = getVariant('subtle').expression;

function mount(w = 1280, h = 800): Any {
  win.innerWidth = w; win.innerHeight = h; loc.hash = ''; hist.length = 0; rafQ = [];
  const M = buildModel(1, () => clock, null);
  return new Engine({ canvas, ui, root, model: M, expression, intro: false });
}
/** Run the frames the engine asked for (each callback clears its own pending flag, as a real frame does). */
function flush(ms = 20) { advance(ms); const q = rafQ; rafQ = []; for (const f of q) f(clock); }
let E: Any = mount();
const M = E.M;
/** A keydown through the real document listener bind() registered. */
function key(k: string, o: { target?: El; ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) {
  let prevented = false;
  doc.dispatch('keydown', { key: k, target: o.target ?? doc, ctrlKey: !!o.ctrl, metaKey: !!o.meta, altKey: !!o.alt, defaultPrevented: false, preventDefault() { prevented = true; } });
  return prevented;
}
const reset = (patch: Record<string, unknown> = {}) => { E.store.set({ morning: false, dec: null, open: null, dtab: null, tl: false, menu: null, whoMenu: false, info: false, page: 'plan', track: null, prev: null, lprev: null, key: null, blast: null, ga: false, selMode: false, phone: false, ...patch }); };

// ---------------------------------------------------------------------------------------------- 1. construction and the store's notify
expect(E.S.ready === true, 'a constructed Engine reports ready in its store');
expect(E.cam.world === M.L.world, 'the camera is handed the model\'s world box');
expect(win.__bp === E, 'the engine registers itself on window.__bp (the debug handle the browser tests use)');
{
  // a playing swarm keeps the frame loop asking for the next frame; pause it so a pending frame means 'dirty', nothing else
  if (M.sim.playing) E.togglePlay();
  flush(); flush(); flush();
  expect(rafQ.length === 0, 'a paused, settled engine asks for no further frames (the loop sleeps)');
  let n = 0; const off = E.store.subscribe(() => { n++; });
  rafCount = 0;
  E.patch({ delta: 14 });
  expect(n === 1, 'patch() with a changed value notifies a store subscriber exactly once (got ' + n + ')');
  expect(E.S.delta === 14, 'patch() lands in the store');
  expect(rafCount === 1, 'patch() asks for exactly one frame (got ' + rafCount + ')');
  n = 0;
  E.patch({ delta: 14 });
  expect(n === 0, 'patch() with an unchanged value notifies nobody');
  expect(rafCount === 1, 'a second patch while a frame is pending does not queue another (frames asked: ' + rafCount + ')');
  off(); n = 0; E.patch({ delta: 7 });
  expect(n === 0, 'an unsubscribed listener hears nothing');
}
{
  // a frame actually runs the draw path against the recording context
  flush(); calls.length = 0; E.dirty(); flush();
  expect(calls.length > 20, 'one frame runs the real draw path against the recording context (' + calls.length + ' calls)');
}

// ---------------------------------------------------------------------------------------------- 2. computeHome, via fit()
{
  const world = M.L.world, k = E.HOME.k, S = E.SAFE, U = E.U;
  expect(k > 0 && Number.isFinite(k), 'computeHome gives a finite positive zoom');
  const left = E.FW / 2 + (world.x - E.HOME.x) * k, right = left + world.w * k, top = E.FH / 2 + (world.y - E.HOME.y) * k, bot = top + world.h * k;
  const eps = 1.5;
  expect(left >= S.l + 20 * U - eps && right <= S.r - 20 * U + eps, 'HOME keeps the whole world inside the safe box, minus the site pad (horizontal)');
  expect(top >= S.t + 122 * U - eps && bot <= S.b - 70 * U + eps, 'HOME keeps the whole world inside the safe box, minus the site pad (vertical: 122 top, 70 bottom)');
  expect(Math.abs(E.cam.KMIN - k * 0.8) < 1e-9, 'the camera floor sits at 80% of the home zoom');
  expect(E.cam.near(E.HOME, 0.03, 8), 'a first fit() leaves the camera at HOME');
  // fit() follows the window: a bigger window raises U and the safe box moves with it
  const U0 = E.U; win.innerWidth = 2560; win.innerHeight = 1600; E.fit();
  expect(E.U > U0 && E.U <= 1.5 && E.FW === 2560, 'fit() on a 2560 x 1600 window scales the UI up (U ' + U0 + ' -> ' + E.U + ', capped at 1.5)');
  expect(E.SAFE.r < 2560 && E.SAFE.b < 1600, 'fit() recomputes the safe box inside the new window');
  win.innerWidth = 1280; win.innerHeight = 800; E.fit();
  expect(E.U === 1 && E.FW === 1280, 'fit() back at 1280 x 800 returns to U = 1');
  win.innerWidth = 700; E.fit();
  expect(E.S.phone === true, 'a window under 760 px wide routes to the phone view');
  win.innerWidth = 1280; E.fit();
  expect(E.S.phone === false, 'a 1280 px window is the plan, not the phone view');
}

// ---------------------------------------------------------------------------------------------- 3. the hit boxes, measured by scanning
// The pointer is swept over a grid; the box of a hit is the extent of the positions that resolve to it. The assertions are
// FLOORS (a box may grow for a coarse pointer, never shrink below what a mouse gets today); the measured figures are
// printed so a reader sees the number the touch work has to beat. Nothing here pins toast() or the boxes' exact size.
const FLOOR = { pin: [23, 27], cluster: [31, 31], track: [18, 18], agentR: 10, chip: [58, 20] };
function extent(test: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number, step = 0.5) {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) if (test(x, y)) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y); }
  return c < a ? null : { w: c - a, h: d - b, x0: a, y0: b, x1: c, y1: d };
}
const measured: Record<string, string> = {};
{
  reset(); win.innerWidth = 1280; win.innerHeight = 800; E.fit();
  // tile level: zoom into a tile that has an open question so lod > 0.4
  const fid = Object.keys(M.sim.DOF).find((f) => M.sim.DOF[f].length === 1 && M.L.TILE[f]);
  expect(!!fid, 'the sample swarm has a tile with exactly one open question');
  if (fid) {
    const T = M.L.TILE[fid];
    E.cam.set({ x: T.x + T.w / 2, y: T.y + T.h / 2, k: E.KB1 * 2.5 }); E.cam.stopFly?.();
    expect(E.lod() > 0.9, 'the camera is at tile level (lod ' + E.lod().toFixed(2) + ')');
    const r = E.featureRect(fid)!;
    const dd = M.sim.DOF[fid][0];
    const pinBox = extent((x, y) => { const h = E.pinAt(x, y); return !!h && !h.cluster && h.d === dd; }, r.x - 40, r.y - 40, r.x + r.w + 40, r.y + r.h + 40);
    expect(pinBox !== null, 'pinAt resolves a tile\'s question pin somewhere on its rect');
    if (pinBox) {
      measured.pin = pinBox.w + ' x ' + pinBox.h;
      expect(pinBox.w >= FLOOR.pin[0] - 1 && pinBox.h >= FLOOR.pin[1] - 1, 'a tile question pin\'s hit box is at least 23 x 27 (measured ' + measured.pin + ')');
      // the box must hold the point the pin is drawn at: its anchor sits at the tile's bottom right, 12u in from the right, 5u up
      const ax = r.x + r.w - 12 * E.U, ay = r.y + r.h - 5 * E.U - 10;
      expect(E.pinAt(ax, ay)?.d === dd, 'the pin\'s own anchor resolves to its question');
      expect(E.pinAt(pinBox.x1 + 6, pinBox.y1 + 6) === null, 'a point outside the box resolves to nothing');
    }
    const trackFid = Object.keys(M.tracks?.F ?? {}).find((f) => M.L.TILE[f]);
    if (trackFid) {
      const Tt = M.L.TILE[trackFid]; E.cam.set({ x: Tt.x + Tt.w / 2, y: Tt.y + Tt.h / 2, k: E.KB1 * 2.5 });
      const rt = E.featureRect(trackFid)!;
      const tb = extent((x, y) => E.trackAt(x, y) === M.tracks.F[trackFid][0].id, rt.x - 20, rt.y - 20, rt.x + rt.w + 20, rt.y + rt.h + 20);
      if (tb) { measured.track = tb.w + ' x ' + tb.h; expect(tb.h >= FLOOR.track[1] - 1, 'a track mark\'s hit box is at least 18 px tall (measured ' + measured.track + ')'); }
    }
  }
  // a moving agent: the smallest circle around its drawn position that still resolves to it
  E.cam.set(E.HOME); E.cam.set({ x: E.HOME.x, y: E.HOME.y, k: E.KB1 * 2.5 });
  const T0 = M.L.tiles[0]; E.cam.set({ x: T0.x + T0.w / 2, y: T0.y + T0.h / 2, k: E.KB1 * 2.5 });
  let agentHit = 0, agentMiss = 0;
  for (let y = 0; y <= E.FH; y += 6) for (let x = 0; x <= E.FW; x += 6) { if (E.agentAt(x, y)) agentHit++; else agentMiss++; }
  expect(agentHit > 0, 'agentAt finds an agent somewhere across the tile-level plan (' + agentHit + ' grid hits)');
  expect(agentMiss > agentHit, 'agentAt does not claim the whole plan: most of the grid is a miss');
  {
    // the first agent found, its hit region measured on a fine grid around the point (a parked chip is wider than a moving agent's disc, so only the height is a floor)
    let found: { A: Any; x: number; y: number } | null = null;
    for (let y = 0; y <= E.FH && !found; y += 6) for (let x = 0; x <= E.FW && !found; x += 6) { const A = E.agentAt(x, y); if (A) found = { A, x, y }; }
    if (found) {
      const ab = extent((x, y) => E.agentAt(x, y) === found!.A, found.x - 40, found.y - 40, found.x + 40, found.y + 40, 0.5);
      if (ab) { measured.agent = ab.w + ' x ' + ab.h; expect(ab.h >= FLOOR.agentR * 2 - 1, 'an agent\'s hit region is at least 20 px tall (measured ' + measured.agent + ')'); }
    }
  }
  // the whole-plan view: a room cluster pin
  E.cam.set(E.HOME);
  const ri = (() => { const rd = E.roomDecs(); for (let i = 0; i < rd.length; i++) if (rd[i].length) return i; return -1; })();
  if (ri >= 0 && E.lod() < 0.6) {
    const rr = E.view; void rr;
    const cb = extent((x, y) => { const h = E.pinAt(x, y); return !!h && h.cluster && h.at === M.L.rooms[ri].d.name; }, 0, 0, E.FW, E.FH, 1);
    if (cb) { measured.cluster = cb.w + ' x ' + cb.h; expect(cb.w >= FLOOR.cluster[0] - 2 && cb.h >= FLOOR.cluster[1] - 2, 'a room cluster pin\'s hit box is at least 31 x 31 (measured ' + measured.cluster + ')'); }
    else expect(false, 'a room with open questions has a clickable cluster pin at the home zoom');
  }
  E.cam.set(E.HOME); reset();
}

// ---------------------------------------------------------------------------------------------- 3b. the hit list: what the frame drew, in draw order
// Each dynamic layer registers the marks it DRAWS into one per-frame list (render/hits.ts); clickAt / hoverAt and the
// pinAt / trackAt / agentAt readers walk it topmost first. Pinned here: an agent the overflow chip hides is not hit,
// the "+N" chip stands for its tile, a moved drawing moves its box (a BP_ENGINE_MUTATE child run), one presence
// threshold for the crossfade, the coarse-pointer 44 px floor, and a pooled list (a still frame allocates nothing).
{
  reset(); win.innerWidth = 1280; win.innerHeight = 800; E.fit();
  const u = E.U;
  /** The tile-level pin box (pointer scan) of the first tile with exactly one open question, after one real frame. */
  const pinProbe = () => {
    const fid = Object.keys(M.sim.DOF).find((f) => M.sim.DOF[f].length === 1 && M.L.TILE[f])!;
    const T = M.L.TILE[fid]; E.cam.set({ x: T.x + T.w / 2, y: T.y + T.h / 2, k: E.KB1 * 2.5 }); E.dirty(); flush();
    const r = E.featureRect(fid)!, dd = M.sim.DOF[fid][0];
    const b = extent((x, y) => E.pinAt(x, y)?.d === dd, r.x - 60, r.y - 40, r.x + r.w + 40, r.y + r.h + 40);
    return { fid, r, dd, b, cx: b ? (b.x0 + b.x1) / 2 : NaN, cy: b ? (b.y0 + b.y1) / 2 : NaN };
  };
  if (process.env.BP_HARNESS_PROBE === 'pin') { const p = pinProbe(); console.log('PROBE ' + JSON.stringify({ cx: p.cx, cy: p.cy })); process.exit(0); }

  // case 1 / 2: at k = 1 on failed-payment-dunning the chip cap is 1 - one "+N" chip, agents idx 1..3 undrawn
  const fid = 'failed-payment-dunning', T = M.L.TILE[fid], crew = M.sim.AGF[fid] ?? [];
  expect(!!T && crew.length === 4, 'the sample has failed-payment-dunning with a crew of 4 (' + crew.length + ')');
  if (T) {
    E.cam.set({ x: T.x + T.w / 2, y: T.y + T.h / 2, k: 1 }); E.dirty(); flush();
    const r = E.featureRect(fid)!, y = r.y + r.h - 14 * u;
    expect(E.lod() > 0.6 && r.w < 200 * u, 'k = 1 is chip level with a narrow tile (lod ' + E.lod().toFixed(2) + ', w ' + r.w + ')');
    const a3 = E.agentAt(r.x + 20 * u + 3 * 62 * u, y);
    expect(a3 === null, 'an agent the overflow chip hides is not hit at its undrawn position (got ' + (a3 ? a3.id + ' of ' + a3.f : 'null') + ')');
    const more = E.hitUnder?.(r.x + 20 * u, y);
    expect(!!more && more.kind === 'more' && more.id === fid, 'the "+N" overflow chip resolves to its feature (got ' + (more ? more.kind + ':' + more.id : 'null') + ')');
    expect(E.agentAt(r.x + 20 * u, y) === null, 'the "+N" chip is not the agent that happens to sit at its index');
  }

  // case 4: a moved drawing moves its box - a child run with the drawn tile pin 28 px left must measure the box 28 px left
  {
    const here = pinProbe();
    const { spawnSync } = await import('node:child_process');
    const mut = [['dynamic.ts', 'r.x + r.w - 12 * u - j * 18 * u', 'r.x + r.w - 40 * u - j * 18 * u']];
    const out = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-engine-harness.ts')], { env: { ...process.env, BP_ENGINE_MUTATE: JSON.stringify(mut), BP_HARNESS_PROBE: 'pin' }, encoding: 'utf8' });
    const line = (out.stdout || '').split('\n').find((l) => l.startsWith('PROBE ')), got = line ? JSON.parse(line.slice(6)) : null;
    expect(!!got && Math.abs(got.cx - (here.cx - 28 * u)) <= 1 && Math.abs(got.cy - here.cy) <= 1, 'a tile pin drawn 28 px left has its hit box 28 px left (here ' + here.cx + ', mutated ' + (got ? got.cx : 'no probe: ' + (out.stderr || '').slice(0, 200)) + ')');
  }

  // case 5: one presence threshold - a mark is hit-testable when drawn at >= 0.5 of its presence
  {
    const kAt = (want: number) => { let lo = E.KB1 * 0.5, hi = E.KB1 * 3; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (E.lod(m) < want) lo = m; else hi = m; } return (lo + hi) / 2; };
    const tf = Object.keys(M.sim.DOF).find((f) => M.sim.DOF[f].length >= 1 && M.L.TILE[f])!;
    const Tp = M.L.TILE[tf], ri = Tp.room.ri, R = M.L.rooms[ri];
    const sweep = (want: boolean) => { let n = 0; for (let y = 0; y <= E.FH; y += 3) for (let x = 0; x <= E.FW; x += 3) { const h = E.pinAt(x, y); if (h && h.cluster === want) n++; } return n; };
    E.cam.set({ x: R.x + R.w / 2, y: R.y + R.h / 2, k: kAt(0.45) }); E.dirty(); flush();
    let pp: { x: number; y: number } | null = DYN.roomPinPos(E, E.view, ri);
    const c45 = pp ? E.pinAt(pp.x, pp.y - 10) : null, t45 = sweep(false);
    expect(!!c45 && c45.cluster && c45.at === R.d.name, 'at lod 0.45 a room cluster pin anchor resolves to its cluster');
    expect(t45 === 0, 'at lod 0.45 no tile pin resolves anywhere (' + t45 + ' grid hits)');
    E.cam.set({ x: R.x + R.w / 2, y: R.y + R.h / 2, k: kAt(0.55) }); E.dirty(); flush();
    const rt = E.featureRect(tf)!, t55 = E.pinAt(rt.x + rt.w - 12 * u, rt.y + rt.h - 15 * u), c55 = sweep(true);
    expect(!!t55 && !t55.cluster && t55.d === M.sim.DOF[tf][0], 'at lod 0.55 a tile pin anchor resolves to its question');
    expect(c55 === 0, 'at lod 0.55 no room cluster pin resolves anywhere (' + c55 + ' grid hits)');
    pp = null;
  }

  // case 7: a coarse pointer grows every region to the 44 px touch floor around its drawn centre; a mouse keeps case 3's boxes
  {
    const mouse = pinProbe();
    coarse = true; E.dirty(); flush();
    const H = E.hits, small: string[] = [];
    if (H) for (let i = 0; i < H.n; i++) { const b = H.boxOf(H.pool[i], E.touchMin(), {}); const h = H.pool[i]; if (b.w < 44 - 1e-6 || b.h < 44 - 1e-6 || Math.abs(b.x + b.w / 2 - (h.x + h.w / 2)) > 1e-6 || Math.abs(b.y + b.h / 2 - (h.y + h.h / 2)) > 1e-6) small.push(h.kind + ':' + h.id); }
    expect(!!H && H.n > 0 && small.length === 0, 'coarse pointer: every registered region is at least 44 x 44 around its drawn centre (' + (H ? H.n : 0) + ' regions, short: ' + small.slice(0, 5).join(' ') + ')');
    const touch = pinProbe();
    expect(!!touch.b && touch.b.w >= 43 && touch.b.h >= 43, 'coarse pointer: a tile pin measured by the pointer is >= 44 x 44 (' + (touch.b ? touch.b.w + ' x ' + touch.b.h : 'none') + ')');
    coarse = false; const back = pinProbe();
    expect(!!back.b && !!mouse.b && back.b.w === mouse.b.w && back.b.h === mouse.b.h && back.b.w >= FLOOR.pin[0] - 1, 'GUARD mouse pointer: the pin box is the mouse box again (' + (back.b ? back.b.w + ' x ' + back.b.h : 'none') + ')');
  }

  // case 8: the list is pooled - 20 still frames keep its record count and its pool size
  {
    pinProbe(); for (let i = 0; i < 3; i++) { E.dirty(); flush(); }
    const H = E.hits, n0 = H?.n, p0 = H?.pool.length; let same = !!H;
    for (let i = 0; i < 20 && H; i++) { E.dirty(); flush(); if (H.n !== n0 || H.pool.length !== p0) same = false; }
    expect(same && n0 > 0, 'the hit list is pooled: 20 frames at an unchanged view keep ' + n0 + ' records and a pool of ' + p0);
  }
  E.cam.set(E.HOME); reset();
}

// ---------------------------------------------------------------------------------------------- 4. goUp: the Esc ladder, in order
{
  const rung = (name: string, patch: Record<string, unknown>, field: string, cleared: unknown) => {
    reset(patch); E.goUp(); const s = E.S as Any;
    expect(JSON.stringify(s[field]) === JSON.stringify(cleared), 'Esc ladder: ' + name + ' closes first (' + field + ' -> ' + JSON.stringify(s[field]) + ')');
  };
  rung('the scan menu', { menu: { x: 1, y: 1, chain: [], tile: null }, tl: true, dtab: 'view' }, 'menu', null);
  rung('the timeline, before the morning card', { tl: true, morning: true, dtab: 'view' }, 'tl', false);
  rung('the morning card, before the person menu', { morning: true, whoMenu: true, dtab: 'view' }, 'morning', false);
  rung('the person menu, before the dock flyout', { whoMenu: true, dtab: 'view' }, 'whoMenu', false);
  rung('the dock flyout, before info', { dtab: 'view', info: true }, 'dtab', null);
  rung('info, before an open feature', { info: true, open: Object.keys(M.P.F)[0] }, 'info', false);
  {
    const f = Object.keys(M.P.F)[0]; reset({ open: f, blast: f }); E.goUp();
    expect(E.S.open === null && E.S.blast === f, 'Esc ladder: an open feature closes before a blast mode');
  }
  {
    const f = Object.keys(M.P.F)[0]; reset({ blast: f, ga: true }); E.goUp();
    expect(E.S.blast === null && E.S.ga === true, 'Esc ladder: blast clears before the GA mode');
    E.goUp(); expect(E.S.ga === false, 'Esc ladder: then the GA mode');
  }
  {
    reset({ page: 'ledger', tl: false, dtab: null, key: 'x' }); E.goUp();
    expect(E.S.page === 'ledger' && E.S.key === 'x', 'Esc ladder: on the ledger page Esc changes nothing behind it');
  }
  {
    reset({ key: 'x' }); E.goUp(); expect(E.S.key === null, 'Esc ladder: the legend key closes after the modes');
  }
  reset();
}

// ---------------------------------------------------------------------------------------------- 5. onKey: refusals and the map
{
  reset(); const inp = new El('input'), plain = new El('div'), ownz = new El('div'); ownz.matchSel = ['[data-keys="own"]'];
  const was = (k: string, tgt: El | undefined, o = {}) => { reset(); const b = E.S.tl; key(k, { target: tgt, ...o }); return E.S.tl !== b; };
  expect(was('t', undefined) === true, 'key t toggles the timeline');
  expect(was('t', inp) === false, 'a key typed into an input is refused');
  expect(was('t', undefined, { ctrl: true }) === false, 'Ctrl+t is refused (the browser\'s shortcut)');
  expect(was('t', undefined, { meta: true }) === false, 'Cmd+t is refused');
  expect(was('t', undefined, { alt: true }) === false, 'Alt+t is refused');
  expect(was('t', ownz) === false, 'a target inside data-keys="own" is refused');
  reset({ phone: true }); { const b = E.S.tl; key('t', { target: plain }); expect(E.S.tl === b, 'the phone view refuses every plan key'); }
  reset({ page: 'ledger' }); { const b = E.S.tl; key('t'); expect(E.S.tl === b, 'no plan key fires on the ledger page'); }
  reset({ page: 'ledger', info: true }); { key('Escape'); expect(E.S.page === 'ledger', 'Esc on the ledger page does not leave it'); }
  reset({ open: Object.keys(M.P.F)[0] }); { const b = E.S.tl; key('t'); expect(E.S.tl === b, 'the feature page is modal: t does not open the timeline under it'); }
  reset({ open: Object.keys(M.P.F)[0] }); { const b = E.S.dtab; key('p'); expect(E.S.dtab === b, 'the feature page is modal: p opens no flyout under it'); }
  reset({ open: Object.keys(M.P.F)[0] }); { key('2'); expect(E.S.view !== 'general' || M.P.lenses.length < 2, 'the feature page still takes the lens digits'); E.setView('general'); }
  reset(); { const p = key('Escape'); expect(p === true, 'Esc is claimed (default prevented)'); }
  reset(); { const p = key('/'); expect(p === true, '/ is claimed for the search box'); }
  reset(); { let f = 0; E.focusSearch = () => { f++; }; key('/'); expect(f === 1, '/ calls focusSearch once'); }
  reset(); { E.setView('general'); key('2'); const vs = ['general', ...M.P.lenses.map((l: Any) => l.id)]; void vs; expect(E.S.view !== 'general', 'digit 2 selects the first lens after General'); key('1'); expect(E.S.view === 'general', 'digit 1 returns to General'); }
  reset(); { key('m'); expect(E.S.morning === true, 'm opens the morning card'); key('m'); }
  reset(); { key('s'); expect(E.S.selMode === true, 's enters target mode'); key('s'); expect(E.S.selMode === false, 's again leaves it'); }
  reset(); { key('p'); expect(E.S.dtab === 'view', 'p opens the view flyout'); }
  reset(); { const b = E.M.sim.speed; key('.'); const up = E.M.sim.speed; expect(up > b, 'the . key steps the simulation speed up (' + b + ' -> ' + up + ')'); key(','); expect(E.M.sim.speed === b, 'the , key steps it back down'); }
  reset(); { const d0 = E.S.delta; void d0; const t0 = E.S.t; key('['); expect(E.S.t !== t0, '[ steps the viewed week back'); key(']'); }
  reset({ page: 'plan', morning: true }); { const b = E.S.tl; key('t'); expect(E.S.tl === b, 'with the morning card up, only Enter and Esc act: t is swallowed'); }
  reset({ info: false, tl: true }); { key('Escape'); expect(E.S.tl === false, 'Esc through the key handler runs the ladder (timeline closes)'); }
  // U walks the plan's undo history back (Enter decides at the recommendation; U takes it back), never from an input,
  // never with Ctrl held, and never on the ledger page (where U is the ledger's own)
  {
    const sim = E.M.sim, q = sim.openDecs()[0];
    reset({ dec: q.id }); key('Enter');
    expect(!q.open, 'U: Enter on an open decision decides it at the recommendation');
    reset(); key('u', { target: inp }); expect(!q.open, 'U: "u" typed in the search input does nothing');
    reset(); key('u', { ctrl: true }); expect(!q.open, 'U: Ctrl+u does nothing');
    reset({ page: 'ledger' }); key('u'); expect(!q.open, 'U: on the ledger page U stays the ledger\'s own');
    reset(); key('u'); expect(q.open && !q.ans, 'U: "u" on the plan reopens the question');
    reset({ dec: q.id }); key('Enter'); reset(); key('U'); expect(q.open, 'U: Shift+U works the same');
  }
  reset();
}

// ---------------------------------------------------------------------------------------------- 6. the hash: write, push / replace, read back
{
  E.destroy(); E = mount(); reset();
  advance(1100);                                                  // past the load window in which writes only adopt
  hist.length = 0;
  E.setView(M.P.lenses[1].id); advance(300);
  expect(loc.hash.includes('lens=' + M.P.lenses[1].id), 'a lens change is written to the hash (' + loc.hash + ')');
  expect(hist.length > 0 && hist.every((h) => h.kind === 'replace'), 'a lens change replaces the history entry, never pushes');
  E.setView('general'); advance(300);
  expect(!loc.hash.includes('lens='), 'General leaves no lens= in the hash');
  hist.length = 0; E.setDelta(14); advance(300);
  expect(loc.hash.includes('d=14') && hist.every((h) => h.kind === 'replace'), 'a delta other than 7 is written (d=14) by replace');
  E.setDelta(7); advance(300);
  expect(!loc.hash.includes('d='), 'the default delta writes nothing');
  // place: a rested new place pushes once after PUSH_MS (600), an explicit navigation pushes at once
  const wing = M.L.blds[0].wings?.[0] ?? Object.values(M.L.WING)[0] as Any;
  const fid = Object.keys(M.P.F)[0];
  hist.length = 0; E.openFeature(fid); advance(300);
  expect(loc.hash.includes('open=' + fid), 'opening a feature writes open=<id> (' + loc.hash + ')');
  expect(hist.some((h) => h.kind === 'push'), 'opening a feature is explicit navigation: it pushes a history entry');
  const pushes = hist.filter((h) => h.kind === 'push').length;
  advance(2000); expect(hist.filter((h) => h.kind === 'push').length === pushes, 'a pushed place does not push again while it rests');
  hist.length = 0; E.closeFeature(false); advance(300);
  expect(!loc.hash.includes('open='), 'closing the feature drops open= from the hash');
  void wing;
  // the reader: a hash pasted in restores view, delta and the open feature; absence means the default
  E.setView('general'); advance(300);
  const lens = M.P.lenses[1].id;
  loc.hash = '#lens=' + lens + '&d=14&open=' + fid; win.dispatch('hashchange', {});
  expect(E.S.view === lens && E.S.delta === 14 && E.S.open === fid, 'a pasted hash restores lens, delta and the open feature (view=' + E.S.view + ' d=' + E.S.delta + ' open=' + E.S.open + ')');
  loc.hash = ''; win.dispatch('popstate', {});
  expect(E.S.view === 'general' && E.S.delta === 7 && E.S.open === null, 'an emptied hash restores the defaults (back to the first entry)');
  loc.hash = '#lens=%E0%A4%A&d=14'; win.dispatch('popstate', {});
  expect(E.S.delta === 14, 'a mangled %-escape skips that pair; the valid ones still apply');
  loc.hash = '#lens=no-such-lens&who=nobody&open=nothing&t=garbage'; win.dispatch('popstate', {});
  expect(E.S.view === 'general' && E.S.who === null && E.S.open === null, 'an unknown lens, person and feature in a hash are ignored, not adopted');
  // our own write must not be read back as a navigation
  E.setDelta(14); advance(300); const hs = E.S.delta; win.dispatch('hashchange', {});
  expect(E.S.delta === hs, 'the engine\'s own hash write is not restored as a navigation');
  E.setDelta(7); advance(300);
  // load: a hash present at construction is read into the store
  E.destroy(); loc.hash = '#d=1&open=' + fid; hist.length = 0; E = mount(); loc.hash = '#d=1&open=' + fid;
  E.destroy(); E = (() => { win.innerWidth = 1280; win.innerHeight = 800; rafQ = []; return new Engine({ canvas, ui, root, model: buildModel(1, () => clock, null), expression, intro: false }); })();
  expect(E.S.ready === true, 'a second Engine constructs after destroy() (the first one released its window handle)');
}
{
  E.destroy(); loc.hash = '#d=14&lens=' + M.P.lenses[1].id + '&open=' + Object.keys(M.P.F)[0];
  const E2 = new Engine({ canvas, ui, root, model: buildModel(1, () => clock, null), expression, intro: false });
  expect(E2.S.delta === 14 && E2.S.view === M.P.lenses[1].id && E2.S.open === Object.keys(M.P.F)[0], 'a hash present at load is read into the store: lens, delta and open feature');
  E2.destroy();
}

// ---------------------------------------------------------------------------------------------- 7. destroy
{
  const E3 = mount(); const before = (doc as Any).L?.size;
  void before;
  E3.destroy(); rafQ = [];
  E3.patch({ delta: 14 });
  expect(rafQ.length === 0, 'after destroy() the engine asks for no more frames');
  expect(win.__bp !== E3, 'destroy() releases window.__bp');
  let fired = 0; E3.focusSearch = () => { fired++; };
  key('/'); expect(fired === 0, 'after destroy() the key listener is gone');
}

// ---------------------------------------------------------------------------------------------- report
console.log('measured hit boxes at U = 1 (px):', JSON.stringify(measured), '- touch floor in this repo: 44');
if (failures.length) { console.error('check-engine-harness: ' + failures.length + ' failed (' + held + ' held)'); for (const f of failures) console.error('  FAIL ' + f); process.exit(1); }
console.log('check-engine-harness: ' + held + ' assertions held against a constructed Engine');
process.exit(0);
