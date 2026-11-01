// The outline becomes the building: the contest prototype's canvas engine (blueprint-buildup, o3 variant-1), ported to
// TypeScript and driven by the build-up contract's events instead of its own data load and clock.
//
// The prototype knew the whole plan at t=0 and precomputed one schedule (every line's typing time, every flight, the
// camera path, the folds, the stamps and the health). This port keeps its drawing code and its pacing constants, but
// builds the schedule incrementally: each event appends to it at "now" or after what is already queued, never before.
//   structure -> outline lines (typed at the prototype's demo pace, compressed when a burst would take > DRAIN s),
//                bay flights, folds and camera keys for the new part only
//   history   -> stage stamps in created order, after the last flight lands
//   measure   -> a sweep that repeats until `measure done` arrives
//   health    -> one batch of tiles judged per event, queued after the sweep
//   register / done -> the column collapses and the camera settles; the plan becomes explorable
// The engine's clock runs in run seconds: it follows the source's own clock (events carry `at`), so a lab speed of 4x
// plays the prototype's x4.
import { PHASES, type BBox, type BuildupEvent, type Health, type Phase, type Stage } from '../contract';

type Styles = Readonly<Record<string, string>>;
type Kind = 'wing' | 'room' | 'bay' | 'tile';

interface Line { kind: Kind; ref: PNode; prefix: string; text: string; i: number; t0: number; t1: number }
interface NodeBase { id: string; name: string; order: number; box: BBox; line: Line; fly: number }
interface WingN extends NodeBase { kind: 'wing'; letter: string; rooms: RoomN[]; tiles: TileN[] }
interface RoomN extends NodeBase { kind: 'room'; wing: WingN; bays: BayN[]; tiles: TileN[] }
interface BayN extends NodeBase { kind: 'bay'; room: RoomN; wing: WingN; tiles: TileN[]; foldAt: number | undefined }
interface TileN extends NodeBase {
  kind: 'tile'; bay: BayN; room: RoomN; wing: WingN; idx: number;
  stage: Stage | null; fkind: string | null; tier: string | null; summary: string | null;
  created: string | null; general: Health | null; wrap: string[]; stampAt: number; healthAt: number;
}
type PNode = WingN | RoomN | BayN | TileN;
interface Cam { x: number; y: number; s: number }
interface Key extends Cam { t: number; d: number }
interface Step { k: Phase; n: string; llm?: boolean; what: string; t0: number; t1: number }

const STEP_DEF: { k: Phase; n: string; llm?: boolean; what: string }[] = [
  { k: 'check', n: 'check', what: 'which artifacts exist already' },
  { k: 'context-map', n: 'context map', what: 'the code partitioned into contexts' },
  { k: 'seed', n: 'seed', what: 'the code tree' },
  { k: 'product-tree', n: 'product tree', llm: true, what: 'domains, capabilities, features' },
  { k: 'events', n: 'history', what: 'feature history from git' },
  { k: 'measure', n: 'measure', what: 'static metrics per feature' },
  { k: 'judge', n: 'judge', llm: true, what: 'lens judgements per feature' },
  { k: 'register', n: 'register', what: 'the product appears in bp' },
];
const STAGE_WORD: Record<string, string> = { live: 'Built', flagged: 'Partly open', 'in-review': 'Inspection', 'in-dev': 'Construction', specified: 'Proposed', idea: 'Future', deprecated: 'Demolish' };
const KIND_WORD: Record<string, string> = { user_flow: 'User flow', capability: 'Capability', ops: 'Operations', integration: 'Integration' };

// pacing: the prototype's demo constants (its k came out at 0.20 to 0.24 s per weight unit for the three products)
const WEIGHT: Record<Kind, number> = { wing: 1.6, room: 1.2, bay: 1.0, tile: 0.62 };
const K0 = 0.21, K_MIN = 0.06, DRAIN = 36; // a burst never takes longer than DRAIN run-seconds to type
const DUR = { bay: 1.7, room: 1.5, wing: 1.25 };
const LAG = 1.0, EV_DUR = 4.6, MS_DUR = 2.2, REG_DUR = 3.3, HEALTH_GAP = 0.05;

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const span = (t: number, a: number, d: number) => (d <= 0 ? (t >= a ? 1 : 0) : clamp((t - a) / d));
const fin = (n: number) => Number.isFinite(n);
const fmtT = (s: number) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
function hexRgb(h: string): [number, number, number] | null {
  h = h.trim(); if (h[0] !== '#') return null;
  if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lerpCam = (a: Cam, b: Cam, p: number): Cam => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), p)) });
const lerpBox = (a: BBox, b: BBox, p: number): BBox => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) });
const sameBox = (a: BBox, b: BBox) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h) < 0.5;

export interface OutlineEngine {
  onEvent(e: BuildupEvent): void;
  setReduced(r: boolean): void;
  setTheme(): void;
  destroy(): void;
}

