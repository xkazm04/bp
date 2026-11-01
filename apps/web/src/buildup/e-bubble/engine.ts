// Pencil first: the bubble diagram. An imperative canvas engine, ported from the contest prototype (blueprint-buildup E1)
// and re-driven by the build-up event stream. The prototype drew every frame as a pure function of (plan, schedule, t)
// over a plan it loaded whole; here the schedule is written as events arrive, never in the past of the engine's clock:
//   structure -> the plan grows, the bubble cluster is re-packed (and re-framed smoothly), each new wing becomes a unit
//                the pen drafts in its own pacing queue (one unit per wing, rooms 0.34 s apart, dots pinging in);
//   history   -> once the bubble queue has drained: wings slide to their boxes, the sheet pulls back, rooms square up
//                room by room and tiles climb their stage ladder;
//   health    -> per batch, a scan line crosses the batch's tiles once those tiles stand;
//   done      -> the sheet is stamped (G-001) and stays explorable.
// Anything that arrives early waits in the queue; nothing is dropped. Every rAF, listener and timer is released in
// `dispose`, and `begin` rebuilds the model from nothing (replay).
import type { BBox, BuildupEvent, Health, Phase } from '../contract';
import { PHASES } from '../contract';
import {
  TAU, clamp, lerp, sstep, eOut, eInOut, eBack, seg, mulberry32, hashStr, shuffle, packSiblings, enclose,
  MONTHS, dayOf, fmtTime, fmtDay, fmtDate, type Circle,
} from './pack';
import {
  KIND_WORD, HEALTH_WORD, rungOf, stageGroup, stageWord, emptyStat,
  type BayE, type Ent, type Local, type Pack, type RoomE, type RoomLab, type Stat, type TileE, type WingE, type Wob,
} from './model';

export interface Engine {
  push(e: BuildupEvent): void;
  setTheme(theme: 'dark' | 'light'): void;
  setReduced(r: boolean): void;
  dispose(): void;
}

type RGBA = [number, number, number, number];
interface Theme {
  light: boolean; paper: RGBA; hi: RGBA; mid: RGBA; lo: RGBA; core: RGBA; ink: RGBA; inkHi: RGBA; accent: RGBA; mint: RGBA;
  amber: RGBA; red: RGBA; red2: RGBA; labelBg: RGBA; tileBase: RGBA; halo: string; grid: string; glow: RGBA; edge: RGBA; vig: RGBA;
}
interface Cam { cx: number; cy: number; s: number }
interface Box4 { x0: number; y0: number; x1: number; y1: number }
interface Unit { t: number; wing: WingE; rooms: RoomE[]; fresh: boolean }
interface Sweep { t0: number; t1: number; x0: number; x1: number; y0: number; y1: number }
interface PhaseRec { state: 'pend' | 'run' | 'done' | 'fail'; startWall: number; endWall: number; detail: string | null }
interface FindSet { wings: Set<WingE>; rooms: Set<RoomE>; tiles: Set<TileE> }

const SANS_FALLBACK = "'IBM Plex Sans Condensed','Arial Narrow','Roboto Condensed',system-ui,sans-serif";
const MONO_FALLBACK = "'IBM Plex Mono',Consolas,'SFMono-Regular',Menlo,monospace";
/** A provisional sheet for a run that has not said how big the plan is (extent null, no structure yet). */
const PROVISIONAL: BBox = { x: 0, y: 0, w: 2400, h: 1300 };

const STEPS: { n: string; tag?: string; d: string }[] = [
  { n: 'Check', d: 'what bp already has' }, { n: 'Context map', d: 'code into areas' }, { n: 'Seed', d: 'the code tree' },
  { n: 'Product tree', tag: 'LLM', d: 'domains, rooms, features named' }, { n: 'Events', d: 'when each feature began' },
  { n: 'Measure', d: 'static metrics per feature' }, { n: 'Judge', tag: 'LLM', d: 'health, lens by lens' }, { n: 'Register', d: 'the plan appears in bp' },
];

const esc = (s: unknown): string => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

function parseColor(s: string): RGBA {
  s = (s || '').trim();
  // the app's computed tokens come back as #rrggbb or #rrggbbaa (the prototype's sheet wrote rgba())
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1]; }
  m = /^#([0-9a-f]{3})([0-9a-f])?$/i.exec(s);
  if (m) { const h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), m[2] ? parseInt(m[2] + m[2], 16) / 255 : 1]; }
  m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) { const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  return [255, 255, 255, 1];
}
const rgba = (c: RGBA, a: number): string => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + clamp(a).toFixed(3) + ')';
const lerpCam = (a: Cam, b: Cam, t: number): Cam => ({ cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), t)) });
const lerpPack = (a: Pack, b: Pack, t: number): Pack => ({ cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), R: lerp(a.R, b.R, t) });
const lerpLocal = (a: Local, b: Local, t: number): Local => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), R: lerp(a.R, b.R, t) });
const lerpBox = (a: Box4, b: Box4, t: number): Box4 => ({ x0: lerp(a.x0, b.x0, t), y0: lerp(a.y0, b.y0, t), x1: lerp(a.x1, b.x1, t), y1: lerp(a.y1, b.y1, t) });
const fin = (x: number): boolean => Number.isFinite(x);

function wobOf(id: string): Wob {
  const r = mulberry32(hashStr(id) ^ 0x7e57);
  return { a1: 0.4 + r() * 0.6, a2: 0.3 + r() * 0.5, a3: 0.2 + r() * 0.4, p1: r() * TAU, p2: r() * TAU, p3: r() * TAU, a0: r() * TAU };
}

