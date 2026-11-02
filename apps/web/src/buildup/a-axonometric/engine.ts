// Axonometric Raise, ported from the contest prototype (blueprint-buildup, claude-opus-5-5 xhigh o2, variant 1).
// One hand-rolled orthographic projection draws everything:  screen = view(rotate(theta) · tilt(phi) · (x, y, z)).
// When theta = phi = 0 and wall height = 0 the projection is the plain plan transform, so the last frame of the build
// IS the live plan. What changed in the port: the prototype computed one schedule up front from the whole plan; here
// every time on an element (footprint traced, room raised, slab dropped, stage stamped, health laid) is stamped when
// its event ARRIVES, onto a visual queue `Q` the engine animates through at the prototype's own pacing. Drawing is
// still a pure function of the engine clock T and those stamps.
import type { ActivityVerb, BBox, BuildupEvent, BuildupSource, Health, Phase, Stage } from '../contract';
import { PHASES } from '../contract';
import { HEALTHS, HEALTH_WORD, KIND_WORD, Model, STAGES, STAGE_WORD, type Bay, type Node, type Room, type Tile, type Wing } from './model';
import { SITE, bandBox, bandLayout, byLines, capBox, ghostBox, orderLots, rectAt, retarget, siteLayout, still, unionAll, type Ghost, type Lot } from './site';
import css from './axo.module.css';