export function createOutlineEngine(root: HTMLElement, cls: Styles): OutlineEngine {
  const q = <T extends HTMLElement>(r: string): T => {
    const el = root.querySelector<T>(`[data-r="${r}"]`);
    if (!el) throw new Error('outline: missing element ' + r);
    return el;
  };
  const cv = q<HTMLCanvasElement>('cv');
  const ctx0 = cv.getContext('2d');
  if (!ctx0) throw new Error('outline: no 2d context');
  const ctx = ctx0;
  const ac = new AbortController();
  const on = { signal: ac.signal };
  const ls = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  const HAS_LS = 'letterSpacing' in ctx;
  const setLS = (px: number) => { if (HAS_LS) ls.letterSpacing = px + 'px'; };
  const rootCss = getComputedStyle(document.documentElement);
  const fam = (n: string, fb: string) => { const v = rootCss.getPropertyValue(n).trim(); return v ? v + ', ' + fb : fb; };
  const SANS = fam('--font-sans', '"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif');
  const MONO = fam('--font-mono', '"IBM Plex Mono",Consolas,"Courier New",monospace');

  const el = {
    head: q('head'), rail: q('rail'), index: q('index'), idxList: q('idxList'), idxClose: q('idxClose'), crumbs: q('crumbs'),
    zoom: q('zoom'), zIn: q('zIn'), zOut: q('zOut'), zFit: q('zFit'), card: q('card'), tip: q('tip'), toast: q('toast'),
    track: q('track'), clock: q('clock'), live: q('live'), find: q<HTMLInputElement>('find'), results: q('results'),
  };

  // ---------- state ----------
  const S = {
    t: 0, live: false, reduced: false, began: false,
    cam: { x: 0, y: 0, s: 1 } as Cam, userCam: null as Cam | null, tween: null as { from: Cam; to: Cam; t0: number; d: number } | null,
    hover: null as PNode | null, sel: null as TileN | null,
    drag: null as { x: number; y: number; moved: boolean; cam: Cam } | null,
  };
  let rate = 1, ratePair: { at: number; wall: number } | null = null, rateSeen = false;

  let C: Record<string, string> = {};
  let inkRgb: [number, number, number] = [223, 240, 255], accRgb: [number, number, number] = [127, 224, 255];
  const inkA = (a: number) => `rgba(${inkRgb[0]},${inkRgb[1]},${inkRgb[2]},${a})`;
  const accA = (a: number) => `rgba(${accRgb[0]},${accRgb[1]},${accRgb[2]},${a})`;
  const healthCol = (g: Health | null) => (g === 'good' ? inkA(0.62) : g === 'watch' ? C.amber : g === 'bad' ? C.red : inkA(0.12));
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const n of ['paper', 'paper-hi', 'paper-mid', 'paper-lo', 'ink', 'ink-2', 'ink-3', 'ink-4', 'line', 'grid', 'accent', 'mint', 'amber', 'red', 'red-2', 'label-bg', 'tile-base', 'panel-solid', 'halo', 'ink-hi', 'vignette', 'card'])
      next[n] = cs.getPropertyValue('--' + n).trim() || '#888';
    C = next;
    inkRgb = hexRgb(C.ink) ?? [223, 240, 255];
    accRgb = hexRgb(C.accent) ?? [127, 224, 255];
  }

  // ---------- the model: what has arrived ----------
  let project = { slug: '', name: '' };
  let announced: BBox | null = null; // begin.extent
  let wings: WingN[] = [], rooms: RoomN[] = [], bays: BayN[] = [], tiles: TileN[] = [], lines: Line[] = [];
  let byId = new Map<string, PNode>();
  let typeEnd = 0, prevFly = -1e9, lastLand = 0, structTail = 0, treeDone = false;
  let steps: Step[] = [];
  let rail: { t0: number; t1: number; failed: boolean; detail: string | null }[] = [];
  let stampOrder: TileN[] = [], healthOrder: TileN[] = [], lastHealthAt = -Infinity, hasDates = false;
  let measureDone = false, judgeDone = false, doneSeen = false, T = Infinity;
  let failed: { phase: Phase; message: string } | null = null;
  let extVersions: { t: number; ext: BBox }[] = [];
  let provisional: BBox | null = null;
  let origin: { x: number; y: number; t: number } | null = null;

  function reset(e: Extract<BuildupEvent, { type: 'begin' }>) {
    leaveLive();
    project = e.project; announced = e.extent;
    wings = []; rooms = []; bays = []; tiles = []; lines = []; byId = new Map();
    typeEnd = 0; prevFly = -1e9; lastLand = 0; structTail = 0; treeDone = false;
    steps = STEP_DEF.map((s) => ({ ...s, t0: Infinity, t1: Infinity }));
    rail = PHASES.map(() => ({ t0: Infinity, t1: Infinity, failed: false, detail: null }));
    stampOrder = []; healthOrder = []; lastHealthAt = -Infinity; hasDates = false;
    measureDone = false; judgeDone = false; doneSeen = false; T = Infinity; failed = null;
    extVersions = announced && announced.w > 0 ? [{ t: -1, ext: announced }] : [];
    provisional = null;
    origin = announced && announced.w > 0 ? { x: announced.x, y: announced.y, t: -1 } : null;
    S.t = 0; S.userCam = null; S.tween = null; S.hover = null; S.sel = null; S.began = true;
    lastStep = -1; lastClock = '';
    el.find.value = ''; el.results.classList.remove(cls.open);
    buildTrack();
    makeView();
    dirty = true;
  }

  const knownExt = (): BBox | null => (extVersions.length ? extVersions[extVersions.length - 1].ext : null);
  function updateExtent() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const boxes = announced && announced.w > 0 ? [announced, ...wings.map((w) => w.box)] : wings.map((w) => w.box);
    for (const b of boxes) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    if (!fin(x0)) return;
    const ext = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const k = knownExt();
    if (!k || !sameBox(k, ext)) extVersions.push({ t: S.t, ext });
    if (!origin) origin = { x: ext.x, y: ext.y, t: S.t };
  }

  // tile labels are wrapped once, in world units (14 world-unit type in a 160-unit tile)
  function wrapText(s: string, maxW: number, maxL: number): string[] {
    const words = s.split(/\s+/), out: string[] = []; let cur = '';
    for (let i = 0; i < words.length; i++) {
      const test = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width <= maxW || !cur) cur = test;
      else { out.push(cur); cur = words[i]; if (out.length === maxL) { cur = ''; out[maxL - 1] = fitEll(out[maxL - 1] + ' ' + words.slice(i).join(' '), maxW); break; } }
    }
    if (cur) out.push(cur);
    return out.map((l) => fitEll(l, maxW));
  }
  function fitEll(s: string, maxW: number): string {
    if (ctx.measureText(s).width <= maxW) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }
  const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;
  const noLine = undefined as unknown as Line; // set in the same call that creates the node

  function onStructure(e: Extract<BuildupEvent, { type: 'structure' }>) {
    const now = S.t;
    const fresh = new Set<PNode>();
    for (const w of e.wings) {
      if (byId.has('wing:' + w.id)) continue;
      const n: WingN = { kind: 'wing', id: w.id, name: w.name, order: w.order, letter: w.letter, box: w.box, line: noLine, fly: Infinity, rooms: [], tiles: [] };
      byId.set('wing:' + w.id, n); wings.push(n); fresh.add(n);
    }
    wings.sort(byOrder);
    for (const r of e.rooms) {
      const w = byId.get('wing:' + r.parentId);
      if (byId.has('room:' + r.id) || !w || w.kind !== 'wing') continue;
      const n: RoomN = { kind: 'room', id: r.id, name: r.name, order: r.order, box: r.box, line: noLine, fly: Infinity, wing: w, bays: [], tiles: [] };
      byId.set('room:' + r.id, n); w.rooms.push(n); w.rooms.sort(byOrder); fresh.add(n);
    }
    for (const b of e.bays) {
      const r = byId.get('room:' + b.parentId);
      if (byId.has('bay:' + b.id) || !r || r.kind !== 'room') continue;
      const n: BayN = { kind: 'bay', id: b.id, name: b.name, order: b.order, box: b.box, line: noLine, fly: Infinity, room: r, wing: r.wing, tiles: [], foldAt: undefined };
      byId.set('bay:' + b.id, n); r.bays.push(n); r.bays.sort(byOrder); fresh.add(n);
    }
    ctx.font = `500 14px ${SANS}`;
    for (const t of e.tiles) {
      const b = byId.get('bay:' + t.parentId);
      if (byId.has('tile:' + t.id) || !b || b.kind !== 'bay') continue;
      const n: TileN = {
        kind: 'tile', id: t.id, name: t.name, order: t.order, box: t.box, line: noLine, fly: Infinity, bay: b, room: b.room, wing: b.wing, idx: 0,
        stage: t.stage, fkind: t.kind, tier: t.tier, summary: t.summary, created: null, general: null,
        wrap: wrapText(t.name, t.box.w - 16, 3), stampAt: Infinity, healthAt: Infinity,
      };
      byId.set('tile:' + t.id, n); b.tiles.push(n); b.tiles.sort(byOrder); fresh.add(n);
    }
    if (!fresh.size) return;
    // the outline: new nodes in tree order, appended (an outline is written top to bottom; it never inserts)
    const nl: Line[] = [];
    const emit = (ref: PNode, prefix: string, text: string) => {
      const l: Line = { kind: ref.kind, ref, prefix, text, i: lines.length, t0: Infinity, t1: Infinity };
      ref.line = l; lines.push(l); nl.push(l);
      if (ref.kind === 'room') rooms.push(ref);
      else if (ref.kind === 'bay') bays.push(ref);
      else if (ref.kind === 'tile') { ref.idx = tiles.length; tiles.push(ref); ref.room.tiles.push(ref); ref.wing.tiles.push(ref); }
    };
    for (const w of wings) {
      if (fresh.has(w)) emit(w, w.letter + '  ', w.name.toUpperCase());
      w.rooms.forEach((r, ri) => {
        const lastR = ri === w.rooms.length - 1;
        if (fresh.has(r)) emit(r, '  ' + (lastR ? '└─ ' : '├─ '), r.name);
        const p1 = '  ' + (lastR ? '   ' : '│  ');
        r.bays.forEach((b, bi) => {
          const lastB = bi === r.bays.length - 1;
          if (fresh.has(b)) emit(b, p1 + (lastB ? '└─ ' : '├─ '), b.name);
          for (const tl of b.tiles) if (fresh.has(tl)) emit(tl, p1 + (lastB ? '   ' : '│  ') + '· ', tl.name);
        });
      });
    }
    // typing: the prototype's demo weights, compressed when the queue would run past DRAIN seconds
    const backlog = Math.max(0, typeEnd - now);
    const newW = nl.reduce((a, l) => a + WEIGHT[l.kind], 0);
    let k = K0;
    if (backlog + newW * K0 > DRAIN) k = Math.max(K_MIN, (DRAIN - Math.min(backlog, DRAIN * 0.5)) / newW);
    let t = Math.max(now + 0.12, typeEnd);
    for (const l of nl) { const d = WEIGHT[l.kind] * k; l.t0 = t; l.t1 = t + Math.min(d * 0.85, 0.1 + l.text.length * 0.011); t += d; }
    typeEnd = t;
    // flights: bays leave the outline in outline order, each as one block
    const f = Math.min(1, k / K0);
    const STAG = Math.max(0.32, 0.85 * f), RX = Math.max(0.22, 0.45 * f), WX = Math.max(0.26, 0.5 * f);
    for (const l of nl) {
      if (l.kind !== 'bay') continue;
      const b = l.ref as BayN;
      const last = b.tiles.length ? b.tiles[b.tiles.length - 1].line : b.line;
      const firstR = !fin(b.room.fly), firstW = firstR && !fin(b.wing.fly);
      const lead = (firstR ? RX : 0) + (firstW ? WX : 0);
      const first = prevFly < -1e8;
      const s = Math.max(last.t1 + (first ? 0.25 : LAG + lead), prevFly + STAG + lead);
      b.fly = s; prevFly = s;
      if (firstR) b.room.fly = s - RX;
      if (firstW) b.wing.fly = b.room.fly - WX;
      for (const tl of b.tiles) tl.fly = s;
    }
    for (const l of nl) {
      const o = l.ref;
      if (o.kind === 'tile' && !fin(o.fly)) o.fly = Math.max(o.bay.fly, o.line.t1 + LAG); // a late tile for a bay that already flew
      else if ((o.kind === 'room' || o.kind === 'wing') && !fin(o.fly)) o.fly = o.line.t1 + LAG;
    }
    for (const b of bays) lastLand = Math.max(lastLand, b.fly + DUR.bay);
    for (const r of rooms) lastLand = Math.max(lastLand, r.fly + DUR.room);
    structTail = Math.max(lines[lines.length - 1].t1 + 0.3, lastLand + 0.25);
    updateExtent();
    for (const [key, v] of flightCache) if (v.fly > now) flightCache.delete(key);
    refold(now);
    buildKeys();
  }

  const after = (i: number) => {
    let m = i > 3 ? structTail : 0;
    for (let j = 0; j < i; j++) { if (fin(steps[j].t1)) m = Math.max(m, steps[j].t1); if (fin(steps[j].t0)) m = Math.max(m, steps[j].t0); }
    return m;
  };

  function spread(list: TileN[], t0: number, dur: number, key: 'stampAt' | 'healthAt') {
    const N = list.length;
    list.forEach((x, i) => { x[key] = t0 + (N > 1 ? Math.pow(i / (N - 1), 0.92) : 0) * dur; });
  }

  function onHistory(e: Extract<BuildupEvent, { type: 'history' }>) {
    const now = S.t;
    for (const h of e.tiles) { const tl = byId.get('tile:' + h.id); if (tl && tl.kind === 'tile') tl.created = h.created; }
    hasDates = tiles.some((x) => x.created);
    const order = tiles.filter((x) => !fin(x.stampAt));
    if (hasDates) order.sort((a, b) => (a.created || '9').localeCompare(b.created || '9') || a.idx - b.idx);
    const ev0 = Math.max(now, structTail, fin(steps[4].t1) ? steps[4].t1 : 0);
    if (!fin(steps[3].t1)) steps[3].t1 = ev0;
    if (!fin(steps[4].t0)) steps[4].t0 = ev0;
    steps[4].t1 = ev0 + EV_DUR;
    spread(order, ev0 + 0.3, EV_DUR - 0.7, 'stampAt');
    stampOrder = stampOrder.concat(order);
    buildKeys();
  }

  function onHealth(e: Extract<BuildupEvent, { type: 'health' }>) {
    const now = S.t;
    const j0 = fin(steps[6].t0) ? steps[6].t0 : after(6);
    let at = Math.max(now, j0 + 0.4, lastHealthAt + HEALTH_GAP);
    for (const h of e.tiles) {
      const tl = byId.get('tile:' + h.id);
      if (!tl || tl.kind !== 'tile') continue;
      tl.general = h.general;
      if (!fin(tl.healthAt)) { tl.healthAt = at; healthOrder.push(tl); lastHealthAt = at; at += HEALTH_GAP; }
    }
  }

  function onPhase(e: Extract<BuildupEvent, { type: 'phase' }>) {
    const now = S.t, i = PHASES.indexOf(e.phase);
    if (i < 0) return;
    const r = rail[i];
    if (e.state === 'start') r.t0 = now;
    else { if (!fin(r.t0)) r.t0 = now; r.t1 = now; r.detail = e.detail; r.failed = e.state === 'failed'; }
    const st = steps[i];
    if (e.state === 'start') {
      if (i <= 3) st.t0 = now;
      else if (i !== 4 && !fin(st.t0)) st.t0 = Math.max(now, after(i)); // history's step starts when its stamps can
      if (i === 7) buildKeys();
    } else {
      if (i <= 2) st.t1 = now;
      if (i === 3) treeDone = true;
      if (i === 5) { // the sweep finishes its pass, then repeats only while measuring was still running
        measureDone = true;
        if (!fin(st.t0)) st.t0 = Math.max(now, after(5));
        st.t1 = st.t0 + Math.max(1, Math.ceil((Math.max(now, st.t0) - st.t0) / MS_DUR - 1e-6)) * MS_DUR;
      }
      if (i === 6) { judgeDone = true; if (!fin(st.t0)) st.t0 = Math.max(now, after(6)); st.t1 = Math.max(now, lastHealthAt + 0.5, st.t0 + 0.5); }
    }
  }

  function onDone() {
    const now = S.t;
    doneSeen = true;
    if (!fin(steps[3].t1)) steps[3].t1 = Math.max(now, structTail);
    for (let i = 4; i < 7; i++) { if (!fin(steps[i].t0)) steps[i].t0 = Math.max(now, after(i)); if (!fin(steps[i].t1)) steps[i].t1 = Math.max(steps[i].t0, i === 6 ? lastHealthAt + 0.5 : 0); }
    if (!fin(steps[7].t0)) steps[7].t0 = Math.max(now, after(7));
    steps[7].t1 = steps[7].t0 + REG_DUR;
    T = steps[7].t1;
    buildKeys();
  }

  function onEvent(e: BuildupEvent) {
    const wall = performance.now();
    if (e.type === 'begin') { ratePair = { at: e.at, wall }; reset(e); return; }
    if (!S.began) return;
    // the run's own clock: `at` is run time, so the source's pace (a lab speed, or 1 live) sets the engine's
    if (ratePair && wall - ratePair.wall > 80 && e.at > ratePair.at) {
      const r = clamp((e.at - ratePair.at) / (wall - ratePair.wall), 0.25, 8);
      rate = rateSeen ? lerp(rate, r, 0.5) : r; rateSeen = true;
      ratePair = { at: e.at, wall };
    } else if (!ratePair || e.at > ratePair.at) ratePair = { at: e.at, wall };
    if (e.type === 'structure') onStructure(e);
    else if (e.type === 'history') onHistory(e);
    else if (e.type === 'health') onHealth(e);
    else if (e.type === 'phase') onPhase(e);
    else if (e.type === 'done') onDone();
    else if (e.type === 'failed') {
      failed = { phase: e.phase, message: e.message };
      const i = PHASES.indexOf(e.phase); if (i >= 0) { rail[i].failed = true; if (!fin(rail[i].t1)) rail[i].t1 = S.t; }
    }
    dirty = true;
  }

  const stepAt = (t: number) => { for (let i = steps.length - 1; i >= 0; i--) if (t >= steps[i].t0) return i; return 0; };

  // ---------- view: sizes, folding and camera keys ----------
  const LH = 22, HDR = 128, RAIL = 44;
  let V = { dpr: 1, W: 1, H: 1, cw: 8, colW: 300, cap: 10, limit: 10, maxChars: 30, sb: 1, fin: null as Cam | null, keys: [] as Key[], keyRect: null as { X: number; Y: number; s: number; Wk: number; Hk: number } | null };
  const flightCache = new Map<string, { fly: number; self: { x: number; y: number }; tiles: { x: number; y: number }[] | null }>();
  function makeView() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, cv.clientWidth), H = Math.max(1, cv.clientHeight);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.font = `14px ${MONO}`;
    const cw = ctx.measureText('MMMMMMMMMM').width / 10;
    const colW = Math.round(clamp(W * 0.3, 300, 470));
    const cap = Math.max(8, Math.floor((H - HDR - 18) / LH));
    // build scale: tile labels at 14 px (the outline's size) when the window allows, never under 12 px
    const sb = clamp(Math.min((W - colW - 70) / 560, (H - 90) / 300), 0.6, 1);
    V = { ...V, dpr, W, H, cw, colW, cap, limit: clamp(cap - 3, 10, 40), maxChars: Math.floor((colW - 30) / cw), sb };
    provisional = null;
    for (const b of bays) b.foldAt = undefined;
    refold(-Infinity);
    flightCache.clear();
    buildKeys();
  }
  // folding: finished bays waiting to fly fold into one summary line when the outline runs long. Decisions already
  // in the past stand; the rest are recomputed from what has arrived.
  const liftOf = (l: Line) => l.ref.fly;
  function refold(now: number) {
    for (const b of bays) if (b.foldAt !== undefined && b.foldAt > now) b.foldAt = undefined;
    for (const b of bays) {
      const T0 = (b.tiles.length ? b.tiles[b.tiles.length - 1].line : b.line).t1;
      if (T0 <= now) continue;
      let count = 0;
      for (const l of lines) {
        if (l.t0 > T0) break;
        if (liftOf(l) <= T0) continue;
        if (l.kind === 'tile') { const fa = (l.ref as TileN).bay.foldAt; if (fa !== undefined && fa <= T0) continue; }
        count++;
      }
      for (const c of bays) {
        if (count <= V.limit || c === b) break;
        if (c.fly > T0 && c.foldAt === undefined && c.tiles.length > 1) { c.foldAt = T0; count -= c.tiles.length; }
      }
    }
  }
  const area = (colWidth: number) => ({ w: V.W - colWidth, h: V.H });
  const fitBox = (box: BBox, a: { w: number; h: number }, padX: number, padTop: number, padBot: number, maxS: number): Cam => {
    const s = Math.min((a.w - 2 * padX) / Math.max(1, box.w), (a.h - padTop - padBot) / Math.max(1, box.h), maxS);
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 - (padTop - padBot) / 2 / s, s };
  };
  function buildKeys() {
    const keys: Key[] = [];
    const ext = knownExt();
    V.fin = ext ? fitBox(ext, area(RAIL), 46, 112, 70, 1.2) : null;
    const endT = fin(steps[7]?.t0) && doneSeen ? steps[7].t0 : Infinity;
    const s = V.sb, a = area(V.colW), hw = a.w / 2 / s, hh = a.h / 2 / s;
    const o0 = origin && origin.t < 0 ? origin : { x: 0, y: 0 };
    let cx = o0.x - 100 / s + hw, cy = o0.y - 170 / s + hh;
    keys.push({ t: -1, x: cx, y: cy, s, d: 0 });
    if (S.reduced) {
      for (const v of extVersions) { const fb = fitBox(v.ext, area(V.colW), 30, 110, 60, 1); keys.push({ t: v.t, ...fb, d: 0 }); }
      if (V.fin && fin(endT)) keys.push({ t: endT + 0.6, ...V.fin, d: 0 });
    } else {
      if (origin && origin.t >= 0) {
        const nx = origin.x - 100 / s + hw, ny = origin.y - 170 / s + hh;
        if (Math.abs(nx - cx) > 1 || Math.abs(ny - cy) > 1) { keys.push({ t: origin.t, x: nx, y: ny, s, d: 1 }); cx = nx; cy = ny; }
      }
      const ev: { t: number; box: BBox }[] = [];
      for (const w of wings) if (fin(w.fly)) ev.push({ t: w.fly, box: { x: w.box.x, y: w.box.y - 70, w: Math.min(w.box.w, 560), h: 240 } });
      for (const r of rooms) if (fin(r.fly)) ev.push({ t: r.fly, box: { x: r.box.x, y: r.box.y - 70, w: r.box.w, h: Math.min(r.box.h, 300) + 70 } });
      for (const b of bays) if (fin(b.fly)) ev.push({ t: b.fly, box: { x: b.box.x, y: b.box.y - 20, w: b.box.w, h: b.box.h + 30 } });
      ev.sort((p, q2) => p.t - q2.t);
      const padL = 40 / s, padR = 40 / s, padT = 96 / s, padB = 120 / s;
      for (const e of ev) {
        const bx = e.box; let nx = cx, ny = cy;
        if (bx.w + padL + padR > 2 * hw) nx = bx.x - padL + hw;
        else { if (bx.x - padL < nx - hw) nx = bx.x - padL + hw; if (bx.x + bx.w + padR > nx + hw) nx = bx.x + bx.w + padR - hw; }
        if (bx.h + padT + padB > 2 * hh) ny = bx.y - padT + hh;
        else { if (bx.y - padT < ny - hh) ny = bx.y - padT + hh; if (bx.y + bx.h + padB > ny + hh) ny = bx.y + bx.h + padB - hh; }
        if (Math.abs(nx - cx) > 1 || Math.abs(ny - cy) > 1) { keys.push({ t: e.t - 0.15, x: nx, y: ny, s, d: 1.0 }); cx = nx; cy = ny; }
      }
      if (V.fin && fin(endT)) keys.push({ t: endT + 0.25, ...V.fin, d: 2.7 });
    }
    keys.sort((p, q2) => p.t - q2.t);
    V.keys = keys;
  }
  function segVal(seg: { from: Cam; to: Key }, t: number): Cam {
    const p = ease(span(t, seg.to.t, seg.to.d));
    return lerpCam(seg.from, seg.to, p);
  }
  function camAt(t: number): Cam {
    const K = V.keys; let cur: Cam = { x: K[0].x, y: K[0].y, s: K[0].s }, seg: { from: Cam; to: Key } | null = null;
    for (let i = 1; i < K.length; i++) {
      const k = K[i]; if (k.t > t) break;
      if (seg) cur = segVal(seg, k.t);
      seg = { from: cur, to: k };
    }
    return seg ? segVal(seg, t) : cur;
  }
  function colWAt(t: number) {
    if (S.live) return RAIL;
    const r0 = steps[7].t0;
    if (!fin(r0)) return V.colW;
    if (S.reduced) return t >= r0 + 0.6 ? RAIL : V.colW;
    return lerp(V.colW, RAIL, ease(span(t, r0 + 0.1, 1.7)));
  }
  function camNow(t: number): Cam {
    if (S.live) return S.cam;
    const c = camAt(t);
    if (S.userCam) {
      const r0 = steps[7].t0;
      if (!fin(r0) || !doneSeen || t < r0 + 0.25) return S.userCam;
      return lerpCam(S.userCam, c, ease(span(t, r0 + 0.25, 2.7)));
    }
    return c;
  }
  let F = { cam: { x: 0, y: 0, s: 1 } as Cam, cw: 300, ox: 0, oy: 0 };
  const sx = (x: number) => (x - F.cam.x) * F.cam.s + F.ox;
  const sy = (y: number) => (y - F.cam.y) * F.cam.s + F.oy;
  const wx = (x: number) => (x - F.ox) / F.cam.s + F.cam.x;
  const wy = (y: number) => (y - F.oy) / F.cam.s + F.cam.y;
  function setFrame(t: number) { const cw = colWAt(t); F = { cam: camNow(t), cw, ox: cw + (V.W - cw) / 2, oy: V.H / 2 }; }

  // the site's extent as drawn: unknown on a live run until the structure lands, so the sheet starts as a provisional
  // frame over the empty drawing area and re-frames to the site when it is known (and again whenever it grows)
  function extAt(t: number): { box: BBox; known: boolean } | null {
    if (!provisional) provisional = { x: wx(F.cw + 80), y: wy(150), w: (V.W - F.cw - 160) / F.cam.s, h: (V.H - 240) / F.cam.s };
    if (!extVersions.length) return { box: provisional, known: false };
    let cur: BBox = extVersions[0].t < 0 ? extVersions[0].ext : provisional;
    let from = cur;
    for (const v of extVersions) {
      if (v.t > t) break;
      from = cur;
      cur = S.reduced || v.t < 0 ? v.ext : lerpBox(from, v.ext, ease(span(t, v.t, 1.2)));
    }
    return { box: cur, known: t >= extVersions[0].t };
  }

  // ---------- the outline column ----------
  function slotH(l: Line, t: number) {
    if (t < l.t0) return 0;
    let h = S.reduced ? LH : LH * easeOut(span(t, l.t0, 0.14));
    if (l.kind === 'tile') { const fa = (l.ref as TileN).bay.foldAt; if (fa !== undefined && t > fa) h *= 1 - ease(span(t, fa, 0.45)); }
    const lift = liftOf(l);
    if (t > lift) h *= 1 - ease(span(t, lift + (S.reduced ? 0.6 : 0.2), 0.5));
    return h;
  }
  function layoutColumn(t: number) {
    const n = lines.length, ys = new Float32Array(n);
    let y = 0, cursor = -1;
    for (let i = 0; i < n; i++) { ys[i] = y; const l = lines[i]; if (l.t0 <= t) cursor = i; y += slotH(l, t); }
    const visH = V.H - HDR - 14;
    const cb = cursor >= 0 ? ys[cursor] + LH : 0;
    const scroll = Math.max(0, cb - (visH - LH * 1.5));
    return { ys, scroll, cursor };
  }
  function lineText(l: Line) {
    const max = V.maxChars - l.prefix.length - (l.kind === 'bay' ? 4 : 0);
    return l.text.length > max ? l.text.slice(0, Math.max(1, max - 1)) + '…' : l.text;
  }
  // the tree glyphs are drawn one monospace cell at a time: the web font's latin subset has no box-drawing glyphs, and a
  // fallback font's wider glyphs would push the names off the grid
  function drawPrefix(prefix: string, x: number, y: number) {
    for (let i = 0; i < prefix.length; i++) { const ch = prefix[i]; if (ch !== ' ') ctx.fillText(ch, x + i * V.cw, y); }
  }
  const mixFresh = (kind: Kind, f: number) => (f > 0.5 ? C.accent : kind === 'tile' ? C['ink-2'] : C.ink);
  function drawColumn(t: number, cw: number) {
    if (cw <= RAIL + 0.5) return;
    const H = V.H;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, cw, H); ctx.clip();
    ctx.fillStyle = C['panel-solid']; ctx.fillRect(0, 0, cw, H);
    const step = stepAt(t);
    const x0 = 16;
    if (step <= 3 && t < steps[3].t1) {
      const lay = layoutColumn(t);
      ctx.textBaseline = 'middle';
      drawStepLog(t, cw, lines.length && lines[0].t0 <= t + 0.4 ? 1 - span(t, lines[0].t0 - 0.4, 0.4) : 1);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]; const h = slotH(l, t); if (h < 0.5) continue;
        const y = HDR + lay.ys[i] - lay.scroll + LH / 2;
        if (y < HDR - LH || y > H + LH) continue;
        const lift = liftOf(l);
        const lifted = t >= lift;
        const preA = lifted ? 1 - span(t, lift, 0.35) : 1;
        const rowA = clamp(h / LH);
        // about to leave: a selection band, like text being cut
        const warn = !S.reduced && !lifted ? span(t, lift - 0.45, 0.3) : 0;
        if (warn > 0) { ctx.fillStyle = accA(0.16 * warn); ctx.fillRect(8, y - LH / 2 + 1, cw - 16, LH - 2); }
        const txt = lineText(l);
        const p = S.reduced ? (t >= l.t0 ? 1 : 0) : span(t, l.t0, l.t1 - l.t0);
        const shown = txt.slice(0, Math.ceil(txt.length * p));
        ctx.font = (l.kind === 'wing' ? '600 ' : l.kind === 'room' ? '500 ' : '') + `14px ${MONO}`;
        ctx.globalAlpha = rowA * preA;
        ctx.fillStyle = l.kind === 'wing' ? C.accent : C['ink-3'];
        drawPrefix(l.prefix, x0, y);
        const nx = x0 + l.prefix.length * V.cw;
        const bay = l.kind === 'bay' ? (l.ref as BayN) : null;
        const folded = !!bay && bay.foldAt !== undefined && t >= bay.foldAt;
        if (!lifted || S.reduced) {
          let a = rowA;
          if (lifted) a *= 1 - span(t, lift, 0.5);
          ctx.globalAlpha = a;
          const fresh = 1 - span(t, l.t1, 0.6);
          ctx.fillStyle = l.kind === 'wing' ? C['ink-hi'] : l.kind === 'room' ? C.ink : l.kind === 'bay' ? C.ink : C['ink-2'];
          if (fresh > 0 && !S.reduced) ctx.fillStyle = mixFresh(l.kind, fresh);
          ctx.fillText(shown, nx, y);
          if (bay && p >= 1) {
            ctx.fillStyle = C['ink-3'];
            if (folded && bay.foldAt !== undefined) { ctx.globalAlpha = a * span(t, bay.foldAt, 0.4); ctx.fillText(' · ' + bay.tiles.length + ' features', nx + txt.length * V.cw, y); }
            else { ctx.globalAlpha = a * span(t, l.t1, 0.3); ctx.textAlign = 'right'; ctx.fillText(String(bay.tiles.length), cw - 16, y); ctx.textAlign = 'left'; }
          }
          if (S.reduced && lifted) { ctx.globalAlpha = rowA * span(t, lift, 0.3); ctx.fillStyle = C.mint; ctx.fillText('✓', cw - 34, y); }
        }
        ctx.globalAlpha = 1;
      }
      // cursor
      const lastL = lines[lines.length - 1];
      if (t >= steps[3].t0 && (!lastL || !treeDone || t < lastL.t1 + 4)) {
        let cy2 = HDR + LH / 2, cx2 = x0;
        if (lay.cursor >= 0) {
          const l = lines[lay.cursor]; const txt = lineText(l);
          const p = S.reduced ? 1 : span(t, l.t0, l.t1 - l.t0);
          cy2 = HDR + lay.ys[lay.cursor] - lay.scroll + LH / 2; cx2 = x0 + (l.prefix.length + Math.ceil(txt.length * p)) * V.cw + 2;
          if (p >= 1 && t >= liftOf(l)) { cy2 = HDR + LH / 2; cx2 = x0; }
        }
        const typing = lay.cursor >= 0 && t < lines[lay.cursor].t1;
        if (typing || Math.floor(t * 2.2) % 2 === 0) { ctx.fillStyle = C.accent; ctx.fillRect(cx2, cy2 - 8, Math.max(7, V.cw * 0.8), 16); }
      }
    } else {
      drawLog(t, cw);
    }
    // header (drawn over scrolled lines)
    const g = ctx.createLinearGradient(0, HDR - 14, 0, HDR + 6);
    ctx.fillStyle = C['panel-solid']; ctx.fillRect(0, 0, cw, HDR - 14);
    g.addColorStop(0, C['panel-solid']); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, HDR - 14, cw, 20);
    drawHeader(t, cw, step);
    ctx.restore();
    ctx.fillStyle = C['ink-4']; ctx.fillRect(cw - 1, 0, 1, H);
  }
  // before the first words: the steps the run has finished, with their real times, under the waiting cursor
  function drawStepLog(t: number, cw: number, a: number) {
    if (a <= 0.01) return;
    const x0 = 16;
    ctx.font = `14px ${MONO}`; ctx.textBaseline = 'middle';
    let row = 0;
    for (let i = 0; i < 4; i++) {
      const r = rail[i]; if (!fin(r.t0)) break;
      const y = HDR + LH * (2 + row) + LH / 2;
      const running = !fin(r.t1);
      const dur = (running ? t : r.t1) - r.t0;
      ctx.globalAlpha = a;
      ctx.fillStyle = running ? C.accent : r.failed ? C['red-2'] : C['ink-3'];
      ctx.fillText(running ? '▸' : r.failed ? '✕' : '✓', x0, y);
      ctx.fillStyle = running ? C['ink-2'] : C['ink-3'];
      const name = `${i + 1} ${STEP_DEF[i].n}${STEP_DEF[i].llm ? ' (LLM)' : ''}`;
      const time = running ? fmtT(dur) : dur < 10 ? dur.toFixed(1) + ' s' : fmtT(dur);
      ctx.textAlign = 'right'; ctx.fillText(time, cw - 16, y); ctx.textAlign = 'left';
      ctx.fillText(fitMono(name + (r.detail ? ' · ' + r.detail : ''), Math.floor((cw - 32 - 2 * V.cw - (time.length + 1) * V.cw) / V.cw)), x0 + 2 * V.cw, y);
      row++;
    }
    ctx.globalAlpha = 1;
  }
  function drawHeader(t: number, cw: number, step: number) {
    const x0 = 16; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    setLS(1.6); ctx.font = `500 12px ${MONO}`; ctx.fillStyle = C['ink-3'];
    ctx.fillText(step < 4 ? 'ONBOARDING · PRODUCT TREE' : 'ONBOARDING · ' + STEP_DEF[step].n.toUpperCase(), x0, 26);
    setLS(1); ctx.font = `600 26px ${SANS}`; ctx.fillStyle = C['ink-hi'];
    ctx.fillText(fitEll(project.name.toUpperCase(), cw - 32), x0, 58);
    setLS(0);
    // counters: what has been written so far (real counts as they arrive)
    let w = 0, r = 0, b = 0, f = 0;
    for (const l of lines) { if (l.t0 > t) break; if (l.kind === 'wing') w++; else if (l.kind === 'room') r++; else if (l.kind === 'bay') b++; else f++; }
    ctx.font = `14px ${SANS}`; ctx.fillStyle = C['ink-2'];
    const pl = (n: number, w1: string) => n + ' ' + w1 + (n === 1 ? '' : 's');
    const ct = t < steps[3].t0 ? 'reading the repository…' : `${pl(w, 'wing')} · ${pl(r, 'room')} · ${pl(b, 'bay')} · ${pl(f, 'feature')}`;
    ctx.fillText(fitEll(ct, cw - 32), x0, 82);
    // the running step
    const st = steps[step];
    ctx.font = `500 12px ${MONO}`; setLS(0.8);
    ctx.fillStyle = C.accent;
    let detail = st.what;
    if (step === 3) {
      let typed = 0;
      for (const l of lines) { if (l.t0 <= t) typed++; else break; }
      const allTyped = typed === lines.length && lines.length > 0;
      detail = typed + ' of ' + (treeDone && allTyped ? lines.length : '…') + ' lines';
      if (typed === 0) detail = 'the model is reading the code · ' + fmtT(t - st.t0);
      else if (allTyped && !treeDone) detail += ' · waiting for the model';
      if (allTyped && treeDone) detail = 'all ' + lines.length + ' lines written · drafting';
    } else if (step === 6) {
      let judged = 0; for (const x of healthOrder) if (x.healthAt <= t) judged++;
      detail = `${judged} of ${tiles.length} judged`;
      if (!judgeDone && judged === healthOrder.length) detail += ' · waiting for the model';
    }
    if (failed) { ctx.fillStyle = C['red-2']; detail = `failed at ${failed.phase}: ${failed.message}`; }
    ctx.fillText(fitEll(`${step + 1}/8 ${st.n.toUpperCase()}${st.llm ? ' (LLM)' : ''} · ${detail}`, cw - 32), x0, 106);
    setLS(0);
  }
  const fitMono = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
  // after the outline is consumed, the column logs what the later steps deliver, with real names and dates
  function drawLog(t: number, cw: number) {
    const step = stepAt(t), x0 = 16;
    ctx.textBaseline = 'middle';
    let list: TileN[] | null = null, keyName: 'stampAt' | 'healthAt' = 'stampAt';
    if (step === 4) { list = stampOrder; keyName = 'stampAt'; }
    else if (step >= 6) { list = healthOrder; keyName = 'healthAt'; }
    const top = HDR + 6, rows = Math.floor((V.H - top - 12) / LH);
    if (step === 5) {
      const st = steps[5];
      const p = measureDone && t >= st.t1 - MS_DUR ? span(t, st.t1 - MS_DUR, MS_DUR) : ((t - st.t0) % MS_DUR) / MS_DUR;
      ctx.font = `14px ${MONO}`; ctx.fillStyle = C['ink-2'];
      ctx.fillText(measureDone && t >= st.t1 - MS_DUR ? `measured ${Math.round(p * tiles.length)} of ${tiles.length} features` : `measuring ${tiles.length} features…`, x0, top + LH / 2);
      ctx.fillStyle = C['ink-4']; ctx.fillRect(x0, top + LH + 6, cw - 32, 4);
      ctx.fillStyle = C.accent; ctx.fillRect(x0, top + LH + 6, (cw - 32) * p, 4);
      return;
    }
    if (!list) return;
    let hi = -1; for (let i = 0; i < list.length; i++) { if (list[i][keyName] <= t) hi = i; else break; }
    const from = Math.max(0, hi - rows + 1);
    for (let i = from; i <= hi; i++) {
      const tl = list[i], y = top + (i - from) * LH + LH / 2;
      const a = S.reduced ? 1 : span(t, tl[keyName], 0.25);
      ctx.globalAlpha = a * (i === hi ? 1 : 0.9);
      ctx.font = `14px ${MONO}`;
      let x = x0;
      if (keyName === 'stampAt') {
        if (hasDates) { ctx.fillStyle = C['ink-3']; const dt = (tl.created || '').slice(0, 10); ctx.fillText(dt, x, y); x += 11 * V.cw; }
        const word = tl.stage ? STAGE_WORD[tl.stage] || tl.stage : 'no stage';
        const wW = (word.length + 1) * V.cw;
        ctx.fillStyle = tl.stage === 'live' ? C.ink : tl.stage === 'deprecated' ? C['red-2'] : C['ink-2'];
        ctx.textAlign = 'right'; ctx.fillText(word, cw - 14, y); ctx.textAlign = 'left';
        ctx.fillStyle = C['ink-2']; ctx.fillText(fitMono(tl.name, Math.floor((cw - 14 - wW - x) / V.cw)), x, y);
      } else {
        ctx.fillStyle = healthCol(tl.general);
        ctx.fillRect(x, y - 5, 10, 10); x += 18;
        ctx.fillStyle = C['ink-2']; ctx.fillText(fitMono(tl.name, Math.floor((cw - 14 - 7 * V.cw - x) / V.cw)), x, y);
        ctx.fillStyle = tl.general === 'bad' ? C['red-2'] : tl.general === 'watch' ? C.amber : C['ink-3'];
        ctx.textAlign = 'right'; ctx.fillText(tl.general ?? '', cw - 14, y); ctx.textAlign = 'left';
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- the plan ----------
  const isDone = (t: number) => S.live || t >= T;
  function wallProgress(o: PNode, t: number) { // how much of a box's walls are drawn
    if (isDone(t)) return 1;
    if (o.kind === 'wing') return S.reduced ? span(t, o.fly + 0.3, 0.4) : span(t, o.fly + 0.55, 1.1);
    if (o.kind === 'room') return S.reduced ? span(t, o.fly + 0.3, 0.4) : span(t, o.fly + DUR.room * 0.35, DUR.room * 0.65);
    return 1;
  }
  function labelA(o: PNode, t: number) {
    if (isDone(t)) return 1;
    if (S.reduced) return span(t, o.fly + 0.3, 0.4);
    if (o.kind === 'wing') return span(t, o.fly + DUR.wing * 0.82, DUR.wing * 0.18);
    if (o.kind === 'room') return span(t, o.fly + DUR.room * 0.5, DUR.room * 0.16);
    if (o.kind === 'bay') return span(t, o.fly + DUR.bay * 0.42, DUR.bay * 0.1);
    return 1;
  }
  function measLocal(t: number): number | null {
    const ms = steps[5];
    if (!fin(ms.t0) || t < ms.t0) return null;
    if (fin(ms.t1) && t >= ms.t1 - MS_DUR) return t - (ms.t1 - MS_DUR);
    return (t - ms.t0) % MS_DUR;
  }
  interface TileState { a: number; la: number; k: number; sa: number; ha: number; fl: number; ma: number }
  function tileState(tl: TileN, t: number): TileState {
    const done = isDone(t);
    const b = tl.bay, Db = DUR.bay, f0 = tl.fly;
    let a: number, la: number, k = 1;
    if (done) { a = 1; la = 1; }
    else if (S.reduced) { a = span(t, f0 + 0.3, 0.45); la = a; }
    else if (b.foldAt !== undefined) { const p = span(t, f0 + Db * 0.42, Db * 0.45); a = p; k = easeOut(p); la = span(t, f0 + Db * 0.82, Db * 0.18); }
    else { a = span(t, f0 + Db * 0.55, Db * 0.3); la = span(t, f0 + Db * 0.84, Db * 0.16); }
    const sa = done ? 1 : span(t, tl.stampAt, S.reduced ? 0.3 : 0.22);
    const ha = done ? (tl.general ? 1 : 0) : span(t, tl.healthAt, 0.35);
    const fl = done || S.reduced ? 0 : 1 - span(t, tl.stampAt, 0.7);
    let ma = 0;
    const ext = knownExt();
    const loc = done || S.reduced || !ext ? null : measLocal(t);
    if (loc !== null && ext && (!fin(steps[5].t1) || t < steps[5].t1 + 0.9)) {
      const at = 0.2 + (tl.box.x + tl.box.w / 2 - ext.x) / Math.max(1, ext.w) * (MS_DUR - 0.5);
      if (loc >= at) ma = 1 - span(loc, at, 0.9);
      else if (t - steps[5].t0 >= MS_DUR) ma = 1 - span(loc + MS_DUR, at, 0.9);
    }
    return { a, la, k, sa, ha, fl: t >= tl.stampAt ? fl : 0, ma };
  }
  function perim(x: number, y: number, w: number, h: number, p: number) { // trace a rectangle's walls from the top-left, clockwise
    const L = 2 * (w + h); let r = L * p;
    ctx.beginPath(); ctx.moveTo(x, y);
    const seg: [number, number][] = [[w, 0], [0, h], [-w, 0], [0, -h]]; let cx = x, cy = y;
    for (const [dx, dy] of seg) { const len = Math.abs(dx + dy); if (r <= 0) break; const q2 = Math.min(1, r / len); cx += dx * q2; cy += dy * q2; ctx.lineTo(cx, cy); r -= len; }
    ctx.stroke();
  }
  function drawPaper(t: number) {
    const { W, H } = V;
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    // light-table core glow
    const cx = F.ox, cy = F.oy;
    const rg = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(W, H) * 0.75);
    rg.addColorStop(0, C['paper-mid']); rg.addColorStop(1, C.paper);
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    // drafting grid, world-anchored
    const s = F.cam.s; let g = 40; while (g * s < 14) g *= 5;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
    const x0 = Math.floor(wx(F.cw) / g) * g, x1 = wx(W), y0 = Math.floor(wy(0) / g) * g, y1 = wy(H);
    for (let x = x0; x <= x1; x += g) { const X = Math.round(sx(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, H); }
    for (let y = y0; y <= y1; y += g) { const Y = Math.round(sy(y)) + 0.5; ctx.moveTo(F.cw, Y); ctx.lineTo(W, Y); }
    ctx.stroke();
    // sheet frame around the site, laid first (provisional, dashed, while the site is not yet known)
    const ex = extAt(t); if (!ex) return;
    const e = ex.box, pad = 50;
    const fp = S.live || S.reduced ? 1 : span(t, 0, 1.4);
    ctx.strokeStyle = inkA(0.22); ctx.lineWidth = 1;
    if (!ex.known) ctx.setLineDash([6, 6]);
    const fTop = Math.min(sy(e.y - pad - 60), sy(e.y) - 92), fBot = sy(e.y + e.h + pad);
    perim(sx(e.x - pad), fTop, (e.w + 2 * pad) * s, fBot - fTop, fp);
    ctx.setLineDash([]);
    if (fp > 0.5) {
      ctx.globalAlpha = span(fp, 0.5, 0.5);
      ctx.font = `500 12px ${MONO}`; setLS(1.4); ctx.fillStyle = C['ink-3']; ctx.textBaseline = 'bottom';
      ctx.fillText(`SHEET G-001 · GENERAL ARRANGEMENT · ${project.name.toUpperCase()}${ex.known ? '' : ' · SITE NOT YET SURVEYED'}`, sx(e.x - pad) + 2, fTop - 6);
      if (S.live || t >= steps[4].t0) {
        const by = sy(e.y + e.h) + 30; ctx.textBaseline = 'middle';
        if (by < V.H - 10) {
          const lx = sx(e.x), rx = sx(e.x + e.w);
          ctx.fillText('OLDEST WORK', lx, by); ctx.textAlign = 'right'; ctx.fillText('NEWEST WORK ▸', rx, by); ctx.textAlign = 'center';
          if (rx - lx > 620) ctx.fillText('LEFT TO RIGHT: WINGS IN THE ORDER WORK BEGAN · FEATURES OLDEST FIRST', (lx + rx) / 2, by);
          ctx.textAlign = 'left';
        }
      }
      setLS(0); ctx.globalAlpha = 1;
    }
  }
  function drawPlan(t: number) {
    const s = F.cam.s;
    const showLabels = 14 * s >= 11.95;
    for (const w of wings) {
      if (!S.live && t < w.fly) continue;
      const p = wallProgress(w, t); if (p <= 0) continue;
      const X = sx(w.box.x), Y = sy(w.box.y), Wd = w.box.w * s, Hd = w.box.h * s;
      if (X > V.W || X + Wd < F.cw - 200 || Y > V.H || Y + Hd < -200) continue;
      ctx.fillStyle = inkA(0.035 * p); ctx.fillRect(X, Y, Wd, Hd);
      ctx.strokeStyle = C.ink; ctx.lineWidth = Math.max(1.5, 3 * s); ctx.globalAlpha = 0.9;
      perim(X, Y, Wd, Hd, p); ctx.globalAlpha = 1;
    }
    for (const r of rooms) {
      if (!S.live && t < r.fly) continue;
      const p = wallProgress(r, t); if (p <= 0) continue;
      const X = sx(r.box.x), Y = sy(r.box.y), Wd = r.box.w * s, Hd = r.box.h * s;
      if (X > V.W || X + Wd < F.cw - 50 || Y > V.H || Y + Hd < -50) continue;
      ctx.strokeStyle = C.line; ctx.lineWidth = Math.max(1, 2 * s);
      perim(X + 1, Y + 1, Wd - 2, Hd - 2, p);
    }
    for (const b of bays) {
      if (!S.live && t < b.fly) continue;
      const X = sx(b.box.x), Y = sy(b.box.y), Wd = b.box.w * s;
      if (X > V.W || X + Wd < F.cw || Y > V.H + 10 || Y + b.box.h * s < 0) continue;
      const p = isDone(t) ? 1 : S.reduced ? span(t, b.fly + 0.3, 0.4) : span(t, b.fly + DUR.bay * 0.3, DUR.bay * 0.3);
      ctx.strokeStyle = inkA(0.45); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X, Y + 0.5); ctx.lineTo(X + Wd * p, Y + 0.5); ctx.stroke();
    }
    for (const tl of tiles) {
      if (!S.live && t < tl.fly) continue;
      const st = tileState(tl, t); if (st.a <= 0) continue;
      drawTile(tl, st, showLabels, s);
    }
    // measure sweep
    const ext = knownExt();
    const loc = measLocal(t);
    if (ext && loc !== null && !S.live && !S.reduced && (!fin(steps[5].t1) || t < steps[5].t1 + 0.3)) {
      const p = span(loc, 0.2, MS_DUR - 0.5);
      const X = sx(ext.x + ext.w * p), Y0 = sy(ext.y - 20), Y1 = sy(ext.y + ext.h + 20);
      const gr = ctx.createLinearGradient(X - 90, 0, X, 0); gr.addColorStop(0, accA(0)); gr.addColorStop(1, accA(0.18));
      ctx.fillStyle = gr; ctx.fillRect(X - 90, Y0, 90, Y1 - Y0);
      ctx.fillStyle = C.accent; ctx.fillRect(X - 1, Y0, 2, Y1 - Y0);
    }
    // labels over the drawing: bays, rooms, wings
    for (const b of bays) {
      if (!S.live && t < b.fly) continue;
      const a = labelA(b, t); if (a <= 0) continue;
      const X = sx(b.box.x), Y = sy(b.box.y), Wd = b.box.w * s;
      const band = 46 * s;
      if (band < 15 || Wd < 70 || X > V.W || X + Wd < F.cw || Y > V.H || Y < -20) continue;
      ctx.globalAlpha = a; ctx.font = `500 12px ${MONO}`; setLS(0.8); ctx.textBaseline = 'middle';
      const cnt = String(b.tiles.length);
      const name = fitEll(b.name.toUpperCase(), Wd - 34);
      const ty = Y + Math.min(band / 2, 16);
      ctx.fillStyle = C['ink-2']; ctx.fillText(name, X + 2, ty);
      const nw = ctx.measureText(name).width;
      ctx.fillStyle = C['ink-3']; ctx.fillText(cnt, X + nw + 12, ty);
      setLS(0); ctx.globalAlpha = 1;
    }
    for (const r of rooms) {
      if (!S.live && t < r.fly) continue;
      const a = labelA(r, t); if (a <= 0) continue;
      const X = sx(r.box.x), Y = sy(r.box.y), Wd = r.box.w * s;
      if (Wd < 60 || X > V.W || X + Wd < F.cw || Y > V.H || Y + r.box.h * s < 0) continue;
      drawRoomPlate(r, X, Y, Wd, s, a);
    }
    for (const w of wings) {
      if (!S.live && t < w.fly) continue;
      const a = labelA(w, t); if (a <= 0) continue;
      drawWingLabel(w, t, a, s);
    }
  }
  function drawRoomPlate(r: RoomN, X: number, Y: number, Wd: number, s: number, a: number) {
    ctx.font = `600 12px ${SANS}`; setLS(1);
    const lines2 = 72 * s >= 36 ? 2 : 1;
    const words = wrapText(r.name.toUpperCase(), Wd - 26, lines2);
    const w = Math.max(...words.map((l) => ctx.measureText(l).width)) + 12, h = words.length * 15 + 7;
    const px = X + Math.max(4, 8 * s), py = Y + Math.max(4, 8 * s);
    ctx.globalAlpha = a;
    ctx.fillStyle = C['label-bg']; ctx.fillRect(px, py, w, h);
    ctx.fillStyle = C['ink-hi']; ctx.textBaseline = 'top';
    words.forEach((l, i) => ctx.fillText(l, px + 6, py + 4 + i * 15));
    ctx.globalAlpha = 1; setLS(0);
  }
  function wingStats(w: WingN, t: number) {
    let n = 0, live = 0, bad = 0;
    const done = isDone(t);
    for (const tl of w.tiles) { n++; if ((done || t >= tl.stampAt) && tl.stage === 'live') live++; if ((done || t >= tl.healthAt) && tl.general === 'bad') bad++; }
    return { n, live, bad };
  }
  function drawWingLabel(w: WingN, t: number, a: number, s: number) {
    const X = sx(w.box.x), Y = sy(w.box.y), Wd = w.box.w * s;
    if (X > V.W || X + Wd < F.cw) return;
    ctx.globalAlpha = a; ctx.textBaseline = 'middle';
    const ly = Y - 48;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X + 10, ly, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `600 12px ${MONO}`; ctx.fillStyle = C['ink-hi']; ctx.textAlign = 'center'; ctx.fillText(w.letter, X + 10, ly + 0.5); ctx.textAlign = 'left';
    ctx.font = `600 14px ${SANS}`; setLS(1);
    if (Wd > 50) ctx.fillText(fitEll(w.name.toUpperCase(), Wd - 28), X + 25, ly + 1);
    setLS(0);
    const histOn = S.live || t >= steps[4].t0;
    if (Wd > 70) {
      const stt = wingStats(w, t);
      ctx.font = `13px ${SANS}`; ctx.fillStyle = C['ink-2'];
      let txt = stt.n + (Wd > 150 ? ' features' : '');
      if (histOn) txt += ' · ' + stt.live + ' live';
      ctx.fillText(fitEll(txt, Wd - 4), X, Y - 26);
      const tw = ctx.measureText(txt).width, bt = stt.bad + ' in trouble';
      if (stt.bad && tw + ctx.measureText(bt).width + 16 < Wd - 4) { ctx.fillStyle = C['red-2']; ctx.textAlign = 'right'; ctx.fillText(bt, X + Wd - 2, Y - 26); ctx.textAlign = 'left'; }
      // stage bar: share of the wing that is built
      ctx.fillStyle = inkA(0.16); ctx.fillRect(X, Y - 12, Wd - 4, 3);
      if (histOn) { ctx.fillStyle = inkA(0.7); ctx.fillRect(X, Y - 12, (Wd - 4) * stt.live / Math.max(1, stt.n), 3); }
    }
    ctx.globalAlpha = 1;
  }
  function hatch(X: number, Y: number, Wd: number, Hd: number, gap: number, dir: number, col: string) {
    ctx.save(); ctx.beginPath(); ctx.rect(X, Y, Wd, Hd); ctx.clip();
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = -Hd; k < Wd; k += gap) { if (dir > 0) { ctx.moveTo(X + k, Y + Hd); ctx.lineTo(X + k + Hd, Y); } else { ctx.moveTo(X + k, Y); ctx.lineTo(X + k + Hd, Y + Hd); } }
    ctx.stroke(); ctx.restore();
  }
  function drawTile(tl: TileN, st: TileState, showLabels: boolean, s: number) {
    const b = tl.box;
    let X = sx(b.x), Y = sy(b.y), Wd = b.w * s, Hd = b.h * s;
    if (X > V.W || X + Wd < F.cw || Y > V.H || Y + Hd < 0) return;
    if (st.k < 1) { // a folded bay: tiles unfold out of the bay tag
      const ox = sx(tl.bay.box.x), oy = sy(tl.bay.box.y);
      X = lerp(ox, X, st.k); Y = lerp(oy, Y, st.k); Wd *= st.k; Hd *= st.k;
    }
    ctx.globalAlpha = st.a;
    ctx.fillStyle = C['tile-base']; ctx.fillRect(X, Y, Wd, Hd);
    ctx.strokeStyle = inkA(0.3); ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.strokeRect(X + 0.5, Y + 0.5, Wd - 1, Hd - 1);
    // stage, stamped by the history step
    if (st.sa > 0) {
      ctx.globalAlpha = st.a * st.sa;
      const stg = tl.stage, hatchGap = Math.max(5, 9 * s);
      if (stg === 'live') { ctx.fillStyle = inkA(0.22); ctx.fillRect(X, Y, Wd, Hd); ctx.strokeStyle = inkA(0.7); ctx.strokeRect(X + 0.5, Y + 0.5, Wd - 1, Hd - 1); }
      else if (stg === 'flagged') { ctx.fillStyle = inkA(0.22); ctx.fillRect(X, Y, Wd * 0.5, Hd); ctx.setLineDash([5, 3]); ctx.strokeStyle = inkA(0.75); ctx.strokeRect(X + 0.5, Y + 0.5, Wd - 1, Hd - 1); ctx.setLineDash([]); }
      else if (stg === 'in-review') { hatch(X, Y, Wd, Hd, hatchGap, 1, inkA(0.28)); hatch(X, Y, Wd, Hd, hatchGap, -1, inkA(0.28)); ctx.strokeStyle = inkA(0.6); ctx.strokeRect(X + 0.5, Y + 0.5, Wd - 1, Hd - 1); }
      else if (stg === 'in-dev') { hatch(X, Y, Wd, Hd, hatchGap, 1, inkA(0.3)); ctx.strokeStyle = inkA(0.6); ctx.strokeRect(X + 0.5, Y + 0.5, Wd - 1, Hd - 1); ctx.fillStyle = inkA(0.5); ctx.fillRect(X + 3, Y + Hd - Math.max(6, 12 * s), Wd - 6, Math.max(1, 2 * s)); }
      else if (stg === 'specified') { ctx.fillStyle = C.paper; ctx.fillRect(X, Y, Wd, Hd); ctx.setLineDash([5, 3]); ctx.strokeStyle = inkA(0.8); ctx.strokeRect(X + 0.5, Y + 0.5, Wd - 1, Hd - 1); ctx.setLineDash([]); }
      else if (stg === 'idea') { ctx.fillStyle = C.paper; ctx.fillRect(X, Y, Wd, Hd); ctx.setLineDash([1.5, 2.5]); ctx.strokeStyle = inkA(0.8); ctx.strokeRect(X + 0.5, Y + 0.5, Wd - 1, Hd - 1); ctx.setLineDash([]); }
      else if (stg === 'deprecated') { ctx.strokeStyle = inkA(0.4); ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Wd, Y + Hd); ctx.moveTo(X + Wd, Y); ctx.lineTo(X, Y + Hd); ctx.stroke(); }
      if (st.fl > 0) { ctx.globalAlpha = st.fl; ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.strokeRect(X - 1, Y - 1, Wd + 2, Hd + 2); ctx.lineWidth = 1; }
    }
    if (st.ma > 0) { ctx.globalAlpha = st.ma * 0.5; ctx.fillStyle = C.accent; ctx.fillRect(X, Y, Wd, Hd); }
    // health, judged last
    if (st.ha > 0) {
      ctx.globalAlpha = st.a;
      const hh = Math.max(2, 5 * s);
      ctx.fillStyle = healthCol(tl.general); ctx.fillRect(X, Y + Hd - hh, Wd * easeOut(st.ha), hh);
    }
    // label: only where it reads at 12 px or more
    if (showLabels && st.la > 0 && st.k >= 1) {
      const fs = 14 * s;
      ctx.globalAlpha = st.la * st.a;
      ctx.font = `500 ${fs}px ${SANS}`; ctx.textBaseline = 'top';
      ctx.fillStyle = tl.stage === 'deprecated' && st.sa > 0 ? C['ink-2'] : C['ink-hi'];
      const lh = 17 * s;
      tl.wrap.forEach((l, i) => ctx.fillText(l, X + 8 * s, Y + 8 * s + i * lh));
    }
    ctx.globalAlpha = 1;
  }

  // ---------- flights: lines leave the outline and become the plan ----------
  function flightSources(o: WingN | RoomN | BayN) {
    const key = o.kind + ':' + o.id;
    const c0 = flightCache.get(key);
    if (c0) return c0;
    const lay = layoutColumn(o.fly - 0.001);
    const pos = (l: Line) => ({ x: 16 + l.prefix.length * V.cw, y: HDR + lay.ys[l.i] - lay.scroll + LH / 2 });
    const c = { fly: o.fly, self: pos(o.line), tiles: o.kind === 'bay' && o.foldAt === undefined ? o.tiles.map((tl) => pos(tl.line)) : null };
    flightCache.set(key, c);
    return c;
  }
  function flyText(txt: string, x: number, y: number, fs: number, font: number, col: string, a: number, glow: number) {
    ctx.globalAlpha = a; ctx.font = `${font} ${fs}px ${MONO}`; ctx.textBaseline = 'middle';
    if (glow > 0.02) { // a cheap halo: the line is lifted off the paper while it travels
      ctx.globalAlpha = a * 0.35 * glow; ctx.strokeStyle = C.accent; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.strokeText(txt, x, y); ctx.lineWidth = 1; ctx.globalAlpha = a;
    }
    ctx.fillStyle = col; ctx.fillText(txt, x, y);
    ctx.globalAlpha = 1;
  }
  function drawFlights(t: number) {
    if (S.reduced || S.live || t >= steps[4].t0) return;
    const s = F.cam.s;
    const labelsOn = 14 * s >= 11.95;
    for (const w of wings) {
      const p = span(t, w.fly, DUR.wing); if (p <= 0 || p >= 1) continue;
      const src = flightSources(w), e = ease(p);
      const tx = sx(w.box.x) + 25, ty = sy(w.box.y) - 47;
      const x = lerp(src.self.x, tx, e), y = lerp(src.self.y, ty, e) - Math.sin(Math.PI * e) * 34;
      flyText(lineText(w.line), x, y, 14, 600, C['ink-hi'], 1 - span(p, 0.82, 0.18), 1 - p);
    }
    for (const r of rooms) {
      const p = span(t, r.fly, DUR.room); if (p <= 0 || p >= 0.68) continue;
      const src = flightSources(r), e = ease(span(p, 0, 0.55));
      const tx = sx(r.box.x) + Math.max(4, 8 * s) + 6, ty = sy(r.box.y) + Math.max(4, 8 * s) + 10;
      const x = lerp(src.self.x, tx, e), y = lerp(src.self.y, ty, e) - Math.sin(Math.PI * e) * 26;
      flyText(lineText(r.line), x, y, lerp(14, 12.5, e), 500, C.ink, 1 - span(p, 0.5, 0.17), 1 - e);
    }
    for (const b of bays) {
      const p = span(t, b.fly, DUR.bay); if (p <= 0 || p >= 1) continue;
      const src = flightSources(b);
      const eA = ease(span(p, 0, 0.45));
      const tagX = sx(b.box.x) + 2, tagY = sy(b.box.y) + Math.min(46 * s / 2, 16);
      // the bay line becomes the bay tag
      const bx = lerp(src.self.x, tagX, eA), by = lerp(src.self.y, tagY, eA) - Math.sin(Math.PI * eA) * 22;
      if (p < 0.52) flyText(lineText(b.line), bx, by, lerp(14, 12, eA), 400, C.ink, 1 - span(p, 0.42, 0.1), 1 - eA);
      if (!src.tiles) {
        // folded: the summary line carries the whole bay
        if (p < 0.5) flyText('· ' + b.tiles.length + ' features', bx + (lineText(b.line).length + 1) * V.cw * lerp(1, 12 / 14, eA), by, lerp(14, 12, eA), 400, C['ink-3'], 1 - span(p, 0.3, 0.15), 0);
        continue;
      }
      // the block travels as one piece, then fans out into the tile grid
      const eB = ease(span(p, 0.45, 0.4));
      const srcTiles = src.tiles;
      b.tiles.forEach((tl, i) => {
        const s0 = srcTiles[i]; if (!s0) return;
        const offX = s0.x - src.self.x, offY = s0.y - src.self.y;
        const ax = lerp(s0.x, tagX + offX * 0.85, eA), ay = lerp(s0.y, tagY + offY + 4, eA) - Math.sin(Math.PI * eA) * 22;
        const tX = sx(tl.box.x) + 8 * s, tY = sy(tl.box.y) + 8 * s + (labelsOn ? 7 * s : 7);
        const x = lerp(ax, tX, eB), y = lerp(ay, tY, eB);
        const fs = labelsOn ? lerp(14, 14 * s, eB) : 14;
        const txt = lineText(tl.line);
        const fade = labelsOn ? 1 - span(p, 0.84, 0.16) : 1 - span(p, 0.7, 0.2);
        const clipW = lerp(V.W, tl.box.w * s - 10 * s, ease(span(p, 0.5, 0.3)));
        ctx.save(); ctx.beginPath(); ctx.rect(x - 4, y - 14, clipW + 4, 28); ctx.clip();
        flyText(txt, x, y, fs, 400, eB > 0.2 ? C['ink-hi'] : C['ink-2'], fade, (1 - eB) * 0.8);
        ctx.restore();
      });
    }
  }

  // ---------- key plan (where the camera is, what stands so far) ----------
  function drawKeyPlan(t: number) {
    V.keyRect = null;
    if (!extVersions.length) return;
    const ex = extAt(t); if (!ex) return;
    const e = ex.box, Wk = Math.min(230, V.W * 0.2), s = Wk / Math.max(1, e.w), Hk = e.h * s;
    const X = V.W - Wk - 16, Y = V.H - Hk - 30;
    if (X < F.cw + 40) return;
    ctx.fillStyle = C.halo; ctx.fillRect(X - 8, Y - 24, Wk + 16, Hk + 32);
    ctx.strokeStyle = C['ink-4']; ctx.strokeRect(X - 8.5, Y - 24.5, Wk + 17, Hk + 33);
    ctx.font = `500 12px ${MONO}`; setLS(1.2); ctx.fillStyle = C['ink-3']; ctx.textBaseline = 'middle'; ctx.fillText('KEY PLAN', X, Y - 12); setLS(0);
    const kx = (x: number) => X + (x - e.x) * s, ky = (y: number) => Y + (y - e.y) * s;
    ctx.lineWidth = 1;
    for (const r of rooms) { if (t < r.fly && !S.live) continue; const a = wallProgress(r, t); ctx.strokeStyle = inkA(0.5 * a); ctx.strokeRect(kx(r.box.x) + 0.5, ky(r.box.y) + 0.5, r.box.w * s - 1, r.box.h * s - 1); }
    for (const tl of tiles) { if (t < tl.fly && !S.live) continue; const st = tileState(tl, t); ctx.fillStyle = inkA(0.5 * st.a); ctx.fillRect(kx(tl.box.x), ky(tl.box.y), Math.max(1, tl.box.w * s - 1), Math.max(1, tl.box.h * s - 1)); }
    for (const w of wings) { if (t < w.fly && !S.live) continue; ctx.strokeStyle = inkA(0.85 * wallProgress(w, t)); ctx.strokeRect(kx(w.box.x) + 0.5, ky(w.box.y) + 0.5, w.box.w * s - 1, w.box.h * s - 1); }
    // the camera's view
    const vx0 = wx(F.cw), vx1 = wx(V.W), vy0 = wy(0), vy1 = wy(V.H);
    ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
    const rx = clamp(kx(vx0), X - 6, X + Wk + 6), ry = clamp(ky(vy0), Y - 6, Y + Hk + 6), rx1 = clamp(kx(vx1), X - 6, X + Wk + 6), ry1 = clamp(ky(vy1), Y - 6, Y + Hk + 6);
    ctx.strokeRect(rx, ry, rx1 - rx, ry1 - ry);
    V.keyRect = { X, Y, s, Wk, Hk };
  }

  // ---------- frame ----------
  function draw() {
    const t = S.t;
    setFrame(t);
    ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    ctx.textAlign = 'left'; ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.shadowBlur = 0; setLS(0);
    drawPaper(t);
    if (S.began) {
      drawPlan(t);
      drawHighlights();
      drawColumn(t, F.cw);
      drawFlights(t);
      if (!S.live) drawKeyPlan(t);
    }
    const g = ctx.createRadialGradient(V.W / 2, V.H / 2, Math.min(V.W, V.H) * 0.45, V.W / 2, V.H / 2, Math.max(V.W, V.H) * 0.8);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, C.vignette);
    ctx.fillStyle = g; ctx.fillRect(F.cw, 0, V.W - F.cw, V.H);
    updateChrome(t);
  }
  function drawHighlights() {
    const s = F.cam.s;
    const ring = (o: PNode, col: string, w: number) => { const b = o.box; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.strokeRect(sx(b.x) - 2, sy(b.y) - 2, b.w * s + 4, b.h * s + 4); };
    if (S.hover && S.hover !== S.sel) ring(S.hover, accA(0.7), 1.5);
    if (S.sel) ring(S.sel, C.accent, 2.5);
    ctx.lineWidth = 1;
  }

  // ---------- chrome: the pipeline rail, header, breadcrumb ----------
  let segEls: HTMLDivElement[] = [];
  function buildTrack() {
    el.track.innerHTML = '';
    segEls = STEP_DEF.map((st, i) => {
      const d = document.createElement('div');
      d.className = cls.sg + (st.llm ? ' ' + cls.llm : '');
      d.title = `${i + 1} ${st.n}${st.llm ? ' (LLM)' : ''}: ${st.what}`;
      d.innerHTML = `<i></i><span>${i + 1} ${esc(st.n)}</span>`;
      el.track.appendChild(d); return d;
    });
  }
  let lastStep = -1, lastClock = '';
  function updateChrome(t: number) {
    // the rail is the pipeline as it really runs: a step's width is its real duration so far, unstarted steps wait small
    let cur = -1;
    rail.forEach((r, i) => { if (fin(r.t0)) cur = i; });
    segEls.forEach((d, i) => {
      const r = rail[i]; if (!r) return;
      const started = fin(r.t0), done = fin(r.t1);
      const dur = started ? (done ? r.t1 : t) - r.t0 : 0;
      d.style.flex = Math.max(2.5, dur) + ' 1 0';
      const fill = d.firstChild as HTMLElement | null;
      if (fill) fill.style.width = started ? '100%' : '0%';
      d.classList.toggle(cls.on, i === cur && !done && !S.live);
      d.classList.toggle(cls.bad, r.failed);
    });
    const c = fmtT(t) + ' / ' + (fin(T) ? fmtT(T) : '…');
    if (c !== lastClock) { el.clock.textContent = c; lastClock = c; }
    const step = stepAt(t);
    if (step !== lastStep && S.began) { lastStep = step; el.live.textContent = `Step ${step + 1} of 8: ${STEP_DEF[step].n}`; }
  }
  function enterLive() {
    if (S.live) return;
    S.t = T;
    S.cam = camNow(T);
    S.live = true; S.userCam = null;
    for (const k of [el.rail, el.crumbs, el.zoom, el.head]) k.classList.add(cls.on);
    const live = tiles.filter((x) => x.stage === 'live').length, dev = tiles.filter((x) => x.stage === 'in-dev').length, bad = tiles.filter((x) => x.general === 'bad').length;
    el.head.innerHTML = `<b>${esc(project.name.toUpperCase())}</b><span>${tiles.length} features</span><span>· ${live} live</span><span>· ${dev} being built</span><span class="${cls.warn}">· ${bad} in trouble</span>`;
    cv.classList.add(cls.grab);
    buildIndex();
    renderCrumbs();
    toast(`${project.name} is registered · the plan is live · scroll to zoom, drag to pan, / to find`);
    dirty = true;
  }
  function leaveLive() {
    S.live = false; S.tween = null;
    for (const k of [el.rail, el.crumbs, el.zoom, el.head]) k.classList.remove(cls.on);
    el.index.classList.remove(cls.open); el.card.classList.remove(cls.open); el.tip.style.display = 'none';
    S.sel = null; S.hover = null; cv.classList.remove(cls.grab);
  }
  let toastT: ReturnType<typeof setTimeout> | undefined;
  function toast(msg: string) {
    el.toast.textContent = msg; el.toast.classList.add(cls.on);
    clearTimeout(toastT); toastT = setTimeout(() => el.toast.classList.remove(cls.on), 4200);
  }
  function pathOf(o: PNode | null): PNode[] {
    if (!o) return [];
    if (o.kind === 'tile') return [o.wing, o.room, o.bay, o];
    if (o.kind === 'bay') return [o.wing, o.room, o];
    if (o.kind === 'room') return [o.wing, o];
    return [o];
  }
  const nameOf = (o: PNode) => (o.kind === 'wing' ? o.letter + ' ' + o.name : o.name);
  function renderCrumbs() {
    const focus = S.sel || S.hover || centreObj();
    const parts = [`<button data-k="site">${esc(project.name)} · site</button>`];
    for (const o of pathOf(focus)) parts.push(`<em>›</em><button data-k="${o.kind}:${esc(o.id)}">${esc(nameOf(o))}</button>`);
    const html = parts.join('');
    if (el.crumbs.innerHTML !== html) el.crumbs.innerHTML = html;
  }
  function centreObj(): PNode | null {
    if (!S.live) return null;
    const X = wx(F.cw + (V.W - F.cw) / 2), Y = wy(V.H / 2);
    const s = F.cam.s;
    const hitIn = <N extends PNode>(arr: N[]) => arr.find((o) => X >= o.box.x && X <= o.box.x + o.box.w && Y >= o.box.y && Y <= o.box.y + o.box.h);
    if (s < 0.5) return null;
    return (s > 1 ? hitIn(bays) : undefined) || hitIn(rooms) || hitIn(wings) || null;
  }
  function findById(k: string): PNode | 'site' | null {
    if (k === 'site') return 'site';
    return byId.get(k) ?? null;
  }

  // ---------- live camera ----------
  function flyTo(target: Cam, d = 0.75) {
    if (!S.live) { S.userCam = target; dirty = true; return; } // during the build the camera is the viewer's until register
    if (S.reduced) d = 0;
    if (d === 0) { S.cam = target; S.tween = null; }
    else S.tween = { from: { ...S.cam }, to: target, t0: performance.now(), d: d * 1000 };
    dirty = true;
  }
  function fitTarget(box: BBox, maxS = 1.6, padTop = 90): Cam {
    const aw = V.W - RAIL, ah = V.H;
    const s = clamp(Math.min((aw - 120) / box.w, (ah - padTop - 80) / box.h), 0.12, maxS);
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 - (padTop - 80) / 2 / s, s };
  }
  function focusObj(o: PNode | 'site' | null, select?: boolean) {
    if (o === 'site') { closeCard(); if (V.fin) flyTo({ ...V.fin }); return; }
    if (!o) return;
    if (o.kind === 'tile') {
      if (select !== false) selectTile(o);
      const b = o.bay.box; flyTo(fitTarget({ x: b.x - 10, y: b.y - 60, w: b.w + 20, h: b.h + 70 }, 1.5));
    } else if (o.kind === 'wing') flyTo(fitTarget({ x: o.box.x, y: o.box.y - 60, w: o.box.w, h: o.box.h + 60 }, 1.4));
    else flyTo(fitTarget({ x: o.box.x, y: o.box.y - 10, w: o.box.w, h: o.box.h + 10 }, 1.6));
  }
  function zoomAt(f: number, px: number, py: number) {
    const before = { x: (px - F.ox) / S.cam.s + S.cam.x, y: (py - F.oy) / S.cam.s + S.cam.y };
    const ns = clamp(S.cam.s * f, 0.1, 4);
    S.cam = { x: before.x - (px - F.ox) / ns, y: before.y - (py - F.oy) / ns, s: ns };
    S.tween = null; dirty = true;
  }

  // ---------- selection, card, tooltip ----------
  function selectTile(tl: TileN) {
    S.sel = tl;
    const t = S.t;
    const created = tl.created ? String(tl.created).slice(0, 10) : !S.live && t < steps[4].t0 ? 'not read from history yet' : 'no date in this repo’s history';
    const health = tl.general && (S.live || t >= tl.healthAt) ? tl.general : 'not judged yet';
    const stage = tl.stage ? `${esc(STAGE_WORD[tl.stage] || tl.stage)} <span class="${cls.muted}">(${esc(tl.stage)})</span>` : 'none given';
    el.card.innerHTML = `<button class="${cls.btn} ${cls.x}" data-c="x" title="Close (Esc)">✕</button>
      <div class="${cls.path}">${esc(tl.wing.letter + ' ' + tl.wing.name.toUpperCase())} › ${esc(tl.room.name)} › ${esc(tl.bay.name)}</div>
      <h3>${esc(tl.name)}</h3>
      ${tl.summary ? `<p>${esc(tl.summary)}</p>` : ''}
      <dl><dt>Stage</dt><dd>${stage}</dd>
      <dt>Health</dt><dd><span class="${cls.dot}" style="background:${health === 'not judged yet' ? inkA(0.12) : healthCol(tl.general)}"></span>${esc(health)}</dd>
      <dt>Kind</dt><dd>${esc(tl.fkind ? KIND_WORD[tl.fkind] || tl.fkind : '—')}${tl.tier ? ' · ' + esc(tl.tier) : ''}</dd>
      <dt>Created</dt><dd>${esc(created)}</dd></dl>
      <button class="${cls.btn}" data-c="zoom">Zoom to feature</button>`;
    el.card.classList.add(cls.open);
    markIndex(); if (S.live) renderCrumbs(); dirty = true;
  }
  function closeCard() { S.sel = null; el.card.classList.remove(cls.open); markIndex(); if (S.live) renderCrumbs(); dirty = true; }
  function hitTest(px: number, py: number): PNode | null {
    const X = wx(px), Y = wy(py);
    const inside = (o: PNode) => X >= o.box.x && X <= o.box.x + o.box.w && Y >= o.box.y && Y <= o.box.y + o.box.h;
    const t = S.t;
    const tl = tiles.find((o) => inside(o) && (S.live || t >= o.fly + DUR.bay * 0.6));
    if (tl) return tl;
    if (!S.live) return null;
    return bays.find(inside) || rooms.find(inside) || wings.find(inside) || null;
  }
  function showTip(o: PNode | null, cx: number, cy: number) {
    const tip = el.tip;
    if (!o || o.kind !== 'tile') { tip.style.display = 'none'; return; }
    const t = S.t, known = S.live || t >= o.stampAt, hk = S.live || t >= o.healthAt;
    const stage = known ? (o.stage ? STAGE_WORD[o.stage] || o.stage : 'no stage') : 'stage: waiting for history';
    tip.innerHTML = `<div class="${cls.n}">${esc(o.name)}</div><div class="${cls.m}">${esc(o.room.name)} › ${esc(o.bay.name)}</div>
      <div class="${cls.m}">${esc(stage)} · ${hk && o.general ? 'health ' + esc(o.general) : 'health: not judged yet'}</div>`;
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let x = cx + 16, y = cy + 16;
    if (x + r.width > innerWidth - 8) x = cx - r.width - 12;
    if (y + r.height > innerHeight - 8) y = cy - r.height - 12;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  // ---------- outline index (the same words, kept as the plan's table of contents) ----------
  function buildIndex() {
    const ol = el.idxList; ol.innerHTML = '';
    for (const l of lines) {
      const li = document.createElement('li'); li.className = l.kind === 'wing' ? cls.wing : l.kind === 'room' ? cls.room : '';
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.k = l.kind + ':' + l.ref.id;
      const ct = l.ref.kind === 'bay' ? l.ref.tiles.length : l.ref.kind === 'room' ? l.ref.tiles.length : null;
      b.innerHTML = `<span class="${cls.pf}">${esc(l.prefix)}</span>${esc(l.text)}${ct !== null ? `<span class="${cls.ct}">${ct}</span>` : ''}`;
      b.title = l.text;
      li.appendChild(b); ol.appendChild(li);
    }
  }
  function markIndex() {
    const k = S.sel ? 'tile:' + S.sel.id : '';
    el.idxList.querySelectorAll('button[aria-current]').forEach((b) => b.removeAttribute('aria-current'));
    if (k) { const b = el.idxList.querySelector(`button[data-k="${CSS.escape(k)}"]`); if (b) { b.setAttribute('aria-current', 'true'); b.scrollIntoView({ block: 'nearest' }); } }
  }
  function toggleIndex(force?: boolean) {
    if (!S.live) return;
    const open = force !== undefined ? force : !el.index.classList.contains(cls.open);
    el.index.classList.toggle(cls.open, open);
    if (open) markIndex();
  }

  // ---------- find (what has arrived) ----------
  let found: PNode[] = [], foundI = 0;
  function runFind() {
    const qv = el.find.value.trim().toLowerCase();
    if (!qv) { el.results.classList.remove(cls.open); found = []; return; }
    const all: PNode[] = [...wings, ...rooms, ...bays, ...tiles];
    found = all.filter((o) => o.name.toLowerCase().includes(qv)).sort((a, b) => (a.name.toLowerCase().startsWith(qv) ? 0 : 1) - (b.name.toLowerCase().startsWith(qv) ? 0 : 1)).slice(0, 14);
    foundI = 0;
    el.results.innerHTML = found.length
      ? found.map((o, i) => `<button type="button" role="option" data-i="${i}" aria-selected="${i === 0}"><div class="${cls.rn}">${esc(nameOf(o))}</div><div class="${cls.rp}">${esc(o.kind === 'tile' ? 'feature' : o.kind)} · ${esc(pathOf(o).slice(0, -1).map(nameOf).join(' › ') || 'site')}</div></button>`).join('')
      : `<div class="${cls.none}">${lines.length ? 'Nothing in ' + esc(project.name) + ' is called that' + (S.live ? '.' : ' yet.') : 'Nothing has arrived yet.'}</div>`;
    el.results.classList.add(cls.open);
  }
  function pickFound(i: number) {
    const o = found[i]; if (!o) return;
    el.results.classList.remove(cls.open); el.find.blur();
    focusObj(o);
  }
  el.find.addEventListener('input', runFind, on);
  el.find.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); foundI = clamp(foundI + (e.key === 'ArrowDown' ? 1 : -1), 0, Math.max(0, found.length - 1));
      el.results.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(i === foundI)));
    } else if (e.key === 'Enter') pickFound(foundI);
    else if (e.key === 'Escape') { el.find.value = ''; el.results.classList.remove(cls.open); el.find.blur(); }
    e.stopPropagation();
  }, on);
  el.results.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-i]'); if (b) pickFound(Number(b.dataset.i)); }, on);

  // ---------- input on the canvas ----------
  const local = (e: { clientX: number; clientY: number }) => { const r = cv.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; };
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { px, py } = local(e);
    if (!S.live) {
      const c = S.userCam || { ...camNow(S.t) };
      const f = Math.exp(-e.deltaY * 0.0015);
      const bx = (px - F.ox) / c.s + c.x, by = (py - F.oy) / c.s + c.y; const ns = clamp(c.s * f, 0.1, 4);
      S.userCam = { x: bx - (px - F.ox) / ns, y: by - (py - F.oy) / ns, s: ns }; dirty = true; return;
    }
    zoomAt(Math.exp(-e.deltaY * 0.0015), px, py);
  }, { passive: false, signal: ac.signal });
  cv.addEventListener('pointerdown', (e) => {
    const { px, py } = local(e);
    const k = V.keyRect, ext = knownExt();
    // the key plan is a map you can click
    if (!S.live && k && ext && px >= k.X && px <= k.X + k.Wk && py >= k.Y && py <= k.Y + k.Hk) {
      const c = S.userCam || camNow(S.t);
      const e2 = extAt(S.t)?.box ?? ext;
      S.userCam = { x: e2.x + (px - k.X) / k.s, y: e2.y + (py - k.Y) / k.s, s: c.s }; dirty = true; return;
    }
    S.drag = { x: e.clientX, y: e.clientY, moved: false, cam: S.live ? { ...S.cam } : { ...(S.userCam || camNow(S.t)) } };
    cv.setPointerCapture(e.pointerId);
    if (S.live) cv.classList.add(cls.grabbing);
  }, on);
  cv.addEventListener('pointermove', (e) => {
    const { px, py } = local(e);
    if (S.drag) {
      const dx = e.clientX - S.drag.x, dy = e.clientY - S.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) S.drag.moved = true;
      if (S.drag.moved) {
        const c = S.drag.cam, n = { x: c.x - dx / c.s, y: c.y - dy / c.s, s: c.s };
        if (S.live) { S.cam = n; S.tween = null; } else S.userCam = n;
        el.tip.style.display = 'none'; dirty = true; return;
      }
    }
    if (px < F.cw) { if (S.hover) { S.hover = null; dirty = true; } el.tip.style.display = 'none'; return; }
    const o = hitTest(px, py);
    if (o !== S.hover) { S.hover = o; dirty = true; if (S.live) renderCrumbs(); }
    cv.classList.toggle(cls.point, !!(o && o.kind === 'tile'));
    showTip(o, e.clientX, e.clientY);
  }, on);
  cv.addEventListener('pointerup', (e) => {
    const d = S.drag; S.drag = null; cv.classList.remove(cls.grabbing);
    if (d && d.moved) { if (S.live) renderCrumbs(); return; }
    const { px, py } = local(e);
    const o = hitTest(px, py);
    if (!o) { if (S.sel) closeCard(); return; }
    if (o.kind === 'tile') selectTile(o); // during the build a click reads the tile without stopping the show
    else if (S.live) focusObj(o);
  }, on);
  cv.addEventListener('pointerleave', () => { if (S.hover) { S.hover = null; dirty = true; } el.tip.style.display = 'none'; }, on);
  cv.addEventListener('dblclick', (e) => {
    if (!S.live) return;
    const { px, py } = local(e); const c = S.cam;
    flyTo({ x: (px - F.ox) / c.s + c.x, y: (py - F.oy) / c.s + c.y, s: clamp(c.s * 2, 0.1, 4) }, 0.45);
  }, on);
  el.card.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-c]'); if (!b) return;
    if (b.dataset.c === 'x') closeCard();
    else if (S.sel) { const bx = S.sel.box; flyTo(fitTarget({ x: bx.x - 30, y: bx.y - 30, w: bx.w + 60, h: bx.h + 60 }, 2.6)); }
  }, on);
  el.rail.addEventListener('click', () => toggleIndex(true), on);
  el.idxClose.addEventListener('click', () => toggleIndex(false), on);
  el.idxList.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-k]'); if (b?.dataset.k) focusObj(findById(b.dataset.k)); }, on);
  el.crumbs.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-k]'); if (!b?.dataset.k) return;
    const o = findById(b.dataset.k); focusObj(o, o !== 'site' && o?.kind === 'tile');
  }, on);
  el.zIn.addEventListener('click', () => zoomAt(1.4, F.ox, F.oy), on);
  el.zOut.addEventListener('click', () => zoomAt(1 / 1.4, F.ox, F.oy), on);
  el.zFit.addEventListener('click', () => focusObj('site'), on);
  window.addEventListener('keydown', (e) => {
    if (e.target === el.find) return;
    if (e.key === '/') { e.preventDefault(); el.find.focus(); return; }
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA')) return;
    const k = e.key;
    if (k === 'Escape') { if (el.index.classList.contains(cls.open)) toggleIndex(false); else if (S.sel) closeCard(); }
    else if (k === 'o' || k === 'O') toggleIndex();
    else if (S.live && (k === '+' || k === '=')) zoomAt(1.4, F.ox, F.oy);
    else if (S.live && (k === '-' || k === '_')) zoomAt(1 / 1.4, F.ox, F.oy);
    else if (S.live && k === '0') focusObj('site');
    else if (S.live && k.startsWith('Arrow')) { const d = 80 / S.cam.s; S.cam = { ...S.cam, x: S.cam.x + (k === 'ArrowRight' ? d : k === 'ArrowLeft' ? -d : 0), y: S.cam.y + (k === 'ArrowDown' ? d : k === 'ArrowUp' ? -d : 0) }; dirty = true; }
  }, on);
  let rz = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { const live = S.live, cam = S.cam; makeView(); if (live) S.cam = cam; dirty = true; });
  });
  ro.observe(cv);

  // ---------- loop ----------
  let dirty = true, last = performance.now(), raf = 0, dead = false;
  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (S.began && !S.live) {
      S.t += dt * rate; dirty = true;
      if (fin(T) && S.t >= T) enterLive();
    }
    if (S.tween) {
      const p = clamp((now - S.tween.t0) / S.tween.d);
      S.cam = lerpCam(S.tween.from, S.tween.to, ease(p));
      if (p >= 1) { S.tween = null; renderCrumbs(); }
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    draw();
    if (S.live && !S.drag && !S.tween && !S.hover && !S.sel) renderCrumbs();
  }

  readTheme();
  steps = STEP_DEF.map((s) => ({ ...s, t0: Infinity, t1: Infinity }));
  rail = PHASES.map(() => ({ t0: Infinity, t1: Infinity, failed: false, detail: null }));
  buildTrack();
  makeView();
  raf = requestAnimationFrame(loop);
  // fonts that load late change measurements: re-wrap once they settle
  void document.fonts?.ready.then(() => {
    if (dead) return;
    ctx.font = `500 14px ${SANS}`;
    for (const t of tiles) t.wrap = wrapText(t.name, t.box.w - 16, 3);
    makeView(); dirty = true;
  });

  return {
    onEvent,
    setReduced(r: boolean) {
      if (r === S.reduced) return;
      S.reduced = r; makeView(); if (!S.live) S.userCam = null; dirty = true;
    },
    setTheme() { readTheme(); dirty = true; },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf); cancelAnimationFrame(rz); clearTimeout(toastT);
      ro.disconnect(); ac.abort();
      cv.width = 0; cv.height = 0;
    },
  };
}