export function createEngine(root: HTMLElement, opts: { reduced: boolean; theme: 'dark' | 'light' }): Engine {
  const $ = <T extends HTMLElement = HTMLElement>(k: string): T => {
    const el = root.querySelector<T>(`[data-el="${k}"]`);
    if (!el) throw new Error('bubble: missing element ' + k);
    return el;
  };
  const cv = $<HTMLCanvasElement>('canvas');
  const ctx0 = cv.getContext('2d');
  if (!ctx0) throw new Error('bubble: no 2d context');
  const ctxMain: CanvasRenderingContext2D = ctx0;
  let ctx: CanvasRenderingContext2D = ctxMain;
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d') as CanvasRenderingContext2D;
  let DPR = 1, VW = 1000, VH = 600;
  let TH!: Theme;
  let PAT: { diag: HTMLCanvasElement | null; cross: HTMLCanvasElement | null } = { diag: null, cross: null };
  let F_SANS = SANS_FALLBACK, F_MONO = MONO_FALLBACK;
  let CAM: Cam = { cx: 0, cy: 0, s: 1 };
  let TIPS: { x: number; y: number }[] = [];
  let REDUCED = opts.reduced;
  let theme = opts.theme;
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const listen = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (ev: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
    el.addEventListener(type, fn as EventListener, o);
    cleanups.push(() => el.removeEventListener(type, fn as EventListener, o));
  };

  /* ================= the plan as it has arrived ================= */
  const P = {
    slug: '', name: '',
    wings: [] as WingE[], rooms: [] as RoomE[], bays: [] as BayE[], tiles: [] as TileE[],
    wById: new Map<string, WingE>(), rById: new Map<string, RoomE>(), bById: new Map<string, BayE>(), tById: new Map<string, TileE>(),
    wingArrival: [] as WingE[],
    extent: null as BBox | null,
    X0: 0, Y0: 0, X1: PROVISIONAL.w, Y1: PROVISIONAL.h,
    sheet: { x0: 0, y0: 0, x1: 1, y1: 1 } as Box4, sh0: { x0: 0, y0: 0, x1: 1, y1: 1 } as Box4, sd: { x0: 0, y0: 0, x1: 1, y1: 1 } as Box4,
    dotR: 10, dr0: 10, dd: 10, rotA: null as number | null,
    dated: false, d0: 0, d1: 1,
  };
  /* the schedule, in engine seconds; Infinity = not known yet */
  const S = {
    rnd: mulberry32(1), qT: 0, structEnd: 0, units: [] as Unit[],
    tHist: Infinity, tSlideEnd: Infinity, tCam0: Infinity, dCam: 1, tRooms0: Infinity, tRoomsEnd: Infinity, tFade0: Infinity, dFade: 3.2,
    sweeps: [] as Sweep[], sweepEnd: 0, pending: [] as TileE[][], firstH: Infinity,
    tReg0: Infinity, total: Infinity, endT: 0, lay: { t0: -Infinity, dur: 1 },
  };
  const RUN = { begunWall: 0, phases: new Map<Phase, PhaseRec>(), failed: null as string | null, done: false };
  const VIEW = { hover: null as Ent | null, sel: null as Ent | null, find: null as FindSet | null, railW: 214, fade: 0, th: 0 };
  const ST = {
    t: 0, playing: true, follow: true, ucam: null as Cam | null, blend: null as { from: Cam; t0: number; dur: number } | null,
    anim: null as { from: Cam; to: Cam; t0: number; dur: number } | null, dirty: true, ended: false, now: 0, last: 0, lvl: 0,
    crumbKey: '', toastT: 0 as ReturnType<typeof setTimeout> | 0, cam: null as Cam | null, began: false,
    snap: 0, auto: true, rfade: null as { a: number; ac: number | null; b: number; bc: number | null; t0: number } | null,
    shown: { t: 0, cap: null as number | null }, hudAt: 0,
  };

  function resetAll(project: { slug: string; name: string }, extent: BBox | null) {
    P.slug = project.slug; P.name = project.name;
    P.wings = []; P.rooms = []; P.bays = []; P.tiles = [];
    P.wById.clear(); P.rById.clear(); P.bById.clear(); P.tById.clear(); P.wingArrival = [];
    P.extent = extent && extent.w > 0 && extent.h > 0 ? extent : null;
    P.rotA = null; P.dated = false;
    setExtents();
    P.sh0 = P.sheet; P.sd = P.sheet;
    P.dotR = P.dr0 = P.dd = 10;
    S.rnd = mulberry32(hashStr(project.slug) ^ 0x51f15e);
    S.qT = 0; S.structEnd = 0; S.units = [];
    S.tHist = S.tSlideEnd = S.tCam0 = S.tRooms0 = S.tRoomsEnd = S.tFade0 = S.tReg0 = S.total = S.firstH = Infinity;
    S.dCam = 1; S.sweeps = []; S.sweepEnd = 0; S.pending = []; S.endT = 0; S.lay = { t0: -Infinity, dur: 1 };
    RUN.begunWall = performance.now(); RUN.phases = new Map(PHASES.map((p) => [p, { state: 'pend', startWall: 0, endWall: 0, detail: null }]));
    RUN.failed = null; RUN.done = false;
    VIEW.hover = null; VIEW.sel = null; VIEW.find = null;
    ST.t = 0; ST.playing = true; ST.follow = true; ST.ucam = null; ST.blend = null; ST.anim = null; ST.ended = false; ST.cam = null;
    ST.snap = 0; ST.auto = true; ST.rfade = null; ST.shown = { t: 0, cap: null }; ST.began = true; ST.crumbKey = '';
    const f = $<HTMLInputElement>('find'); f.value = ''; $('findbox').hidden = true; results = [];
    hideCard(); hideTip(); $('toast').removeAttribute('data-on');
    setTxt($('tProj'), P.name.toUpperCase()); setTxt($('pname'), P.name);
    buildRail(); buildTrack(); syncButtons();
    ST.dirty = true;
  }
  function setExtents() {
    let b: BBox = P.extent ?? PROVISIONAL;
    if (!P.extent && P.wings.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const w of P.wings) { x0 = Math.min(x0, w.box.x); y0 = Math.min(y0, w.box.y); x1 = Math.max(x1, w.box.x + w.box.w); y1 = Math.max(y1, w.box.y + w.box.h); }
      b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    P.X0 = b.x; P.Y0 = b.y; P.X1 = b.x + b.w; P.Y1 = b.y + b.h;
    // the sheet reaches further up than down: it holds the wing headers
    P.sheet = { x0: P.X0 - 160, y0: P.Y0 - 415, x1: P.X1 + 145, y1: P.Y1 + 250 };
  }

  /* ---------- intake ---------- */
  function addStructure(e: Extract<BuildupEvent, { type: 'structure' }>) {
    const now = ST.t;
    const newRooms: RoomE[] = [], newTiles: TileE[] = [], touched: WingE[] = [];
    const freshW = new Set<WingE>();
    for (const w of [...e.wings].sort((a, b) => a.order - b.order)) {
      if (P.wById.has(w.id)) continue;
      const o: WingE = {
        type: 'wing', id: w.id, name: w.name, letter: w.letter, order: w.order, box: w.box, cx: w.box.x + w.box.w / 2, cy: w.box.y + w.box.h / 2,
        rooms: [], tiles: [], stat: emptyStat(), wob: wobOf(w.id), pkR: 1, pack: { cx: 0, cy: 0, R: 0 }, pk0: { cx: 0, cy: 0, R: 0 }, pd: { cx: 0, cy: 0, R: 0 },
        median: null, lab: null,
        sc: { tIn: Infinity, tPlate: Infinity, tSlide: Infinity, tSq0: Infinity, tInk0: Infinity, tHead: Infinity },
        s: { appear: 0, slide: 0, sq: 0, cx: 0, cy: 0, hw: 0, hh: 0, n: 2, ink: 0, head: 0, plate: 0, letter: 0 },
      };
      P.wById.set(w.id, o); P.wings.push(o); P.wingArrival.push(o); freshW.add(o);
    }
    P.wings.sort((a, b) => a.order - b.order);
    for (const r of e.rooms) {
      if (P.rById.has(r.id)) continue;
      const wing = P.wById.get(r.parentId); if (!wing) continue;
      const o: RoomE = {
        type: 'room', id: r.id, name: r.name, order: r.order, box: r.box, cx: r.box.x + r.box.w / 2, cy: r.box.y + r.box.h / 2, wing,
        bays: [], tiles: [], stat: emptyStat(), wob: wobOf(r.id), pkR: 1.5, pkx: 0, pky: 0,
        local: { x: 0, y: 0, R: 0 }, lc0: { x: 0, y: 0, R: 0 }, ld: { x: 0, y: 0, R: 0 }, lab: null, plate: false,
        sc: { tIn: Infinity, tSq0: Infinity, tInk0: Infinity, tBay0: Infinity, tName: Infinity },
        s: { appear: 0, sq: 0, cx: 0, cy: 0, hw: 0, hh: 0, n: 2, ink: 0, bay: 0, name: 0 },
      };
      P.rById.set(r.id, o); wing.rooms.push(o); newRooms.push(o);
      if (!touched.includes(wing)) touched.push(wing);
    }
    for (const b of e.bays) {
      if (P.bById.has(b.id)) continue;
      const room = P.rById.get(b.parentId); if (!room) continue;
      const o: BayE = { type: 'bay', id: b.id, name: b.name, order: b.order, box: b.box, room, tiles: [] };
      P.bById.set(b.id, o); room.bays.push(o);
    }
    for (const t of e.tiles) {
      if (P.tById.has(t.id)) continue;
      const bay = P.bById.get(t.parentId); if (!bay) continue;
      const room = bay.room, wing = room.wing;
      const o: TileE = {
        type: 'tile', id: t.id, name: t.name, order: t.order, box: t.box, cx: t.box.x + t.box.w / 2, cy: t.box.y + t.box.h / 2,
        stage: t.stage, kind: t.kind, summary: t.summary ?? '', created: null, day: null, general: null,
        bay, room, wing, u: { x: 0, y: 0 }, ready: false,
        sc: { tDot: Infinity, tSw0: Infinity, tC0: Infinity, rung: rungOf(t.stage), tH: Infinity },
        s: { appear: 0, sw: 0, cx: 0, cy: 0, hw: 0, hh: 0, rad: 0, climb: 0, health: 0, hflash: 0, vis: false },
      };
      P.tById.set(t.id, o); bay.tiles.push(o); newTiles.push(o);
      if (!touched.includes(wing)) touched.push(wing);
    }
    relinkLists();
    const shNow = sheetAt(now);
    setExtents();
    relayout(now, shNow);
    // the pacing queue: one unit per wing that got rooms or tiles in this chunk, in plan order
    touched.sort((a, b) => a.order - b.order);
    for (const w of touched) {
      const fresh = freshW.has(w);
      const tA = Math.max(now + 0.05, S.qT);
      if (fresh) { w.sc.tIn = tA; w.sc.tPlate = tA + 0.5; }
      const rs = newRooms.filter((r) => r.wing === w).sort((a, b) => a.order - b.order);
      const off0 = fresh ? 0.55 : 0.12;
      rs.forEach((r, j) => { r.sc.tIn = tA + off0 + j * 0.34; });
      const rooms = new Set<RoomE>(); for (const t of newTiles) if (t.wing === w) rooms.add(t.room);
      for (const r of rooms) {
        const ts = newTiles.filter((t) => t.room === r);
        const n = r.tiles.length, sp = clamp(0.75 / Math.max(n, 1), 0.022, 0.075), ord = shuffle(ts, S.rnd);
        const base = Math.max(r.sc.tIn + 0.4, now + 0.05);
        ord.forEach((tl, rank) => { tl.sc.tDot = base + rank * sp * (0.8 + 0.4 * S.rnd()); S.structEnd = Math.max(S.structEnd, tl.sc.tDot + 0.4); });
      }
      for (const r of rs) S.structEnd = Math.max(S.structEnd, r.sc.tIn + 0.6);
      S.units.push({ t: tA, wing: w, rooms: rs, fresh });
      S.qT = tA + off0 + Math.max(1, rs.length) * 0.34 + 0.3;
      bump(S.structEnd);
    }
    // structure after history (not the pipeline's order, but allowed): square what is new right after the rest
    if (fin(S.tHist)) {
      let t0 = Math.max(S.tRoomsEnd, now) + 0.2;
      for (const r of newRooms) { scheduleRoomSquare(r, t0); t0 += 0.6; }
      for (const r of P.rooms) for (const tl of r.tiles) if (!fin(tl.sc.tSw0)) scheduleTileSquare(tl, Math.max(now, r.sc.tSq0), 0);
      for (const w of touched) if (!fin(w.sc.tSlide)) { w.sc.tSlide = now + 0.2; scheduleWingSquare(w); }
    }
    ST.dirty = true;
  }
  function relinkLists() {
    P.rooms = []; P.bays = []; P.tiles = [];
    for (const w of P.wings) {
      w.rooms.sort((a, b) => a.order - b.order); w.tiles = []; w.stat = emptyStat();
      for (const r of w.rooms) {
        P.rooms.push(r); r.bays.sort((a, b) => a.order - b.order); r.tiles = []; r.stat = emptyStat();
        for (const b of r.bays) { P.bays.push(b); b.tiles.sort((a, c) => a.order - c.order); for (const t of b.tiles) { r.tiles.push(t); w.tiles.push(t); P.tiles.push(t); } }
      }
    }
    const stat = (tiles: TileE[], s: Stat) => { s.n = tiles.length; for (const t of tiles) s[stageGroup(t.stage)]++; };
    for (const w of P.wings) stat(w.tiles, w.stat);
    for (const r of P.rooms) stat(r.tiles, r.stat);
  }

  /* ---- the bubble diagram: dots in rooms in wings in a cluster, area proportional to feature count ----
     Re-run on every structure chunk over what has arrived; bubbles tween from where they are drawn to their new slot. */
  function relayout(now: number, shNow: Box4) {
    const a = layA(now);
    for (const w of P.wings) { if (w.pkR > 0 && w.pack.R > 0) w.pk0 = lerpPack(w.pk0, w.pack, a); }
    for (const r of P.rooms) { if (r.local.R > 0) r.lc0 = lerpLocal(r.lc0, r.local, a); }
    P.dr0 = lerp(P.dr0, P.dotR, a); P.sh0 = shNow;
    const hadPack = new Set(P.wings.filter((w) => w.pack.R > 0));
    const hadLocal = new Set(P.rooms.filter((r) => r.local.R > 0));
    for (const room of P.rooms) {
      const cs: Circle[] = room.tiles.map(() => ({ r: 1.2, x: 0, y: 0 }));
      packSiblings(cs);
      const e = enclose(cs);
      const R = Math.max(1.5, e.r + 0.3);
      const pts = cs.map((c) => ({ x: c.x - e.x, y: c.y - e.y }));
      // reading-order assignment: dot rows map to tile rows, so a dot travels to its tile without crossing its neighbours
      pts.sort((p, q) => (Math.round(p.y / 2.0) - Math.round(q.y / 2.0)) || (p.x - q.x));
      room.tiles.forEach((t, i) => { t.u = { x: pts[i].x / R, y: pts[i].y / R }; });
      room.pkR = R;
    }
    for (const w of P.wings) {
      const cs = w.rooms.map((r) => ({ r: r.pkR + 0.55, x: 0, y: 0, ref: r }));
      packSiblings(cs);
      const e = enclose(cs);
      w.pkR = Math.max(2, e.r + 0.45);
      cs.forEach((c) => { c.ref.pkx = c.x - e.x; c.ref.pky = c.y - e.y; });
    }
    const cs = P.wingArrival.map((w) => ({ r: w.pkR + 1.5, x: 0, y: 0, ref: w }));
    packSiblings(cs);
    // rotate the cluster so it is as wide as it can be (the plan is a wide sheet); prefer the last angle, so a new
    // bubble re-frames the cluster rather than spinning it
    let bestA = 0, bestS = -Infinity;
    if (cs.length > 1) {
      for (let ang = 0; ang < 180; ang += 5) {
        const ca = Math.cos(ang * Math.PI / 180), sa = Math.sin(ang * Math.PI / 180);
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const c of cs) { const x = c.x * ca - c.y * sa, y = c.x * sa + c.y * ca; x0 = Math.min(x0, x - c.r); x1 = Math.max(x1, x + c.r); y0 = Math.min(y0, y - c.r); y1 = Math.max(y1, y + c.r); }
        const asp = (x1 - x0) / (y1 - y0);
        let sc = Math.min(asp, 2.1) - 0.0004 * (x1 - x0) * (y1 - y0);
        if (P.rotA != null) { const d = Math.min(Math.abs(ang - P.rotA), 180 - Math.abs(ang - P.rotA)); sc -= 0.004 * d; }
        if (sc > bestS) { bestS = sc; bestA = ang; }
      }
      P.rotA = bestA;
    }
    const ca = Math.cos(bestA * Math.PI / 180), sa = Math.sin(bestA * Math.PI / 180);
    for (const c of cs) { const x = c.x * ca - c.y * sa, y = c.x * sa + c.y * ca; c.x = x; c.y = y; }
    const bbox = () => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const c of cs) { x0 = Math.min(x0, c.x - c.r); x1 = Math.max(x1, c.x + c.r); y0 = Math.min(y0, c.y - c.r); y1 = Math.max(y1, c.y + c.r); } return { x0, x1, y0, y1 }; };
    // few bubbles pack into a round blob; the sheet is wide, so stretch the cluster sideways (an airy, loose bubble diagram)
    if (cs.length > 2) {
      const b0 = bbox(), asp = (b0.x1 - b0.x0) / (b0.y1 - b0.y0), fx = clamp(2.05 / asp, 1, 1.9);
      for (const c of cs) c.x *= fx;
      for (let it = 0; it < 300; it++) { // keep circles apart after the stretch
        let moved = false;
        for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
          const p = cs[i], q = cs[j], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy), min = p.r + q.r;
          if (d < min) { const push = (min - d) / 2 + 1e-3, ux = d ? dx / d : 1, uy = d ? dy / d : 0; p.x -= ux * push; p.y -= uy * push; q.x += ux * push; q.y += uy * push; moved = true; }
        }
        if (!moved) break;
      }
    }
    const { x0, x1, y0, y1 } = cs.length ? bbox() : { x0: 0, x1: 0, y0: 0, y1: 0 };
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const SH = P.sheet, ccx = (SH.x0 + SH.x1) / 2, ccy = (SH.y0 + SH.y1) / 2;
    // one scale for the whole product: the tightest wing decides, so every wing bubble fits inside its own final box
    let k = Infinity;
    for (const w of P.wings) k = Math.min(k, 0.455 * Math.min(w.box.w, w.box.h) / w.pkR);
    if (!fin(k)) k = 10;
    for (const c of cs) { const w = c.ref; w.pack = { cx: ccx + (c.x - mx) * k, cy: ccy + (c.y - my) * k, R: w.pkR * k }; if (!hadPack.has(w)) w.pk0 = w.pack; }
    for (const r of P.rooms) { r.local = { x: r.pkx * k, y: r.pky * k, R: r.pkR * k }; if (!hadLocal.has(r)) r.lc0 = r.local; }
    if (hadPack.size === 0) P.dr0 = k;
    P.dotR = k;
    S.lay = { t0: now, dur: REDUCED ? 0.001 : 1.0 };
    planLabels();
  }
  function layA(t: number): number { return eInOut(seg(t, S.lay.t0, S.lay.dur)); }

  function scheduleRoomSquare(r: RoomE, t0: number) {
    const sc = r.sc;
    sc.tSq0 = t0; sc.tInk0 = t0 + 0.55; sc.tBay0 = t0 + 1.0; sc.tName = t0 + 1.05;
    const n = r.tiles.length, stag = Math.min(0.085, 1.0 / Math.max(n, 1));
    r.tiles.forEach((t, i) => scheduleTileSquare(t, t0, i * stag));
  }
  function scheduleTileSquare(t: TileE, t0: number, d: number) {
    const ts = t.sc;
    ts.tSw0 = t0 + 0.8 + d; ts.tC0 = ts.tSw0 + 0.22;
    const tC1 = ts.tC0 + 0.15 * (ts.rung + 1);
    S.tRoomsEnd = fin(S.tRoomsEnd) ? Math.max(S.tRoomsEnd, tC1) : tC1;
    bump(tC1);
  }
  function scheduleWingSquare(w: WingE) {
    if (!w.rooms.length) return;
    const first = w.rooms[0].sc, sc = w.sc;
    sc.tSq0 = first.tSq0 - 0.5; sc.tInk0 = sc.tSq0 + 1.0 - 0.25; sc.tHead = sc.tInk0 + 0.2;
  }
  function bump(t: number) { if (fin(t)) S.endT = Math.max(S.endT, t); }

  function addHistory(e: Extract<BuildupEvent, { type: 'history' }>) {
    const now = ST.t;
    for (const h of e.tiles) { const t = P.tById.get(h.id); if (t) { t.created = h.created; t.day = dayOf(h.created); } }
    const dated = P.tiles.filter((t) => t.day != null);
    P.dated = dated.length > 0;
    if (P.dated) {
      P.d0 = Math.min(...dated.map((t) => t.day as number)); P.d1 = Math.max(...dated.map((t) => t.day as number));
      for (const w of P.wings) { const ds = w.tiles.map((t) => t.day).filter((d): d is number => d != null).sort((a, b) => a - b); w.median = ds.length ? ds[Math.floor(ds.length / 2)] : null; }
    }
    if (fin(S.tHist)) { ST.dirty = true; return; } // a second history only refreshes dates
    // history lands as ONE burst, once the pen has drafted every bubble that has arrived
    const tHist = Math.max(now + 0.05, S.structEnd + 0.35, S.qT - 0.3);
    S.tHist = tHist;
    const slideStag = 0.17, slideDur = 1.15, nW = P.wings.length;
    P.wings.forEach((w, j) => { w.sc.tSlide = tHist + 0.15 + j * slideStag; });
    S.tSlideEnd = tHist + 0.15 + Math.max(0, nW - 1) * slideStag + slideDur;
    S.tCam0 = tHist + 0.05; S.dCam = S.tSlideEnd - S.tCam0 + 0.25;
    // room by room, three in flight, in plan order (wing by wing, top to bottom)
    const nR = Math.max(1, P.rooms.length);
    S.tRooms0 = S.tSlideEnd + 0.12;
    const spacing = clamp(15.5 / nR, 0.45, 1.15);
    P.rooms.forEach((r, k) => scheduleRoomSquare(r, S.tRooms0 + k * spacing));
    for (const w of P.wings) scheduleWingSquare(w);
    S.tFade0 = S.tRoomsEnd + 0.5; S.dFade = 3.2;
    bump(S.tSlideEnd + 0.3);
    // health that came early waited for its tiles to stand
    const pend = S.pending; S.pending = [];
    for (const b of pend) scheduleHealth(b);
    ST.dirty = true;
  }
  function addHealth(e: Extract<BuildupEvent, { type: 'health' }>) {
    const batch: TileE[] = [];
    for (const h of e.tiles) { const t = P.tById.get(h.id); if (t) { t.general = h.general as Health; batch.push(t); } }
    if (!batch.length) return;
    if (!fin(S.tHist)) { S.pending.push(batch); return; }
    scheduleHealth(batch);
  }
  /* a scan line crosses each judged batch, once its tiles stand (the prototype swept the whole plan at once) */
  function scheduleHealth(batch: TileE[]) {
    const now = ST.t;
    let ready = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const t of batch) {
      ready = Math.max(ready, fin(t.sc.tSw0) ? t.sc.tSw0 + 0.5 : now);
      x0 = Math.min(x0, t.box.x); x1 = Math.max(x1, t.box.x + t.box.w); y0 = Math.min(y0, t.box.y); y1 = Math.max(y1, t.box.y + t.box.h);
    }
    x0 -= 50; x1 += 50;
    const v = (P.X1 - P.X0 + 120) / 4.4;
    const a = Math.max(now + 0.05, ready, S.sweepEnd - 0.15);
    const dur = Math.max(0.35, (x1 - x0) / v);
    for (const t of batch) t.sc.tH = a + clamp((t.cx - x0) / (x1 - x0)) * dur;
    S.sweeps.push({ t0: a, t1: a + dur, x0, x1, y0: y0 - 30, y1: y1 + 30 });
    S.sweepEnd = a + dur;
    S.firstH = Math.min(S.firstH, a);
    bump(a + dur + 0.7);
  }
  function addDone() {
    const now = ST.t;
    RUN.done = true;
    S.tReg0 = Math.max(now + 0.05, S.endT + 0.3);
    S.total = S.tReg0 + 1.9;
    bump(S.total);
    ST.dirty = true;
  }

  function push(ev: BuildupEvent) {
    if (disposed) return;
    const wall = performance.now();
    if (ev.type === 'begin') { resetAll(ev.project, ev.extent); return; }
    if (!ST.began) return;
    switch (ev.type) {
      case 'phase': {
        const r = RUN.phases.get(ev.phase); if (!r) break;
        if (ev.state === 'start') { r.state = 'run'; r.startWall = wall; }
        else if (ev.state === 'done') { r.state = 'done'; r.endWall = wall; if (!r.startWall) r.startWall = wall; }
        else { r.state = 'fail'; r.endWall = wall; }
        if (ev.detail != null) r.detail = ev.detail;
        break;
      }
      case 'structure': addStructure(ev); break;
      case 'history': addHistory(ev); break;
      case 'health': addHealth(ev); break;
      case 'done': addDone(); break;
      case 'failed': {
        RUN.failed = ev.message; const r = RUN.phases.get(ev.phase); if (r) { r.state = 'fail'; r.endWall = wall; }
        toast('<b>' + esc(PHASE_NAME(ev.phase)) + ' failed:</b> ' + esc(ev.message), 12000);
        break;
      }
    }
    ST.dirty = true;
  }
  const PHASE_NAME = (p: Phase) => STEPS[PHASES.indexOf(p)]?.n ?? p;

  /* ================= render ================= */
  function readTheme() {
    const cs = getComputedStyle(root);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    const c = (n: string) => parseColor(v(n));
    TH = {
      light: theme === 'light',
      paper: c('--paper'), hi: c('--paper-hi'), mid: c('--paper-mid'), lo: c('--paper-lo'), core: c('--paper-core'),
      ink: c('--ink'), inkHi: c('--ink-hi'), accent: c('--accent'), mint: c('--mint'), amber: c('--amber'), red: c('--red'), red2: c('--red-2'),
      labelBg: c('--label-bg'), tileBase: c('--tile-base'), halo: v('--halo') || 'rgba(9,31,68,0.92)', grid: v('--grid') || 'rgba(127,224,255,0.07)', glow: c('--glow'), edge: c('--glass-edge'), vig: c('--vignette'),
    };
    const fs = v('--font-sans'), fm = v('--font-mono');
    F_SANS = (fs ? fs + ',' : '') + SANS_FALLBACK; F_MONO = (fm ? fm + ',' : '') + MONO_FALLBACK;
    const mk = (draw: (g: CanvasRenderingContext2D) => void) => { const k = document.createElement('canvas'); k.width = k.height = 6; const g = k.getContext('2d'); if (!g) return null; g.strokeStyle = rgba(TH.ink, 0.5); g.lineWidth = 1; draw(g); return k; };
    PAT = {
      diag: mk((g) => { g.beginPath(); g.moveTo(0, 6); g.lineTo(6, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(5, 7); g.lineTo(7, 5); g.stroke(); }),
      cross: mk((g) => { g.beginPath(); g.moveTo(0, 6); g.lineTo(6, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(5, 7); g.lineTo(7, 5); g.moveTo(0, 0); g.lineTo(6, 6); g.moveTo(-1, 5); g.lineTo(1, 7); g.moveTo(5, -1); g.lineTo(7, 1); g.stroke(); }),
    };
    ST.dirty = true;
  }
  const inkA = (a: number) => rgba(TH.ink, a);
  const pattern = (p: HTMLCanvasElement | null): string | CanvasPattern => (p && ctx.createPattern(p, 'repeat')) || inkA(0.2);

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    VW = Math.max(320, root.clientWidth || window.innerWidth); VH = Math.max(320, root.clientHeight || window.innerHeight);
    cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
    cv.style.width = VW + 'px'; cv.style.height = VH + 'px';
    off.width = cv.width; off.height = cv.height;
    planLabels(); ST.dirty = true;
  }
  function insets() { return { t: VW < 900 ? 140 : VW < 1100 ? 112 : 74, b: VW < 1180 ? 112 : 78, l: VW < 1180 ? 16 : VIEW.railW, r: 16 }; }
  function fitBox(b: Box4, ins: ReturnType<typeof insets>, pad: number): Cam {
    const aw = Math.max(80, VW - ins.l - ins.r), ah = Math.max(80, VH - ins.t - ins.b);
    const s = Math.min(aw / Math.max(1, b.x1 - b.x0), ah / Math.max(1, b.y1 - b.y0)) * (1 - (pad || 0));
    return { cx: (b.x0 + b.x1) / 2 - (ins.l - ins.r) / (2 * s), cy: (b.y0 + b.y1) / 2 - (ins.t - ins.b) / (2 * s), s };
  }
  function frameFor(x0: number, y0: number, x1: number, y1: number): Cam {
    const ins = insets();
    let cam: Cam = fitBox({ x0: x0 - 140, y0: y0 - 90, x1: x1 + 140, y1: y1 + 90 }, ins, 0), mx = 140, my = 90;
    for (let k = 0; k < 3; k++) { cam = fitBox({ x0: x0 - mx, y0: y0 - my, x1: x1 + mx, y1: y1 + my }, ins, 0); mx = 150 / cam.s; my = 84 / cam.s; }
    return cam;
  }
  function sheetAt(t: number): Box4 { return lerpBox(P.sh0, P.sheet, layA(t)); }
  function planCam(t: number): Cam { return fitBox(sheetAt(t), insets(), 0.012); }
  /* the pack camera: frames the wing bubbles the pen has reached, easing out as each new one arrives */
  function packCamAt(t: number): Cam {
    const base = planCam(t);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const a = layA(t);
    for (const w of P.wings) {
      if (!(w.sc.tIn - 0.25 <= t)) continue;
      const p = lerpPack(w.pk0, w.pack, a);
      x0 = Math.min(x0, p.cx - p.R); x1 = Math.max(x1, p.cx + p.R); y0 = Math.min(y0, p.cy - p.R); y1 = Math.max(y1, p.cy + p.R);
    }
    // nothing drafted yet: the pen works close, over the middle of the sheet, as the prototype's first bubble did
    if (!fin(x0)) return { cx: base.cx, cy: base.cy, s: base.s * 2.0 };
    const cam = frameFor(x0, y0, x1, y1);
    return { cx: cam.cx, cy: cam.cy, s: clamp(cam.s, base.s, base.s * 2.6) };
  }
  function camAt(t: number): Cam {
    const a = eInOut(seg(t, S.tCam0, S.dCam));
    if (a <= 0) return packCamAt(t);
    return lerpCam(packCamAt(S.tCam0), planCam(t), a);
  }
  const sx = (x: number) => (x - CAM.cx) * CAM.s + VW / 2;
  const sy = (y: number) => (y - CAM.cy) * CAM.s + VH / 2;
  const wx = (px: number) => (px - VW / 2) / CAM.s + CAM.cx;
  const wy = (py: number) => (py - VH / 2) / CAM.s + CAM.cy;

  /* ---------- state at time t: where everything is ---------- */
  function updateState(t: number, hcap: number | null) {
    const th = hcap == null ? t : Math.min(t, hcap);
    VIEW.fade = seg(th, S.tFade0, S.dFade); VIEW.th = th;
    const a = layA(t);
    P.sd = lerpBox(P.sh0, P.sheet, a); P.dd = lerp(P.dr0, P.dotR, a);
    for (const w of P.wings) {
      const sc = w.sc, s = w.s;
      w.pd = lerpPack(w.pk0, w.pack, a);
      s.appear = seg(t, sc.tIn, 0.85);
      s.slide = eInOut(seg(t, sc.tSlide, 1.15));
      s.sq = eInOut(seg(t, sc.tSq0, 1.0));
      s.cx = lerp(w.pd.cx, w.cx, s.slide); s.cy = lerp(w.pd.cy, w.cy, s.slide);
      s.hw = lerp(w.pd.R, w.box.w / 2, s.sq); s.hh = lerp(w.pd.R, w.box.h / 2, s.sq);
      s.n = lerp(2, 18, s.sq);
      s.ink = seg(t, sc.tInk0, 0.9);
      s.head = seg(t, sc.tHead, 0.55);
      s.plate = seg(t, sc.tPlate, 0.7);
      s.letter = seg(t, sc.tSlide + 0.15, 0.4);
    }
    for (const r of P.rooms) {
      const sc = r.sc, s = r.s, ws = r.wing.s;
      r.ld = lerpLocal(r.lc0, r.local, a);
      s.appear = seg(t, sc.tIn, 0.6);
      s.sq = eInOut(seg(t, sc.tSq0, 0.85));
      const pcx = ws.cx + r.ld.x, pcy = ws.cy + r.ld.y;
      s.cx = lerp(pcx, r.cx, s.sq); s.cy = lerp(pcy, r.cy, s.sq);
      s.hw = lerp(r.ld.R, r.box.w / 2, s.sq); s.hh = lerp(r.ld.R, r.box.h / 2, s.sq);
      s.n = lerp(2, 18, s.sq);
      s.ink = seg(t, sc.tInk0, 0.7);
      s.bay = seg(t, sc.tBay0, 0.5);
      s.name = seg(t, sc.tName, 0.5);
    }
    for (const tl of P.tiles) {
      const sc = tl.sc, s = tl.s, rs = tl.room.s;
      s.appear = seg(t, sc.tDot, 0.38);
      const f = lerp(1, 0.84, rs.sq);
      const spx = rs.cx + tl.u.x * rs.hw * f, spy = rs.cy + tl.u.y * rs.hh * f;
      s.sw = eInOut(seg(t, sc.tSw0, 0.5));
      s.cx = lerp(spx, tl.cx, s.sw); s.cy = lerp(spy, tl.cy, s.sw);
      s.hw = lerp(P.dd, tl.box.w / 2, s.sw); s.hh = lerp(P.dd, tl.box.h / 2, s.sw);
      s.rad = lerp(P.dd, 3.5, s.sw);
      s.climb = fin(sc.tC0) ? clamp((t - sc.tC0) / 0.15, 0, sc.rung + 1) : 0;
      s.health = seg(th, sc.tH, 0.4);
      s.hflash = fin(sc.tH) ? 1 - seg(th, sc.tH, 0.7) : 0;
      s.vis = s.appear > 0.01;
    }
  }

  /* ---------- small drawing helpers ---------- */
  function rr(x: number, y: number, w: number, h: number, r: number) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function txt(str: string, x: number, y: number, font: string, color: string, align?: CanvasTextAlign, halo?: boolean) {
    ctx.font = font; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    if (halo !== false) { ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = TH.halo; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  function wrapLines(str: string, maxW: number, maxLines: number, font: string): string[] | null {
    ctx.font = font;
    const words = str.split(/\s+/), lines: string[] = []; let cur = '';
    for (const w of words) {
      if (ctx.measureText(w).width > maxW) return null;
      const tryS = cur ? cur + ' ' + w : w;
      if (ctx.measureText(tryS).width <= maxW) cur = tryS; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length <= maxLines ? lines : null;
  }
  function wrapEllipsis(str: string, maxW: number, maxLines: number, font: string): string[] {
    ctx.font = font;
    const words = str.split(/\s+/), lines: string[] = []; let cur = '';
    for (let i = 0; i < words.length; i++) {
      const w = words[i], tryS = cur ? cur + ' ' + w : w;
      if (ctx.measureText(tryS).width <= maxW || !cur) cur = tryS;
      else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    else if (lines.length === maxLines) { let l = lines[maxLines - 1]; while (l.length > 1 && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1); lines[maxLines - 1] = l + '…'; }
    return lines;
  }
  /* hand-drawn superellipse: n=2 is the circle of a bubble, n large is the square of a block. Returns the pen tip. */
  function sePath(cx: number, cy: number, hw: number, hh: number, n: number, wob: Wob, wamp: number, a0: number, frac: number) {
    const N = 72, m = Math.max(2, Math.ceil(N * frac)), ex = 2 / n;
    let px = 0, py = 0;
    ctx.beginPath();
    for (let k = 0; k <= m; k++) {
      const th = a0 + TAU * Math.min(k / N, frac), c = Math.cos(th), sn = Math.sin(th);
      const ux = Math.sign(c) * Math.pow(Math.abs(c), ex), uy = Math.sign(sn) * Math.pow(Math.abs(sn), ex);
      const wv = 1 + wamp * (wob.a1 * Math.sin(2 * th + wob.p1) + wob.a2 * Math.sin(3 * th + wob.p2) + wob.a3 * Math.sin(5 * th + wob.p3));
      px = cx + hw * ux * wv; py = cy + hh * uy * wv;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    return { x: px, y: py };
  }
  function perimPoint(x: number, y: number, w: number, h: number, p: number) {
    const per = 2 * (w + h); let d = p * per;
    if (d < w) return { x: x + d, y };
    d -= w; if (d < h) return { x: x + w, y: y + d };
    d -= h; if (d < w) return { x: x + w - d, y: y + h };
    d -= w; return { x, y: y + h - d };
  }
  function traceRect(x: number, y: number, w: number, h: number, p: number, lw: number, color: string) {
    if (p <= 0) return;
    ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.lineJoin = 'miter';
    if (p >= 1) { ctx.setLineDash([]); ctx.strokeRect(x, y, w, h); return; }
    const per = 2 * (w + h);
    ctx.setLineDash([per * p, per]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    TIPS.push(perimPoint(x, y, w, h, p));
  }
  const dimW = (w: WingE, d: number) => (VIEW.find && !VIEW.find.wings.has(w)) ? d : 1;
  const dimR = (r: RoomE, d: number) => (VIEW.find && !VIEW.find.rooms.has(r)) ? d : 1;
  const dimT = (t: TileE, d: number) => (VIEW.find && !VIEW.find.tiles.has(t)) ? d : 1;

  /* ---------- sheet: the drafting paper, the same one the real canvas ends on ---------- */
  function drawSheet(t: number) {
    const s = CAM.s;
    const pulse = fin(S.tReg0) ? Math.sin(Math.PI * seg(t, S.tReg0, 1.3)) : 0; // the sheet is stamped: the rim breathes once
    ctx.fillStyle = rgba(TH.lo, 1); ctx.fillRect(0, 0, VW, VH);
    const gs = 200 * s;
    if (gs > 7) {
      ctx.strokeStyle = TH.grid; ctx.lineWidth = 1; ctx.beginPath();
      const x0 = Math.floor(wx(0) / 200) * 200, x1 = wx(VW), y0 = Math.floor(wy(0) / 200) * 200, y1 = wy(VH);
      for (let x = x0; x <= x1; x += 200) { const X = Math.round(sx(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, VH); }
      for (let y = y0; y <= y1; y += 200) { const Y = Math.round(sy(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(VW, Y); }
      ctx.stroke();
    }
    const sh = P.sd, x = sx(sh.x0), y = sy(sh.y0), w = (sh.x1 - sh.x0) * s, h = (sh.y1 - sh.y0) * s, rad = Math.max(10, 100 * s);
    ctx.save();
    ctx.shadowColor = rgba(TH.accent, TH.light ? 0.25 : 0.4); ctx.shadowBlur = 26 * Math.min(1, s * 3 + 0.3);
    rr(x, y, w, h, rad); ctx.fillStyle = rgba(TH.hi, 1); ctx.fill();
    ctx.restore();
    rr(x, y, w, h, rad); ctx.save(); ctx.clip();
    const cx = x + w / 2, cy = y + h / 2, R = Math.max(w, h) * 0.62;
    let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, rgba(TH.core, TH.light ? 0.0 : 0.62)); g.addColorStop(0.7, rgba(TH.core, 0)); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, R);
    g.addColorStop(0, rgba(TH.vig, 0)); g.addColorStop(1, rgba(TH.vig, Math.min(1, TH.vig[3] * (TH.light ? 1.6 : 1.15)))); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = TH.grid; ctx.lineWidth = 1; ctx.beginPath();
    for (let gx = Math.ceil(sh.x0 / 200) * 200; gx < sh.x1; gx += 200) { const X = Math.round(sx(gx)) + 0.5; ctx.moveTo(X, y); ctx.lineTo(X, y + h); }
    for (let gy = Math.ceil(sh.y0 / 200) * 200; gy < sh.y1; gy += 200) { const Y = Math.round(sy(gy)) + 0.5; ctx.moveTo(x, Y); ctx.lineTo(x + w, Y); }
    ctx.stroke();
    ctx.restore();
    ctx.save(); if (pulse > 0.01) { ctx.shadowColor = rgba(TH.accent, 0.9 * pulse); ctx.shadowBlur = 30 * pulse; }
    rr(x, y, w, h, rad); ctx.lineWidth = Math.max(3, 9 * s) * (1 + 0.45 * pulse); ctx.strokeStyle = rgba(TH.accent, (TH.light ? 0.4 : 0.36) + 0.5 * pulse); ctx.stroke(); ctx.restore();
    const i3 = 3 * Math.max(1, s * 3);
    rr(x + i3, y + i3, w - 2 * i3, h - 2 * i3, rad); ctx.lineWidth = 1; ctx.strokeStyle = rgba(TH.edge, TH.light ? 0.5 : 0.3); ctx.stroke();
  }

  /* ---------- pencil layer: bubbles ---------- */
  const pencilAlpha = (ink: number, fade: number) => lerp(1, 0.26, ink) * (1 - fade);
  function drawWingPencil(w: WingE, t: number) {
    const s = w.s; if (s.appear <= 0) return;
    const pa = pencilAlpha(s.ink, VIEW.fade); if (pa <= 0.01) return;
    const k = CAM.s, cx = sx(s.cx), cy = sy(s.cy), hw = s.hw * k, hh = s.hh * k, wob = w.wob, dim = dimW(w, 0.4);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // faint construction loop (a compass line), then the dotted bubble itself
    ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = inkA(0.16 * pa * dim);
    sePath(cx, cy, hw, hh, s.n, wob, 0.01, -Math.PI / 2, Math.min(1, s.appear));
    ctx.stroke();
    ctx.setLineDash([0.4, 8.6]); ctx.lineDashOffset = REDUCED ? 0 : -((t * 5) % 9); ctx.lineWidth = 2.9; ctx.strokeStyle = inkA(0.92 * pa * dim);
    const tip = sePath(cx, cy, hw, hh, s.n, wob, 0.012, -Math.PI / 2, s.appear);
    ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (s.appear < 1) TIPS.push(tip);
    if (s.sq < 0.2) { const al = 0.55 * pa * Math.min(1, s.appear * 3) * (1 - s.sq * 5) * dim; ctx.strokeStyle = inkA(al); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke(); }
  }
  function drawRoomPencil(r: RoomE) {
    const s = r.s; if (s.appear <= 0) return;
    const pa = pencilAlpha(s.ink, VIEW.fade); if (pa <= 0.01) return;
    const k = CAM.s, cx = sx(s.cx), cy = sy(s.cy), hw = s.hw * k, hh = s.hh * k, wob = r.wob, dim = dimR(r, 0.4);
    const amp = 0.022 * (1 - s.sq);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
    if (s.appear >= 1 || s.sq > 0) { sePath(cx, cy, hw, hh, s.n, wob, amp, wob.a0, 1); ctx.fillStyle = rgba(TH.accent, 0.05 * pa * dim); ctx.fill(); }
    ctx.lineWidth = 1.8; ctx.strokeStyle = inkA(0.72 * pa * dim);
    const tip = sePath(cx, cy, hw, hh, s.n, wob, amp, wob.a0, s.appear * 1.05);
    ctx.stroke();
    // the second, lighter pass: pencils never retrace exactly
    ctx.lineWidth = 1; ctx.strokeStyle = inkA(0.3 * pa * dim);
    sePath(cx, cy, hw * 1.012, hh * 1.012, s.n, { a1: wob.a2, a2: wob.a3, a3: wob.a1, p1: wob.p3, p2: wob.p1, p3: wob.p2, a0: wob.a0 }, amp * 1.3, wob.a0 + 0.35, Math.min(1, s.appear * 0.96));
    ctx.stroke();
    if (s.appear < 1) TIPS.push(tip);
  }
  /* a tile before the plan needs it: a pencil dot (ring + dab), pinging when it is born */
  function drawDot(tl: TileE) {
    const s = tl.s; if (!s.vis) return;
    const k = CAM.s, cx = sx(s.cx), cy = sy(s.cy), R = Math.max(2.5, P.dd * k) * eBack(s.appear);
    const pa = 1 - VIEW.fade, dim = dimT(tl, 0.35), hov = VIEW.hover === tl;
    ctx.setLineDash([]);
    if (s.appear < 1) { ctx.beginPath(); ctx.arc(cx, cy, R * (1 + 1.1 * s.appear), 0, TAU); ctx.lineWidth = 1; ctx.strokeStyle = rgba(TH.accent, 0.5 * (1 - s.appear)); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.1, R * 0.82), 0, TAU);
    ctx.fillStyle = inkA(0.1 * dim); ctx.fill();
    ctx.lineWidth = hov ? 2.6 : 1.7; ctx.strokeStyle = hov ? rgba(TH.accent, 1) : inkA(0.9 * dim * Math.max(pa, 0)); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.3, R * 0.2), 0, TAU); ctx.fillStyle = inkA(0.92 * dim * pa); ctx.fill();
  }

  /* ---------- ink layer: walls and bay rules ---------- */
  function drawRoomInk(r: RoomE) {
    const s = r.s; if (s.ink <= 0) return;
    const k = CAM.s;
    traceRect(sx(r.box.x), sy(r.box.y), r.box.w * k, r.box.h * k, eOut(s.ink), Math.max(1.2, 2.2 * k * 1.6), inkA(0.78 * dimR(r, 0.5)));
  }
  function drawBays(r: RoomE) {
    const s = r.s; if (s.bay <= 0) return;
    const k = CAM.s;
    ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = inkA(0.4);
    for (const b of r.bays) {
      const x0 = sx(b.box.x), y0 = Math.round(sy(b.box.y)) + 0.5, w = b.box.w * k * eOut(s.bay);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + w, y0); ctx.stroke();
    }
  }
  function drawWingInk(w: WingE) {
    const s = w.s; if (s.ink <= 0) return;
    const k = CAM.s;
    ctx.save(); ctx.shadowColor = rgba(TH.edge, TH.light ? 0.0 : 0.55); ctx.shadowBlur = 8;
    traceRect(sx(w.box.x), sy(w.box.y), w.box.w * k, w.box.h * k, eOut(s.ink), Math.max(2.2, 4.2 * k * 1.4), inkA(0.96));
    ctx.restore();
  }

  /* ---------- tiles: a dot swells to a tile, then climbs the ladder dotted, dashed, hatched, cross-hatched, solid ---------- */
  function drawTileBody(tl: TileE, x: number, y: number, w: number, h: number, rad: number, rung: number, flash: number) {
    const st = tl.stage, final = rung >= tl.sc.rung;
    ctx.save(); ctx.globalAlpha = dimT(tl, 0.3);
    rr(x, y, w, h, rad); ctx.fillStyle = rgba(TH.tileBase, TH.tileBase[3]); ctx.fill();
    let edge = 0.85, dash: number[] | null = null, fillA = 0, pat: HTMLCanvasElement | null = null, flag = false, dep = false;
    if (rung === 0 && !(final && st !== 'idea' && st != null)) dash = [1.5, 2.5];
    else if (rung === 1) dash = [5, 3];
    else if (rung === 2) pat = PAT.diag;
    else if (rung === 3) pat = PAT.cross;
    else if (rung >= 4) {
      if (final && st === 'flagged') { flag = true; dash = [4, 2]; fillA = 0.22; }
      else if (final && st === 'deprecated') { dep = true; fillA = 0.07; edge = 0.4; }
      else fillA = 0.22;
    }
    if ((rung <= 1 || rung >= 4) && fillA) { rr(x, y, flag ? w * 0.6 : w, h, rad); ctx.fillStyle = inkA(fillA + flash * 0.25); ctx.fill(); }
    if (pat) { ctx.save(); rr(x, y, w, h, rad); ctx.clip(); ctx.fillStyle = pattern(pat); ctx.globalAlpha *= 0.85 + flash * 0.15; ctx.fillRect(x, y, w, h); ctx.restore(); }
    if (flash > 0) { rr(x, y, w, h, rad); ctx.fillStyle = rgba(TH.accent, flash * 0.28); ctx.fill(); }
    rr(x + 0.5, y + 0.5, w - 1, h - 1, rad);
    ctx.lineWidth = 1.15; ctx.strokeStyle = inkA(edge); if (dash) ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
    if (dep && w > 10) { ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + w - 2, y + h - 2); ctx.moveTo(x + w - 2, y + 2); ctx.lineTo(x + 2, y + h - 2); ctx.lineWidth = 1; ctx.strokeStyle = inkA(0.55); ctx.stroke(); }
    ctx.restore();
  }
  function drawTile(tl: TileE) {
    const s = tl.s; if (!s.vis) return;
    if (s.sw <= 0.002) { drawDot(tl); return; }
    const k = CAM.s, cxp = sx(s.cx), cyp = sy(s.cy);
    let w = s.hw * 2 * k, h = s.hh * 2 * k; const rad = s.rad * k;
    let x = cxp - w / 2, y = cyp - h / 2;
    if (s.sw >= 1) { x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h); }
    const rung = Math.min(Math.floor(s.climb), tl.sc.rung), frac = s.climb - Math.floor(s.climb);
    const flash = (s.climb > 0 && s.climb < tl.sc.rung + 1) ? (1 - frac) * 0.6 : 0;
    drawTileBody(tl, x, y, w, h, Math.min(rad, h / 2), rung, flash);
    if (s.sw > 0.9) drawHealth(tl, x, y, w);
  }
  function drawHealth(tl: TileE, x: number, y: number, w: number) {
    const s = tl.s, k = CAM.s, bh = clamp(5 * k, 2, 5);
    ctx.save(); ctx.globalAlpha = dimT(tl, 0.3);
    ctx.fillStyle = inkA(0.12); ctx.fillRect(x, y - bh - 1, w, bh);
    if (s.health > 0) {
      const g = tl.general, col = g === 'bad' ? TH.red : g === 'watch' ? TH.amber : g === 'good' ? TH.ink : null;
      if (col) {
        ctx.fillStyle = g === 'good' ? inkA(0.62) : rgba(col, 1);
        ctx.fillRect(x, y - bh - 1, w * eOut(s.health), bh);
        if (s.hflash > 0) { ctx.fillStyle = rgba(TH.accent, 0.8 * s.hflash); ctx.fillRect(x, y - bh - 1, w * eOut(s.health), bh); }
      }
    }
    ctx.restore();
  }

  /* ---------- labels ---------- */
  function drawTileLabels(tl: TileE) {
    const s = tl.s; if (s.sw < 1 || !tl.ready) return;
    const k = CAM.s, w = tl.box.w * k, h = tl.box.h * k;
    if (w < 92) return;
    const x = sx(tl.box.x), y = sy(tl.box.y);
    ctx.save(); rr(x, y, w, h, 3); ctx.clip(); ctx.globalAlpha = dimT(tl, 0.3);
    const fs = clamp(Math.round(13 * Math.min(1.25, 0.9 + k * 0.15)), 13, 16);
    const font = `500 ${fs}px ${F_SANS}`;
    const lines = wrapEllipsis(tl.name, w - 14, h > 80 ? 2 : 1, font);
    lines.forEach((l, i) => txt(l, x + 7, y + 7 + fs + i * (fs + 2), font, inkA(0.98), 'left', true));
    if (h > 64) {
      txt(stageWord(tl.stage).toUpperCase(), x + 7, y + h - 8, `12px ${F_MONO}`, inkA(0.72), 'left', true);
      if (tl.day != null && w > 150 && fin(S.tHist) && ST.t >= S.tHist) txt(fmtDay(tl.day), x + w - 7, y + h - 8, `12px ${F_MONO}`, inkA(0.55), 'right', true);
    }
    ctx.restore();
  }
  function drawBayTags(r: RoomE) {
    if (r.s.bay < 1) return;
    const k = CAM.s; if (k < 0.5) return;
    for (const b of r.bays) {
      if (b.box.w * k < 200) continue;
      txt(b.name.toUpperCase() + ' · ' + b.tiles.length, sx(b.box.x) + 6, sy(b.box.y) + 15, `12px ${F_MONO}`, inkA(0.7), 'left', true);
    }
  }
  function drawRoomPlate(r: RoomE) {
    const s = r.s; if (s.name <= 0 || !r.plate) return;
    const k = CAM.s, rw = r.box.w * k; if (rw < 96) return;
    const x = sx(r.box.x) + 8, y = sy(r.box.y) + 8;
    const fs = rw > 420 ? 14 : 13, maxW = Math.min(rw - 28, 210 + k * 60), font = `600 ${fs}px ${F_SANS}`;
    const lines = wrapEllipsis(r.name.toUpperCase(), maxW, 2, font);
    ctx.font = font;
    let pw = 0; lines.forEach((l) => { pw = Math.max(pw, ctx.measureText(l).width); });
    const ph = lines.length * (fs + 3) + 8;
    ctx.save(); ctx.globalAlpha = s.name * dimR(r, 0.5);
    ctx.fillStyle = rgba(TH.labelBg, 0.96); ctx.fillRect(x, y, pw + 16, ph);
    ctx.strokeStyle = inkA(0.22); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, pw + 15, ph - 1);
    lines.forEach((l, i) => txt(l, x + 8, y + 4 + fs + i * (fs + 3) - 1, font, inkA(1), 'left', false));
    ctx.restore();
  }
  function drawWingHeader(w: WingE) {
    const s = w.s; if (s.head <= 0) return;
    const k = CAM.s, X0 = sx(w.box.x), WW = w.box.w * k, top = sy(w.box.y);
    if (WW < 70) return;
    const pad = 7, x = X0 + pad, ww = WW - pad * 2;
    const a = s.head, rise = (1 - eOut(a)) * 8;
    ctx.save(); ctx.globalAlpha = a * dimW(w, 0.5);
    const nameFont = `600 ${ww < 170 ? 14 : 16}px ${F_SANS}`, tx = x + 27;
    const lines = wrapEllipsis(w.name.toUpperCase(), ww - 30, 3, nameFont);
    const lh = 17, rows = lines.length;
    const barY = top - 12 + rise, statY = barY - 8, nameBottom = statY - 17;
    const ly = nameBottom - (rows - 1) * lh / 2 - 6;
    ctx.beginPath(); ctx.arc(x + 10, ly, 10, 0, TAU); ctx.fillStyle = rgba(TH.labelBg, 0.9); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = inkA(0.9); ctx.stroke();
    txt(w.letter, x + 10, ly + 4.5, `600 13px ${F_SANS}`, inkA(1), 'center', false);
    lines.forEach((l, i) => txt(l, tx, nameBottom - (rows - 1 - i) * lh, nameFont, inkA(1), 'left', true));
    // counts tick up as tiles reach their stage / their health arrives
    let live = 0, bad = 0;
    for (const tl of w.tiles) { if (tl.s.climb >= tl.sc.rung + 1 && stageGroup(tl.stage) === 'live') live++; if (tl.s.health >= 1 && tl.general === 'bad') bad++; }
    const f13 = `13px ${F_SANS}`, left = w.tiles.length + ' · ' + live + ' live';
    txt(left, x, statY, f13, inkA(0.9), 'left', true);
    if (bad > 0) {
      ctx.font = f13; const lw = ctx.measureText(left).width;
      let rt = bad + ' in trouble'; if (lw + ctx.measureText(rt).width + 12 > ww) rt = bad + ' trouble';
      if (lw + ctx.measureText(rt).width + 8 <= ww) txt(rt, x + ww, statY, f13, rgba(TH.red2, 1), 'right', true);
    }
    const bw = ww, bh = 6, st = w.stat, n = Math.max(1, w.tiles.length); let bx = x;
    ctx.fillStyle = rgba(TH.labelBg, 0.7); ctx.fillRect(x, barY, bw, bh);
    for (const [g, c] of [['live', st.live], ['build', st.build], ['paper', st.paper], ['dep', st.dep]] as const) {
      if (!c) continue; const sw = bw * c / n * eOut(a);
      if (g === 'live') { ctx.fillStyle = inkA(0.85); ctx.fillRect(bx, barY, sw, bh); }
      else if (g === 'build') { ctx.save(); ctx.beginPath(); ctx.rect(bx, barY, sw, bh); ctx.clip(); ctx.fillStyle = pattern(PAT.diag); ctx.fillRect(bx, barY, sw, bh); ctx.restore(); }
      else if (g === 'paper') { ctx.fillStyle = inkA(0.14); ctx.fillRect(bx, barY, sw, bh); }
      else { ctx.fillStyle = inkA(0.4); ctx.fillRect(bx, barY + 2, sw, 2); }
      bx += sw;
    }
    ctx.strokeStyle = inkA(0.55); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, barY + 0.5, bw - 1, bh - 1);
    ctx.restore();
  }

  /* the wing's pencil name plate, a room's name inside its bubble, or a callout with a leader line */
  function drawPencilLabels(t: number) {
    const k = CAM.s;
    for (const r of P.rooms) {
      const s = r.s, lab = r.lab; if (!lab || s.appear < 0.8) continue;
      const fadeO = (1 - sstep(s.sq * 2.5)) * (1 - VIEW.fade) * sstep((s.appear - 0.8) * 5); if (fadeO <= 0.01) continue;
      const ws = r.wing.s, dim = dimR(r, 0.4);
      ctx.save(); ctx.globalAlpha = fadeO * dim;
      if (lab.inside) {
        const f = `600 12px ${F_SANS}`, lh = 14, cx = sx(s.cx), cy = sy(s.cy), x = cx - lab.w / 2, y = cy - lab.h / 2;
        ctx.fillStyle = rgba(TH.labelBg, 0.93); ctx.fillRect(x, y, lab.w, lab.h);
        ctx.strokeStyle = inkA(0.28); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, lab.w - 1, lab.h - 1);
        lab.lines.forEach((l, i) => txt(l, cx, y + 4 + 11 + i * lh, f, inkA(0.98), 'center', false));
      } else {
        ctx.globalAlpha = fadeO * dim * (1 - seg(t, S.tHist, 0.4));
        if (ctx.globalAlpha < 0.02) { ctx.restore(); continue; }
        const Rw = r.wing.pd.R * k, cx = sx(ws.cx) + lab.ux * (Rw + lab.off), cy = sy(ws.cy) + lab.uy * (Rw + lab.off), x = cx - lab.w / 2, y = cy - lab.h / 2;
        const bx = sx(s.cx), by = sy(s.cy), br = r.ld.R * k;
        const ang = Math.atan2(cy - by, cx - bx), ex = bx + Math.cos(ang) * br, ey = by + Math.sin(ang) * br;
        const px = clamp(ex, x, x + lab.w), py = clamp(ey, y, y + lab.h);
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(px, py); ctx.lineWidth = 1; ctx.strokeStyle = inkA(0.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, 2, 0, TAU); ctx.fillStyle = inkA(0.8); ctx.fill();
        lab.lines.forEach((l, i) => txt(l, cx, y + 13 + i * 14, `600 12px ${F_SANS}`, inkA(0.92), 'center', true));
      }
      ctx.restore();
    }
    for (const w of P.wings) {
      const s = w.s; if (s.plate <= 0 || !w.lab) continue;
      const fadeO = (1 - sstep(s.sq * 3)) * (1 - VIEW.fade);
      if (fadeO <= 0.01) continue;
      const L = w.lab, Rw = w.pd.R * k, cx = sx(s.cx) + L.ux * (Rw + L.off), cy = sy(s.cy) + L.uy * (Rw + L.off);
      const x = cx - L.w / 2, y = cy - L.h / 2;
      ctx.save(); ctx.globalAlpha = Math.min(1, s.plate * 2) * fadeO * dimW(w, 0.4);
      ctx.fillStyle = rgba(TH.labelBg, 0.95); ctx.fillRect(x, y, L.w, L.h);
      ctx.strokeStyle = inkA(0.4); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, L.w - 1, L.h - 1);
      const typed = Math.ceil(w.name.length * clamp(s.plate * 1.15));
      txt(w.name.toUpperCase().slice(0, typed), x + 8, y + 20, `600 15px ${F_SANS}`, inkA(1), 'left', false);
      let n = 0; for (const tl of w.tiles) if (tl.s.appear > 0.5) n++;
      txt(n + (n === 1 ? ' FEATURE' : ' FEATURES'), x + 8, y + L.h - 9, `12px ${F_MONO}`, inkA(0.72), 'left', false);
      ctx.restore();
    }
  }
  /* lay the bubble names out for the pack camera over what has arrived: inside when it fits at 12 px, else a callout */
  function planLabels() {
    if (!P.wings.length || !TH) return;
    ctx = ctxMain;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const w of P.wings) { x0 = Math.min(x0, w.pack.cx - w.pack.R); x1 = Math.max(x1, w.pack.cx + w.pack.R); y0 = Math.min(y0, w.pack.cy - w.pack.R); y1 = Math.max(y1, w.pack.cy + w.pack.R); }
    const base = fitBox(P.sheet, insets(), 0.012), fc = frameFor(x0, y0, x1, y1);
    const s = clamp(fc.s, base.s, base.s * 2.6);
    const circles = new Map<WingE, { x: number; y: number; R: number }>();
    for (const w of P.wings) {
      ctx.font = `600 15px ${F_SANS}`;
      const nameW = ctx.measureText(w.name.toUpperCase()).width;
      ctx.font = `12px ${F_MONO}`; const cW = ctx.measureText('000 FEATURES').width;
      w.lab = { w: Math.max(nameW, cW) + 16, h: 46, ux: 0, uy: -1, off: 0 };
      circles.set(w, { x: w.pack.cx * s, y: w.pack.cy * s, R: w.pack.R * s });
    }
    const placed: { cx: number; cy: number; w: number; h: number }[] = [];
    for (const w of P.wingArrival) {
      const me = circles.get(w), L = w.lab; if (!me || !L) continue;
      let best = { pen: Infinity, cx: me.x, cy: me.y - me.R - L.h };
      for (let kk = 0; kk < 24; kk++) {
        const a = -Math.PI / 2 + (kk % 2 ? 1 : -1) * Math.ceil(kk / 2) * (TAU / 24);
        const ux = Math.cos(a), uy = Math.sin(a), offd = Math.abs(ux) * L.w / 2 + Math.abs(uy) * L.h / 2 + 6;
        const cx = me.x + ux * (me.R + offd), cy = me.y + uy * (me.R + offd);
        let pen = (uy > 0.3 ? 14 : 0) + kk * 0.6;
        for (const o of circles.values()) {
          if (o === me) continue;
          const nx = clamp(o.x, cx - L.w / 2, cx + L.w / 2), ny = clamp(o.y, cy - L.h / 2, cy + L.h / 2), d = Math.hypot(o.x - nx, o.y - ny) - o.R;
          if (d < 8) pen += 60 + (8 - d) * 3;
        }
        for (const p of placed) { if (Math.abs(p.cx - cx) < (p.w + L.w) / 2 + 6 && Math.abs(p.cy - cy) < (p.h + L.h) / 2 + 6) pen += 200; }
        if (pen < best.pen) best = { pen, cx, cy };
      }
      const vx = best.cx - me.x, vy = best.cy - me.y, d = Math.hypot(vx, vy) || 1; L.ux = vx / d; L.uy = vy / d; L.off = d - me.R;
      placed.push({ cx: best.cx, cy: best.cy, w: L.w, h: L.h });
    }
    const callouts: { lab: RoomLab; me: { x: number; y: number; R: number } }[] = [];
    for (const w of P.wings) for (const r of w.rooms) {
      const Rpx = r.local.R * s, me = circles.get(w); if (!me) continue;
      const f12 = `600 12px ${F_SANS}`;
      const lines = wrapLines(r.name.toUpperCase(), Math.max(40, Rpx * 2.0 - 14), 3, f12);
      if (lines) {
        ctx.font = f12; let pw = 0; lines.forEach((l) => { pw = Math.max(pw, ctx.measureText(l).width); });
        pw += 12; const ph = lines.length * 14 + 8;
        if (pw <= Rpx * 2.15 && ph <= Rpx * 1.5) { r.lab = { inside: true, lines, w: pw, h: ph, cx: 0, cy: 0, ux: 0, uy: 0, off: 0 }; continue; }
      }
      const ls = wrapEllipsis(r.name.toUpperCase(), 130, 2, f12);
      ctx.font = f12; let lw = 0; ls.forEach((l) => { lw = Math.max(lw, ctx.measureText(l).width); });
      let dx = r.local.x, dy = r.local.y, dl = Math.hypot(dx, dy); if (dl < 1e-3) { dx = 0; dy = -1; dl = 1; }
      dx /= dl; dy /= dl;
      const lab: RoomLab = { inside: false, lines: ls, w: lw + 10, h: ls.length * 14 + 6, cx: 0, cy: 0, ux: 0, uy: 0, off: 0 };
      const offd = Math.abs(dx) * lab.w / 2 + Math.abs(dy) * lab.h / 2 + 10;
      lab.cx = me.x + dx * (me.R + offd); lab.cy = me.y + dy * (me.R + offd);
      r.lab = lab; callouts.push({ lab, me });
    }
    for (let it = 0; it < 80; it++) {
      for (const c of callouts) {
        const a = c.lab;
        for (const b of callouts) {
          if (b === c) continue; const o = b.lab;
          const ox = (a.w + o.w) / 2 + 4 - Math.abs(a.cx - o.cx), oy = (a.h + o.h) / 2 + 4 - Math.abs(a.cy - o.cy);
          if (ox > 0 && oy > 0) { if (ox < oy) { const sgn = a.cx >= o.cx ? 1 : -1; a.cx += sgn * ox / 2; o.cx -= sgn * ox / 2; } else { const sgn = a.cy >= o.cy ? 1 : -1; a.cy += sgn * oy / 2; o.cy -= sgn * oy / 2; } }
        }
        for (const p of placed) {
          const ox = (a.w + p.w) / 2 + 4 - Math.abs(a.cx - p.cx), oy = (a.h + p.h) / 2 + 4 - Math.abs(a.cy - p.cy);
          if (ox > 0 && oy > 0) { if (ox < oy) a.cx += (a.cx >= p.cx ? 1 : -1) * ox; else a.cy += (a.cy >= p.cy ? 1 : -1) * oy; }
        }
        for (const o of circles.values()) {
          const nx = clamp(o.x, a.cx - a.w / 2, a.cx + a.w / 2), ny = clamp(o.y, a.cy - a.h / 2, a.cy + a.h / 2), d = Math.hypot(o.x - nx, o.y - ny) - (o.R + 4);
          if (d < 0) { const ux = nx - o.x, uy = ny - o.y, ul = Math.hypot(ux, uy) || 1; a.cx -= ux / ul * d; a.cy -= uy / ul * d; }
        }
      }
    }
    for (const c of callouts) { const vx = c.lab.cx - c.me.x, vy = c.lab.cy - c.me.y, d = Math.hypot(vx, vy) || 1; c.lab.ux = vx / d; c.lab.uy = vy / d; c.lab.off = d - c.me.R; }
    for (const tl of P.tiles) tl.ready = true;
    for (const r of P.rooms) r.plate = true;
  }

  /* ---------- history: the ruler under the plan, with the months the repo's own dates give ---------- */
  function drawRuler(t: number) {
    const ru = seg(t, S.tHist, 1.1); if (ru <= 0) return;
    const k = CAM.s, y0 = sy(P.Y1 + 135), xa = sx(P.X0), xb = sx(P.X1), aw = xb - xa, tickH = clamp(48 * k, 6, 16);
    ctx.save(); ctx.globalAlpha = Math.min(1, ru * 2);
    ctx.lineWidth = 1; ctx.strokeStyle = inkA(0.5); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(xa, y0 + 0.5); ctx.lineTo(xa + aw * eOut(ru), y0 + 0.5); ctx.stroke();
    const f12 = `12px ${F_MONO}`;
    if (P.dated) {
      ctx.strokeStyle = inkA(0.36); ctx.beginPath();
      const span = Math.max(1, P.d1 - P.d0);
      for (const tl of P.tiles) { if (tl.day == null) continue; const fx = (tl.day - P.d0) / span; if (fx > eOut(ru)) continue; const X = Math.round(xa + fx * aw) + 0.5; ctx.moveTo(X, y0); ctx.lineTo(X, y0 - tickH); }
      ctx.stroke();
      const d0 = new Date(P.d0 * 86400000);
      let yr = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1;
      const months = Math.ceil(span / 28) + 2;
      for (let i = 0; i < Math.min(60, months); i++) {
        if (m > 11) { m = 0; yr++; }
        const d = Date.UTC(yr, m, 1) / 86400000, fx = (d - P.d0) / span;
        if (fx > 1) break;
        // a long history labels every month only when there is room for it
        const every = Math.max(1, Math.ceil(months * 46 / Math.max(1, aw)));
        if (fx >= 0 && fx <= eOut(ru) && i % every === 0) { const X = xa + fx * aw; ctx.beginPath(); ctx.moveTo(Math.round(X) + 0.5, y0); ctx.lineTo(Math.round(X) + 0.5, y0 + 6); ctx.strokeStyle = inkA(0.7); ctx.stroke(); txt(MONTHS[m], X + 4, y0 + 16, f12, inkA(0.8), 'left', true); }
        m++;
      }
      // each wing's median day, pinned to the ruler as its letter
      for (const w of P.wings) {
        if (w.median == null) continue;
        const a = seg(t, w.sc.tSlide + 0.5, 0.5); if (a <= 0) continue;
        const fx = (w.median - P.d0) / span, X = xa + fx * aw, Y = y0 - tickH - 16 - (1 - eOut(a)) * 10;
        ctx.globalAlpha = Math.min(1, ru * 2) * a;
        ctx.beginPath(); ctx.moveTo(X, y0 - tickH - 1); ctx.lineTo(X - 4, Y + 10); ctx.lineTo(X + 4, Y + 10); ctx.closePath(); ctx.fillStyle = inkA(0.9); ctx.fill();
        ctx.beginPath(); ctx.arc(X, Y, 9, 0, TAU); ctx.fillStyle = rgba(TH.labelBg, 0.95); ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = inkA(0.9); ctx.stroke();
        txt(w.letter, X, Y + 4.5, `600 12px ${F_SANS}`, inkA(1), 'center', false);
      }
      ctx.globalAlpha = Math.min(1, ru * 2);
    }
    const fy = y0 + (P.dated ? 32 : 18), L = 'OLDEST WORK', R = 'NEWEST WORK ▸', M = 'LEFT TO RIGHT: WINGS IN THE ORDER THEIR WORK BEGAN · FEATURES OLDEST FIRST';
    ctx.font = f12; const lw = ctx.measureText(L).width, rw = ctx.measureText(R).width, mw = ctx.measureText(M).width;
    txt(L, xa + 2, fy, f12, inkA(0.7), 'left', true); txt(R, xb - 2, fy, f12, inkA(0.7), 'right', true);
    if (aw > lw + rw + mw + 60) txt(M, (xa + xb) / 2, fy, f12, inkA(0.7), 'center', true);
    ctx.restore();
  }

  /* ---------- overlays: pen tips, the health scan line, hover ---------- */
  function drawSweep() {
    const th = VIEW.th;
    for (const sw of S.sweeps) {
      if (!(th > sw.t0 && th < sw.t1)) continue;
      const a = (th - sw.t0) / (sw.t1 - sw.t0);
      const x = sx(lerp(sw.x0, sw.x1, a)), y0 = sy(sw.y0), y1 = sy(sw.y1);
      const g = ctx.createLinearGradient(x - 60, 0, x + 2, 0);
      g.addColorStop(0, rgba(TH.accent, 0)); g.addColorStop(1, rgba(TH.accent, TH.light ? 0.16 : 0.22));
      ctx.fillStyle = g; ctx.fillRect(x - 60, y0, 62, y1 - y0);
      ctx.save(); ctx.shadowColor = rgba(TH.accent, 0.9); ctx.shadowBlur = 12; ctx.fillStyle = rgba(TH.accent, 0.95); ctx.fillRect(x - 1, y0, 2, y1 - y0); ctx.restore();
    }
  }
  /* while the pipeline is still thinking, the pen does not rest: it swings a compass over the next bubble's slot, or,
     when nothing says where the next bubble goes, over the sheet's open paper beside the cluster */
  function penWaiting(t: number): boolean {
    if (REDUCED || t >= S.tHist || RUN.done) return false;
    return true;
  }
  function drawIdlePen(t: number) {
    if (!penWaiting(t)) return;
    let ni = -1; for (let i = 0; i < S.units.length; i++) if (S.units[i].t > t) { ni = i; break; }
    const last = S.units.length ? S.units[S.units.length - 1] : null;
    let ax: number, ay: number, ar: number, lead: number;
    if (ni >= 0) {
      if (ni > 0 && t < S.units[ni - 1].t + 1.9) return;
      const u = S.units[ni], w = u.wing;
      if (u.fresh) { ax = w.pd.cx; ay = w.pd.cy; ar = w.pd.R; } else { const r = u.rooms[0] ?? w.rooms[0]; ax = w.pd.cx + (r ? r.ld.x : 0); ay = w.pd.cy + (r ? r.ld.y : 0); ar = r ? r.ld.R : w.pd.R; }
      lead = u.t;
    } else {
      if (last && t < last.t + 1.9) return;
      if (fin(S.tHist)) return;
      // no next slot is known: the pen circles open paper, right of what has been drafted (or the sheet's middle)
      const sh = P.sd, mid = { x: (sh.x0 + sh.x1) / 2, y: (sh.y0 + sh.y1) / 2 };
      if (P.wings.length) {
        let x1 = -Infinity, cyS = 0, rS = 0; for (const w of P.wings) { x1 = Math.max(x1, w.pd.cx + w.pd.R); cyS += w.pd.cy; rS += w.pd.R; }
        const rm = rS / P.wings.length;
        ax = Math.min(x1 + rm * 1.1, sh.x1 - rm - 60); ay = cyS / P.wings.length; ar = rm * 0.8;
      } else { ax = mid.x; ay = mid.y; ar = Math.min(sh.x1 - sh.x0, sh.y1 - sh.y0) * 0.12; }
      lead = 1.6;
    }
    const k = CAM.s, cx = sx(ax), cy = sy(ay), R = Math.max(14, ar * k);
    const pos = (tt: number) => { const th = tt * 0.95 + 1.3, rr0 = R * (0.9 + 0.1 * Math.sin(tt * 1.7)); return { x: cx + Math.cos(th) * rr0, y: cy + Math.sin(th) * rr0 }; };
    ctx.lineCap = 'round'; ctx.setLineDash([]);
    for (let j = 24; j >= 1; j--) { const a = pos(t - j * 0.05), b = pos(t - (j - 1) * 0.05); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = rgba(TH.accent, 0.62 * (1 - j / 25)); ctx.lineWidth = 1.7; ctx.stroke(); }
    let p = pos(t);
    if (ni <= 0 && !last) { const g = sstep(t / Math.max(0.2, lead)), sx0 = VW * 0.16, sy0 = VH * 0.28; p = { x: lerp(sx0, p.x, g), y: lerp(sy0, p.y, g) }; }
    TIPS.push(p);
  }
  function drawTips() {
    for (const tp of TIPS) {
      ctx.save(); ctx.shadowColor = rgba(TH.accent, 1); ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(tp.x, tp.y, 4.2, 0, TAU); ctx.fillStyle = rgba(TH.accent, 1); ctx.fill();
      ctx.restore();
    }
  }
  function drawHover() {
    const k = CAM.s;
    const one = (e: Ent | null, strong: boolean) => {
      if (!e || e.type === 'bay') return;
      let x: number, y: number, w: number, h: number, rad = 3;
      if (e.type === 'tile') { const s = e.s; if (!s.vis) return; x = sx(s.cx - s.hw); y = sy(s.cy - s.hh); w = s.hw * 2 * k; h = s.hh * 2 * k; rad = s.rad * k; }
      else { const s = e.s; if (s.sq < 0.99 && s.ink < 1) return; x = sx(e.box.x); y = sy(e.box.y); w = e.box.w * k; h = e.box.h * k; }
      ctx.save(); ctx.shadowColor = rgba(TH.accent, 0.9); ctx.shadowBlur = strong ? 14 : 8;
      rr(x - 1.5, y - 1.5, w + 3, h + 3, rad + 1.5); ctx.lineWidth = strong ? 2.6 : 2; ctx.strokeStyle = rgba(TH.accent, 1); ctx.stroke();
      ctx.restore();
    };
    if (VIEW.sel && VIEW.sel !== VIEW.hover) one(VIEW.sel, true);
    if (VIEW.hover) one(VIEW.hover, false);
  }

  function drawScene(c: CanvasRenderingContext2D, t: number, cam: Cam) {
    ctx = c; CAM = cam; TIPS = [];
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSheet(t);
    for (const w of P.wings) drawWingPencil(w, t);
    for (const r of P.rooms) drawRoomPencil(r);
    for (const r of P.rooms) drawRoomInk(r);
    for (const r of P.rooms) drawBays(r);
    for (const w of P.wings) drawWingInk(w);
    for (const tl of P.tiles) drawTile(tl);
    drawSweep();
    drawRuler(t);
    for (const r of P.rooms) { drawRoomPlate(r); drawBayTags(r); }
    for (const tl of P.tiles) drawTileLabels(tl);
    for (const w of P.wings) drawWingHeader(w);
    drawPencilLabels(t);
    drawHover();
    drawIdlePen(t);
    drawTips();
  }

  /* ---------- picking: a bubble before the plan stands, a box after ---------- */
  function inShape(e: WingE | RoomE, x: number, y: number) {
    const s = e.s, dx = Math.abs(x - s.cx) / Math.max(1e-6, s.hw), dy = Math.abs(y - s.cy) / Math.max(1e-6, s.hh);
    if (dx > 1 || dy > 1) return false;
    return Math.pow(dx, s.n || 2) + Math.pow(dy, s.n || 2) <= 1.0001;
  }
  function hitTest(px: number, py: number): Ent | null {
    if (!P.tiles.length && !P.wings.length) return null;
    const x = wx(px), y = wy(py);
    for (let i = P.tiles.length - 1; i >= 0; i--) {
      const tl = P.tiles[i], s = tl.s; if (!s.vis) continue;
      const grow = s.sw < 0.5 ? 1.15 : 1;
      if (Math.abs(x - s.cx) <= s.hw * grow && Math.abs(y - s.cy) <= s.hh * grow) return tl;
    }
    for (const r of P.rooms) { if (r.s.appear >= 0.6 && inShape(r, x, y)) return r; }
    for (const w of P.wings) { if (w.s.appear >= 0.6 && inShape(w, x, y)) return w; }
    return null;
  }
  const boxOf = (e: Ent): Box4 => ({ x0: e.box.x, y0: e.box.y, x1: e.box.x + e.box.w, y1: e.box.y + e.box.h });

  /* ================= the controller: playback, camera, hover, selection, breadcrumb, levels, find, rail ================= */
  const setTxt = (el: HTMLElement, v: string) => { const d = el as HTMLElement & { _v?: string }; if (d._v !== v) { d._v = v; el.textContent = v; } };
  const setHtml = (el: HTMLElement, v: string) => { const d = el as HTMLElement & { _h?: string }; if (d._h !== v) { d._h = v; el.innerHTML = v; } };

  /** Reduced motion: three still sheets. 0 the bubble diagram as far as it has arrived, 1 the block plan, 2 ink + health. */
  const reached = () => (RUN.done || S.sweeps.length ? 2 : fin(S.tHist) ? 1 : 0);
  const snapTime = (i: number) => i === 0 ? Math.min(S.endT, S.tHist - 0.02) : i === 1 ? (fin(S.tRoomsEnd) ? S.tRoomsEnd + 0.05 : S.endT) : Math.max(S.endT, fin(S.total) ? S.total : 0);
  const snapCap = (i: number) => (i === 1 ? -1 : null);
  const viewTime = () => (REDUCED ? snapTime(ST.snap) : ST.t);
  function currentCam(t: number): Cam {
    if (ST.follow) {
      const base = REDUCED ? camAt(t) : (ST.cam ?? camAt(t));
      if (ST.blend) { const a = (ST.now - ST.blend.t0) / ST.blend.dur; if (a >= 1) ST.blend = null; else return lerpCam(ST.blend.from, base, eInOut(a)); }
      return base;
    }
    if (ST.anim) {
      const a = (ST.now - ST.anim.t0) / ST.anim.dur;
      if (a >= 1) { ST.ucam = ST.anim.to; ST.anim = null; } else return lerpCam(ST.anim.from, ST.anim.to, eInOut(a));
    }
    return ST.ucam ?? camAt(t);
  }
  function userControl() {
    if (ST.follow) { ST.ucam = { ...currentCam(viewTime()) }; ST.follow = false; ST.blend = null; syncButtons(); }
    else if (ST.anim) { ST.ucam = { ...currentCam(viewTime()) }; ST.anim = null; }
  }
  function animateTo(cam: Cam, dur: number) { userControl(); const from = { ...currentCam(viewTime()) }; ST.anim = { from, to: cam, t0: ST.now, dur: (REDUCED ? 0.01 : dur) * 1000 }; ST.ucam = from; ST.dirty = true; }
  function followAgain() { if (ST.follow) return; const from = { ...currentCam(viewTime()) }; ST.follow = true; ST.anim = null; ST.blend = { from, t0: ST.now, dur: REDUCED ? 10 : 700 }; ST.dirty = true; syncButtons(); }
  const clampS = (s: number) => clamp(s, planCam(viewTime()).s * 0.55, 4.2);
  function curBox(e: Ent): Box4 {
    if (e.type === 'tile' && e.s.sw < 1) return { x0: e.s.cx - 200, y0: e.s.cy - 200, x1: e.s.cx + 200, y1: e.s.cy + 200 };
    if ((e.type === 'wing' || e.type === 'room') && e.s.sq < 1) return { x0: e.s.cx - e.s.hw, y0: e.s.cy - e.s.hh, x1: e.s.cx + e.s.hw, y1: e.s.cy + e.s.hh };
    return boxOf(e);
  }
  function focusEntity(e: Ent, dur?: number) {
    const b = curBox(e), ins = insets();
    const pad = e.type === 'tile' ? 110 : e.type === 'bay' ? 40 : e.type === 'room' ? 50 : 70;
    const top = e.type === 'wing' ? 260 : e.type === 'room' ? 30 : 0;
    const cam = fitBox({ x0: b.x0 - pad, y0: b.y0 - pad - top, x1: b.x1 + pad, y1: b.y1 + pad }, ins, 0);
    cam.s = clampS(cam.s); animateTo(cam, dur || 0.75);
  }
  function zoomBy(f: number, px?: number, py?: number) {
    userControl();
    const c = ST.anim ? ST.anim.to : (ST.ucam ?? camAt(viewTime())), s2 = clampS(c.s * f); if (s2 === c.s) return;
    const qx = px == null ? VW / 2 : px, qy = py == null ? VH / 2 : py;
    const wxp = (qx - VW / 2) / c.s + c.cx, wyp = (qy - VH / 2) / c.s + c.cy;
    ST.anim = null; ST.ucam = { cx: wxp - (qx - VW / 2) / s2, cy: wyp - (qy - VH / 2) / s2, s: s2 }; ST.dirty = true;
  }

  /* ---------- the run rail + stats + sheet title ---------- */
  function buildRail() {
    $('steps').innerHTML = STEPS.map((s, i) => '<li data-i="' + i + '"' + (i < 3 ? ' data-pre="1"' : '') + ' data-st="pend"><span data-g aria-hidden="true">✓</span><div><div data-n>' + (i + 1) + ' ' + esc(s.n) + (s.tag ? '<em>' + s.tag + '</em>' : '') + '</div><div data-d></div></div></li>').join('');
  }
  function counts() {
    const c = { found: 0, live: 0, build: 0, paper: 0, dep: 0, done: 0, judged: 0, bad: 0, watch: 0, good: 0, rooms: 0, wings: 0 };
    for (const tl of P.tiles) {
      if (tl.s.appear > 0.5) c.found++;
      if (tl.s.climb >= tl.sc.rung + 1) { c.done++; c[stageGroup(tl.stage)]++; }
      if (tl.s.health >= 1) { c.judged++; if (tl.general === 'bad') c.bad++; else if (tl.general === 'watch') c.watch++; else if (tl.general === 'good') c.good++; }
    }
    for (const r of P.rooms) if (r.s.appear > 0.5) c.rooms++;
    for (const w of P.wings) if (w.s.appear > 0.3) c.wings++;
    return c;
  }
  function stepDetail(i: number, rec: PhaseRec, c: ReturnType<typeof counts>, wall: number): string {
    const st = rec.state, nT = P.tiles.length;
    const el = (rec.state === 'run' ? wall - rec.startWall : rec.endWall - rec.startWall) / 1000;
    if (st === 'fail') return RUN.failed ? 'failed: ' + RUN.failed : 'failed';
    switch (i) {
      case 3:
        if (st === 'pend') return STEPS[3].d;
        if (st === 'run' && !P.wings.length) return 'naming the product · ' + fmtTime(el);
        return c.wings + ' of ' + P.wings.length + (P.wings.length === 1 ? ' wing' : ' wings') + ' · ' + c.found + ' features' + (st === 'run' ? ' · ' + fmtTime(el) : '');
      case 4: return st === 'pend' ? STEPS[4].d : st === 'run' ? 'reading history…' : (P.dated ? fmtDay(P.d0) + ' → ' + fmtDay(P.d1) + ' · wings ordered' : 'wings ordered, oldest first');
      case 5: return st === 'pend' ? STEPS[5].d : st === 'run' ? 'reading metrics… ' + fmtTime(el) : 'metrics in';
      case 6: return st === 'pend' ? STEPS[6].d : st === 'run' ? c.judged + ' of ' + nT + ' judged · ' + fmtTime(el) : c.bad + ' in trouble · ' + c.watch + ' watch';
      case 7: return st === 'pend' ? STEPS[7].d : st === 'run' ? 'stamping the sheet…' : 'on the board';
      default: return st === 'run' ? STEPS[i].d + ' · ' + fmtTime(el) : (rec.detail ?? STEPS[i].d);
    }
  }
  function updateHud(tv: number) {
    const c = counts(), wall = performance.now();
    const phase = tv < S.tHist ? 0 : tv < S.tReg0 ? 1 : 2;
    setTxt($('tCode'), ['A-001', 'A-002', 'G-001'][phase]); setTxt($('tName'), ['BUBBLE DIAGRAM', 'BLOCK PLAN', 'GENERAL ARRANGEMENT'][phase]);
    let h: string;
    if (tv < S.tHist) {
      const treeDone = RUN.phases.get('product-tree')?.state === 'done';
      h = '<b>' + c.found + '</b> features found' + (treeDone && P.wings.length ? ' <span data-dim>· ' + P.wings.length + ' wings · ' + P.rooms.length + ' rooms</span>' : '');
    } else {
      h = '<b>' + P.tiles.length + '</b> features';
      if (c.live) h += ' · <b>' + c.live + '</b> live';
      if (c.build) h += ' · <b>' + c.build + '</b> being built';
      if (c.paper) h += ' · <b>' + c.paper + '</b> on paper';
      if (c.dep) h += ' · <b>' + c.dep + '</b> to demolish';
      if (c.bad) h += ' · <span data-bad><b>' + c.bad + '</b> in trouble</span>';
    }
    setHtml($('stats'), h);
    const lis = $('steps').children;
    PHASES.forEach((p, i) => {
      const rec = RUN.phases.get(p); const li = lis[i] as HTMLElement | undefined; if (!rec || !li) return;
      if (li.dataset.st !== rec.state) li.dataset.st = rec.state;
      const d = li.querySelector<HTMLElement>('[data-d]'); if (d) setTxt(d, stepDetail(i, rec, c, wall));
    });
    // elapsed run time (the run's total is not known until it is done)
    const el = ((RUN.done ? (RUN.phases.get('register')?.endWall || wall) : wall) - RUN.begunWall) / 1000;
    setTxt($('time'), REDUCED ? 'Sheet ' + (ST.snap + 1) + ' of 3' : fmtTime(el) + (RUN.done ? ' · done' : ''));
    // the three sheets: how far each has been drawn
    const nT = Math.max(1, P.tiles.length);
    const f0 = fin(S.tHist) ? clamp((tv - (S.units[0]?.t ?? 0)) / Math.max(0.1, S.tHist - (S.units[0]?.t ?? 0))) : c.found / nT * (RUN.phases.get('product-tree')?.state === 'done' ? 1 : 0.9);
    const f1 = fin(S.tHist) ? clamp((tv - S.tHist) / Math.max(0.1, S.tRoomsEnd - S.tHist)) : 0;
    const f2 = RUN.done && tv >= S.total ? 1 : c.judged / nT;
    const fs = [f0, f1, f2];
    const cur = REDUCED ? ST.snap : phase;
    $('track').querySelectorAll<HTMLElement>('[data-ph]').forEach((ph, i) => {
      const fill = ph.querySelector<HTMLElement>('[data-fill]'); const w = ((REDUCED ? (i <= reached() ? 1 : 0) : fs[i]) * 100).toFixed(1) + '%';
      if (fill && fill.style.width !== w) fill.style.width = w;
      const on = i === cur ? '1' : '0'; if (ph.dataset.on !== on) ph.dataset.on = on;
    });
    const cam = ST.follow ? camAt(tv) : (ST.anim ? ST.anim.to : ST.ucam), r = cam ? cam.s / planCam(tv).s : 1;
    const lvl = tv < S.tHist ? 0 : r < 1.35 ? 0 : r < 2.4 ? 1 : r < 4.2 ? 2 : r < 7.5 ? 3 : 4;
    if (lvl !== ST.lvl) { ST.lvl = lvl; syncButtons(); }
    if (cam) { const w = Math.round(clamp(160 * cam.s, 6, 118)); const sc = $('scale').firstElementChild as (HTMLElement & { _w?: number }) | null; if (sc && sc._w !== w) { sc._w = w; sc.style.width = w + 'px'; } }
    updateCrumb(tv, cam);
  }
  function buildTrack() {
    const names = ['1 Bubble diagram', '2 Block plan', '3 Ink + health'];
    $('track').innerHTML = names.map((n, i) => '<div data-ph="' + i + '" data-on="0"><div data-fill></div><span data-lb>' + n + '</span></div>').join('');
  }

  /* ---------- where am I: breadcrumb (SITE > wing > room > bay > feature) ---------- */
  function pathOf(e: Ent | null): Ent[] {
    if (!e) return [];
    if (e.type === 'tile') return [e.wing, e.room, e.bay, e];
    if (e.type === 'bay') return [e.room.wing, e.room, e];
    if (e.type === 'room') return [e.wing, e];
    return [e];
  }
  function centerEntity(cam: Cam | null): Ent | null {
    if (!cam) return null;
    const x = cam.cx, y = cam.cy;
    let best: Ent | null = null;
    for (const w of P.wings) if (x >= w.box.x && x <= w.box.x + w.box.w && y >= w.box.y && y <= w.box.y + w.box.h) {
      best = w;
      for (const r of w.rooms) if (y >= r.box.y && y <= r.box.y + r.box.h) {
        best = r;
        for (const b of r.bays) if (y >= b.box.y && y <= b.box.y + b.box.h) {
          best = b;
          for (const t of b.tiles) if (x >= t.box.x && x <= t.box.x + t.box.w && y >= t.box.y && y <= t.box.y + t.box.h) best = t;
        }
      }
    }
    return best;
  }
  const label = (x: Ent) => (x.type === 'wing' ? x.letter + ' ' + x.name : x.name);
  let crumbPath: Ent[] = [];
  function updateCrumb(tv: number, cam: Cam | null) {
    const el = $('crumb');
    if (tv < S.tHist) { if (!el.hidden) { el.hidden = true; ST.crumbKey = ''; } return; }
    let e = VIEW.sel;
    if (!e && !ST.follow && cam && cam.s / planCam(tv).s > 1.35) e = centerEntity(cam);
    const key = e ? e.type + e.id : 'site';
    if (key === ST.crumbKey && !el.hidden) return;
    ST.crumbKey = key; el.hidden = false;
    const path = pathOf(e), parts = ['<button type="button" data-c="site"' + (!e ? ' aria-current="true"' : '') + '>Site</button>'];
    path.forEach((x, i) => {
      parts.push('<i>›</i><button type="button" data-c="' + i + '"' + (i === path.length - 1 ? ' aria-current="true"' : '') + ' title="' + esc(label(x)) + '">' + esc(label(x)) + '</button>');
    });
    el.innerHTML = parts.join(''); crumbPath = path;
  }

  /* ---------- tooltip + card ---------- */
  const historyKnown = () => viewTime() >= S.tHist;
  const staged = (e: TileE) => historyKnown() && e.s.climb >= e.sc.rung + 1;
  function describe(e: Ent) {
    if (e.type === 'tile') {
      const meta: string[] = [];
      if (staged(e)) meta.push(stageWord(e.stage));
      if (e.kind) meta.push(KIND_WORD[e.kind] ?? e.kind);
      return { title: e.name, meta: meta.join(' · '), body: e.summary };
    }
    if (e.type === 'room') return { title: e.name, meta: 'Room · ' + e.tiles.length + (e.tiles.length === 1 ? ' feature' : ' features') + (e.bays.length ? ' · ' + e.bays.length + (e.bays.length === 1 ? ' bay' : ' bays') : ''), body: '' };
    if (e.type === 'wing') return { title: (historyKnown() && e.s.letter > 0 ? e.letter + ' · ' : '') + e.name, meta: 'Wing · ' + e.rooms.length + (e.rooms.length === 1 ? ' room' : ' rooms') + ' · ' + e.tiles.length + ' features', body: '' };
    return { title: e.name, meta: '', body: '' };
  }
  function showTip(e: Ent, mx: number, my: number) {
    const tip = $('tip'), d = describe(e);
    tip.innerHTML = '<b>' + esc(d.title) + '</b>' + (d.meta ? '<div data-m>' + esc(d.meta) + '</div>' : '') + (d.body ? '<p>' + esc(d.body) + '</p>' : '');
    tip.style.display = 'block';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = mx + 16, y = my + 18; if (x + w > VW - 8) x = mx - w - 14; if (y + h > VH - 8) y = my - h - 14;
    tip.style.transform = 'translate(' + Math.max(8, x) + 'px,' + Math.max(8, y) + 'px)';
  }
  function hideTip() { $('tip').style.display = 'none'; }
  function hideCard() { $('card').hidden = true; }
  let cardKids: Ent[] = [];
  function showCard(e: Ent) {
    const el = $('card'), path = pathOf(e).slice(0, -1);
    const crumbs = '<div data-path>' + (path.map((x) => esc(label(x))).join(' › ') || 'Site') + '</div>';
    let h = '<button type="button" data-close aria-label="Close">✕</button>' + crumbs + '<h3>' + esc(e.name) + '</h3>';
    if (e.type === 'tile') {
      h += (e.summary ? '<p>' + esc(e.summary) + '</p>' : '') + '<dl>';
      if (staged(e) && e.stage) h += '<dt>Stage</dt><dd><span data-chip>' + stageWord(e.stage) + '</span> ' + esc(e.stage) + '</dd>';
      if (e.kind) h += '<dt>Kind</dt><dd>' + esc(KIND_WORD[e.kind] ?? e.kind) + '</dd>';
      if (e.created && historyKnown()) h += '<dt>Created</dt><dd>' + esc(fmtDate(e.created)) + '</dd>';
      if (e.s.health >= 1 && e.general) h += '<dt>Health</dt><dd data-hb="' + e.general + '">' + HEALTH_WORD[e.general] + '</dd>';
      h += '</dl>';
      cardKids = [];
    } else {
      const st = e.type === 'bay' ? null : e.stat;
      h += '<dl><dt>Features</dt><dd>' + e.tiles.length + '</dd>';
      if (e.type === 'wing') h += '<dt>Rooms</dt><dd>' + e.rooms.length + '</dd>'; else if (e.type === 'room') h += '<dt>Bays</dt><dd>' + e.bays.length + '</dd>';
      if (historyKnown() && st) h += '<dt>Live</dt><dd>' + st.live + ' of ' + st.n + (st.build ? ' · ' + st.build + ' being built' : '') + (st.paper ? ' · ' + st.paper + ' on paper' : '') + '</dd>';
      const bad = e.tiles.filter((t) => t.s.health >= 1 && t.general === 'bad').length;
      if (bad) h += '<dt>Trouble</dt><dd data-hb="bad">' + bad + ' in trouble</dd>';
      h += '</dl>';
      const kids: Ent[] = e.type === 'wing' ? e.rooms : e.tiles;
      h += '<ul data-kids>' + kids.map((k, i) => '<li><button type="button" data-k="' + i + '">' + esc(k.name) + '<small>' + (k.type === 'room' ? k.tiles.length : k.type === 'tile' ? esc(staged(k) ? stageWord(k.stage) : '') : '') + '</small></button></li>').join('') + '</ul>';
      cardKids = kids;
    }
    el.innerHTML = h; el.hidden = false;
  }
  function select(e: Ent | null, doFocus: boolean) {
    VIEW.sel = e; ST.crumbKey = ''; ST.dirty = true;
    if (e) { showCard(e); if (doFocus) focusEntity(e); } else hideCard();
  }

  /* ---------- find ---------- */
  let results: { e: Ent; sc: number; ctx: string }[] = [], resIdx = 0;
  function runFind(q: string) {
    q = q.trim().toLowerCase(); results = []; resIdx = 0;
    if (!q) { VIEW.find = null; renderResults(); ST.dirty = true; return; }
    const hit = (s: string) => s.toLowerCase().indexOf(q);
    const f: FindSet = { wings: new Set(), rooms: new Set(), tiles: new Set() };
    for (const w of P.wings) { const i = hit(w.name); if (i >= 0) { results.push({ e: w, sc: i === 0 ? 1 : 3, ctx: 'Wing' }); f.wings.add(w); } }
    for (const r of P.rooms) { const i = hit(r.name); if (i >= 0) { results.push({ e: r, sc: i === 0 ? 1 : 3, ctx: 'Room · ' + r.wing.letter + ' ' + r.wing.name }); f.rooms.add(r); f.wings.add(r.wing); } }
    for (const t of P.tiles) { const i = hit(t.name); if (i >= 0) { results.push({ e: t, sc: i === 0 ? 0 : 2, ctx: t.wing.letter + ' ' + t.wing.name + ' › ' + t.room.name }); f.tiles.add(t); f.rooms.add(t.room); f.wings.add(t.wing); } }
    results.sort((a, b) => a.sc - b.sc);
    VIEW.find = f; renderResults(); ST.dirty = true;
  }
  function renderResults() {
    const ul = $('results');
    if (!$<HTMLInputElement>('find').value.trim()) { ul.innerHTML = ''; return; }
    if (!results.length) { ul.innerHTML = '<li data-none>Nothing on this plan is called that.</li>'; return; }
    ul.innerHTML = results.slice(0, 40).map((r, i) => '<li role="option" data-i="' + i + '" aria-selected="' + (i === resIdx) + '"><b>' + esc(r.e.name) + '</b><small>' + esc(r.ctx) + '</small></li>').join('');
  }
  function pickResult(i: number) { const r = results[i]; if (!r) return; select(r.e, true); closeFind(true); }
  function openFind() { $('findbox').hidden = false; const f = $<HTMLInputElement>('find'); f.focus(); f.select(); }
  function closeFind(keepFilter?: boolean) { $('findbox').hidden = true; const f = $<HTMLInputElement>('find'); if (!keepFilter) { f.value = ''; VIEW.find = null; ST.dirty = true; } f.blur(); }

  /* ---------- levels ---------- */
  function levelEntity(l: number): Ent | null {
    const cam = ST.follow ? camAt(viewTime()) : (ST.anim ? ST.anim.to : ST.ucam);
    const e = VIEW.sel || centerEntity(cam) || P.wings[0]; if (!e) return null;
    const path = pathOf(e);
    if (l === 4) { if (e.type === 'tile') return e; return e.tiles[0] ?? null; }
    const want = ['site', 'wing', 'room', 'bay'][l];
    for (const x of path) if (x.type === want) return x;
    if (e.type === 'wing' && l >= 2) return e.rooms[0] ?? null;
    if (e.type === 'room' && l === 3) return e.bays[0] ?? null;
    return path[Math.min(path.length - 1, l - 1)] || P.wings[0] || null;
  }
  function gotoLevel(l: number) {
    if (l === 0) { select(null, false); followAgain(); return; }
    const e = levelEntity(l); if (!e) return;
    select(l < 4 && e.type === 'bay' ? null : e, false); focusEntity(e);
  }

  function syncButtons() {
    root.querySelectorAll<HTMLButtonElement>('[data-el="segLevel"] button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.l) === ST.lvl)));
    $('btnFollow').setAttribute('aria-pressed', String(ST.follow));
    const playing = REDUCED ? ST.auto : ST.playing;
    const bp = $('btnPlay'); bp.textContent = playing ? '❚❚' : '▶'; bp.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  function toast(html: string, ms?: number) {
    const el = $('toast'); el.innerHTML = html; el.dataset.on = '1';
    if (ST.toastT) clearTimeout(ST.toastT);
    ST.toastT = setTimeout(() => { el.removeAttribute('data-on'); }, ms || 7000);
  }
  function onEnd() {
    ST.ended = true; syncButtons();
    toast('<b>' + esc(P.name) + '</b> is on the board: ' + P.tiles.length + ' features in ' + P.wings.length + ' wings. Hover a tile, scroll to zoom, press <kbd>/</kbd> to find.', 8000);
  }
  /** Catch up: jump the draft to everything that has arrived (the prototype's End, bounded by the stream). */
  function catchUp() {
    if (REDUCED) { snapTo(reached()); ST.auto = true; syncButtons(); return; }
    ST.t = Math.max(ST.t, S.endT); ST.cam = null; ST.dirty = true;
  }
  function snapTo(i: number) {
    i = clamp(i, 0, reached()); if (i === ST.snap && !ST.rfade) return;
    ST.rfade = { a: ST.shown.t, ac: ST.shown.cap, b: snapTime(i), bc: snapCap(i), t0: ST.now };
    ST.snap = i; ST.dirty = true; syncButtons();
  }

  /* ---------- frame ---------- */
  function draw() {
    if (REDUCED) {
      const B = snapTime(ST.snap), bc = snapCap(ST.snap);
      if (ST.rfade) {
        const f = clamp((ST.now - ST.rfade.t0) / 1100), A = ST.rfade.a;
        updateState(A, ST.rfade.ac); drawScene(ctxMain, A, currentCam(A));
        updateState(B, bc); drawScene(offCtx, B, currentCam(B));
        ctxMain.setTransform(1, 0, 0, 1, 0, 0); ctxMain.globalAlpha = eInOut(f); ctxMain.drawImage(off, 0, 0); ctxMain.globalAlpha = 1;
        ctx = ctxMain;
        if (f >= 1) ST.rfade = null; else ST.dirty = true;
      } else { updateState(B, bc); drawScene(ctxMain, B, currentCam(B)); ctx = ctxMain; }
      ST.shown = { t: B, cap: bc };
      updateHud(bc == null ? B : Math.min(B, bc));
      return;
    }
    const tv = ST.t;
    updateState(tv, null); drawScene(ctxMain, tv, currentCam(tv)); ctx = ctxMain;
    updateHud(tv);
  }
  let raf = 0;
  function frame(now: number) {
    if (disposed) return;
    ST.now = now; const dt = Math.min(0.1, (now - (ST.last || now)) / 1000); ST.last = now;
    if (!REDUCED && ST.playing && ST.began) {
      ST.t += dt;
      // the followed camera eases toward where the schedule wants it (re-framing smoothly as the plan grows)
      const target = camAt(ST.t);
      ST.cam = ST.cam ? lerpCam(ST.cam, target, 1 - Math.exp(-dt / 0.38)) : target;
      ST.dirty = true;
      if (fin(S.total) && ST.t >= S.total && !ST.ended) onEnd();
    }
    if (REDUCED && ST.began) {
      // stills: follow the latest sheet as events arrive (unless the reader stepped back), cross-fading to it
      const want = ST.auto ? reached() : ST.snap;
      const bt = snapTime(want);
      if (want !== ST.snap || (!ST.rfade && Math.abs(bt - ST.shown.t) > 1e-6)) {
        if (!ST.rfade) { ST.rfade = { a: ST.shown.t, ac: ST.shown.cap, b: bt, bc: snapCap(want), t0: now }; ST.snap = want; ST.dirty = true; }
      }
      if (RUN.done && !ST.ended && ST.snap === 2 && !ST.rfade) onEnd();
    }
    if (ST.blend || ST.anim) ST.dirty = true;
    if (now - ST.hudAt > 250) { ST.hudAt = now; ST.dirty = true; } // the rail's clocks tick
    if (ST.dirty && TH) { ST.dirty = false; draw(); }
    raf = requestAnimationFrame(frame);
  }

  /* ---------- pointer: pan, zoom, hover, click ---------- */
  function initPointer() {
    let drag: { x: number; y: number; cx: number; cy: number; s: number; moved: boolean } | null = null;
    const pointers = new Map<number, { x: number; y: number }>(); let pinch: { d: number; cam: Cam } | null = null;
    const loc = (ev: MouseEvent) => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const setCur = (v: string) => { if (cv.dataset.cur !== v) cv.dataset.cur = v; };
    const hover = (px: number, py: number) => {
      const e = hitTest(px, py);
      if (e !== VIEW.hover) { VIEW.hover = e; ST.dirty = true; setCur(e ? 'hit' : ''); }
      if (e && !drag) showTip(e, px, py); else hideTip();
    };
    listen(cv, 'pointerdown', (ev) => {
      try { cv.setPointerCapture(ev.pointerId); } catch { /* a synthetic pointer */ }
      const p = loc(ev); pointers.set(ev.pointerId, p);
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cam: { ...currentCam(viewTime()) } }; drag = null; return; }
      const cam = currentCam(viewTime()); drag = { x: p.x, y: p.y, cx: cam.cx, cy: cam.cy, s: cam.s, moved: false };
    });
    listen(cv, 'pointermove', (ev) => {
      const p = loc(ev);
      if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y); userControl();
        const s2 = clampS(pinch.cam.s * d / Math.max(1, pinch.d)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const wxp = (mx - VW / 2) / pinch.cam.s + pinch.cam.cx, wyp = (my - VH / 2) / pinch.cam.s + pinch.cam.cy;
        ST.anim = null; ST.ucam = { cx: wxp - (mx - VW / 2) / s2, cy: wyp - (my - VH / 2) / s2, s: s2 }; ST.dirty = true; return;
      }
      if (drag) {
        const dx = p.x - drag.x, dy = p.y - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; userControl(); setCur('drag'); hideTip(); }
        if (drag.moved) { ST.anim = null; ST.ucam = { cx: drag.cx - dx / drag.s, cy: drag.cy - dy / drag.s, s: drag.s }; ST.dirty = true; return; }
      }
      hover(p.x, p.y);
    });
    const up = (ev: PointerEvent) => {
      pointers.delete(ev.pointerId); if (pointers.size < 2) pinch = null;
      if (drag && !drag.moved) { const p = loc(ev); const e = hitTest(p.x, p.y); select(e && e === VIEW.sel ? null : e, false); }
      drag = null; if (cv.dataset.cur === 'drag') setCur('');
    };
    listen(cv, 'pointerup', up); listen(cv, 'pointercancel', up);
    listen(cv, 'pointerleave', () => { VIEW.hover = null; hideTip(); ST.dirty = true; });
    listen(cv, 'wheel', (ev) => { ev.preventDefault(); const p = loc(ev); zoomBy(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0016)), p.x, p.y); hover(p.x, p.y); }, { passive: false });
    listen(cv, 'dblclick', (ev) => {
      const p = loc(ev); const e = hitTest(p.x, p.y);
      if (!e) { select(null, false); followAgain(); return; }
      const next = e.type === 'wing' ? (e.rooms.find((r) => inShape(r, wx(p.x), wy(p.y))) || e) : e;
      select(next, true);
    });
  }

  /* ---------- wire the HUD ---------- */
  function wire() {
    listen($('btnPlay'), 'click', () => {
      if (REDUCED) { ST.auto = !ST.auto; syncButtons(); return; }
      ST.playing = !ST.playing; syncButtons();
    });
    listen($('btnSkip'), 'click', catchUp);
    listen($('btnFollow'), 'click', () => { if (ST.follow) select(null, false); followAgain(); });
    listen($('segLevel'), 'click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (b) gotoLevel(Number(b.dataset.l)); });
    listen($('zIn'), 'click', () => zoomBy(1.45)); listen($('zOut'), 'click', () => zoomBy(1 / 1.45));
    listen($('btnFindOpen'), 'click', () => { if ($('findbox').hidden) openFind(); else closeFind(); });
    listen($('crumb'), 'click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      if (b.dataset.c === 'site') { select(null, false); followAgain(); return; }
      const x = crumbPath[Number(b.dataset.c)]; if (x) { select(x.type === 'bay' ? null : x, false); focusEntity(x); }
    });
    listen($('card'), 'click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) { select(null, false); return; }
      const k = t.closest<HTMLElement>('[data-k]'); if (k) { const x = cardKids[Number(k.dataset.k)]; if (x) select(x, true); }
    });
    const f = $<HTMLInputElement>('find');
    listen(f, 'input', () => runFind(f.value));
    listen(f, 'keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); resIdx = Math.min(results.length - 1, resIdx + 1); renderResults(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); resIdx = Math.max(0, resIdx - 1); renderResults(); }
      else if (e.key === 'Enter') { e.preventDefault(); pickResult(resIdx); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    });
    listen($('results'), 'click', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]'); if (li) pickResult(Number(li.dataset.i)); });
    // reduced motion: the three sheets are steppable
    listen($('track'), 'click', (e) => {
      if (!REDUCED) return;
      const ph = (e.target as HTMLElement).closest<HTMLElement>('[data-ph]'); if (!ph) return;
      const i = Number(ph.dataset.ph); if (i > reached()) return;
      ST.auto = i === reached(); snapTo(i);
    });
    listen(window, 'keydown', (e) => {
      const tg = e.target as HTMLElement | null;
      if (tg && tg.closest && tg.closest('input, select, textarea')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === ' ' && !(tg && tg.closest && tg.closest('button'))) { e.preventDefault(); $('btnPlay').click(); }
      else if (k === 'f' || k === 'F') { select(null, false); followAgain(); }
      else if (k === '/') { e.preventDefault(); openFind(); }
      else if (k === '0') { select(null, false); followAgain(); }
      else if (k === '+' || k === '=') zoomBy(1.35);
      else if (k === '-' || k === '_') zoomBy(1 / 1.35);
      else if (k === 'Escape') {
        if (!$('findbox').hidden) closeFind();
        else if (VIEW.sel) { const p = pathOf(VIEW.sel); if (p.length > 1) { const upE = p[p.length - 2]; select(upE.type === 'bay' ? null : upE, false); focusEntity(upE); } else { select(null, false); followAgain(); } }
        else if (!ST.follow) followAgain();
      }
    });
    const ro = new ResizeObserver(() => resize());
    ro.observe(root);
    cleanups.push(() => ro.disconnect());
  }

  /* ---------- boot ---------- */
  setExtents(); P.sh0 = P.sd = P.sheet;
  readTheme();
  resize();
  buildRail(); buildTrack(); wire(); initPointer(); syncButtons();
  raf = requestAnimationFrame(frame);

  return {
    push,
    setTheme(t) { theme = t; readTheme(); planLabels(); },
    setReduced(r) { if (r === REDUCED) return; REDUCED = r; ST.rfade = null; ST.auto = true; ST.snap = reached(); ST.cam = null; ST.dirty = true; syncButtons(); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      if (ST.toastT) clearTimeout(ST.toastT);
      for (const c of cleanups.splice(0)) c();
      off.width = off.height = 0;
      PAT = { diag: null, cross: null };
    },
  };
}