const STEPS: { n: string; name: string; y: string; llm?: boolean }[] = [
  { n: '01', name: 'Check', y: 'existing artifacts' },
  { n: '02', name: 'Context map', y: 'code areas' },
  { n: '03', name: 'Seed', y: 'code tree' },
  { n: '04', name: 'Product tree', llm: true, y: 'wings · rooms · bays · tiles' },
  { n: '05', name: 'Events', y: 'history · stages' },
  { n: '06', name: 'Measure', y: 'static metrics' },
  { n: '07', name: 'Judge', llm: true, y: 'health' },
  { n: '08', name: 'Register', y: 'plan in bp' },
];
const H_WING = 120, H_ROOM = 62, H_SLAB = 10;
const TH_DOLLY = 0.34, PH_DOLLY = 1.0, TH_OV = 0.26, PH_OV = 0.9;
const PAD_BUILD = { t: 150, b: 112, l: 28, r: 28 };
const PAD_FINAL = { t: 146, b: 104, l: 28, r: 28 };
/** The light table before anything says how big the product is (a live run announces no extent). World units. */
const NOMINAL: BBox = { x: 0, y: 0, w: 3200, h: 1400 };
const SWEEP = 2.4;
const INF = Infinity;

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (u: number) => u * u * (3 - 2 * u);
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const backOut = (u: number) => { const c1 = 1.25, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
const nf = (n: number) => Math.round(n).toLocaleString('en-US');
const VERB: Readonly<Record<ActivityVerb, string>> = { read: 'READING', write: 'WRITING', run: 'WORKING IN' };
const fmt = (s: number) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

interface Cam { cx: number; cy: number; zoom: number; th: number; ph: number; ox: number; oy: number }
type Key = { t: number; idle?: boolean; ease?: 'mix' | 'flat' } & (
  | { k: 'box'; box: BBox; th: number; ph: number; zTop: number; frac: number; maxZ?: boolean }
  | { k: 'ext'; th: number; ph: number; zTop: number; frac: number; maxZ?: boolean }
  | { k: 'final' }
  | { k: 'cam'; cam: Cam });
interface Log { t: number; html: string; wait?: boolean; idle?: boolean }
interface Step { t0: number; t1: number; failed: boolean }

export interface EngineOpts { reducedMotion: boolean; kind: BuildupSource['kind'] }
export interface Engine { feed(e: BuildupEvent): void; setReduced(r: boolean): void; retheme(): void; destroy(): void }

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

export function createEngine(root: HTMLElement, opts: EngineOpts): Engine {
  const $ = <T extends HTMLElement = HTMLElement>(k: string) => root.querySelector(`[data-r="${k}"]`) as T;
  const cv = $<HTMLCanvasElement>('cv'), ctx = cv.getContext('2d') as Ctx;
  const kp = $<HTMLCanvasElement>('keyplan'), kctx = kp.getContext('2d') as Ctx;
  const hasLS = 'letterSpacing' in ctx;
  let RMODE = opts.reducedMotion;
  const PACE_WORD = opts.kind === 'preset-demo' ? 'DEMO PACE' : opts.kind === 'preset-real' ? 'REAL-RUN SHAPE' : 'LIVE RUN';
  const ORBIT = opts.kind === 'preset-demo' ? .06 : .11;

  /* ---------- tokens: the canvas reads the same sheet as the DOM ---------- */
  const C: Record<string, string> = {};
  const HX = new Map<string, string>();
  let FS = '"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif', FM = '"IBM Plex Mono",Consolas,monospace';
  function readTokens() {
    const cs = getComputedStyle(root);
    for (const k of ['paper', 'paper-hi', 'paper-mid', 'paper-lo', 'ink', 'ink-2', 'ink-3', 'ink-4', 'line', 'grid', 'accent',
      'mint', 'amber', 'red', 'red-2', 'glow', 'glass-edge', 'rim', 'label-bg', 'tile-base', 'sheet-a', 'sheet-b', 'sheet-c',
      'halo', 'ink-hi', 'on-ink', 'paper-core']) C[k] = cs.getPropertyValue('--' + k).trim() || '#888888';
    const fs = cs.getPropertyValue('--font-sans').trim(), fm = cs.getPropertyValue('--font-mono').trim();
    FS = (fs ? fs + ',' : '') + '"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif';
    FM = (fm ? fm + ',' : '') + '"IBM Plex Mono",Consolas,monospace';
    HX.clear();
  }
  function hexA(col: string, a: number) {
    const key = col + a; let v = HX.get(key); if (v) return v;
    if (col.startsWith('#')) {
      let h = col.slice(1); if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      const n = parseInt(h.slice(0, 6), 16); v = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    } else {
      const m = col.match(/[\d.]+/g) ?? ['136', '136', '136'];
      v = `rgba(${m[0]},${m[1]},${m[2]},${(m[3] ? +m[3] : 1) * a})`;
    }
    HX.set(key, v); return v;
  }

  /* ---------- state ---------- */
  let M = new Model('', '');
  let S = freshSchedule();
  let beginExt: BBox | null = null;
  let ext: BBox = NOMINAL, extD: BBox = NOMINAL, extKnown = false;
  let projectName = '';
  let begun = false;
  let T = 0, phase: 'build' | 'live' = 'build';
  let userTh = 0, userPh = 0, userZ = 1;
  let liveCam: Cam | null = null, liveMoved = false, raise = 0, raiseTarget = 0;
  let hover: Node | null = null, sel: Tile | null = null, tween: { from: Cam; to: Cam; t0: number; dur: number } | null = null;
  let dirty = true, level = 0;
  let vw = 1, vh = 1, dpr = 1;
  const V = { cx: 0, cy: 0, zoom: 1, th: 0, ph: 0, ox: 0, oy: 0, ws: 1, flat: 0 };
  /** pipeline truth, for the bars: which phases have started / finished (the strip itself follows the visual queue) */
  const phaseOn = new Set<Phase>(), phaseDone = new Set<Phase>();
  let measureOn = false;

  /* ---------- the site survey: what the run knows before (and between) the plan's own events. All optional: with none
     of them arrived, nothing below draws and the engine runs as the prototype did. ---------- */
  const lots = new Map<string, Lot>();
  const ghosts = new Map<string, Ghost>();
  interface Act { area: string | null; path: string; verb: ActivityVerb; t0: number; last: number }
  let act: Act | null = null, actPrev: Act | null = null;
  let prog: { t: number; n: number; of: number }[] = [];
  /** an anti-stale event has arrived: only then do the layers that answer silence (the lamp, inspection rings) run */
  let anti = false;
  /** the survey lamp's strength, eased per frame so it never pops */
  let lampA = 0;
  /** the footing strip leaves the framed extent as the plan flattens */
  let bandGone = false;

  function freshSchedule() {
    return {
      steps: STEPS.map((): Step => ({ t0: INF, t1: INF, failed: false })),
      keys: [] as Key[], logs: [] as Log[], sweeps: [] as { t0: number; t1: number }[],
      /** the visual queue: the engine time at which the work stamped so far has finished animating */
      Q: 0, R0: INF, end: INF, failed: null as string | null,
    };
  }

  /* ---------- the visual queue: scheduling from events ---------- */
  function cancelIdle(now: number) {
    // an idle tail (a "waiting for the next wing" log, a drift back to the overview) is superseded by real work
    const snap = camAt(now);
    const before = S.keys.length;
    S.keys = S.keys.filter((k) => !(k.idle && k.t > now));
    S.logs = S.logs.filter((l) => !(l.idle && l.t > now));
    const last = S.keys[S.keys.length - 1];
    if (S.keys.length !== before || (last && last.t < now)) S.keys.push({ t: now, k: 'cam', cam: snap });
  }
  /** catch-up: when the queue runs behind the arrivals, queued work plays faster (down to 0.4x its prototype length) */
  const catchUp = (now: number) => clamp(1 - Math.max(0, S.Q - now - .5) * .15, .4, 1);
  const addKey = (k: Key) => { S.keys.push(k); S.keys.sort((a, b) => a.t - b.t); };
  const ov = (t: number, th = TH_OV, ph = PH_OV, idle = false, ease?: Key['ease']) => addKey({ t, k: 'ext', th, ph, zTop: H_WING, frac: .97, idle, ease });
  const dollyKey = (t: number, w: Wing, y: number) => addKey({ t, k: 'box', box: { x: w.box.x - 30, y: y - 150, w: w.box.w + 60, h: 420 }, th: TH_DOLLY, ph: PH_DOLLY, zTop: H_ROOM, frac: .8, maxZ: true, ease: 'mix' });
  const log = (t: number, html: string, wait = false, idle = false) => { S.logs.push({ t, html, wait, idle }); S.logs.sort((a, b) => a.t - b.t); };
  const dollyZ = () => clamp(0.3 * vw / 532, 0.45, 0.92);

  /** The plan as known, with the footing strip in front of it; before any plan, the survey site and the pencilled wings. */
  function siteExt(): BBox | null {
    const k = M.known();
    if (k) return lots.size && !bandGone ? union(k, bandBox(k)) : k;
    const boxes: BBox[] = [];
    if (lots.size) boxes.push(SITE);
    for (const g of ghosts.values()) if (g.fadeT === INF) boxes.push(g.tw.b);
    return unionAll(boxes);
  }
  function setExtTarget() {
    const k = siteExt();
    const next = beginExt ? (k ? union(beginExt, k) : beginExt) : k ?? NOMINAL;
    extKnown = !!beginExt || !!M.known();
    ext = next;
    if (RMODE || !begun) extD = { ...next };
    sizeKeyplan();
  }
  const union = (a: BBox, b: BBox): BBox => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };

  function onStructure(e: Extract<BuildupEvent, { type: 'structure' }>) {
    const now = T;
    const n = M.add(e);
    setExtTarget();
    if (!n.wings.length && !n.rooms.length && !n.bays.length && !n.tiles.length) return;
    cancelIdle(now);
    const kc = catchUp(now);
    const c0 = Math.max(now, S.Q);
    const W = n.wings.length;
    // hand-over: a pencilled ghost first slides onto its wing's real footprint, and the pen then inks the footprint over it
    const HO = n.wings.some((w) => ghosts.has(w.id)) ? .8 * kc : 0;
    // footprints: grid axis chalked, a pen traces each new wing, then glass walls ripple up (prototype .2/.45/1.0 staggers)
    n.wings.forEach((w, i) => { w.axisT = c0 + HO + i * .07; w.footT = c0 + HO + .25 + i * .1; w.wallT = c0 + HO + .8 * kc + i * .17; });
    n.wings.forEach((w, i) => {
      const g = ghosts.get(w.id); if (!g) return;
      const t0 = c0 + i * .07;
      g.matched = true; g.tw = { a: rectAt(g.tw, t0), b: w.box, t0, dur: HO }; g.fadeT = w.footT + .3;
      for (const cp of g.caps) {
        const r = w.rooms.find((x) => x.id === cp.id);
        if (r) cp.tw = { a: rectAt(cp.tw, t0), b: r.box, t0, dur: HO };
        cp.fadeT = w.footT; // re-set to the room's rise below, once the walk has stamped it
      }
    });
    // the survey lots slide out from under the rising wings into a footing strip along the plan's front edge
    if (lots.size) {
      const L = bandLayout([...lots.values()], M.known() ?? SITE);
      orderLots([...lots.values()]).forEach((l, i) => { const b = L.get(l.id); if (b) { const t0 = c0 + .3 + i * .04; l.tw = { a: rectAt(l.tw, t0), b, t0, dur: 1.4 }; } });
    }
    let cur = W ? n.wings[W - 1].wallT + 1.1 * kc : c0;
    if (W > 1) {
      ov(c0);
      log(c0 + .25, `<b>04 Product tree</b> · ${W} wings: ${n.wings.map((w) => esc(w.letter + ' ' + w.name)).join(' · ')}`);
      ov(cur - .5);
    } else if (W === 1) {
      const w = n.wings[0];
      addKey({ t: c0 + .2, k: 'box', box: w.box, th: TH_DOLLY, ph: PH_DOLLY, zTop: H_WING, frac: .75, maxZ: true });
    }
    // pacing: a burst of many wings gets the prototype's demo budget; a wing at a time gets its real-run step, tightened
    // when a backlog builds up
    const newR = new Set<Room>(n.rooms), newB = new Set<Bay>(n.bays), newT = new Set<Tile>(n.tiles);
    const units = n.rooms.length + n.bays.length;
    let per: number;
    if (W > 2) { const budget = clamp(6 + units * .28, 12, 26); per = Math.max(.18, (budget - W * .5) / Math.max(1, units)); }
    else per = Math.max(.15, .34 * kc);
    const touched = M.wings.filter((w) => w.rooms.some((r) => newR.has(r)) || w.bays.some((b) => newB.has(b)) || w.tiles.some((t) => newT.has(t)));
    for (const w of touched) {
      cur += .5 * kc;
      log(cur, `<b>04 Product tree</b> · wing ${esc(w.letter)} · ${esc(w.name)}${W === 1 ? ' arrived' : ''} · ${w.rooms.length} rooms · ${w.tiles.length} features`);
      for (const r of w.rooms) {
        if (newR.has(r)) { r.riseT = cur; dollyKey(cur + per * .3, w, r.box.y + 60); cur += per; }
        for (const b of r.bays) {
          const fresh = b.tiles.filter((t) => newT.has(t));
          if (newB.has(b)) {
            b.ruleT = cur - per * .45; fresh.forEach((tl, k) => { tl.dropT = cur + k * .05; });
            dollyKey(cur + per * .6, w, b.box.y + 40); cur += per;
          } else if (fresh.length) { fresh.forEach((tl, k) => { tl.dropT = cur + k * .05; }); cur += per * .5; }
        }
      }
    }
    // tiles whose parent landed in an earlier chunk but whose wing was not walked above cannot exist: `touched` covers them
    S.Q = cur;
    // a pencilled capability gives way to its room as the room is raised
    for (const w of n.wings) { const g = ghosts.get(w.id); if (g) for (const cp of g.caps) { const r = w.rooms.find((x) => x.id === cp.id); if (r && r.riseT < INF) cp.fadeT = r.riseT; } }
    // idle tail: look at what is standing, then drift back to the overview while the model works on
    addKey({ t: cur + .2, k: 'ext', th: TH_DOLLY, ph: PH_DOLLY, zTop: H_ROOM, frac: .8, maxZ: true, idle: true });
    if (phaseOn.has('product-tree') && !phaseDone.has('product-tree')) {
      ov(cur + 2.2, TH_OV, PH_OV, true);
      log(cur + .6, `<b>04 Product tree</b> · waiting for the next wing from the model`, true, true);
    }
  }

  function onHistory(e: Extract<BuildupEvent, { type: 'history' }>) {
    const now = T;
    for (const h of e.tiles) { const tl = M.tile(h.id); if (tl) tl.created = h.created ? h.created.slice(0, 10) : null; }
    M.historyIn = true; M.reorderHist();
    cancelIdle(now);
    const E0 = Math.max(now, S.Q), N = M.hist.length;
    const kc = catchUp(now);
    const span = clamp(4 + N * .03, 5, 8) * kc;
    ov(E0 + 1.1);
    log(E0, `<b>05 Events</b> · ${M.dated ? 'history from git' : 'stages from git (this repo has no creation dates: plan order)'}`);
    M.hist.forEach((tl, r) => { tl.stageT = Math.max(E0 + 1.0 * kc + (N > 1 ? r / (N - 1) : 0) * span, tl.dropT + .6); });
    S.Q = E0 + (1.0 + .6) * kc + span;
  }

  /** The reading a tile shows at t: a batch's provisional one (pencil) until the final one is inked. */
  const gen = (tl: Tile, t: number): Health | null => (tl.pen != null && t < tl.inkT ? tl.pen : tl.general);
  const inPencil = (tl: Tile, t: number) => tl.pen != null && t >= tl.healthT && t < tl.inkT;

  function onHealth(e: Extract<BuildupEvent, { type: 'health' }>) {
    const now = T;
    // a first reading lands (in pencil when provisional); a final reading over a pencilled one inks it; a provisional
    // reading never overrides anything already read
    const got: Tile[] = [], ink: Tile[] = [];
    for (const h of e.tiles) {
      const tl = M.tile(h.id); if (!tl) continue;
      if (tl.healthT === INF) { if (e.provisional) tl.pen = h.general; else tl.general = h.general; got.push(tl); }
      else if (!e.provisional && tl.pen != null && tl.inkT === INF) { tl.general = h.general; ink.push(tl); }
    }
    if (e.provisional) anti = true;
    if (!got.length && !ink.length) return;
    cancelIdle(now);
    const kc = catchUp(now);
    const cur = Math.max(now, S.Q);
    // the prototype laid health across the sheet left to right; a batch keeps that sweep inside itself
    const lr = (a: Tile, b: Tile) => a.box.x - b.box.x || a.box.y - b.box.y;
    got.sort(lr);
    got.forEach((tl, k) => { tl.healthT = cur + .3 * kc + k * .07 * kc; if (!e.provisional) tl.inkT = tl.healthT; tl.wing.healthT = Math.min(tl.wing.healthT, tl.healthT); });
    // count what has landed by the end of this batch (later batches may already be queued behind it)
    let upto = got.length ? got[got.length - 1].healthT : cur;
    S.Q = got.length ? cur + (.3 + got.length * .07) * kc : cur;
    if (ink.length) {
      ink.sort(lr);
      const i0 = got.length ? upto + .2 : cur + .3 * kc;
      ink.forEach((tl, k) => { tl.inkT = i0 + k * .05 * kc; });
      upto = Math.max(upto, ink[ink.length - 1].inkT + .5); S.Q = Math.max(S.Q, upto);
    }
    const judged = M.tiles.filter((x) => x.healthT <= upto);
    const bad = judged.filter((x) => gen(x, upto) === 'bad').length;
    const badH = bad ? ` · <span class="${css.bad}">${bad} in trouble</span>` : '';
    if (e.provisional) {
      const p = prog.length ? prog[prog.length - 1] : null;
      log(cur, `<b>07 Judge</b> · ${p && p.n ? `batch ${p.n} of ${p.of} · ` : ''}${judged.length}/${M.tiles.length} pencilled${badH}`, !p || p.n < p.of);
    } else if (ink.length) log(cur, `<b>07 Judge</b> · final readings inked · ${judged.length}/${M.tiles.length}${badH}`);
    else log(cur, `<b>07 Judge</b> · ${judged.length}/${M.tiles.length} judged${badH}`);
  }

  function onSurvey(e: Extract<BuildupEvent, { type: 'survey' }>) {
    anti = true;
    const now = T;
    for (const a of e.areas) {
      const old = lots.get(a.id);
      if (old) Object.assign(old, a);
      else lots.set(a.id, { ...a, chalkT: INF, tw: still({ x: 0, y: 0, w: 0, h: 0 }) });
    }
    const list = [...lots.values()], k = M.known();
    const L = k ? bandLayout(list, k) : siteLayout(list);
    let i = 0;
    for (const l of orderLots(list)) {
      const b = L.get(l.id); if (!b) continue;
      // a new lot is chalked in place, one after another; a known one moves to its new size (the lines arriving)
      if (l.chalkT === INF) { l.chalkT = now + .2 + i++ * .09; l.tw = still(b); }
      else retarget(l.tw, b, now, 1.6);
    }
    setExtTarget();
    const running = !phaseDone.has('product-tree') && (phaseOn.has('context-map') || phaseOn.has('product-tree'));
    log(now, byLines(list)
      ? `<b>03 Seed</b> · ${list.length} code areas measured · ${nf(list.reduce((s, l) => s + (l.lines ?? 0), 0))} lines · lots resized by lines`
      : `<b>02 Context map</b> · ${list.length} code areas chalked on the site · sized by files until lines are counted`, running);
  }

  function layoutGhosts(now: number) {
    const all = [...ghosts.values()].sort((a, b) => a.d.order - b.d.order || a.d.id.localeCompare(b.d.id));
    all.forEach((g, r) => {
      if (g.matched) return;
      g.rank = r; g.letter = String.fromCharCode(65 + (r % 26));
      const box = ghostBox(r, g.d.capabilities.length);
      const fresh = g.tw.b.w === 0;
      if (fresh) g.tw = still(box); else retarget(g.tw, box, now, 1.2);
      g.caps = g.d.capabilities.map((c, j) => {
        const old = g.caps.find((x) => x.id === c.id), cb = capBox(box, j);
        if (!old) return { id: c.id, name: c.name, tw: still(cb), fadeT: INF };
        old.name = c.name; if (!fresh) retarget(old.tw, cb, now, 1.2);
        return old;
      });
    });
  }
  function onOutline(e: Extract<BuildupEvent, { type: 'outline' }>) {
    anti = true;
    const now = T;
    const named: string[] = [];
    for (const d of e.domains) {
      if (M.wings.some((w) => w.id === d.id)) continue; // the wing itself is already standing
      const g = ghosts.get(d.id);
      if (g) g.d = d;
      else { ghosts.set(d.id, { d, rank: 0, letter: '', appearT: now + .1 + named.length * .3, fadeT: INF, matched: false, tw: still({ x: 0, y: 0, w: 0, h: 0 }), caps: [] }); named.push(d.id); }
    }
    layoutGhosts(now);
    setExtTarget();
    for (const id of named) {
      const g = ghosts.get(id); if (!g) continue;
      log(now, `<b>04 Product tree</b> · wing ${esc(g.letter)} named · ${esc(g.d.name)} · ${g.d.capabilities.length} capabilities pencilled`, !phaseDone.has('product-tree'));
    }
  }
  function onActivity(e: Extract<BuildupEvent, { type: 'activity' }>) {
    anti = true;
    const now = T;
    if (act && act.area === e.area) { act.path = e.path; act.verb = e.verb; act.last = now; return; }
    actPrev = act; act = { area: e.area, path: e.path, verb: e.verb, t0: now, last: now };
  }
  /** how lit a lot is by the agent's reading: the current lot fades in, the one before fades out (never a jump) */
  function actW(id: string, t: number) {
    if (!act) return 0;
    const u = RMODE ? 1 : smooth(clamp((t - act.t0) / .9));
    if (act.area === id) return u;
    if (actPrev && actPrev.area === id) return 1 - u;
    return 0;
  }
  function onProgress(e: Extract<BuildupEvent, { type: 'progress' }>) {
    anti = true;
    if (e.phase === 'judge') prog.push({ t: Math.max(T, S.Q), n: e.n, of: e.of });
  }
  const progAt = (t: number) => { let p: (typeof prog)[number] | null = null; for (const x of prog) if (x.t <= t) p = x; return p; };

  function onPhase(e: Extract<BuildupEvent, { type: 'phase' }>) {
    const now = T, i = PHASES.indexOf(e.phase), st = S.steps[i];
    if (e.state === 'start') phaseOn.add(e.phase); else phaseDone.add(e.phase);
    if (e.state !== 'start') cancelIdle(now);
    let vt = Math.max(now, S.Q);
    if (e.state === 'start') {
      st.t0 = Math.min(st.t0, vt);
      const msg: Partial<Record<Phase, [string, boolean]>> = {
        check: [`looking for bp artifacts in ${esc(projectName)}`, false],
        'context-map': ['partitioning the code into contexts', false],
        seed: ['reading the code tree', false],
        'product-tree': ['the model is naming domains, capabilities and features', true],
        events: ['reading git history', true],
        measure: ['static metrics per feature', false],
        judge: ['the model is reading each feature through the lenses', true],
        register: [`${esc(projectName)} enters bp`, false],
      };
      const m = msg[e.phase];
      if (m) log(vt, `<b>${STEPS[i].n} ${STEPS[i].name}</b> · ${m[0]}`, m[1]);
      if (e.phase === 'measure') { measureOn = true; S.sweeps.push({ t0: vt + .1, t1: vt + SWEEP }); S.Q = Math.max(S.Q, vt + SWEEP); }
      if (e.phase === 'judge') addKey({ t: vt, k: 'ext', th: TH_OV - .06, ph: PH_OV, zTop: H_WING, frac: .97 });
    } else if (e.state === 'done') {
      if (e.phase === 'measure') { measureOn = false; const l = S.sweeps[S.sweeps.length - 1]; if (l) { vt = Math.max(vt, l.t1); S.Q = Math.max(S.Q, l.t1); } }
      if (st.t0 === INF) st.t0 = vt;
      st.t1 = vt;
      // a domain the tree named but did not keep fades with the step
      if (e.phase === 'product-tree' && ghosts.size) { for (const g of ghosts.values()) if (!g.matched && g.fadeT === INF) { g.fadeT = vt; for (const cp of g.caps) cp.fadeT = vt; } setExtTarget(); }
      if (e.detail && e.phase !== 'register') log(vt, `<b>${STEPS[i].n} ${STEPS[i].name}</b> · ${esc(e.detail)}`);
    } else {
      st.failed = true; if (st.t0 === INF) st.t0 = vt; st.t1 = vt;
    }
  }

  function onDone() {
    const now = T;
    cancelIdle(now);
    // a run that sent no history still has to show its stages before it stands
    let c = Math.max(now, S.Q);
    const unstamped = M.hist.filter((x) => x.stageT === INF);
    unstamped.forEach((tl, k) => { tl.stageT = c + k * .02; });
    if (unstamped.length) c += .6 + unstamped.length * .02;
    for (const st of S.steps) { if (st.t0 === INF) st.t0 = c; if (st.t1 === INF) st.t1 = c; }
    const R0 = c + (opts.kind === 'preset-demo' ? .3 : 1.2);
    ov(R0, TH_OV - .06, PH_OV);
    S.R0 = R0; S.end = R0 + 3.4;
    S.steps[7].t1 = S.end;
    addKey({ t: S.end, k: 'final', ease: 'flat' });
  }

  function reset(e: Extract<BuildupEvent, { type: 'begin' }>) {
    M = new Model(e.project.name, e.project.slug);
    projectName = e.project.name;
    S = freshSchedule();
    beginExt = e.extent && e.extent.w > 0 ? e.extent : null;
    lots.clear(); ghosts.clear(); bandGone = false;
    begun = false; setExtTarget(); begun = true;
    phaseOn.clear(); phaseDone.clear(); measureOn = false;
    act = actPrev = null; prog = []; anti = false; lampA = 0;
    T = 0; phase = 'build'; userTh = 0; userPh = 0; userZ = 1; liveCam = null; liveMoved = false; raise = raiseTarget = 0; tween = null; level = 0;
    hover = null; sel = null; showDetail(); $('tip').hidden = true; closeFind();
    root.classList.remove(css.live);
    ov(0);
    $('pname').textContent = M.name;
    buildStrip();
    dirty = true; lastHud = {};
    requestAnimationFrame(placeFloaters);
  }

  function feed(e: BuildupEvent) {
    if (e.type === 'begin') { reset(e); return; }
    if (!begun) return;
    switch (e.type) {
      case 'phase': onPhase(e); break;
      case 'structure': onStructure(e); break;
      case 'history': onHistory(e); break;
      case 'health': onHealth(e); break;
      case 'survey': onSurvey(e); break;
      case 'outline': onOutline(e); break;
      case 'activity': onActivity(e); break;
      case 'progress': onProgress(e); break;
      case 'done': onDone(); break;
      case 'failed': {
        S.failed = `${STEPS[PHASES.indexOf(e.phase)].n} ${STEPS[PHASES.indexOf(e.phase)].name} failed: ${e.message}`;
        const st = S.steps[PHASES.indexOf(e.phase)]; st.failed = true; if (st.t0 === INF) st.t0 = T; st.t1 = T;
        break;
      }
    }
    dirty = true;
  }

  /* ---------- camera ---------- */
  function fitCam(box: BBox, th: number, ph: number, zTop: number, frac: number, maxZ: number | null, P = PAD_BUILD): Cam {
    const c = Math.cos(th), s = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    let x0 = INF, x1 = -INF, y0 = INF, y1 = -INF;
    for (const [x, y] of [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]) for (const z of [0, zTop]) {
      const dx = x - cx, dy = y - cy, rx = dx * c - dy * s, ry = dx * s + dy * c, Y = ry * cp - z * sp;
      x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    }
    const aw = Math.max(60, vw - P.l - P.r), ah = Math.max(60, vh - P.t - P.b);
    let zoom = Math.min(aw / Math.max(1, x1 - x0), ah / Math.max(1, y1 - y0)) * frac;
    if (maxZ != null) zoom = Math.min(zoom, maxZ);
    return { cx, cy, zoom, th, ph, ox: P.l + aw / 2 - vw / 2 - zoom * (x0 + x1) / 2, oy: P.t + ah / 2 - vh / 2 - zoom * (y0 + y1) / 2 };
  }
  function finalCam(): Cam {
    const E = extD;
    let c = fitCam(E, 0, 0, 0, 1, 2, PAD_FINAL);
    if (vw < 760) return c;
    const lw = 172, lh = Math.min(300, vh * .5), y1 = vh - PAD_FINAL.b + 4, y0 = y1 - lh;
    const wx = (s: number) => (s - vw / 2 - c.ox) / c.zoom + c.cx, wy = (s: number) => (s - vh / 2 - c.oy) / c.zoom + c.cy;
    const hit = M.wings.some((w) => w.box.x < wx(lw) && w.box.y + w.box.h > wy(y0));
    if (hit) c = fitCam(E, 0, 0, 0, 1, 2, { ...PAD_FINAL, l: lw + 12, r: Math.max(PAD_FINAL.r, 40) });
    return c;
  }
  function camKey(k: Key): Cam {
    switch (k.k) {
      case 'final': return finalCam();
      case 'cam': return k.cam;
      case 'ext': return fitCam(extD, k.th, k.ph, k.zTop, k.frac, k.maxZ ? dollyZ() : null);
      case 'box': return fitCam(k.box, k.th, k.ph, k.zTop, k.frac, k.maxZ ? dollyZ() : null);
    }
  }
  function lerpCam(a: Cam, b: Cam, e: number): Cam {
    return {
      cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, th: a.th + (b.th - a.th) * e, ph: a.ph + (b.ph - a.ph) * e,
      ox: a.ox + (b.ox - a.ox) * e, oy: a.oy + (b.oy - a.oy) * e, zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * e),
    };
  }
  function camAt(t: number): Cam {
    const K = S.keys; if (!K.length) return fitCam(extD, TH_OV, PH_OV, H_WING, .97, null);
    if (t <= K[0].t) return camKey(K[0]);
    for (let i = 0; i < K.length - 1; i++) {
      const a = K[i], b = K[i + 1];
      if (t <= b.t) {
        const u = clamp((t - a.t) / Math.max(1e-6, b.t - a.t));
        const e = b.ease === 'mix' ? .45 * u + .55 * smooth(u) : b.ease === 'flat' ? 1 - Math.pow(1 - smooth(u), 1.6) : smooth(u);
        return lerpCam(camKey(a), camKey(b), e);
      }
    }
    return camKey(K[K.length - 1]);
  }
  function proj(x: number, y: number, z: number): [number, number] {
    const dx = x - V.cx, dy = y - V.cy, c = Math.cos(V.th), s = Math.sin(V.th);
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    return [vw / 2 + V.ox + V.zoom * rx, vh / 2 + V.oy + V.zoom * (ry * Math.cos(V.ph) - z * Math.sin(V.ph))];
  }
  function floorT(z: number) { // the plane at height z is an affine image of the plan: draw plan geometry straight through it
    const c = Math.cos(V.th), s = Math.sin(V.th), cp = Math.cos(V.ph), sp = Math.sin(V.ph), k = V.zoom;
    const a = k * c, b = k * cp * s, cc = -k * s, d = k * cp * c;
    const e = vw / 2 + V.ox - (a * V.cx + cc * V.cy), f = vh / 2 + V.oy - (b * V.cx + d * V.cy) - k * z * sp;
    ctx.setTransform(dpr * a, dpr * b, dpr * cc, dpr * d, dpr * e, dpr * f);
  }
  function unproj(sx: number, sy: number, z: number): [number, number] {
    const c = Math.cos(V.th), s = Math.sin(V.th), cp = Math.max(1e-3, Math.cos(V.ph)), sp = Math.sin(V.ph), k = V.zoom;
    const rx = (sx - vw / 2 - V.ox) / k, ry = ((sy - vh / 2 - V.oy) / k + z * sp) / cp;
    return [rx * c + ry * s + V.cx, -rx * s + ry * c + V.cy];
  }
  const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const isLive = () => phase === 'live';
  function flatAt(t: number) { return S.R0 === INF ? 0 : smooth(clamp((t - S.R0) / (S.end - S.R0))); }
  function computeView(t: number) {
    if (phase === 'live' && liveCam) {
      Object.assign(V, liveCam);
      const e = smooth(raise); V.th = 0.3 * e; V.ph = 0.95 * e; V.ws = e; V.flat = 1 - e; return;
    }
    if (RMODE) { Object.assign(V, finalCam()); V.ws = 0; V.flat = 1; return; }
    const c = camAt(t), fl = flatAt(t);
    Object.assign(V, c);
    const orbit = ORBIT * Math.sin(t * .21);
    V.zoom = c.zoom * Math.pow(userZ, 1 - fl);
    V.th = c.th + (orbit + userTh) * (1 - fl);
    V.ph = clamp(c.ph + userPh * (1 - fl), 0, 1.2);
    V.ws = S.R0 === INF ? 1 : 1 - smooth(clamp((t - S.R0) / ((S.end - S.R0) * .8)));
    V.flat = fl;
  }
  const dropP = (tl: Tile, t: number) => isLive() ? 1 : clamp((t - tl.dropT) / .55);
  const stageP = (tl: Tile, t: number) => isLive() && tl.stageT < INF ? 1 : clamp((t - tl.stageT) / .5);
  const healthP = (tl: Tile, t: number) => isLive() && tl.healthT < INF ? 1 : clamp((t - tl.healthT) / .5);
  function wingWallH(w: Wing, t: number, frac = 0) {
    if (isLive()) return H_WING * V.ws;
    if (RMODE) return 0;
    return H_WING * backOut(clamp((t - w.wallT - frac * .24) / .85)) * V.ws;
  }
  function roomWallH(r: Room, t: number) { if (isLive()) return H_ROOM * V.ws; if (RMODE) return 0; return H_ROOM * backOut(clamp((t - r.riseT) / .6)) * V.ws; }

  /* ---------- drawing: plan primitives (world units, any affine plane) ---------- */
  function hatch(g: Ctx, x: number, y: number, w: number, h: number, step: number, dir: number, k: number, a: number) {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.beginPath();
    for (let s = -h; s < w; s += step) { if (dir > 0) { g.moveTo(x + s, y + h); g.lineTo(x + s + h, y); } else { g.moveTo(x + s, y); g.lineTo(x + s + h, y + h); } }
    g.strokeStyle = hexA(C.ink, a); g.lineWidth = k; g.stroke(); g.restore();
  }
  function stagePattern(g: Ctx, st: Stage | null, x: number, y: number, w: number, h: number, k: number) {
    const ol = (a: number, lwm = 1) => { g.strokeStyle = hexA(C.ink, a); g.lineWidth = k * lwm; g.strokeRect(x + k / 2, y + k / 2, w - k, h - k); g.setLineDash([]); };
    g.setLineDash([]);
    switch (st) {
      case 'live': g.fillStyle = hexA(C.ink, .22); g.fillRect(x, y, w, h); ol(.34); break;
      case 'flagged': g.fillStyle = hexA(C.ink, .22); g.fillRect(x, y, w * .5, h); g.setLineDash([4 * k, 3 * k]); ol(.62); break;
      case 'in-review': hatch(g, x, y, w, h, 12, 1, k, .32); hatch(g, x, y, w, h, 12, -1, k, .32); ol(.34); break;
      case 'in-dev': hatch(g, x, y, w, h, 10, 1, k, .34); ol(.34);
        g.fillStyle = hexA(C.ink, .14); g.fillRect(x + 5, y + 5, w - 10, 4); g.fillStyle = hexA(C.ink, .5); g.fillRect(x + 5, y + 5, 4, 4); break;
      case 'specified': g.setLineDash([5 * k, 3 * k]); ol(.66); break;
      case 'idea': g.lineCap = 'round'; g.setLineDash([1.5 * k, 2.5 * k]); ol(.8, 1.4); g.lineCap = 'butt'; break;
      case 'deprecated': g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + w - 4, y + h - 4); g.moveTo(x + w - 4, y + 4); g.lineTo(x + 4, y + h - 4);
        g.strokeStyle = hexA(C.ink, .46); g.lineWidth = k; g.stroke(); ol(.3); break;
      default: g.setLineDash([2 * k, 4 * k]); ol(.4); break;
    }
  }
  const healthCol = (h: Health | null) => h === 'good' ? hexA(C.ink, .62) : h === 'watch' ? C.amber : h === 'bad' ? C.red : hexA(C.ink, .12);

  /* ---------- drawing: layers ---------- */
  function sheetBox() { const e = extD; return { x0: e.x - 120, y0: e.y - 190, x1: e.x + e.w + 120, y1: e.y + e.h + 120 }; }
  function drawSheet(t: number) {
    const a = isLive() ? 1 : clamp(t / .35);
    if (a <= 0) return;
    const { x0, y0, x1, y1 } = sheetBox();
    ctx.globalAlpha = a;
    if (Math.sin(V.ph) > .01) { // the light table's body
      screen();
      const s = Math.sin(V.th), c = Math.cos(V.th), D = 40;
      for (const [ax, ay, bx, by, nx, ny] of [[x0, y0, x1, y0, 0, -1], [x1, y0, x1, y1, 1, 0], [x1, y1, x0, y1, 0, 1], [x0, y1, x0, y0, -1, 0]]) {
        if (nx * s + ny * c <= 0) continue;
        const p = [proj(ax, ay, 0), proj(bx, by, 0), proj(bx, by, -D), proj(ax, ay, -D)];
        ctx.beginPath(); p.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath();
        ctx.fillStyle = hexA(C.glow, ny ? .2 : .12); ctx.fill(); ctx.strokeStyle = hexA(C['glass-edge'], .3); ctx.lineWidth = 1; ctx.stroke();
      }
    }
    floorT(0);
    const k = 1 / V.zoom;
    const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, C['sheet-a']); g.addColorStop(1, C['sheet-c']);
    ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.beginPath();
    for (let x = Math.ceil(x0 / 40) * 40; x <= x1; x += 40) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.ceil(y0 / 40) * 40; y <= y1; y += 40) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.strokeStyle = C.grid; ctx.lineWidth = k; ctx.stroke();
    ctx.beginPath();
    for (let x = Math.ceil(x0 / 200) * 200; x <= x1; x += 200) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.ceil(y0 / 200) * 200; y <= y1; y += 200) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.strokeStyle = hexA(C.accent, .07); ctx.stroke();
    ctx.strokeStyle = hexA(C.rim, .5); ctx.lineWidth = 3 * k; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = hexA(C.glow, .35); ctx.lineWidth = k; ctx.strokeRect(x0 + 10, y0 + 10, x1 - x0 - 20, y1 - y0 - 20);
    ctx.globalAlpha = 1;
  }
  /* ---------- drawing: the site survey (lots, pencilled wings, the agent's reading, the lamp) ---------- */
  const siteFade = (t: number) => (S.R0 === INF ? 1 : 1 - smooth(clamp((t - S.R0) / ((S.end - S.R0) * .6))));
  const sitePens: [number, number][] = [];
  function drawSite(t: number) {
    sitePens.length = 0;
    if (isLive() || (!lots.size && !ghosts.size)) return;
    const F = siteFade(t); if (F <= 0) return;
    const k = 1 / V.zoom, band = M.wings.length > 0;
    const breathe = RMODE ? .5 : .5 + .5 * Math.sin(t * Math.PI * 2 / 3.6);
    floorT(0);
    // lots: the code areas chalked on the table, dashed, a pen tracing each one as it is surveyed
    for (const l of orderLots([...lots.values()])) {
      const p = RMODE ? (t >= l.chalkT ? 1 : 0) : clamp((t - l.chalkT) / .8); if (p <= 0) continue;
      const r = rectAt(l.tw, t, RMODE), aw = actW(l.id, t);
      ctx.globalAlpha = F;
      ctx.fillStyle = hexA(C.ink, (band ? .045 : .06) * Math.min(1, p * 1.6)); ctx.fillRect(r.x, r.y, r.w, r.h);
      if (aw > 0) { ctx.fillStyle = hexA(C.accent, (.07 + .09 * breathe) * aw); ctx.fillRect(r.x, r.y, r.w, r.h); }
      ctx.beginPath();
      if (p < 1) sitePens.push(perimPartial(r.x, r.y, r.w, r.h, p)); else ctx.rect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([7 * k, 4 * k]); ctx.strokeStyle = hexA(C.ink, band ? .3 : .42); ctx.lineWidth = 1.1 * k; ctx.stroke(); ctx.setLineDash([]);
      if (aw > 0) { ctx.strokeStyle = hexA(C.accent, .85 * aw); ctx.lineWidth = 1.8 * k; ctx.strokeRect(r.x, r.y, r.w, r.h); }
    }
    // ghosts: the named wings pencilled over the lots, their capabilities as room plates
    for (const g of ghosts.values()) {
      const p = RMODE ? (t >= g.appearT ? 1 : 0) : clamp((t - g.appearT) / 1.0); if (p <= 0) continue;
      const a = F * (g.fadeT === INF ? 1 : 1 - clamp((t - g.fadeT) / .7)); if (a <= 0) continue;
      const r = rectAt(g.tw, t, RMODE);
      ctx.globalAlpha = a;
      ctx.fillStyle = hexA(C['paper-hi'], .06 * p); ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.beginPath();
      if (p < 1) sitePens.push(perimPartial(r.x, r.y, r.w, r.h, p)); else ctx.rect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([12 * k, 5 * k]); ctx.strokeStyle = hexA(C.ink, .62); ctx.lineWidth = 1.5 * k; ctx.stroke();
      g.caps.forEach((cp, j) => {
        const q = RMODE ? p : clamp((t - g.appearT - .5 - j * .12) / .5); if (q <= 0) return;
        const ca = a * q * (cp.fadeT === INF ? 1 : 1 - clamp((t - cp.fadeT) / .5)); if (ca <= 0) return;
        const cr = rectAt(cp.tw, t, RMODE);
        ctx.globalAlpha = ca; ctx.setLineDash([4 * k, 4 * k]); ctx.strokeStyle = hexA(C.ink, .42); ctx.lineWidth = k;
        ctx.strokeRect(cr.x + 8, cr.y + 8, cr.w - 16, cr.h - 16);
      });
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
  function lampWant(t: number) {
    if (!anti || RMODE || isLive() || measureOn || t >= S.R0 || t < S.Q + .4) return 0;
    return (['context-map', 'seed', 'product-tree', 'judge'] as Phase[]).some((ph) => phaseOn.has(ph) && !phaseDone.has(ph)) ? 1 : 0;
  }
  /** The survey lamp: while a long step runs and nothing is landing, a slow line of light crosses the table, and the
   *  features it passes that nobody has judged yet catch it. It says "working", never "how far". */
  function drawLamp(t: number) {
    if (lampA < .01 || isLive() || RMODE) return;
    const P = 16, u = (t % P) / P, env = Math.sin(Math.PI * u) * lampA;
    if (env < .01) return;
    const e = extD, x = e.x - 60 + (e.w + 120) * u, k = 1 / V.zoom, y0 = e.y - 60, y1 = e.y + e.h + 60;
    floorT(0);
    const g = ctx.createLinearGradient(x - 110, 0, x, 0); g.addColorStop(0, hexA(C.accent, 0)); g.addColorStop(1, hexA(C.accent, .08 * env));
    ctx.fillStyle = g; ctx.fillRect(x - 110, y0, 110, y1 - y0);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.strokeStyle = hexA(C.accent, .5 * env); ctx.lineWidth = 1.4 * k; ctx.stroke();
    if (!(phaseOn.has('judge') && !phaseDone.has('judge'))) return;
    floorT(H_SLAB * V.ws);
    for (const tl of M.tiles) {
      if (dropP(tl, t) < 1 || t >= tl.healthT) continue;
      const d = Math.abs(tl.box.x + tl.box.w / 2 - x); if (d > 120) continue;
      ctx.strokeStyle = hexA(C.accent, .6 * env * (1 - d / 120)); ctx.lineWidth = 1.6 * k;
      ctx.strokeRect(tl.box.x - 2 * k, tl.box.y - 2 * k, tl.box.w + 4 * k, tl.box.h + 4 * k);
    }
  }
  function pencilBubble(x: number, y: number, letter: string) {
    ctx.beginPath(); ctx.arc(x, y, 10.5, 0, Math.PI * 2);
    ctx.fillStyle = hexA(C.paper, .75); ctx.fill(); ctx.setLineDash([2.5, 2.5]); ctx.strokeStyle = C['ink-2']; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    font(`600 12px ${FM}`); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C['ink-2']; ctx.fillText(letter, x, y + .5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function actTag(a: Act, alpha: number, t: number) {
    if (!a.area || alpha <= .01) return;
    const l = lots.get(a.area); if (!l || t < l.chalkT) return;
    const r = rectAt(l.tw, t, RMODE), P = proj(r.x, r.y, 0);
    const ago = t - a.last > 15 ? ` · ${fmt(t - a.last)} ago` : '';
    font(`600 12px ${FM}`, '0.03em');
    const txt = ell(`${VERB[a.verb]} ${a.path}${ago}`, 420), tw = ctx.measureText(txt).width;
    let x = clamp(P[0], 8, vw - tw - 20);
    const y = clamp(P[1] - 24, 8, vh - 30);
    // keep clear of the legend card (DOM, over the canvas)
    const lg = $('legend');
    if (lg.classList.contains(css.on)) { const rr = lg.getBoundingClientRect(), r0 = root.getBoundingClientRect(), lx = rr.right - r0.left, ly = rr.top - r0.top; if (x < lx + 8 && y + 19 > ly) x = lx + 12; }
    ctx.globalAlpha = alpha * siteFade(t);
    ctx.fillStyle = C.accent; ctx.fillRect(x, y, tw + 12, 19);
    ctx.fillStyle = C['on-ink']; ctx.textBaseline = 'top'; ctx.fillText(txt, x + 6, y + 4); ctx.textBaseline = 'alphabetic';
    if (hasLS) ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
  }
  function drawSiteLabels(t: number) {
    if (isLive() || (!lots.size && !ghosts.size)) return;
    const F = siteFade(t); if (F <= 0) return;
    screen();
    const span = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    // lot names and what is known of them: files, then lines and the first and last commit
    const under = [...ghosts.values()].some((g) => t >= g.appearT && g.fadeT === INF) ? .5 : 1;
    if (!M.wings.length) for (const l of lots.values()) {
      const p = RMODE ? (t >= l.chalkT ? 1 : 0) : clamp((t - l.chalkT - .4) / .5); if (p <= 0) continue;
      const r = rectAt(l.tw, t, RMODE);
      const P = proj(r.x + 8, r.y + 8, 0), Q = proj(r.x + r.w - 8, r.y + 8, 0), H = proj(r.x + 8, r.y + r.h - 8, 0);
      const wpx = span(P, Q), hpx = span(P, H); if (wpx < 84 || hpx < 34) continue;
      ctx.globalAlpha = F * p * under; ctx.textBaseline = 'top';
      font(`600 12px ${FS}`, '0.06em'); halo(ell(l.name.toUpperCase(), wpx), P[0], P[1], C['ink-2'], 3);
      font(`500 12px ${FM}`);
      const stat = l.lines != null ? `${nf(l.lines)} lines · ${l.files} files` : `${l.files} file${l.files === 1 ? '' : 's'}`;
      halo(ell(stat, wpx), P[0], P[1] + 16, C['ink-2'], 3);
      if (under === 1 && hpx > 56 && l.first && l.last) halo(ell(`commits ${l.first.slice(5)} → ${l.last.slice(5)}`, wpx), P[0], P[1] + 32, C['ink-3'], 3);
    }
    if (hasLS) ctx.letterSpacing = '0px';
    // ghost wings: a pencilled bubble and name where the wing will stand, their capabilities as pencilled plates
    for (const g of ghosts.values()) {
      const p = RMODE ? (t >= g.appearT ? 1 : 0) : clamp((t - g.appearT - .3) / .5); if (p <= 0) continue;
      const a = F * p * (g.fadeT === INF ? 1 : 1 - clamp((t - g.fadeT + .3) / .5)); if (a <= 0) continue;
      const r = rectAt(g.tw, t, RMODE), P = proj(r.x, r.y, 0), Q = proj(r.x + r.w, r.y, 0);
      const width = Math.max(60, span(P, Q) - 6);
      ctx.globalAlpha = a; ctx.textBaseline = 'alphabetic';
      font(`500 12px ${FS}`);
      halo(ell(`${g.d.capabilities.length} capabilities · pencilled`, width), P[0], P[1] - 15, C['ink-3'], 3);
      font(`600 14px ${FS}`, '0.07em');
      const nm = ell(g.d.name.toUpperCase(), width - 28);
      pencilBubble(P[0] + 10.5, P[1] - 37, g.letter);
      ctx.globalAlpha = a; font(`600 14px ${FS}`, '0.07em');
      halo(nm, P[0] + 26, P[1] - 32, C['ink-2'], 3);
      if (hasLS) ctx.letterSpacing = '0px';
      g.caps.forEach((cp, j) => {
        const q = RMODE ? 1 : clamp((t - g.appearT - .7 - j * .12) / .5); if (q <= 0) return;
        const ca = a * q * (cp.fadeT === INF ? 1 : 1 - clamp((t - cp.fadeT) / .4)); if (ca <= 0) return;
        const cr = rectAt(cp.tw, t, RMODE);
        const A = proj(cr.x + 18, cr.y + 18, 0), B = proj(cr.x + cr.w - 18, cr.y + 18, 0), D = proj(cr.x + 18, cr.y + cr.h - 18, 0);
        const maxW = Math.min(span(A, B) - 8, 260); if (maxW < 56 || span(A, D) < 30) return;
        font(`600 12px ${FS}`, '0.07em'); ctx.globalAlpha = ca; ctx.textBaseline = 'top';
        wrap2(cp.name.toUpperCase(), maxW).forEach((ln, i) => halo(ln, A[0], A[1] + i * 15, C['ink-2'], 3));
        ctx.textBaseline = 'alphabetic';
        if (hasLS) ctx.letterSpacing = '0px';
      });
    }
    ctx.globalAlpha = 1;
    // the pencils surveying lots and ghost wings
    for (const tip of sitePens) { const q = proj(tip[0], tip[1], 0); ctx.beginPath(); ctx.arc(q[0], q[1], 3, 0, Math.PI * 2); ctx.fillStyle = C['ink-hi']; ctx.fill(); ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, Math.PI * 2); ctx.fillStyle = hexA(C.accent, .25); ctx.fill(); }
  }
  /** now reading: the lot the agent is in, tagged with the path (over every other label) */
  function drawActTags(t: number) {
    if (isLive() || !lots.size || siteFade(t) <= 0) return;
    screen();
    if (act) {
      const u = RMODE ? 1 : smooth(clamp((t - act.t0) / .9));
      if (actPrev && actPrev.area !== act.area) actTag(actPrev, 1 - u, t);
      actTag(act, u, t);
    }
  }

  /** where the grid bubbles stand: under the plan's front edge (the footing strip, when there is one, lies beyond) */
  function gridFoot() { const k = lots.size ? M.known() : null; return k ? k.y + k.h + 76 : extD.y + extD.h + 76; }
  function gridAxisAlpha() { return isLive() ? 0 : (1 - V.flat) * (RMODE ? 0 : 1); }
  function axes(): [number, number][] {
    const xs: [number, number][] = M.wings.map((w) => [w.box.x, w.axisT]);
    const lastW = M.wings[M.wings.length - 1];
    if (lastW) xs.push([extD.x + extD.w, Math.max(...M.wings.map((w) => w.axisT)) + .07]);
    return xs;
  }
  function drawGridAxes(t: number) {
    const A = gridAxisAlpha(); if (A <= .01) return;
    const e = extD, ya = e.y - 150, yb = gridFoot(), k = 1 / V.zoom;
    floorT(0);
    ctx.setLineDash([16 * k, 5 * k, 3 * k, 5 * k]); ctx.lineWidth = k; ctx.strokeStyle = hexA(C.accent, .5 * A);
    ctx.beginPath();
    for (const [x, t0] of axes()) { const p = easeOut(clamp((t - t0) / .6)); if (p <= 0) continue; ctx.moveTo(x, ya); ctx.lineTo(x, ya + (yb - ya) * p); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  function perimPartial(x: number, y: number, w: number, h: number, p: number): [number, number] {
    const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    let L = 2 * (w + h) * p; ctx.moveTo(x, y); let tip: [number, number] = [x, y];
    for (let i = 1; i < pts.length && L > 0; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay), u = Math.min(1, L / d);
      tip = [ax + (bx - ax) * u, ay + (by - ay) * u]; ctx.lineTo(tip[0], tip[1]); L -= d;
    }
    return tip;
  }
  const pens: [number, number][] = [];
  function drawFloors(t: number) {
    const k = 1 / V.zoom; pens.length = 0;
    floorT(0);
    for (const w of M.wings) {
      const p = isLive() ? 1 : clamp((t - w.footT) / .7); if (p <= 0) continue;
      const { x, y, w: ww, h } = w.box;
      const fill = isLive() ? 1 : clamp((t - w.wallT) / .8);
      if (fill > 0) { ctx.fillStyle = hexA(C['paper-mid'], .5 * fill); ctx.fillRect(x, y, ww, h); }
      ctx.beginPath();
      if (p < 1 && !RMODE) {
        const tip = perimPartial(x, y, ww, h, p); pens.push(tip);
        ctx.setLineDash([9 * k, 5 * k]); ctx.strokeStyle = hexA(C.accent, .9); ctx.lineWidth = 1.5 * k; ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.rect(x, y, ww, h);
        ctx.strokeStyle = RMODE && !isLive() ? hexA(C['glass-edge'], p) : C['glass-edge']; ctx.lineWidth = 2.2 * k; ctx.stroke();
      }
    }
    for (const r of M.rooms) {
      const q = isLive() ? 1 : clamp((t - r.riseT) / .5); if (q <= 0) continue;
      const { x, y, w, h } = r.box;
      ctx.fillStyle = hexA(C['paper-hi'], .09 * q); ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    }
    ctx.beginPath();
    for (const wl of M.walls) if (wl.type === 'room') { const q = isLive() ? 1 : clamp((t - (wl.owner as Room).riseT) / .4); if (q > 0) { ctx.moveTo(wl.x0, wl.y0); ctx.lineTo(wl.x0 + (wl.x1 - wl.x0) * q, wl.y0 + (wl.y1 - wl.y0) * q); } }
    ctx.strokeStyle = C['glass-edge']; ctx.lineWidth = 1.3 * k; ctx.stroke();
    ctx.beginPath();
    for (const b of M.bays) { const q = isLive() ? 1 : easeOut(clamp((t - b.ruleT) / .45)); if (q > 0) { ctx.moveTo(b.box.x, b.box.y); ctx.lineTo(b.box.x + b.box.w * q, b.box.y); } }
    ctx.strokeStyle = hexA(C.ink, .38); ctx.lineWidth = k; ctx.stroke();
  }
  function drawSlab(tl: Tile, t: number, z0: number, a: number) {
    const { x, y, w, h } = tl.box, hs = H_SLAB * V.ws;
    if (hs > .3 && Math.sin(V.ph) > .01) {
      screen();
      const s = Math.sin(V.th), c = Math.cos(V.th);
      for (const [ax, ay, bx, by, nx, ny] of [[x, y + h, x + w, y + h, 0, 1], [x + w, y, x + w, y + h, 1, 0], [x, y, x, y + h, -1, 0], [x, y, x + w, y, 0, -1]]) {
        if (nx * s + ny * c <= 0) continue;
        const p = [proj(ax, ay, z0), proj(bx, by, z0), proj(bx, by, z0 + hs), proj(ax, ay, z0 + hs)];
        ctx.beginPath(); p.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath();
        ctx.fillStyle = hexA(C.glow, (ny ? .3 : .2) * a); ctx.fill();
      }
    }
    floorT(z0 + hs);
    const k = 1 / V.zoom, sp = stageP(tl, t), hp = healthP(tl, t);
    ctx.globalAlpha = a;
    ctx.fillStyle = C['tile-base']; ctx.fillRect(x, y, w, h);
    if (V.ws > .002) { ctx.fillStyle = hexA(C['paper-hi'], .5 * V.ws); ctx.fillRect(x, y, w, h); }
    if (sp < 1) { ctx.strokeStyle = hexA(C.ink, .3 * (1 - sp)); ctx.lineWidth = k; ctx.strokeRect(x, y, w, h); }
    if (sp > 0) { ctx.globalAlpha = a * sp; stagePattern(ctx, tl.stage, x, y, w, h, k); ctx.globalAlpha = a; }
    if (hp > 0) {
      const bw = (w - 10) * easeOut(hp), by = y + h - 9;
      if (tl.pen != null && t < tl.inkT + .5) {
        // pencil: one batch's reading, drawn hollow and hatched, with a pencilled ring round the slab; the final reading
        // inks the bar from the left and the ring is rubbed out
        const col = healthCol(tl.pen), ip = t < tl.inkT ? 0 : easeOut(clamp((t - tl.inkT) / .5));
        ctx.save(); ctx.globalAlpha = a * (1 - ip);
        ctx.strokeStyle = col; ctx.lineWidth = k; ctx.strokeRect(x + 5 + k / 2, by + k / 2, bw - k, 5 - k);
        ctx.beginPath(); ctx.rect(x + 5, by, bw, 5); ctx.clip(); ctx.beginPath();
        for (let q = -5; q < bw; q += 3) { ctx.moveTo(x + 5 + q, by + 5); ctx.lineTo(x + 10 + q, by); }
        ctx.stroke(); ctx.restore();
        ctx.save(); ctx.globalAlpha = a * (1 - ip) * .85; ctx.setLineDash([3 * k, 3 * k]); ctx.strokeStyle = col; ctx.lineWidth = 1.4 * k;
        ctx.strokeRect(x - 4, y - 4, w + 8, h + 8); ctx.restore();
        if (ip > 0) { ctx.fillStyle = healthCol(tl.general); ctx.fillRect(x + 5, by, (w - 10) * ip, 5); }
      } else { ctx.fillStyle = healthCol(gen(tl, t)); ctx.fillRect(x + 5, by, bw, 5); }
    }
    if (!isLive() && !RMODE) {
      const land = clamp((t - tl.dropT - .55) / .5), stamp = sp > 0 && sp < 1 ? 1 - sp : 0, flash = Math.max(land > 0 && land < 1 ? 1 - land : 0, stamp);
      if (flash > 0) { ctx.strokeStyle = hexA(C.accent, .9 * flash); ctx.lineWidth = 2 * k; ctx.strokeRect(x - 1.5 * k, y - 1.5 * k, w + 3 * k, h + 3 * k); }
    }
    if (sel === tl || hover === tl) { ctx.strokeStyle = C.accent; ctx.lineWidth = (sel === tl ? 2.5 : 1.8) * k; ctx.strokeRect(x - 2 * k, y - 2 * k, w + 4 * k, h + 4 * k); }
    ctx.globalAlpha = 1;
  }
  function drawTiles(t: number, airborne: boolean) {
    for (const tl of M.tiles) {
      const p = dropP(tl, t); if (p <= 0) continue;
      const z = RMODE || isLive() ? 0 : 260 * (1 - p * p);
      if ((z > 16) !== airborne) continue;
      drawSlab(tl, t, z, RMODE ? p : Math.min(1, p * 2.5));
    }
  }
  function drawWalls(t: number) {
    if (Math.sin(V.ph) < .01 || V.ws <= .002) return;
    const s = Math.sin(V.th), c = Math.cos(V.th), list: [number, (typeof M.walls)[number], number][] = [];
    for (const wl of M.walls) {
      const h = wl.type === 'wing' ? wingWallH(wl.owner as Wing, t, (wl.mx - wl.owner.box.x) / Math.max(1, wl.owner.box.w)) : roomWallH(wl.owner as Room, t);
      if (h < .5) continue;
      list.push([(wl.mx - V.cx) * s + (wl.my - V.cy) * c, wl, h]);
    }
    list.sort((a, b) => a[0] - b[0]);
    screen(); ctx.lineJoin = 'round';
    for (const [, wl, h] of list) {
      const a = proj(wl.x0, wl.y0, 0), b = proj(wl.x1, wl.y1, 0), q = proj(wl.x1, wl.y1, h), d = proj(wl.x0, wl.y0, h), wing = wl.type === 'wing';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
      ctx.fillStyle = hexA(C.glow, wing ? .12 : .08); ctx.fill();
      ctx.beginPath(); ctx.moveTo(d[0], d[1]); ctx.lineTo(q[0], q[1]);
      ctx.strokeStyle = hexA(C.glow, .22); ctx.lineWidth = wing ? 6 : 4; ctx.stroke();
      ctx.strokeStyle = C['glass-edge']; ctx.lineWidth = wing ? 1.8 : 1.1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(d[0], d[1]); ctx.moveTo(b[0], b[1]); ctx.lineTo(q[0], q[1]);
      ctx.strokeStyle = hexA(C['glass-edge'], .3); ctx.lineWidth = 1; ctx.stroke();
    }
  }
  function drawSweep(t: number) {
    if (isLive() || RMODE) return;
    for (const sw of S.sweeps) {
      if (t < sw.t0 || t > sw.t1) continue;
      const u = smooth((t - sw.t0) / (sw.t1 - sw.t0)), e = extD, x = e.x - 40 + (e.w + 80) * u, H = H_WING * 1.25 * V.ws;
      screen();
      const a = proj(x, e.y - 40, 0), b = proj(x, e.y + e.h + 40, 0), q = proj(x, e.y + e.h + 40, H), d = proj(x, e.y - 40, H);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
      ctx.fillStyle = hexA(C.accent, .1); ctx.fill();
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.strokeStyle = hexA(C.accent, .85); ctx.lineWidth = 2; ctx.stroke();
    }
  }

  /* ---------- labels: screen-aligned, never under 12 px, anchored to projected points ---------- */
  function font(f: string, ls?: string) { ctx.font = f; if (hasLS) ctx.letterSpacing = ls || '0px'; }
  function ell(s: string, maxW: number) {
    if (ctx.measureText(s).width <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
    return lo > 0 ? s.slice(0, lo).trimEnd() + '…' : '';
  }
  function wrap2(s: string, maxW: number) {
    if (ctx.measureText(s).width <= maxW) return [s];
    const words = s.split(' '); let line = '';
    for (let i = 0; i < words.length; i++) {
      const tryL = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(tryL).width > maxW && line) return [line, ell(words.slice(i).join(' '), maxW)];
      line = tryL;
    }
    return [ell(line, maxW)];
  }
  function halo(txt: string, x: number, y: number, col: string, lw = 3) { ctx.lineJoin = 'round'; ctx.strokeStyle = C.halo; ctx.lineWidth = lw; ctx.strokeText(txt, x, y); ctx.fillStyle = col; ctx.fillText(txt, x, y); }
  function bubble(x: number, y: number, letter: string, hot: boolean) {
    ctx.beginPath(); ctx.arc(x, y, 10.5, 0, Math.PI * 2);
    ctx.fillStyle = hot ? C.accent : hexA(C.paper, .9); ctx.fill(); ctx.strokeStyle = hot ? C.accent : C.ink; ctx.lineWidth = 1.4; ctx.stroke();
    font(`600 12px ${FM}`); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = hot ? C['on-ink'] : C.ink; ctx.fillText(letter, x, y + .5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function curRoom(t: number): Room | null { if (isLive() || t > S.steps[3].t1) return null; let c: Room | null = null; for (const r of M.rooms) if (r.riseT <= t && (!c || r.riseT >= c.riseT)) c = r; return c; }
  function wingCounts(w: Wing, t: number) {
    let n = 0, live = 0, bad = 0; const by: Partial<Record<Stage, number>> = {};
    for (const tl of w.tiles) {
      if (dropP(tl, t) > 0) n++;
      if (stageP(tl, t) > 0 && tl.stage) { by[tl.stage] = (by[tl.stage] ?? 0) + 1; if (tl.stage === 'live' || tl.stage === 'flagged') live++; }
      if (healthP(tl, t) > 0 && gen(tl, t) === 'bad') bad++;
    }
    return { n, live, bad, by };
  }
  const BAR_A: Record<Stage, number> = { live: .9, flagged: .65, 'in-review': .5, 'in-dev': .4, specified: .26, idea: .18, deprecated: .1 };
  function drawLabels(t: number) {
    screen(); ctx.textBaseline = 'alphabetic';
    const live = isLive(), cr = curRoom(t), focusW = cr ? cr.wing : null, A = gridAxisAlpha();
    const hv = hover;
    // grid bubbles at the foot of each axis (the column grid of the sheet)
    if (A > .01) {
      const yb = gridFoot();
      for (const w of M.wings) { const p = clamp((t - w.axisT - .4) / .3); if (p <= 0) continue; const q = proj(w.box.x, yb, 0); ctx.globalAlpha = A * p; bubble(q[0], q[1] + 12, w.letter, w === focusW); }
      ctx.globalAlpha = 1;
    }
    // room plates on the floor
    for (const r of M.rooms) {
      const q = live ? 1 : clamp((t - r.riseT) / .4); if (q <= 0) continue;
      const P = proj(r.box.x + 10, r.box.y + 10, 0), Q = proj(r.box.x + r.box.w - 10, r.box.y + 10, 0), H = proj(r.box.x + 10, r.box.y + r.box.h, 0);
      const maxW = Math.min(Math.abs(Q[0] - P[0]) - 8, 260); if (maxW < 56 || Math.abs(H[1] - P[1]) < 30) continue;
      font(`600 12px ${FS}`, '0.07em');
      const lines = wrap2(r.name.toUpperCase(), maxW);
      const wmax = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const hot = r === cr || (sel && sel.room === r) || (hv && (hv === r || ('room' in hv && hv.room === r)));
      ctx.globalAlpha = q;
      ctx.fillStyle = hot ? C.accent : hexA(C['label-bg'], .92); ctx.fillRect(P[0], P[1], wmax + 12, lines.length * 15 + 7);
      ctx.fillStyle = hot ? C['on-ink'] : C.ink; ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, P[0] + 6, P[1] + 4 + i * 15));
      ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
    }
    // bay tags: code, NAME, count
    for (const b of M.bays) {
      const q = live ? 1 : clamp((t - b.ruleT) / .45); if (q <= 0) continue;
      const P = proj(b.box.x + 2, b.box.y + 6, 0), Q = proj(b.box.x + b.box.w, b.box.y, 0), D = proj(b.box.x, b.box.y + 46, 0);
      const wpx = Math.abs(Q[0] - P[0]); if (wpx < 150 || Math.abs(D[1] - P[1]) < 15) continue;
      font(`500 12px ${FM}`, '0.04em'); ctx.textBaseline = 'top'; ctx.globalAlpha = q;
      const txt = ell(`${b.code}  ${b.name.toUpperCase()}  ${b.tiles.length}`, wpx - 6);
      halo(txt, P[0], P[1] + 2, C['ink-2'], 3);
      ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
    }
    // tile names: on slabs you can read (live plan, or the wing being raised)
    font(`500 12px ${FS}`);
    for (const tl of M.tiles) {
      const p = dropP(tl, t); if (p < 1) continue;
      if (!live && tl.wing !== focusW && !(sel === tl)) continue;
      const z = H_SLAB * V.ws, P = proj(tl.box.x + 7, tl.box.y + 7, z), Q = proj(tl.box.x + tl.box.w - 7, tl.box.y + 7, z);
      const wpx = Math.abs(Q[0] - P[0]); if (wpx < 90) continue;
      const size = wpx > 150 ? 14 : wpx > 120 ? 13 : 12;
      font(`${size >= 13 ? 600 : 500} ${size}px ${FS}`);
      const H = Math.abs(proj(tl.box.x, tl.box.y + tl.box.h, z)[1] - proj(tl.box.x, tl.box.y, z)[1]);
      const lines = H > size * 2 + 16 ? wrap2(tl.name, wpx) : [ell(tl.name, wpx)];
      ctx.textBaseline = 'top'; ctx.globalAlpha = live ? 1 : clamp((t - tl.dropT - .5) / .3);
      lines.forEach((l, i) => halo(l, P[0], P[1] + i * (size + 2), C['ink-hi'], 3));
      ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
    }
    // wing labels ride the parapet: bubble + NAME, then counts, then a stage bar
    for (const w of M.wings) {
      const a = live ? 1 : clamp((t - w.footT) / .5); if (a <= 0) continue;
      const hTop = wingWallH(w, t, 0);
      const P = proj(w.box.x, w.box.y, hTop), Q = proj(w.box.x + w.box.w, w.box.y, hTop);
      const width = Math.max(60, Math.abs(Q[0] - P[0]) - 6);
      const hot = w === focusW || (sel && sel.wing === w) || (hv && (hv === w || ('wing' in hv && hv.wing === w)));
      ctx.globalAlpha = a;
      const cnt = wingCounts(w, t);
      const by = P[1] - 8;
      ctx.fillStyle = hexA(C.ink, .14); ctx.fillRect(P[0], by, width, 3);
      let x = P[0]; const tot = w.tiles.length || 1;
      for (const s of STAGES) { const c = cnt.by[s] ?? 0; if (!c) continue; const ww = width * c / tot; ctx.fillStyle = s === 'deprecated' ? hexA(C.red, .55) : hexA(C.ink, BAR_A[s]); ctx.fillRect(x, by, ww, 3); x += ww; }
      font(`500 12px ${FS}`);
      const left = cnt.n ? `${cnt.n} features${(w.tiles[0] && stageP(w.tiles[0], t) > 0) || cnt.live ? ` · ${cnt.live} live` : ''}` : '';
      const right = cnt.bad ? `${cnt.bad} in trouble` : '';
      const rw = right ? ctx.measureText(right).width : 0;
      if (left) halo(ell(left, width - (rw ? rw + 10 : 0)), P[0], P[1] - 15, C['ink-2'], 3);
      if (right && rw < width * .55) { ctx.textAlign = 'right'; halo(right, P[0] + width, P[1] - 15, C['red-2'], 3); ctx.textAlign = 'left'; }
      let size = 14; font(`600 ${size}px ${FS}`, '0.07em');
      const nm = w.name.toUpperCase(), room = width - 28;
      if (ctx.measureText(nm).width > room) { size = 13; font(`600 ${size}px ${FS}`, '0.05em'); }
      const lines = wrap2(nm, room);
      const top = P[1] - 32 - (lines.length - 1) * 16;
      bubble(P[0] + 10.5, top - 5, w.letter, !!hot);
      ctx.globalAlpha = a;
      font(`600 ${size}px ${FS}`, size === 14 ? '0.07em' : '0.05em');
      lines.forEach((l, i) => halo(l, P[0] + 26, top + i * 16, hot ? C.accent : C['ink-hi'], 3));
      if (hasLS) ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1;
    }
    // pens tracing footprints
    for (const tip of pens) { const q = proj(tip[0], tip[1], 0); ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI * 2); ctx.fillStyle = C['ink-hi']; ctx.fill(); ctx.beginPath(); ctx.arc(q[0], q[1], 9, 0, Math.PI * 2); ctx.fillStyle = hexA(C.accent, .3); ctx.fill(); }
    // inspection rings: a batch's readings land as a ring sweeping over the batch, left to right
    if (!live && !RMODE) for (const tl of M.tiles) {
      if (tl.pen == null) continue; const u = (t - tl.healthT) / 1.3; if (u <= 0 || u >= 1) continue;
      const q = proj(tl.box.x + tl.box.w / 2, tl.box.y + tl.box.h / 2, H_SLAB * V.ws), rr = 8 + 40 * easeOut(u);
      ctx.beginPath(); ctx.ellipse(q[0], q[1], rr, rr * Math.max(.45, Math.cos(V.ph)), 0, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(C.accent, .75 * (1 - u)); ctx.lineWidth = 1.5; ctx.stroke();
    }
    // trouble rings when a bad reading lands (a pencilled one, or a final one that turns a pencilled reading bad)
    if (!live && !RMODE) for (const tl of M.tiles) {
      const rt = (tl.pen ?? tl.general) === 'bad' ? tl.healthT : tl.pen != null && tl.general === 'bad' ? tl.inkT - .3 : INF;
      const u = (t - rt - .3) / 1.1; if (!(u > 0 && u < 1)) continue;
      const q = proj(tl.box.x + tl.box.w / 2, tl.box.y + tl.box.h / 2, H_SLAB * V.ws);
      ctx.beginPath(); ctx.ellipse(q[0], q[1], 10 + 46 * u, (10 + 46 * u) * Math.max(.45, Math.cos(V.ph)), 0, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(C.red, .9 * (1 - u)); ctx.lineWidth = 2; ctx.stroke();
    }
  }

  function draw() {
    const t = isLive() ? S.end : T;
    computeView(t);
    screen();
    ctx.fillStyle = C['paper-lo']; ctx.fillRect(0, 0, vw, vh);
    const g = ctx.createRadialGradient(vw / 2, vh * .48, 0, vw / 2, vh * .48, Math.max(vw, vh) * .75);
    g.addColorStop(0, C.paper); g.addColorStop(1, C['paper-lo']); ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
    drawSheet(t);
    drawSite(t);
    drawGridAxes(t);
    drawFloors(t);
    drawTiles(t, false);
    drawLamp(t);
    drawWalls(t);
    drawTiles(t, true);
    drawSweep(t);
    drawSiteLabels(t);
    drawLabels(t);
    drawActTags(t);
    drawKeyplan(t);
  }

  /* ---------- key plan (wayfinding: where the camera is on the whole sheet) ---------- */
  let KP = { w: 200, h: 80 };
  function sizeKeyplan() {
    const e = ext, w = 200, h = Math.round(clamp(w * e.h / Math.max(1, e.w), 36, 120));
    if (KP.h === h && kp.width === w * dpr) return;
    KP = { w, h };
    kp.width = w * dpr; kp.height = h * dpr; kp.style.width = w + 'px'; kp.style.height = h + 'px';
    placeFloaters();
  }
  const kpMap = () => { const e = extD, s = Math.min((KP.w - 12) / Math.max(1, e.w), (KP.h - 12) / Math.max(1, e.h)); return { e, s, ox: (KP.w - e.w * s) / 2, oy: (KP.h - e.h * s) / 2 }; };
  function drawKeyplan(t: number) {
    const want = !isLive() || level > 0 || liveMoved;
    if (kp.dataset.on !== String(want)) { kp.dataset.on = String(want); kp.style.visibility = $('kpcap').style.visibility = want ? 'visible' : 'hidden'; }
    if (!want || getComputedStyle(kp).display === 'none') return;
    const g = kctx, { e, s, ox, oy } = kpMap();
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, KP.w, KP.h);
    const cr = curRoom(t);
    if (!isLive()) {
      g.globalAlpha = siteFade(t);
      for (const l of lots.values()) { if (t < l.chalkT) continue; const r = rectAt(l.tw, t, RMODE); g.fillStyle = actW(l.id, t) > .5 ? hexA(C.accent, .4) : hexA(C.ink, .07); g.fillRect(ox + (r.x - e.x) * s, oy + (r.y - e.y) * s, Math.max(1, r.w * s - 1), Math.max(1, r.h * s - 1)); }
      g.setLineDash([2, 2]); g.strokeStyle = hexA(C.ink, .45); g.lineWidth = 1;
      for (const gh of ghosts.values()) { if (t < gh.appearT || gh.matched) continue; const r = rectAt(gh.tw, t, RMODE); g.strokeRect(ox + (r.x - e.x) * s + .5, oy + (r.y - e.y) * s + .5, r.w * s - 1, r.h * s - 1); }
      g.setLineDash([]); g.globalAlpha = 1;
    }
    for (const w of M.wings) {
      if (!isLive() && t < w.footT) continue;
      g.fillStyle = (sel && sel.wing === w) || (cr && cr.wing === w) ? hexA(C.accent, .35) : hexA(C.ink, .12);
      g.fillRect(ox + (w.box.x - e.x) * s, oy + (w.box.y - e.y) * s, w.box.w * s - 1, w.box.h * s);
      if (w.box.w * s > 14) { g.font = `600 12px ${FM}`; g.fillStyle = C['ink-2']; g.textBaseline = 'top'; g.fillText(w.letter, ox + (w.box.x - e.x) * s + 3, oy + (w.box.y - e.y) * s + 2); }
    }
    if (!extKnown) { g.strokeStyle = hexA(C.ink, .3); g.setLineDash([3, 3]); g.strokeRect(ox + .5, oy + .5, e.w * s - 1, e.h * s - 1); g.setLineDash([]); }
    if (cr) { g.strokeStyle = C.accent; g.lineWidth = 1.5; g.strokeRect(ox + (cr.box.x - e.x) * s, oy + (cr.box.y - e.y) * s, cr.box.w * s, cr.box.h * s); }
    // viewport footprint on the floor
    const corners = [[0, 0], [vw, 0], [vw, vh], [0, vh]].map(([x, y]) => unproj(x, y, 0));
    g.save(); g.beginPath(); g.rect(0, 0, KP.w, KP.h); g.clip();
    g.beginPath(); corners.forEach(([x, y], i) => { const X = ox + (x - e.x) * s, Y = oy + (y - e.y) * s; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }); g.closePath();
    g.strokeStyle = C['ink-hi']; g.lineWidth = 1.2; g.stroke(); g.restore();
  }

  /* ---------- HUD ---------- */
  let lastHud: Record<string, string> = {};
  const setH = (id: string, html: string) => { if (lastHud[id] !== html) { lastHud[id] = html; $(id).innerHTML = html; } };
  function buildStrip() {
    $('steps').innerHTML = STEPS.map((s, i) => `<div class="${css.step}" data-st="${i}"><div class="${css.top}"><span class="${css.n}">${s.n}</span><span class="${css.nm}">${s.name}</span>${s.llm ? `<span class="${css.llm}">LLM</span>` : ''}</div><div class="${css.y}" data-sy="${i}">${s.y}</div><div class="${css.bar}" data-sb="${i}"></div></div>`).join('');
    lastHud = {};
  }
  const chalked = (t: number) => [...lots.values()].filter((l) => t >= l.chalkT);
  const named = (t: number) => [...ghosts.values()].filter((g) => t >= g.appearT && !g.matched);
  function stepYield(i: number, t: number) {
    const N = M.tiles.length;
    if (i === 1) { const c = chalked(t); if (c.length) return `${c.length} code areas`; }
    if (i === 2) { const c = chalked(t); if (c.length && byLines(c)) return `${nf(c.reduce((q, l) => q + (l.lines ?? 0), 0))} lines`; }
    if (i === 3) { const w = M.wings.filter((x) => t >= x.footT).length, r = M.rooms.filter((x) => t >= x.riseT).length, n = M.tiles.filter((x) => t >= x.dropT).length; const g = named(t).length; return w ? `${w} wings · ${r} rooms · ${n} features` : g ? `${g} wings named` : 'waiting on the model'; }
    if (i === 4) { const s = M.hist.filter((x) => t >= x.stageT); if (!s.length) return M.historyIn && M.dated ? 'history from git' : 'stages'; const l = s[s.length - 1]; return M.dated ? `${l.created ?? ''} · ${s.length}/${N}` : `${s.length}/${N} stamped`; }
    if (i === 6) {
      const j = M.tiles.filter((x) => t >= x.healthT), p = progAt(t);
      const b = p ? `batch ${p.n}/${p.of}` : '';
      return j.length ? `${b ? b + ' · ' : ''}${j.length}/${N} judged · ${j.filter((x) => gen(x, t) === 'bad').length} in trouble` : b ? `${b} · reading` : 'health per feature';
    }
    if (i === 7 && t >= S.end) return 'registered';
    return STEPS[i].y;
  }
  let crumbPath: Node[] = [];
  const nodeName = (p: Node) => p.lvl === 'wing' ? p.letter + ' · ' + p.name : p.lvl === 'room' || p.lvl === 'bay' ? p.code + ' ' + p.name : p.name;
  function hud() {
    const t = isLive() ? S.end : T, live = isLive();
    let n = 0, lv = 0, bb = 0, bad = 0, anyStage = false, anyHealth = false;
    for (const tl of M.tiles) {
      if (t >= tl.dropT) n++;
      if (t >= tl.stageT) { anyStage = true; if (tl.stage === 'live' || tl.stage === 'flagged') lv++; else if (tl.stage === 'in-dev' || tl.stage === 'in-review') bb++; }
      if (t >= tl.healthT) { anyHealth = true; if (gen(tl, t) === 'bad') bad++; }
    }
    const W = M.wings.filter((w) => live || t >= w.footT).length;
    setH('sheetline', `Project ${esc(M.name)} · <b>Drawing set</b> · Sheet G-001 · General arrangement${W ? ` · ${W} wings` : ''}`);
    const cl = n ? [] : chalked(t), gn = n ? 0 : named(t).length;
    const site = cl.length || gn ? [cl.length ? `<b>${cl.length}</b> code areas` : '', cl.length && byLines(cl) ? `<b>${nf(cl.reduce((q, l) => q + (l.lines ?? 0), 0))}</b> lines` : '', gn ? `<b>${gn}</b> wings named` : ''].filter(Boolean).join(' · ') : '';
    setH('psum', n ? `<b>${n}</b> features${anyStage ? ` · <b>${lv}</b> live · <span class="${css.bb}">${bb} being built</span>` : ''}${anyHealth ? ` · <span class="${css.tr}">${bad} in trouble</span>` : ''}` : site || `<span class="${css.mono}" style="font-size:13px">${t < S.steps[3].t0 ? 'reading the repository' : 'drafting'}…</span>`);
    let cr = '';
    const tag = (s: string) => `<span class="${css.tag}">${s}</span>`, sep = `<span class="${css.sep}">›</span>`;
    if (!live) {
      const r = curRoom(t);
      if (S.failed) cr = `${tag('STOPPED')} <span>${esc(S.failed)}</span>`;
      else if (r) cr = `${tag('RAISING')} <span>${esc(r.wing.letter)} · ${esc(r.wing.name)}</span>${sep}<span>${esc(r.code)} ${esc(r.name)}</span>`;
      else if (t < S.steps[3].t0 || M.wings.every((w) => t < w.footT)) {
        const g = named(t).length, c = chalked(t).length;
        cr = g ? `${tag('OUTLINE')} <span>${g} wing${g === 1 ? '' : 's'} named · the model is drawing the plan</span>`
          : c ? `${tag('SURVEY')} <span>${c} code areas chalked</span>` : `${tag('SURVEY')} <span>reading ${esc(M.name)}</span>`;
        if (act && !(act.area && lots.has(act.area))) cr += `${sep}<span>${esc(VERB[act.verb].toLowerCase())} ${esc(act.path)}</span>`;
      }
      else if (t < S.steps[4].t0) cr = `${tag('SHELL')} <span>${M.wings.filter((w) => t >= w.footT).length} wings standing</span>`;
      else if (t < S.steps[5].t0) { const s = M.hist.filter((x) => t >= x.stageT); const l = s[s.length - 1]; cr = `${tag('HISTORY')} ${l ? `<span>${esc(l.created ?? l.wing.letter)}</span>${sep}<span>${esc(l.name)}</span>` : '<span>waiting for git history</span>'}`; }
      else if (t < S.steps[6].t0) cr = `${tag('SURVEY')} <span>measuring every feature</span>`;
      else if (t < S.R0) {
        const w = M.wings.slice().reverse().find((x) => t >= x.healthT), p = progAt(t);
        const b = p ? `<span>batch ${p.n} of ${p.of}</span>${sep}` : '';
        cr = `${tag('INSPECTION')} ${b}<span>${w ? esc(w.letter + ' · ' + w.name) : p ? 'the model is reading the first batch' : 'waiting for the judge'}</span>`;
      }
      else cr = `${tag('PLAN')} <span>looking straight down</span>`;
    } else {
      const f = sel ?? hover;
      const path: Node[] = f ? (f.lvl === 'tile' ? [f.wing, f.room, f.bay, f] : f.lvl === 'room' ? [f.wing, f] : f.lvl === 'wing' ? [f] : []) : [];
      cr = `<button data-go="site">${esc(M.name)} · Site</button>` + path.map((p, i) => `${sep}<button data-go="${i}">${esc(nodeName(p))}</button>`).join('');
      crumbPath = path;
    }
    setH('crumbs', cr);
    if (!live) {
      S.steps.forEach((s, i) => {
        const cls = s.failed && t >= s.t0 ? `${css.step} ${css.fail}` : t >= s.t1 ? `${css.step} ${css.done}` : t >= s.t0 ? `${css.step} ${css.run}` : css.step;
        const el = root.querySelector(`[data-st="${i}"]`) as HTMLElement | null; if (!el) return;
        if (el.className !== cls) el.className = cls;
        const bar = root.querySelector(`[data-sb="${i}"]`) as HTMLElement;
        // nobody knows how long a phase will take, so a running bar is a travelling segment; Judge alone has a real figure
        const running = t >= s.t0 && t < s.t1;
        const N = M.tiles.length;
        const frac = !running ? (t >= s.t1 ? 1 : 0) : i === 6 && N ? M.tiles.filter((x) => t >= x.healthT).length / N : -1;
        const want = frac < 0 ? 'indet' : (100 * frac).toFixed(1) + '%';
        if (bar.dataset.v !== want) {
          bar.dataset.v = want;
          if (frac < 0) { bar.className = `${css.bar} ${css.indet}`; bar.style.width = ''; } else { bar.className = css.bar; bar.style.width = want; }
        }
        const y = stepYield(i, t); if (lastHud['sy' + i] !== y) { lastHud['sy' + i] = y; (root.querySelector(`[data-sy="${i}"]`) as HTMLElement).textContent = y; }
      });
      let L: Log | null = null; for (const l of S.logs) if (l.t <= t) L = l;
      const waiting = L && L.wait ? ` <span class="${css.wait}">· waiting ${fmt(t - L.t)}</span>` : '';
      setH('log', S.failed ? `<span class="${css.bad}">${esc(S.failed)}</span>` : L ? L.html + waiting : '');
      setH('clock', `${PACE_WORD} · ${fmt(t)}`);
    } else {
      setH('log', `<b>08 Register</b> · ${esc(M.name)} is in bp · ${M.tiles.length} features on ${M.wings.length} wings, ${M.rooms.length} rooms, ${M.bays.length} bays · click a feature, scroll to zoom, drag to pan, Esc to go up`);
      setH('clock', `BUILT IN ${fmt(S.end)} · ${PACE_WORD}`);
      const px = Math.round(160 * V.zoom); $('sbar').style.width = clamp(px, 8, 220) + 'px';
      root.querySelectorAll<HTMLButtonElement>('[data-l]').forEach((b) => {
        const l = +(b.dataset.l ?? 0), f = sel ?? hover;
        b.disabled = l > 0 && !(f && ({ wing: 1, room: 2, bay: 3, tile: 4 }[f.lvl] >= l));
        b.setAttribute('aria-pressed', String(l === level));
      });
      $('bRaise').setAttribute('aria-pressed', String(raiseTarget > 0));
    }
    // legend: stages once the first is stamped, health once the first reading has landed; counts are what has landed
    const lg = $('legend');
    const sv = !live && siteFade(t) > .5 ? { lots: chalked(t).length, ghosts: named(t).length, lines: byLines(chalked(t)) } : null;
    const on = anyStage || !!(sv && (sv.lots || sv.ghosts));
    if (lg.classList.contains(css.on) !== on) { lg.classList.toggle(css.on, on); placeFloaters(); }
    if (on) {
      const by: Partial<Record<Stage, number>> = {}, hb: Partial<Record<Health, number>> = {};
      let pencilN = 0;
      for (const tl of M.tiles) { if (t >= tl.stageT && tl.stage) by[tl.stage] = (by[tl.stage] ?? 0) + 1; const g = gen(tl, t); if (t >= tl.healthT && g) hb[g] = (hb[g] ?? 0) + 1; if (inPencil(tl, t)) pencilN++; }
      const key = JSON.stringify([by, hb, pencilN, sv, document.documentElement.dataset.theme]);
      if (lastHud.legendKey !== key) { lastHud.legendKey = key; buildLegend(by, anyHealth ? hb : null, sv, pencilN); }
    }
    $('hint').style.opacity = !live && t > 3.5 && t < S.steps[4].t0 && !RMODE ? '1' : '0';
  }
  function buildLegend(by: Partial<Record<Stage, number>>, hb: Partial<Record<Health, number>> | null, sv: { lots: number; ghosts: number; lines: boolean } | null, pencilN: number) {
    const row = (sw: string, word: string, n: number) => `<div class="${css.row}">${sw}<span>${word}</span><span>${n}</span></div>`;
    let h = '';
    if (sv && (sv.lots || sv.ghosts)) h += `<div class="${css.sec}"><h4>Site survey</h4>`
      + (sv.lots ? row(`<canvas data-sx="lot" width="72" height="34"></canvas>`, `Code area · by ${sv.lines ? 'lines' : 'files'}`, sv.lots) : '')
      + (sv.ghosts ? row(`<canvas data-sx="ghost" width="72" height="34"></canvas>`, 'Wing named', sv.ghosts) : '') + `</div>`;
    if (STAGES.some((s) => by[s])) h += `<div class="${css.sec}"><h4>Stage</h4>` + STAGES.filter((s) => by[s]).map((s) => row(`<canvas data-sw="${s}" width="72" height="34"></canvas>`, STAGE_WORD[s], by[s] ?? 0)).join('') + `</div>`;
    if (hb) h += `<div class="${css.sec}"><h4>Health</h4>` + HEALTHS.filter((s) => hb[s]).map((s) => row(`<i class="${css.hb}" style="background:${healthCol(s)}"></i>`, HEALTH_WORD[s], hb[s] ?? 0)).join('')
      + (pencilN ? row(`<canvas data-sx="pencil" width="72" height="34"></canvas>`, 'Pencil · one batch, provisional', pencilN) : '') + `</div>`;
    $('legend').innerHTML = h;
    $('legend').querySelectorAll<HTMLCanvasElement>('canvas[data-sw]').forEach((c) => swatch(c, c.dataset.sw as Stage));
    $('legend').querySelectorAll<HTMLCanvasElement>('canvas[data-sx]').forEach((c) => siteSwatch(c, c.dataset.sx ?? ''));
  }
  function siteSwatch(c: HTMLCanvasElement, kind: string) {
    const g = c.getContext('2d') as Ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    if (kind === 'lot') { g.fillStyle = hexA(C.ink, .08); g.fillRect(2, 2, 68, 30); g.setLineDash([7, 4]); g.strokeStyle = hexA(C.ink, .5); g.lineWidth = 1.6; g.strokeRect(2, 2, 68, 30); }
    else if (kind === 'ghost') { g.setLineDash([12, 5]); g.strokeStyle = hexA(C.ink, .7); g.lineWidth = 2; g.strokeRect(2, 2, 68, 30); }
    else if (kind === 'pencil') {
      g.setLineDash([4, 4]); g.strokeStyle = C.amber; g.lineWidth = 2; g.strokeRect(2, 2, 68, 30); g.setLineDash([]);
      g.lineWidth = 1.4; g.strokeRect(10, 20, 52, 8); g.save(); g.beginPath(); g.rect(10, 20, 52, 8); g.clip(); g.beginPath();
      for (let q = -8; q < 52; q += 5) { g.moveTo(10 + q, 28); g.lineTo(18 + q, 20); } g.stroke(); g.restore();
    }
    g.setLineDash([]);
  }
  function swatch(c: HTMLCanvasElement, st: Stage | null) {
    const g = c.getContext('2d') as Ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = C['tile-base']; g.fillRect(0, 0, 72, 34); stagePattern(g, st, 1, 1, 70, 32, 1.4);
  }
  function placeFloaters() {
    const sh = $('strip').offsetHeight + 20;
    $('legend').style.bottom = sh + 'px';
    kp.style.bottom = sh + 'px'; $('kpcap').style.bottom = (sh + KP.h + 4) + 'px';
    $('hint').style.bottom = (sh + 4) + 'px';
  }

  /* ---------- detail + tooltip ---------- */
  function showDetail() {
    const d = $('detail');
    if (!sel) { d.hidden = true; return; }
    const tl = sel, t = isLive() ? S.end : T;
    const hasStage = t >= tl.stageT, hasHealth = t >= tl.healthT;
    const pend = (s: string) => `<span class="${css.pend}">${s}</span>`;
    d.hidden = false;
    d.innerHTML = `<button class="${css.x}" data-dx aria-label="Close">Esc</button>
      <div class="${css.dc}">${esc(tl.wing.letter)} · ${esc(tl.wing.name)}<br>${esc(tl.room.code)} ${esc(tl.room.name)} › ${esc(tl.bay.code)} ${esc(tl.bay.name)}</div>
      <h2>${esc(tl.name)}</h2>
      <dl>
        <dt>Stage</dt><dd>${hasStage ? `<canvas data-dsw width="72" height="34"></canvas>${tl.stage ? STAGE_WORD[tl.stage] : 'Unknown'} <span class="${css.mono} ${css.sub}">${esc(tl.stage ?? '')}</span>` : pend('lands with 05 events')}</dd>
        <dt>Health</dt><dd>${hasHealth ? `<i class="${css.chip}" style="background:${healthCol(gen(tl, t))}"></i>${(() => { const g = gen(tl, t); return g ? HEALTH_WORD[g] : '—'; })()}${inPencil(tl, t) ? ` ${pend('pencil: one batch, the final reading inks it')}` : ''}` : pend('lands with 07 judge')}</dd>
        <dt>Kind</dt><dd>${tl.kind ? KIND_WORD[tl.kind] ?? esc(tl.kind) : '—'}${tl.tier ? ` · ${esc(tl.tier)}` : ''}</dd>
        <dt>Room</dt><dd>${esc(tl.room.name)}</dd>
        ${M.historyIn ? (tl.created ? `<dt>Created</dt><dd>${hasStage ? esc(tl.created) : pend('lands with 05 events')}</dd>` : '') : `<dt>Created</dt><dd>${pend('lands with 05 events')}</dd>`}
      </dl>
      ${tl.summary ? `<p>${esc(tl.summary)}</p>` : ''}`;
    const c = d.querySelector<HTMLCanvasElement>('[data-dsw]'); if (c) swatch(c, tl.stage);
    (d.querySelector('[data-dx]') as HTMLButtonElement).onclick = () => { sel = null; showDetail(); dirty = true; };
  }
  function showTip(o: Node | null, x: number, y: number) {
    const tip = $('tip');
    if (!o || dragging) { tip.hidden = true; return; }
    const t = isLive() ? S.end : T;
    let h = '';
    if (o.lvl === 'tile') {
      const hasStage = t >= o.stageT, hasHealth = t >= o.healthT;
      h = `<div class="${css.c}">${esc(o.bay.code)} ${esc(o.bay.name)}</div><b>${esc(o.name)}</b><div class="${css.m}">${hasStage ? (o.stage ? STAGE_WORD[o.stage] : 'stage unknown') : 'stage pending'} · ${(() => { const g = gen(o, t); return hasHealth && g ? HEALTH_WORD[g] + (inPencil(o, t) ? ' (pencil)' : '') : 'health pending'; })()} · ${o.kind ? KIND_WORD[o.kind] ?? esc(o.kind) : ''}</div>`;
    } else if (o.lvl === 'room') h = `<div class="${css.c}">${esc(o.wing.letter)} · ${esc(o.wing.name)}</div><b>${esc(o.code)} ${esc(o.name)}</b><div class="${css.m}">${o.bays.length} bays · ${o.tiles.length} features</div>`;
    else if (o.lvl === 'wing') h = `<b>${esc(o.letter)} · ${esc(o.name)}</b><div class="${css.m}">${o.rooms.length} rooms · ${o.tiles.length} features</div>`;
    tip.innerHTML = h; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(vw - r.width - 8, x + 16) + 'px'; tip.style.top = Math.min(vh - r.height - 8, y + 16) + 'px';
  }
  function pick(sx: number, sy: number): Node | null {
    const t = isLive() ? S.end : T;
    const [x, y] = unproj(sx, sy, H_SLAB * V.ws);
    for (const tl of M.tiles) { const b = tl.box; if (dropP(tl, t) >= 1 && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return tl; }
    const [x0, y0] = unproj(sx, sy, 0);
    for (const r of M.rooms) { const b = r.box; if ((isLive() || t >= r.riseT) && x0 >= b.x && x0 <= b.x + b.w && y0 >= b.y && y0 <= b.y + b.h) return r; }
    for (const w of M.wings) { const b = w.box; if ((isLive() || t >= w.footT) && x0 >= b.x && x0 <= b.x + b.w && y0 >= b.y && y0 <= b.y + b.h) return w; }
    return null;
  }

  /* ---------- live plan camera ---------- */
  function flyTo(target: Cam, lvl?: number) {
    if (lvl != null) level = lvl;
    liveMoved = lvl !== 0;
    if (RMODE || !liveCam) { liveCam = target; dirty = true; return; }
    tween = { from: { ...liveCam }, to: target, t0: performance.now(), dur: 650 };
  }
  function camFor(o: Node | null): Cam {
    const P = { ...PAD_FINAL, r: sel ? 360 : 28 };
    if (!o) return finalCam();
    const b = o.lvl === 'tile' ? o.bay.box : o.box;
    return fitCam(b, 0, 0, 0, .9, o.lvl === 'tile' ? 1.6 : 2.2, P);
  }
  function goLevel(l: number) {
    const f = sel ?? hover;
    if (l === 0) return flyTo(finalCam(), 0);
    if (!f) return;
    const chain: (Node | null)[] = f.lvl === 'tile' ? [null, f.wing, f.room, f.bay, f] : f.lvl === 'room' ? [null, f.wing, f] : f.lvl === 'wing' ? [null, f] : [null];
    const o = chain[l]; if (!o) return;
    flyTo(camFor(o), l);
  }
  function zoomAt(f: number, sx: number, sy: number) {
    if (!isLive() || !liveCam) { userZ = clamp(userZ * f, .5, 3); dirty = true; return; }
    const before = unproj(sx, sy, 0);
    const fit = finalCam().zoom;
    liveCam.zoom = clamp(liveCam.zoom * f, fit * .6, 3.2);
    computeView(S.end);
    const after = unproj(sx, sy, 0);
    liveCam.cx += before[0] - after[0]; liveCam.cy += before[1] - after[1];
    tween = null; liveMoved = true; dirty = true;
  }
  function enterLive() {
    phase = 'live'; liveCam = finalCam(); liveMoved = false; level = 0; raise = raiseTarget = 0;
    root.classList.add(css.live); lastHud = {}; dirty = true;
    requestAnimationFrame(placeFloaters);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1); vw = Math.max(1, root.clientWidth); vh = Math.max(1, root.clientHeight);
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    if (isLive() && !liveMoved) liveCam = finalCam();
    KP.h = -1; sizeKeyplan();
    dirty = true;
  }

  /* ---------- the frame loop ---------- */
  let last = performance.now(), raf = 0;
  function frame(now: number) {
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    // the extent re-frames smoothly as wings arrive (a live run announces none up front)
    const de = Math.abs(extD.x - ext.x) + Math.abs(extD.y - ext.y) + Math.abs(extD.w - ext.w) + Math.abs(extD.h - ext.h);
    if (de > .5) { const u = RMODE ? 1 : 1 - Math.exp(-dt * 2.6); extD = { x: extD.x + (ext.x - extD.x) * u, y: extD.y + (ext.y - extD.y) * u, w: extD.w + (ext.w - extD.w) * u, h: extD.h + (ext.h - extD.h) * u }; dirty = true; }
    else if (de > 0) { extD = { ...ext }; dirty = true; }
    if (begun && !isLive()) {
      T += dt;
      const lw = lampWant(T);
      if (Math.abs(lampA - lw) > .001) lampA += (lw - lampA) * Math.min(1, dt * (lw > lampA ? .8 : 2.4));
      if (!bandGone && lots.size && T >= S.R0) { bandGone = true; setExtTarget(); }
      // measuring has no length: the survey plane makes another pass while the step still runs
      const lastSw = S.sweeps[S.sweeps.length - 1];
      if (measureOn && lastSw && T > lastSw.t1 - .05) { S.sweeps.push({ t0: lastSw.t1, t1: lastSw.t1 + SWEEP }); S.Q = Math.max(S.Q, lastSw.t1 + SWEEP); }
      if (T >= S.end) { T = S.end; enterLive(); }
      dirty = true;
    } else if (isLive()) {
      if (tween && liveCam) { const u = clamp((now - tween.t0) / tween.dur), e = smooth(u); liveCam = lerpCam(tween.from, tween.to, e); if (u >= 1) tween = null; dirty = true; }
      if (Math.abs(raise - raiseTarget) > .001) { raise = RMODE ? raiseTarget : raise + (raiseTarget - raise) * Math.min(1, dt * 4.5); if (Math.abs(raise - raiseTarget) < .002) raise = raiseTarget; dirty = true; }
    }
    if (dirty) { draw(); hud(); dirty = false; }
    raf = requestAnimationFrame(frame);
  }

  /* ---------- input ---------- */
  let dragging = false, down: { x: number; y: number } | null = null, moved = 0;
  const local = (e: { clientX: number; clientY: number }): [number, number] => { const r = root.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onDown = (e: PointerEvent) => { const [x, y] = local(e); down = { x, y }; moved = 0; cv.setPointerCapture(e.pointerId); };
  const onMove = (e: PointerEvent) => {
    const [ex, ey] = local(e);
    if (down) {
      const dx = ex - down.x, dy = ey - down.y; moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) { dragging = true; cv.classList.add(css.drag); }
      if (dragging) {
        if (isLive() && liveCam) {
          const a = unproj(down.x, down.y, 0), b = unproj(ex, ey, 0);
          liveCam.cx += a[0] - b[0]; liveCam.cy += a[1] - b[1]; tween = null; liveMoved = true;
        } else if (!RMODE) { userTh += dx * .004; userPh = clamp(userPh + dy * .003, -.7, .25); }
        down = { x: ex, y: ey }; dirty = true;
      }
      showTip(null, 0, 0); return;
    }
    const o = pick(ex, ey);
    if (o !== hover) { hover = o; dirty = true; }
    cv.classList.toggle(css.hot, !!o && o.lvl === 'tile');
    showTip(o, ex, ey);
  };
  const onUp = (e: PointerEvent) => {
    const wasDrag = dragging; dragging = false; down = null; cv.classList.remove(css.drag);
    if (!wasDrag) {
      const [ex, ey] = local(e);
      const o = pick(ex, ey);
      if (o && o.lvl === 'tile') { sel = o; showDetail(); }
      else if (o && isLive()) { sel = null; showDetail(); hover = o; flyTo(camFor(o), o.lvl === 'wing' ? 1 : 2); }
      else { sel = null; showDetail(); }
      dirty = true;
    }
  };
  const onLeave = () => { hover = null; showTip(null, 0, 0); dirty = true; };
  const onDbl = (e: MouseEvent) => {
    const [ex, ey] = local(e);
    const o = pick(ex, ey);
    if (!isLive()) { userTh = 0; userPh = 0; userZ = 1; dirty = true; return; }
    if (o && o.lvl === 'tile') { sel = o; showDetail(); flyTo(camFor(o), 3); }
  };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); const [ex, ey] = local(e); zoomAt(Math.exp(-e.deltaY * .0015), ex, ey); };
  const onKp = (e: MouseEvent) => {
    if (!isLive() || !liveCam) return;
    const r = kp.getBoundingClientRect(), { e: ext0, s, ox, oy } = kpMap();
    const wx = ext0.x + (e.clientX - r.left - ox) / s, wy = ext0.y + (e.clientY - r.top - oy) / s;
    const c0 = unproj(vw / 2, vh / 2, 0);
    flyTo({ ...liveCam, cx: liveCam.cx + wx - c0[0], cy: liveCam.cy + wy - c0[1] });
  };
  const onCrumb = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.go === 'site') { sel = null; showDetail(); return flyTo(finalCam(), 0); }
    const o = crumbPath[+(b.dataset.go ?? -1)]; if (o) flyTo(camFor(o), { wing: 1, room: 2, bay: 3, tile: 4 }[o.lvl]);
  };
  const onLevels = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.l != null) goLevel(+b.dataset.l);
    else if (b.dataset.r === 'zIn') zoomAt(1.4, vw / 2, vh / 2);
    else if (b.dataset.r === 'zOut') zoomAt(1 / 1.4, vw / 2, vh / 2);
    else if (b.dataset.r === 'bRaise') { raiseTarget = raiseTarget > 0 ? 0 : 1; dirty = true; }
    else if (b.dataset.r === 'bFind') openFind();
  };

  /* ---------- find (the plan is only whole once the run is done, so Find opens on the live plan) ---------- */
  let found: Node[] = [], fi = 0;
  const qIn = $<HTMLInputElement>('q');
  function openFind() { if (!isLive()) return; $('find').hidden = false; qIn.value = ''; runFind(); qIn.focus(); }
  function closeFind() { $('find').hidden = true; }
  function runFind() {
    const q = qIn.value.trim().toLowerCase();
    const all: Node[] = [...M.tiles, ...M.rooms, ...M.wings];
    found = (q ? all.filter((o) => o.name.toLowerCase().includes(q)) : M.wings.slice()).slice(0, 9); fi = 0;
    $('res').innerHTML = found.map((o, i) => `<li data-i="${i}" aria-selected="${i === fi}">${esc(o.name)}<span>${o.lvl === 'tile' ? esc(o.bay.code) + ' feature' : o.lvl === 'room' ? esc(o.code) + ' room' : o.lvl === 'wing' ? esc(o.letter) + ' wing' : ''}</span></li>`).join('') || `<li>No feature, room or wing called “${esc(q)}”</li>`;
  }
  function chooseFound(i: number) {
    const o = found[i]; if (!o) return; closeFind();
    if (o.lvl === 'tile') { sel = o; showDetail(); flyTo(camFor(o), 4); } else { sel = null; showDetail(); hover = o; flyTo(camFor(o), o.lvl === 'wing' ? 1 : 2); }
    dirty = true;
  }
  const onQKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); fi = clamp(fi + (e.key === 'ArrowDown' ? 1 : -1), 0, Math.max(0, found.length - 1)); $('res').querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === fi))); }
    else if (e.key === 'Enter') chooseFound(fi);
    else if (e.key === 'Escape') { e.stopPropagation(); closeFind(); }
  };
  const onRes = (e: MouseEvent) => { const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]'); if (li) chooseFound(+(li.dataset.i ?? 0)); };
  const onKey = (e: KeyboardEvent) => {
    const tg = e.target as HTMLElement | null;
    if (tg && (tg === qIn || tg.tagName === 'INPUT' || tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA')) return;
    if (e.key === '/') { if (isLive()) { e.preventDefault(); openFind(); } }
    else if (e.key === '3' && isLive()) { raiseTarget = raiseTarget > 0 ? 0 : 1; dirty = true; }
    else if (e.key === '+' || e.key === '=') zoomAt(1.3, vw / 2, vh / 2);
    else if (e.key === '-') zoomAt(1 / 1.3, vw / 2, vh / 2);
    else if (e.key === 'Escape') {
      if (!$('find').hidden) return closeFind();
      if (!isLive()) return;
      if (sel) { sel = null; showDetail(); }
      else if (level > 0 || liveMoved) { hover = null; flyTo(finalCam(), 0); }
      dirty = true;
    }
  };

  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointerleave', onLeave);
  cv.addEventListener('dblclick', onDbl);
  cv.addEventListener('wheel', onWheel, { passive: false });
  kp.addEventListener('click', onKp);
  $('crumbs').addEventListener('click', onCrumb);
  $('levels').addEventListener('click', onLevels);
  qIn.addEventListener('input', runFind);
  qIn.addEventListener('keydown', onQKey);
  $('res').addEventListener('click', onRes);
  window.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => resize());
  ro.observe(root);
  let alive = true;
  document.fonts?.ready.then(() => { if (alive) { dirty = true; lastHud = {}; } }).catch(() => {});

  readTokens();
  resize();
  buildStrip();
  placeFloaters();
  root.classList.toggle(css.reduced, RMODE);
  raf = requestAnimationFrame((t) => { last = t; frame(t); });

  return {
    feed,
    setReduced(r: boolean) { RMODE = r; root.classList.toggle(css.reduced, r); dirty = true; },
    retheme() { readTokens(); lastHud = {}; showDetail(); dirty = true; },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointerleave', onLeave);
      cv.removeEventListener('dblclick', onDbl);
      cv.removeEventListener('wheel', onWheel);
      kp.removeEventListener('click', onKp);
      $('crumbs').removeEventListener('click', onCrumb);
      $('levels').removeEventListener('click', onLevels);
      qIn.removeEventListener('input', runFind);
      qIn.removeEventListener('keydown', onQKey);
      $('res').removeEventListener('click', onRes);
      window.removeEventListener('keydown', onKey);
      // release the canvases' backing stores
      cv.width = cv.height = 0; kp.width = kp.height = 0;
    },
  };
}
