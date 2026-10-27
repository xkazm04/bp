// The canvas engine. It owns the camera, the frame loop (draws only when dirty), level of detail,
// hit testing, the cached static layer and the dynamic layers, the lens mix and the simulation clock.
// React talks to it through the imperative methods below and reads discrete state from `store`.
import type { Feature, LensDef, Scalar, ViewId } from '@bp/core/data';
import {
  BLAST_DEFAULT, GA_MILESTONE, HOUR, LINES, SPEEDS, inside, isView, lensOf, lensPerson, personLens, revAt, views, type Box, type BldNode, type BayNode, type Counts, type Model,
  type OrderTemplate, type PlaceNode, type Preview, type RoomNode, type SimAgent, type SimDecision, type SimEvent, type Target, type ToastTone, type TileNode, type WingNode,
} from '@bp/core/model';
import { LIVE_VERB_LABEL, SAMPLE_REFUSED, commitSample, runLivePlan, type LivePlan } from '@/lib/model/live-steer';
import type { ScanJob } from '@bp/core/scan/jobs';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { drawTracks } from './render/tracks';
import { Camera, WheelIntent, clamp, type Cam, type Pad, type Region } from './camera';
import type { ChannelAggregate, FeatureLive, LensChannel, LensExpression } from './lens/contract';
import { MixDriver, type MixState } from './lens/mix';
import { createStore, type Store } from './store';
import { CALLOUT_PAD, baseHeight, overlayRight, railWidth } from './chrome';
import { LEDGER_VARIANTS, initialState, type Crumb, type DockTab, type HoverInfo, type LedgerVariant, type UIState } from './state';
import { DEEP_LINK_KEYS, deepLinkHash, withoutDeepLink } from './deep-link';
import { readTheme, type Theme } from './theme';
import { saveFailWords } from './copy';
import { lineSiblings } from './lines';
import { Text } from './text';
import { StaticCache, deviceRes } from './render/static-cache';
import { buildWallPaths, drawBuildings, drawDecor, drawGrid, drawLabels, featRect, resetOutlines } from './render/plan';
import {
  drawAgents, drawAnswer, drawBlockers, drawBreaches, drawFocus, drawHeat, drawLasso, drawOrderZones, drawOverlays, drawPins, drawPreview,
  drawPulses, drawReleases, drawTargets, type APos,
} from './render/dynamic';
import { KeyPlan } from './render/keyplan';
import { SimWatch } from './render/simwatch';
import { drawFlags, flagKey, layoutFlags, type Flag } from './render/flags';
import { HitList, TOUCH, type Hit, type HitKind } from './render/hits';
import { ScanLayer, type ScanView } from './render/scans';
import { loadArt } from './render/illo';
import { rs, smooth, type SRect, type View } from './render/view';
import { GENERAL } from '@bp/core/data/types';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** The element wrapping the DOM chrome; the engine scales it by U and reads layout from it. */
  ui: HTMLElement;
  /** The app root (gets data-view and --lens). */
  root: HTMLElement;
  model: Model;
  expression: LensExpression;
  intro?: boolean;
}

const PADS: Record<'site' | 'bld' | 'wing' | 'room' | 'bay', Pad> = {
  site: { t: 122, r: 20, b: 70, l: 20 }, bld: { t: 196, r: 26, b: 56, l: 26 }, wing: { t: 124, r: 26, b: 56, l: 26 },
  room: { t: 22, r: 22, b: 56, l: 22 }, bay: { t: 30, r: 30, b: 56, l: 30 },
};
const OVER: Record<string, number> = { bld: 1, wing: 1.8, room: 1.3, bay: 1 };
type Chain = { t: Crumb['t']; o: PlaceNode }[];
const NO_FLAGS: Flag[] = [];
const PIN_KINDS: readonly HitKind[] = ['pin', 'cluster'], TRACK_KINDS: readonly HitKind[] = ['track'], AGENT_KINDS: readonly HitKind[] = ['agent'];
/** A 2D context that draws nothing: re-runs the target layers for their hit regions when the camera moved since the last frame. */
let MUTE: CanvasRenderingContext2D | null = null;
function muteCtx(): CanvasRenderingContext2D {
  if (!MUTE) { const noop = () => undefined; MUTE = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : noop), set: (t, k: string, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D; }
  return MUTE;
}

/** A feature's live values, reused for every call (the caller reads them at once; nothing keeps it). */
class LiveView implements FeatureLive {
  rolloutPct = 0; progressPct = 0;
  private f: Feature | null = null;
  constructor(private E: Engine) {}
  set(f: Feature): this {
    const sim = this.E.M.sim;
    this.f = f; this.rolloutPct = sim.rolloutOf(f);
    this.progressPct = this.E.isNow ? sim.progOf(f) : sim.baseProgress(f);
    return this;
  }
  value(lens: string, key: string): Scalar | undefined {
    const f = this.f; if (!f) return undefined;
    return this.E.isNow ? this.E.M.sim.liveValue(f, lens, key) : f.lens[lens]?.v[key];
  }
}

const CTL = 'button,a,input,textarea,select,summary,[role=button],[role=tab],[role=option],[role=slider],[role=menuitem],[contenteditable=""],[contenteditable=true]';
/** True when the key event's target is an interactive element, whose own Enter / Space must not trigger an engine shortcut. */
const isControl = (t: HTMLElement | null) => !!t?.closest?.(CTL);
/** Keys that move the plan. They belong to the widget they came from: a control, the rail / flyout / timeline / feature page / cards, or a handler that already took them. */
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
const OWN_ZONES = '#rail,#flyout,#tlpanel,#detail,#dcard,#callout,#morning';
/** The hash's ledger prototype, else the default. */
const ledgerVariant = (v: string | undefined): LedgerVariant => (LEDGER_VARIANTS as readonly string[]).includes(v ?? '') ? v as LedgerVariant : 'triage';

export class Engine {
  readonly M: Model;
  readonly expr: LensExpression;
  readonly store: Store<UIState>;
  readonly cam: Camera;
  th!: Theme;
  private anchor: (ox: number, oy: number) => void = () => {};
  readonly tx: Text;
  readonly mix: MixDriver;
  mixS: MixState;
  U = 1; RES = 1; FW = 1280; FH = 800;
  SAFE: Region = { l: 14, t: 72, r: 930, b: 686 };
  HOME: Cam = { x: 0, y: 0, k: 0.2 }; KB1 = 0.2;
  art: Record<string, HTMLImageElement> = {};
  sprites: { glow: HTMLCanvasElement | null; heat: HTMLCanvasElement | null } = { glow: null, heat: null };
  wallPaths: ReturnType<typeof buildWallPaths> = [];
  agentPos: APos[] = [];
  dashT = 0;
  introP = 1;
  lasso: { x0: number; y0: number; x1: number; y1: number } | null = null;
  dimFn: ((f: Feature) => boolean) | null = null;
  /** This frame's trouble flags (render/flags.ts), kept for hit testing; the hovered one's key. */
  private flags: Flag[] = []; private flagHot: string | null = null;
  /** This frame's hit regions (render/hits.ts), registered by the layers as they draw, in draw order. */
  readonly hits = new HitList();
  /** The camera and clock the hit list was registered at (a pointer test after the camera moved re-registers). */
  private hitsAt = { x: NaN, y: NaN, k: NaN, FW: 0, FH: 0, U: 0, now: false };
  blastSet: Set<string> | null = null;
  /** Running scans drawn over the plan (render/scans.ts), fed on discrete changes by setScans. */
  readonly scans = new ScanLayer();
  /** Called when the search box should take focus ('/'). */
  focusSearch: () => void = () => {};

  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ui: HTMLElement;
  private root: HTMLElement;
  private cache: StaticCache;
  private keyplan: KeyPlan | null = null;
  private raf = 0; private lastT = 0; private lastDraw = 0; private lastCamMove = 0; private settleTimer = 0;
  private destroyed = false;
  private themeV = 0; private fontsV = 0; private mixV = 0; private simStaticV = 0; private simStaticAt = 0; private simSeenV = -1; private simT10 = -1; private healthSeenV = -1;
  private camSig = { x: NaN, y: NaN, k: NaN, w: 0, h: 0 }; private kpSig = { themeV: -1, t: '', delta: 0, sv: -1, str: '' }; private placeKey = ''; private hoverEl: HTMLElement | null = null;
  private place: Chain = [];
  /** Place bookkeeping, all pooled: syncPlace runs only when its inputs moved and builds no record on that path. */
  private bestBuf: Chain = []; private bestPool: Chain = [0, 1, 2, 3].map(() => ({ t: 'bld' as Crumb['t'], o: null as unknown as PlaceNode }));
  private placeBuf: Chain = []; private placePool: Chain = [0, 1, 2, 3].map(() => ({ t: 'bld' as Crumb['t'], o: null as unknown as PlaceNode }));
  private placeIds: string[] = []; private placeOpen: string | null = null;
  private placeSig = { x: NaN, y: NaN, k: NaN, FW: 0, FH: 0, l: 0, t: 0, r: 0, b: 0, U: 0, hk: 0, open: null as string | null };
  /** Frame listeners run on frames where the camera moved, plus once after anything that can move their anchors (store change, layout, a new subscriber). */
  private listenForce = true;
  private lastExpire = 0; private settleArmed = false;
  private introOn = false; private introT0 = 0;
  private drag: { x0: number; y0: number; cx: number; cy: number; moved: boolean; lasso: boolean; shift: boolean } | null = null;
  private ptrs = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; k: number; wx: number; wy: number } | null = null; private wheelI = new WheelIntent();
  private simSyncTimer = 0; private hlTimer = 0; private resizeTimer = 0; private lastTickerAt = 0; private pendingTicker: SimEvent | null = null;
  private toastN = 0;
  private aggLensCache = new Map<string, ChannelAggregate>();
  private statsCache = new Map<string, ReturnType<Model['sim']['stats']>>(); private statsKey = '';
  private roomDecCache: SimDecision[][] | null = null; private roomDecV = -1;
  private breachCache: Set<string> | null = null; private breachV = -1;
  private camFns: (() => void)[] = [];
  private simTimeListeners = new Set<(t: number) => void>();
  private lastSimSec = -1;
  private disposers: (() => void)[] = [];
  /** Frame and raster counters for the perf scripts (window.__bp.perf; scripts/perf.py, docs/perf.md). */
  perf = { frames: 0, rasters: 0, lastRasterMs: 0, patches: 0, lastPatchMs: 0 };
  /** What the static raster read from the simulation (render/simwatch.ts). */
  readonly watch = new SimWatch();

  constructor(o: EngineOptions) {
    this.M = o.model; this.expr = o.expression; this.cv = o.canvas; this.ui = o.ui; this.root = o.root;
    this.ctx = this.cv.getContext('2d', { alpha: true })!;
    this.store = createStore(initialState(this.M.P.scale, this.M.P.asOf));
    this.cam = new Camera(() => this.camMoved());
    this.store.subscribe(() => { this.listenForce = true; });
    this.cam.world = this.M.L.world;
    this.cam.reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.tx = new Text('sans-serif', 'monospace');
    this.lensIds = this.M.P.lenses.map((l) => l.id);
    this.mix = new MixDriver(this.lensIds, GENERAL, () => { this.mixV++; this.mixS = this.mix.state; this.dirty(); }, this.expr.spring);
    this.mixS = this.mix.state;
    this.cache = new StaticCache();
    this.wallPaths = buildWallPaths(this);
    this.readTheme();
    this.M.sim.listen({
      changed: () => this.scheduleSimSync(),
      toast: (t) => { this.toastN++; this.store.set({ toast: { ...t, n: this.toastN } }); },
      event: (e) => this.onSimEvent(e),
    });
    this.bind();
    this.fit();
    this.introOn = !!o.intro && !this.cam.reduced;
    if (this.introOn) { this.introT0 = performance.now(); this.introP = 0; this.store.set({ intro: true }); }
    this.readHash();
    this.store.set({ ready: true, simV: this.M.sim.version, levelNames: this.levelNames() });
    this.syncRootView();
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => { if (!this.destroyed) { this.readTheme(); this.fontsV++; this.placeKey = ''; this.dirty(); } });
    }
    (window as unknown as { __bp?: Engine }).__bp = this;
    this.dirty();
  }

  // ============================================================================ state access
  get S(): UIState { return this.store.get(); }
  get isNow(): boolean { return this.S.t === this.M.P.asOf; }
  private set(p: Partial<UIState>) { this.store.set(p); this.dirty(); }
  private liveView = new LiveView(this);
  /** Live values for a feature. The returned object is reused: read it before the next call. */
  live(f: Feature): FeatureLive { return this.liveView.set(f); }
  /** The registry, in order (General's composition). */
  readonly lensIds: readonly string[];
  private chans = new Map<string, LensChannel | null>();
  /** The channel that draws a lens: the variant's own, else its manifest-driven fallback (cached). */
  channel(l: string): LensChannel | null {
    let c = this.chans.get(l);
    if (c === undefined) {
      const d: LensDef | undefined = this.M.P.LENS[l];
      c = this.expr.channels[l] ?? (d && this.expr.fallback ? this.expr.fallback(d) : null);
      this.chans.set(l, c);
    }
    return c;
  }
  accentOf(l: string | null): string {
    if (!l) return this.th.ink;
    const a = this.channel(l)?.accent;
    return a ? a[this.th.mode] : this.th.ink;
  }
  /** A lens's mark colour for scan outlines and chips: the manifest's `presentation.accent`, else the channel's, else ink. */
  lensAccent(l: string): string {
    const a = this.M.P.LENS[l]?.accent;
    return a ? a[this.th.mode] : this.accentOf(l);
  }
  /** The scans to draw (a discrete change: a job moved, a reading came in). The loop runs while one of them runs. */
  /** Tiles with dispatched work pending: a pulsing dot each (render/scans.ts). */
  setBusy(ids: readonly string[]) { if (this.destroyed) return; this.scans.setBusy(ids); this.dirty(); }
  setScans(views: readonly ScanView[]) { if (this.destroyed) return; this.scans.set(views, this); this.hitsAt.k = NaN; this.dirty(); }
  counts(id: string, fs: readonly Feature[]): Counts { return this.M.agg.countsOf(id, fs, this.S.t, this.S.delta); }
  lensAgg(id: string, l: string, fs: readonly Feature[]): ChannelAggregate {
    const k = id + '|' + l; let a = this.aggLensCache.get(k);
    if (!a) { a = this.channel(l)?.aggregate(fs) ?? { parts: [] }; this.aggLensCache.set(k, a); }
    return a;
  }
  statsOf(id: string, fs: readonly Feature[]) {
    const key = this.M.sim.version + '|' + this.S.who + '|' + this.S.view;
    if (key !== this.statsKey) { this.statsKey = key; this.statsCache.clear(); }
    let s = this.statsCache.get(id);
    if (!s) { s = this.M.sim.stats(fs, this.S.who, this.S.view); this.statsCache.set(id, s); }
    return s;
  }
  roomDecs(): SimDecision[][] {
    const sim = this.M.sim;
    if (this.roomDecCache && this.roomDecV === sim.version) return this.roomDecCache;
    const out: SimDecision[][] = this.M.L.rooms.map(() => []);
    for (const fid in sim.DOF) { const T = this.M.L.TILE[fid]; if (T) out[T.room.ri].push(...sim.DOF[fid]); }
    this.roomDecCache = out; this.roomDecV = sim.version;
    return out;
  }
  breachSet(): Set<string> {
    const sim = this.M.sim;
    if (this.breachCache && this.breachV === sim.version) return this.breachCache;
    const s = new Set<string>(); for (const o of sim.orders) for (const f of o.vf) s.add(f);
    this.breachCache = s; this.breachV = sim.version;
    return s;
  }
  /** The ribbon -> tile blend: spans a zoom ratio of 1.5, the static cache's BUCKET, so a bucket crossing never lands on a jump (the cache also re-rasters when the blend drifts, see static-cache LOD_STEP). */
  lod(k = this.cam.k) { return smooth(1.1, 1.65, k / this.KB1); }
  levelNames(): string[] { return (this.M.P.scale > 1 ? ['Campus', 'Building'] : ['Site']).concat(['Wing', 'Room', 'Bay', 'Feature']); }
  placeById(t: string, id: string): PlaceNode | null {
    const L = this.M.L;
    if (t === 'bld') { for (const b of L.blds) if (b.id === id) return b; return null; }
    if (t === 'wing') return L.WING[id] || null;
    if (t === 'room') return L.ROOM[id] || null;
    if (t === 'bay') return L.BAY[id] || null;
    return null;
  }
  /** The live camera's view. One record, refreshed per read: use it at once, never keep it. */
  get view(): View {
    const c = this.cam, v = this.viewRec;
    v.x = c.x; v.y = c.y; v.k = c.k; v.FW = this.FW; v.FH = this.FH; v.c1x = this.FW; v.c1y = this.FH;
    return v;
  }
  private viewRec: View = { x: 0, y: 0, k: 1, FW: 0, FH: 0, c0x: 0, c0y: 0, c1x: 0, c1y: 0 };
  /** Screen rect (CSS px of the page) of a feature at the current zoom. */
  featureRect(fid: string): SRect | null { return featRect(this, this.view, fid, this.lod()); }
  wingName = (fid: string) => { const T = this.M.L.TILE[fid]; return T ? T.wing.def.name : '?'; };

  // ============================================================================ theme, layout
  private readTheme() {
    const h = readTheme(this.RES);
    this.th = h.theme; this.anchor = h.anchor;
    this.tx.setFamilies(this.th.sans, this.th.mono);
    // one re-raster for the whole illustration set; a newer theme read supersedes an older set still loading
    const gen = ++this.artGen;
    this.art = loadArt(this.th.ink, () => { if (gen !== this.artGen || this.destroyed) return; this.themeV++; this.dirty(); });
    this.makeSprites();
    this.themeV++;
    this.syncRootView();
  }
  private makeSprites() {
    const th = this.th;
    const g = document.createElement('canvas'); g.width = g.height = 64;
    const gc = g.getContext('2d')!, rg = gc.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, th.alpha(th.mint, th.mode === 'dark' ? 0.26 : 0.22)); rg.addColorStop(1, th.alpha(th.mint, 0));
    gc.fillStyle = rg; gc.fillRect(0, 0, 64, 64);
    const h = document.createElement('canvas'); h.width = 8; h.height = 64;
    const hc = h.getContext('2d')!, lg = hc.createLinearGradient(0, 64, 0, 0);
    lg.addColorStop(0, th.alpha(th.mint, 0.3)); lg.addColorStop(1, th.alpha(th.mint, 0));
    hc.fillStyle = lg; hc.fillRect(0, 0, 8, 64);
    this.sprites = { glow: g, heat: h };
  }
  private syncRootView() {
    if (!this.root || !this.th) return;
    const v = this.S.view;
    this.root.dataset.view = v;
    this.root.style.setProperty('--lens', this.accentOf(v === GENERAL ? null : v));
  }
  fit() {
    if (this.destroyed) return;
    const w = window.innerWidth, h = window.innerHeight;
    // narrow, or a touch device held landscape (a short mouse window stays the desktop plan)
    const phone = w < 760 || (h < 480 && typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
    if (phone !== this.S.phone) this.store.set({ phone });
    this.lightSim(phone || this.S.page === 'ledger');
    if (phone) return;
    this.U = 1 + 0.5 * (clamp(Math.min(w / 1280, h / 800), 1, 2) - 1);
    this.tx.setU(this.U);
    const U = this.U, compact = h < 740;
    if (compact !== this.S.compact) this.store.set({ compact });
    this.ui.style.width = w / U + 'px'; this.ui.style.height = h / U + 'px'; this.ui.style.transform = U === 1 ? 'none' : `scale(${U})`;
    this.FW = w; this.FH = h; this.cam.FW = w; this.cam.FH = h;
    const r = deviceRes(w, h, window.devicePixelRatio);
    const resChanged = Math.abs(r - this.RES) > 1e-3;
    this.RES = r;
    if (resChanged || this.cv.width !== Math.round(w * r) || this.cv.height !== Math.round(h * r)) {
      this.cv.width = Math.round(w * r); this.cv.height = Math.round(h * r); this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    }
    if (resChanged) this.readTheme();
    const atHome = this.lastFit ? this.cam.near(this.HOME, 0.03, 8) : true;
    this.layoutChrome();
    this.computeHome();
    if (atHome && !this.S.open) this.cam.set(this.HOME);
    if (this.keyplan) { this.keyplan.W = compact ? 132 : 162; this.keyplan.H = compact ? 44 : 72; this.keyplan.cv.style.width = this.keyplan.W + 'px'; this.keyplan.cv.style.height = this.keyplan.H + 'px'; }
    this.lastFit = true;
    this.placeKey = ''; this.cache.invalidate(); this.dirty();
  }
  private lastFit = false;
  private layoutChrome() {
    const w = this.FW, h = this.FH, U = this.U, bb = baseHeight(this.S);
    this.listenForce = true;
    this.ui.style.setProperty('--bb', bb + 'px');
    this.ui.style.setProperty('--rw', railWidth(this.S) + 'px');
    this.SAFE = { l: 12 * U, t: 74 * U, b: h - (bb - 2) * U, r: w - railWidth(this.S) * U };
    this.ui.style.setProperty('--cx', (this.SAFE.l + this.SAFE.r) / 2 / U + 'px');
    this.ui.style.setProperty('--sw', Math.max(300, (this.SAFE.r - this.SAFE.l) / U - 20) + 'px');
  }
  private fitCam(box: Box, pad: Pad, over = 1, R: Region = this.SAFE): Cam {
    const U = this.U;
    return this.cam.fit(box, { t: pad.t * U, r: pad.r * U, b: pad.b * U, l: pad.l * U }, over, R);
  }
  private computeHome() {
    this.cam.KMIN = 0.02;
    const pad = { ...PADS.site, t: this.M.P.scale > 1 ? 132 : 122 };
    this.HOME = this.fitCam(this.M.L.world, pad);
    this.cam.KMIN = this.HOME.k * 0.8;
    this.KB1 = this.M.P.scale > 1 ? this.fitCam(this.M.L.blds[0], PADS.bld, OVER.bld).k : this.HOME.k;
  }

  // ============================================================================ loop
  dirty() { if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this.frame); }
  private camMoved() {
    this.lastCamMove = performance.now();
    if (this.S.hover) this.setHover(null); // the card describes where the camera was
    if (this.ptr) this.retest = true;
    this.dirty();
  }
  /** The static raster's content version: a counter that moves when any field it depends on does (compared field by field, no string built). */
  private staticKey(): number {
    const S = this.S, k = this.sk;
    if (k.themeV !== this.themeV || k.fontsV !== this.fontsV || k.U !== this.U || k.FW !== this.FW || k.FH !== this.FH || k.safeR !== this.SAFE.r || k.mixV !== this.mixV
      || k.t !== S.t || k.delta !== S.delta || k.blast !== S.blast || k.ga !== S.ga || k.key !== S.key || k.who !== S.who || k.view !== S.view) {
      k.themeV = this.themeV; k.fontsV = this.fontsV; k.U = this.U; k.FW = this.FW; k.FH = this.FH; k.safeR = this.SAFE.r; k.mixV = this.mixV;
      k.t = S.t; k.delta = S.delta; k.blast = S.blast; k.ga = S.ga; k.key = S.key; k.who = S.who; k.view = S.view;
      k.ver++;
    }
    return k.ver;
  }
  private sk = { ver: 0, themeV: -1, fontsV: -1, U: -1, FW: -1, FH: -1, safeR: -1, mixV: -1, t: '' as string, delta: 0 as number, blast: null as string | null, ga: false, key: null as string | null, who: null as string | null, view: '' as string };
  private wake = () => { this.settleArmed = false; this.dirty(); };
  /** One wake-up for the settle window, armed once per gesture (not per frame): it fires when the camera has been still for ~150 ms. */
  private armSettle() {
    if (this.settleArmed) return;
    this.settleArmed = true;
    this.settleTimer = window.setTimeout(this.wake, clamp(150 - (performance.now() - this.lastCamMove), 16, 160));
  }
  private artGen = 0;
  private frame = (now: number) => {
    this.raf = 0;
    // the phone and the findings ledger draw no plan: the light timer keeps the simulation going (lightSim)
    if (this.destroyed || this.S.phone || this.S.page === 'ledger') return;
    const dt = this.lastT ? now - this.lastT : 16; this.lastT = now;
    const wheel = this.cam.stepWheel();
    if (wheel) this.lastCamMove = now;
    const sim = this.M.sim, S = this.S;
    if (this.introOn) { this.introP = clamp((now - this.introT0) / 1700, 0, 1); if (this.introP >= 1) this.endIntro(); }
    const live = sim.has && this.isNow && sim.playing && !this.introOn;
    if (live) sim.advance(dt);
    const gesture = wheel || this.cam.flying || !!this.drag?.moved || !!this.pinch;
    const animating = sim.has && this.isNow && sim.animating(now);
    // a running scan marches its outline and sweeps its feature (reduced motion: both hold still, so no frames)
    const scanning = this.scans.animating && this.isNow && !this.cam.reduced;
    // only the simulation or a scan is moving: draw at ~30 fps
    if (!gesture && !this.mix.moving && !this.introOn && (live || animating || scanning) && now - this.lastDraw < (live || animating ? 30 : 33)) { this.raf = requestAnimationFrame(this.frame); return; }
    this.lastDraw = now;
    this.dashT = (now / 40) % 1000;
    // a live reading or map refresh re-judged health (tile fills, marks, troubles): the cached plan is stale everywhere
    if (sim.healthV !== this.healthSeenV) { if (this.healthSeenV >= 0) { this.cache.invalidate(); this.aggLensCache.clear(); } this.healthSeenV = sim.healthV; }
    // throttle static changes driven by the simulation
    if (sim.version !== this.simSeenV || (live && Math.floor(sim.t / 15) !== this.simT10)) {
      if (!live || now - this.simStaticAt > 900) { this.simSeenV = sim.version; this.simT10 = Math.floor(sim.t / 15); this.simStaticV++; this.simStaticAt = now; this.simPatch = true; }
    }
    if (gesture && S.hover) this.setHover(null); // a flight just began: the card describes the old place
    this.draw(now, gesture);
    if (this.retest && !gesture && !this.cam.moving) {
      // the camera came to rest under a still cursor: say what is there now (after the settle window, with the re-raster)
      if (performance.now() - this.lastCamMove > 140) { this.retest = false; if (this.ptr && !S.open) this.hoverAt(this.ptr.x, this.ptr.y); }
      else this.armSettle();
    }
    this.syncPlace();
    this.afterFrame(now);
    if (sim.pulses.length > 40 || now - this.lastExpire >= 500) { this.lastExpire = now; sim.expire(now); }
    if (gesture || this.mix.moving || this.introOn || live || animating || scanning) this.raf = requestAnimationFrame(this.frame);
  };
  private draw(now: number, gesture: boolean) {
    const ctx = this.ctx, c = this.cam, S = this.S;
    this.perf.frames++;
    ctx.setTransform(this.RES, 0, 0, this.RES, 0, 0);
    ctx.clearRect(0, 0, this.FW, this.FH);
    if (!this.modeSeen || S.ga !== this.modeSeen.ga || S.key !== this.modeSeen.key || S.blast !== this.modeSeen.blast) this.syncModeFilters(S);
    // static layer: transform the cached raster during gestures, re-raster when it settles
    const key = this.staticKey();
    const st = this.cache.check(c, key, this.FW, this.FH, this.lod());
    const settled = performance.now() - this.lastCamMove > 140;
    let rastered = false;
    if (st === 'stale' || (st === 'transform' && settled && !gesture)) {
      this.cache.render(c, key, this.FW, this.FH, this.RES, (g, v) => { this.watch.begin(); resetOutlines(this); this.paintPlan(g, v); }, this.mix.moving ? 0 : undefined, this.lod(c.k)); // the camera is still while the lens mix springs: no pan margin to pay for
      this.perf.rasters++; this.perf.lastRasterMs = this.cache.lastMs; rastered = true; this.simPatch = false;
    } else if (st === 'transform') {
      // still moving (or settled mid-gesture): wake once more after the settle window to re-raster
      this.armSettle();
    }
    // a sim tick with the raster still valid: repaint only what the simulation moved (render/simwatch.ts), never the whole plan
    if (this.simPatch && !rastered && st !== 'stale') this.patchSim();
    this.simPatch = false;
    const reveal = this.introOn ? (this.FW + 60) * this.introP : undefined;
    const td = rastered ? performance.now() : 0;
    this.cache.draw(ctx, c, reveal, this.RES);
    // Chrome defers the 2D raster to this first drawImage: count it, so the counter is the cost the frame pays
    if (rastered) this.perf.lastRasterMs += performance.now() - td;
    // dynamic layers at the live camera (no dynamic layer draws a pattern: the patterns stay anchored to the last raster)
    const v = this.view, lod = this.lod();
    this.hits.reset(); this.stampHits();
    drawOverlays(this, ctx, v, lod);
    if (this.introOn) { this.flags = NO_FLAGS; return; }
    drawOrderZones(this, ctx, v, lod); drawTargets(this, ctx, v, lod);
    drawHeat(this, ctx, v, lod, now);
    drawAgents(this, ctx, v, lod, now); drawPulses(this, ctx, v, lod, now);
    drawPins(this, ctx, v, lod, now); drawTracks(this, ctx, v, lod); drawBreaches(this, ctx, v, lod, now);
    drawPreview(this, ctx, v, lod, now); drawFocus(this, ctx, v, lod, now); drawAnswer(this, ctx, v, lod, now); drawBlockers(this, ctx, v, lod); drawReleases(this, ctx, v, lod, now);
    this.scans.draw(this, ctx, v, lod, now);
    // trouble flags over everything: the first thing to find on the plan
    this.flags = layoutFlags(this, v, lod); drawFlags(this, ctx, this.flags, this.flagHot); this.registerFlags();
    drawLasso(this, ctx);
  }
  private stampHits() { const c = this.cam, a = this.hitsAt; a.x = c.x; a.y = c.y; a.k = c.k; a.FW = this.FW; a.FH = this.FH; a.U = this.U; a.now = this.isNow; }
  /** The flags register last, in their draw order (index 0 is drawn last, on top), each with a few px of slack. */
  private registerFlags() {
    const fl = this.flags, sl = 3 * this.U;
    for (let i = fl.length - 1; i >= 0; i--) { const F = fl[i]; this.hits.add('flag', F.fid, 0, F, F.x - sl, F.y - sl, F.w + 2 * sl, F.tipY - F.y + 2 * sl); }
  }
  /** The hit list for the camera as it is now: the last frame's, or (the camera moved since) the target layers re-run mute. */
  private freshHits(): HitList {
    const c = this.cam, a = this.hitsAt;
    if (a.x === c.x && a.y === c.y && a.k === c.k && a.FW === this.FW && a.FH === this.FH && a.U === this.U && a.now === this.isNow) return this.hits;
    this.hits.reset(); this.stampHits();
    if (this.introOn) return this.hits;
    const g = muteCtx(), v = this.view, lod = this.lod(), now = performance.now();
    drawAgents(this, g, v, lod, now); drawPins(this, g, v, lod, now); drawTracks(this, g, v, lod); this.scans.draw(this, g, v, lod, now);
    this.registerFlags();
    return this.hits;
  }
  /** The whole static plan at raster view `v` (a full raster, or a clipped patch of it). */
  private paintPlan(g: CanvasRenderingContext2D, v: View) {
    this.anchor(this.FW / 2 - v.x * v.k, this.FH / 2 - v.y * v.k);
    drawGrid(this, g, v); drawDecor(this, g, v); drawBuildings(this, g, v); drawLabels(this, g, v);
  }
  /** Sim-dependent paint: tiles, ribbon segments and swarm lines whose live values moved since they were painted. */
  private patchSim() {
    const W = this.watch;
    if (!W.collect(this)) return;
    const t0 = performance.now();
    this.cache.patch(W.rects, W.n, (g, v) => { W.arm(); try { this.paintPlan(g, v); } finally { W.disarm(); } });
    this.perf.patches++; this.perf.lastPatchMs = performance.now() - t0;
  }
  /** Set by a sim tick (see frame): the next draw patches the raster instead of re-rastering it. */
  private simPatch = false;
  /** The GA / lens-key / blast filters the layers read, rebuilt when one of the three changes, not per frame. */
  private modeSeen: { ga: boolean; key: string | null; blast: string | null } | null = null;
  private syncModeFilters(S: UIState) {
    this.modeSeen = { ga: S.ga, key: S.key, blast: S.blast };
    const k = S.key;
    this.dimFn = S.ga ? (f) => f.milestone === GA_MILESTONE : k ? (f) => { const h = f.lens[k]?.h; return h === 'bad' || h === 'watch'; } : null;
    this.blastSet = S.blast ? new Set(this.M.closure.of(S.blast)) : null;
  }
  private afterFrame(now: number) {
    const c = this.cam, sg = this.camSig;
    const cx = Math.round(c.x * 100), cy = Math.round(c.y * 100), ck = Math.round(c.k * 1e5);
    const camChanged = cx !== sg.x || cy !== sg.y || ck !== sg.k || this.FW !== sg.w || this.FH !== sg.h;
    sg.x = cx; sg.y = cy; sg.k = ck; sg.w = this.FW; sg.h = this.FH;
    if (this.keyplan && (camChanged || now - this.kpAt > 1000)) {
      this.kpAt = now;
      const S = this.S, q = this.kpSig;
      if (q.themeV !== this.themeV || q.t !== S.t || q.delta !== S.delta || q.sv !== this.simStaticV) {
        q.themeV = this.themeV; q.t = S.t; q.delta = S.delta; q.sv = this.simStaticV; q.str = q.themeV + '|' + q.t + '|' + q.delta + '|' + q.sv;
      }
      this.keyplan.draw(q.str, this.RES);
    }
    if (camChanged || this.listenForce) { this.listenForce = false; const fns = this.camFns; for (let i = 0; i < fns.length; i++) fns[i](); }
    this.tickSimTime();
  }
  private tickSimTime() {
    const sec = Math.floor(this.M.sim.t);
    // the snapshot is taken only on the frames that actually fire (once a displayed second), so the frame loop still allocates nothing
    if (sec !== this.lastSimSec) { this.lastSimSec = sec; for (const fn of [...this.simTimeListeners]) if (this.simTimeListeners.has(fn)) fn(this.M.sim.t); }
  }
  /** The phone and the findings ledger draw no plan, so frame() never runs there: a light timer advances the simulation (waits, agents, new questions) and syncs the store. It stops when the plan is drawn again, and a hidden tab skips its ticks without banking the time. */
  private lightSim(on: boolean) {
    if (!on) { clearInterval(this.phoneTimer); this.phoneTimer = 0; return; }
    if (this.phoneTimer || this.destroyed) return;
    this.phoneAt = performance.now();
    this.phoneTimer = window.setInterval(() => {
      const now = performance.now(); let dt = Math.min(now - this.phoneAt, 2000); this.phoneAt = now;
      const sim = this.M.sim;
      if (this.destroyed || document.hidden || !sim.has) return;
      if (this.isNow && sim.playing) { let ch = false; while (dt > 0) { ch = sim.advance(Math.min(dt, 90)) || ch; dt -= 90; } if (ch) this.scheduleSimSync(); }
      sim.expire(now); this.tickSimTime();
    }, 250);
  }
  private phoneTimer = 0; private phoneAt = 0;
  private kpAt = 0;
  /** Subscribe to the frames where the camera moved (positioned DOM like the decision card and scale bar), and once more after a store change or a layout change. Runs once right after subscribing. Not called on simulation-only frames: use onSimTime for the clock. */
  onFrame(fn: () => void) { this.camFns = [...this.camFns, fn]; this.listenForce = true; this.dirty(); return () => { this.camFns = this.camFns.filter((f) => f !== fn); }; }
  /** Subscribe to the simulation clock (called when the displayed second changes). */
  onSimTime(fn: (t: number) => void) { this.simTimeListeners.add(fn); fn(this.M.sim.t); return () => { this.simTimeListeners.delete(fn); }; }

  // ============================================================================ simulation <-> store
  private scheduleSimSync(immediate = false) {
    const go = () => {
      this.simSyncTimer = 0;
      const sim = this.M.sim;
      const p: Partial<UIState> = { simV: sim.version, playing: sim.playing, speed: sim.speed, over: sim.over };
      if (this.pendingTicker) { p.ticker = this.pendingTicker; this.pendingTicker = null; }
      const S = this.S;
      if (S.dec && !sim.DEC[S.dec]?.open) p.dec = null;
      this.store.set(p); this.dirty();
    };
    if (immediate) { clearTimeout(this.simSyncTimer); go(); return; }
    if (!this.simSyncTimer) this.simSyncTimer = window.setTimeout(go, 250);
  }
  private onSimEvent(e: SimEvent) {
    const sim = this.M.sim;
    if (sim.speed > 60 && (e.syn || e.type === 'commit')) return;
    this.pendingTicker = e;
    const now = performance.now();
    if (now - this.lastTickerAt > 400) { this.lastTickerAt = now; this.scheduleSimSync(); }
  }
  /** A live product's new feed: the sim takes it in place (agents travel, questions open or close). */
  feed(S: Parameters<Model['sim']['applyFeed']>[0]) { if (this.destroyed) return; this.M.sim.applyFeed(S); this.scheduleSimSync(true); this.dirty(); }
  /** A live product's snapshot and jobs, for its answer tracks (src/lib/model/live-tracks.ts). */
  feedTracks(scan: ScanSnapshot, jobs: readonly ScanJob[]) { const T = this.M.tracks; if (this.destroyed || !T) return; T.feed(scan, jobs); this.set({ simV: this.S.simV + 1 }); this.dirty(); }
  /** Open a track's record beside the plan (null closes it). */
  openTrack(id: string | null) { this.set({ track: id }); }
  togglePlay() { if (!this.isNow) { this.setTime(this.M.P.asOf); return; } this.M.sim.togglePlay(); this.scheduleSimSync(true); this.dirty(); }
  setSpeed(n: number) { this.M.sim.setSpeed(n); this.scheduleSimSync(true); this.dirty(); }
  stepSpeed(dir: number) { const i = SPEEDS.indexOf(this.M.sim.speed as (typeof SPEEDS)[number]); this.setSpeed(SPEEDS[clamp(i + dir, 0, SPEEDS.length - 1)]); }
  restart() { this.M.sim.reset(); this.set({ tgt: { ids: {}, n: 0, label: '' }, prev: null, lprev: null, dec: null }); this.scheduleSimSync(true); }
  /**
   * Expand or collapse the timeline panel (it overlays the plan; the safe area keeps the collapsed strip).
   * The timeline panel and a rail flyout never stand open together: opening one closes the other.
   */
  setTimeline(on = !this.S.tl) { if (on !== this.S.tl) this.set(on ? { tl: on, dtab: null } : { tl: on }); }
  seek(t: number) { if (!this.isNow) this.set({ t: this.M.P.asOf }); this.M.sim.seek(t); this.scheduleSimSync(true); this.dirty(); }

  // ============================================================================ lens, person, time
  setView(v: ViewId, quiet = false) {
    if (v === this.S.view || !isView(this.M.P, v)) return;
    this.set({ view: v });
    this.mix.to(v, quiet || this.cam.reduced);
    this.syncRootView();
    this.writeHashSoon();
  }
  setWho(id: string | null) {
    this.store.set({ who: id || null, whoMenu: false, dtab: this.S.dtab ? 'asks' : null });
    const pl = personLens(this.M.P, id);
    if (pl) this.setView(pl, true);
    const q = this.M.sim.queueFor(this.S.who, this.S.view);
    if (id) this.toast('Viewing as ' + (this.M.P.P[id]?.name ?? id), q.mine.length + ' question' + (q.mine.length === 1 ? '' : 's') + ' wait for them');
    this.dirty();
  }
  setTime(d: string) {
    const W = this.M.P.weeks, asOf = this.M.P.asOf;
    if (d > asOf) d = asOf; if (d < W[0]) d = W[0];
    if (d === this.S.t) return;
    this.set({ t: d }); this.placeKey = ''; this.writeHashSoon();
  }
  stepWeek(dir: number) {
    const W = this.M.P.weeks; let i = W.indexOf(this.S.t); if (i < 0) i = revAt(W, this.S.t) - 1;
    this.setTime(W[clamp(i + dir, 0, W.length - 1)]);
  }
  setDelta(d: 1 | 7 | 14) { this.set({ delta: d }); this.writeHashSoon(); }
  /** `tone` is the severity the model already speaks (sim.ts ToastTone): 'bad' a failure, 'warn' a refusal or a nothing-happened, absent a plain confirmation. */
  toast(strong: string, text: string, action?: 'undo' | 'undo2' | 'replay', fid?: string, tone?: ToastTone) { this.toastN++; this.store.set({ toast: { strong, text, action, fid, tone, n: this.toastN } }); }
  dismissToast() { this.store.set({ toast: null }); }

  // ============================================================================ navigation
  goHome(dur?: number) { this.cam.flyTo(this.HOME, dur); }
  private fitOf(c: Chain[number]): Cam { return this.fitCam(c.o, PADS[c.t], OVER[c.t] ?? 1); }
  /** fitOf(c).k without building a record. */
  private fitKOf(c: Chain[number]): number { const U = this.U, p = PADS[c.t]; return this.cam.fitK(c.o, p.t * U, p.r * U, p.b * U, p.l * U, OVER[c.t] ?? 1, this.SAFE); }
  /** The zoom at which a bay fills the view (its L3 fit), cached until the UI scale or the safe area moves: the plan's
   *  feature titles grow toward double size as the camera reaches it (render/plan.ts paintTile). */
  bayFitK(B: BayNode): number {
    const R = this.SAFE, sig = this.U + '|' + R.l + '|' + R.t + '|' + R.r + '|' + R.b;
    if (sig !== this.bayFitSig) { this.bayFitSig = sig; this.bayFit.clear(); }
    let k = this.bayFit.get(B.id);
    if (k === undefined) { k = this.fitKOf({ t: 'bay', o: B }); this.bayFit.set(B.id, k); }
    return k;
  }
  private bayFit = new Map<string, number>(); private bayFitSig = '';
  zoomBy(dir: number) { const S = this.SAFE; this.cam.zoomAt((S.l + S.r) / 2, (S.t + S.b) / 2, dir > 0 ? 1.6 : 1 / 1.6); this.endIntro(); }
  zoomAt(px: number, py: number, f: number) { this.cam.zoomAt(px, py, f); }
  goLevel(depth: number) {
    if (depth === 0) { this.closeFeature(false); this.goHome(); return; }
    if (depth === this.levelNames().length - 1) { const T = this.nearestTile(); if (T) this.openFeature(T.id); return; }
    this.closeFeature(false);
    let ch = this.chainBest();
    if (!ch.length) { const R0 = this.M.L.walk[0]; ch = this.chainAt(R0.x + R0.w / 2, R0.y + 92); }
    const c = ch[Math.min(depth, ch.length) - 1];
    if (c) this.cam.flyTo(this.fitOf(c));
  }
  crumb(depth: number) {
    if (depth === 0) { this.closeFeature(false); this.goHome(); return; }
    if (this.S.open) this.store.set({ open: null });
    const p = this.place[depth - 1] || this.place[this.place.length - 1];
    if (p) this.cam.flyTo(this.fitOf(p));
  }
  goUp() {
    const S = this.S;
    if (S.menu) { this.set({ menu: null }); return; }
    if (S.tl) { this.set({ tl: false }); return; }
    if (S.morning) { this.set({ morning: false }); return; }
    if (S.whoMenu) { this.set({ whoMenu: false }); return; }
    if (S.dtab) { this.set({ dtab: null }); return; }
    if (S.info) { this.set({ info: false }); return; }
    if (S.page === 'ledger') return; // Esc never leaves the ledger (it clears its own selection); nothing on the plan behind it moves
    if (S.open) { this.closeFeature(); return; }
    if (S.dec) { this.closeDecision(); return; }
    if (S.track) { this.set({ track: null }); return; }
    if (S.prev || S.lprev) { this.set({ prev: null, lprev: null }); return; }
    if (S.tgt.n) { this.clearTarget(); return; }
    if (S.blast) { this.setMode({ blast: null }); return; }
    if (S.ga) { this.setMode({ ga: false }); return; }
    if (S.key) { this.set({ key: null }); return; }
    const p = this.place;
    if (!p.length) {
      if (!this.cam.near(this.HOME, 0.02, 4)) this.goHome();
      else if (!this.isNow) this.setTime(this.M.P.asOf);
      return;
    }
    if (p.length === 1) { this.goHome(); return; }
    this.cam.flyTo(this.fitOf(p[p.length - 2]));
  }
  walk(dir: number) {
    const W = this.M.L.walk;
    const cur = this.place.find((c) => c.t === 'room' || c.t === 'bay');
    let i = cur ? W.indexOf(cur.t === 'bay' ? (cur.o as BayNode).room : (cur.o as RoomNode)) : -1;
    if (i < 0) { const w = this.chainBest().find((c) => c.t === 'wing'); i = w ? W.indexOf((w.o as WingNode).rooms[0]) - (dir > 0 ? 1 : 0) : dir > 0 ? -1 : W.length; }
    i = (i + dir + W.length) % W.length;
    this.cam.flyTo(this.fitCam(W[i], PADS.room, OVER.room));
  }
  flyToFeature(id: string, highlight = true) {
    const T = this.M.L.TILE[id]; if (!T) return;
    if (this.S.phone) { this.openFeature(id); return; } // no plan to fly over on a phone: show the feature
    if (this.S.open) this.closeFeature(false);
    this.set({ morning: false });
    this.cam.flyTo(this.fitCam({ x: T.x - 120, y: T.y - 90, w: T.w + 240, h: T.h + 180 }, { t: 40, r: 30, b: 60, l: 30 }, 1));
    if (highlight) { this.set({ hl: id }); clearTimeout(this.hlTimer); this.hlTimer = window.setTimeout(() => { if (!this.destroyed && this.S.hl === id) this.set({ hl: null }); }, 2600); }
  }
  /** Click on the key plan at fractions (0..1) of its width and height. */
  keyplanClick(fx: number, fy: number) {
    if (!this.keyplan) return;
    const p = this.keyplan.toWorld(fx * this.keyplan.W, fy * this.keyplan.H);
    this.cam.flyTo({ x: p.x, y: p.y, k: Math.max(this.cam.k, this.HOME.k * 2.2) });
  }
  nearestTile(): TileNode | null {
    let best: TileNode | null = null, bd = 1e18;
    for (const T of this.M.L.tiles) { const d = Math.hypot(T.x + T.w / 2 - this.cam.x, T.y + T.h / 2 - this.cam.y); if (d < bd) { bd = d; best = T; } }
    return best;
  }
  /**
   * A feature tile's rect on screen, in the UI layer's px (the chrome is scaled by U): where the
   * feature page grows from and shrinks back into. null for an unknown feature.
   */
  tileRect(id: string): { x: number; y: number; w: number; h: number } | null {
    const T = this.M.L.TILE[id]; if (!T) return null;
    const c = this.cam, U = this.U;
    return { x: c.sx(T.x) / U, y: c.sy(T.y) / U, w: (T.w * c.k) / U, h: (T.h * c.k) / U };
  }
  /**
   * L4 is a full page over the dimmed plan: the plan stays where it is, so the page can grow out of
   * the tile and shrink back into it. Only a tile that is off screen or too small to see (a search
   * pick, a deep link, a list row) brings the plan to it first, instantly, behind the page.
   */
  openFeature(id: string) {
    const F = this.M.P.F[id], T = this.M.L.TILE[id]; if (!F || !T) return;
    const r = this.tileRect(id)!, U = this.U, S = this.SAFE;
    if (!this.S.phone && (r.w * U < 48 || r.x * U < S.l || r.y * U < S.t || (r.x + r.w) * U > S.r || (r.y + r.h) * U > S.b)) {
      this.cam.set(this.fitCam({ x: T.x - T.w * 1.6, y: T.y - T.h * 1.6, w: T.w * 4.2, h: T.h * 4.2 }, { t: 40, r: 30, b: 60, l: 30 }, 1));
    }
    this.set({ open: id, sel: null, hl: null, dec: null, hover: null, morning: false, menu: null });
    if (this.S.phone) return;
    this.placeKey = ''; this.writeHashSoon(true);
  }
  /**
   * Back to the plan: the page shrinks into the tile, so the camera does not move.
   * On a phone it returns where openFeature does: the detail owns its own history entry (Phone.tsx pushes it
   * and its Back consumes it), so an engine hash write would land on whatever entry Back had already reached,
   * and there is no canvas on screen to take the focus back.
   */
  closeFeature(focus = true) {
    if (!this.S.open) return;
    this.set({ open: null });
    if (this.S.phone) return;
    this.placeKey = ''; this.writeHashSoon(true);
    if (focus) this.cv.focus({ preventScroll: true });
  }
  setMode(m: { ga?: boolean; blast?: string | null }) {
    const patch: Partial<UIState> = { ...m, info: false };
    if (this.S.open && (m.blast || m.ga)) patch.open = null;
    this.set(patch);
    const S = this.S;
    const ids = S.blast ? this.M.closure.of(S.blast).concat([S.blast]) : S.ga ? this.M.P.features.filter((f) => f.milestone === GA_MILESTONE).map((f) => f.id) : null;
    if (ids && (m.blast || m.ga)) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const i of ids) { const T = this.M.L.TILE[i]; if (!T) continue; x0 = Math.min(x0, T.x); y0 = Math.min(y0, T.y); x1 = Math.max(x1, T.x + T.w); y1 = Math.max(y1, T.y + T.h); }
      this.cam.flyTo(this.fitCam({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { t: 40, r: CALLOUT_PAD, b: 56, l: 30 }));
    }
    this.placeKey = ''; this.writeHashSoon();
  }
  /** The GA readiness mode needs the sample's GA milestone in the map (a live product's map may not have it: then the mode, its key and its overlay do not exist). */
  get hasGA(): boolean { return !!this.M.P.MS[GA_MILESTONE]; }
  toggleGA() { if (this.hasGA || this.S.ga) this.setMode({ ga: !this.S.ga, blast: null }); }
  toggleBlast(id?: string) {
    if (this.S.blast) { this.setMode({ blast: null }); return; }
    const S = this.S, sf = this.M.P.scale > 1 ? '-S' : '';
    const t = id || S.open || S.sel || (S.hover && S.hover.type === 'tile' ? S.hover.id : null) || (this.M.P.F[BLAST_DEFAULT + sf] ? BLAST_DEFAULT + sf : this.M.P.features[0]?.id);
    if (!t) return;
    this.setMode({ blast: t, ga: false });
  }
  /** Highlight the features in trouble (bad or watch) under one lens; null clears. */
  setKey(k: string | null) { this.set({ key: k }); }
  setSel(id: string | null) { this.set({ sel: id }); }
  setHl(id: string | null) { if (this.S.hl !== id) this.set({ hl: id }); }
  setHlDec(id: string | null) { if (this.S.hlDec !== id) this.set({ hlDec: id }); }
  /** An answer option under the pointer / focus (null clears): the plan shows what choosing it would move. */
  setHlOpt(dec: string | null, oi = 0) {
    const h = this.S.hlOpt;
    if (!dec) { if (h) this.set({ hlOpt: null }); return; }
    if (!h || h.dec !== dec || h.oi !== oi) this.set({ hlOpt: { dec, oi } });
  }
  private apV = -1; private apDec = ''; private apOi = -1; private apVal: Preview | null = null;
  /** The highlighted option's dry run (sim.previewAnswer), computed once per (sim version, decision, option), never per frame. */
  answerPreview(): Preview | null {
    const h = this.S.hlOpt, sim = this.M.sim; if (!h) return null;
    if (this.apV !== sim.version || this.apDec !== h.dec || this.apOi !== h.oi) { this.apV = sim.version; this.apDec = h.dec; this.apOi = h.oi; this.apVal = h.dec.startsWith('batch:') ? sim.previewBatch(h.dec.slice(6)) : sim.previewAnswer(h.dec, h.oi); }
    return this.apVal;
  }
  setOrdHi(id: string | null) { if (this.S.ordHi !== id) this.set({ ordHi: id }); }
  /** Open a rail flyout; the open one again (or null) closes it. */
  setDockTab(t: DockTab | null) { const dtab = t === this.S.dtab ? null : t; this.set(dtab ? { dtab, tl: false } : { dtab }); }
  patch(p: Partial<UIState>) { this.set(p); }
  /**
   * Show the drawing set or the findings ledger (a DOM page over the plan). While the ledger shows, the frame loop
   * draws nothing and sleeps (the simulation keeps its light timer, like the phone), and plan keys and pointer are
   * ignored; leaving it draws once. Page and prototype ride in the hash (`page=ledger`, `lv=`) and replace the entry.
   */
  setPage(page: UIState['page'], lv?: UIState['lv']) {
    const S = this.S;
    if (page === S.page && (!lv || lv === S.lv)) return;
    const leaving = S.page === 'ledger' && page !== 'ledger';
    this.endIntro();
    const p: Partial<UIState> = { page, menu: null, hover: null };
    if (lv) p.lv = lv;
    this.store.set(p);
    this.lightSim(S.phone || page === 'ledger');
    if (leaving) { this.lastT = 0; this.placeKey = ''; this.dirty(); } // the sim advanced on the light timer meanwhile: no banked frame delta
    this.writeHashSoon();
  }
  toggleDock(on?: boolean) {
    const hide = on == null ? !this.S.dockHidden : !on;
    this.store.set(hide ? { dockHidden: hide, dtab: null } : { dockHidden: hide });
    // panned away at the home zoom is not "at home": the rail toggle must not yank the plan back
    const atHome = this.cam.near(this.HOME, 0.02, 8);
    this.layoutChrome(); this.computeHome();
    if (atHome && !this.S.open) this.cam.flyTo(this.HOME, 400);
    this.placeKey = ''; this.dirty();
  }
  toggleSelMode() { const on = !this.S.selMode; this.set({ selMode: on }); this.toast(on ? 'Target mode.' : 'Target mode off.', on ? 'Click or drag to select places. Press S again to leave.' : ''); }
  toggleMorning(on?: boolean) { this.set({ morning: on == null ? !this.S.morning : on }); }
  /**
   * The morning watch's places targeted on the plan, on every product line. The incoming ids come from the
   * watch's own events, so at `?scale=N` they carry whichever line's suffix that event was stamped with -
   * not line one's (lineSiblings strips the one that is actually there).
   */
  morningShow(fids: readonly string[], label: string) {
    const ids: Record<string, 1> = {}, sc = this.M.P.scale;
    const sfx = sc > 1 ? LINES.slice(0, sc).map(([, s]) => '-' + s) : [];
    for (const f of fids) for (const id of lineSiblings(f, sfx)) if (this.M.P.F[id]) ids[id] = 1;
    // Nothing to show (a retained event can name a feature the loaded map dropped): keep the watch open and say so.
    if (!Object.keys(ids).length) { this.toast('Nothing to show:', 'those places are not on this plan any more.', undefined, undefined, 'warn'); return; }
    this.set({ morning: false });
    this.setTarget(ids, label);
    this.lookAtTarget();
  }

  // ============================================================================ decisions
  /** What holds a blocked agent: its open question when it has one (the card flies there), else fly to the feature. */
  goToBlocker(fid: string) {
    const d = this.M.sim.DOF[fid]?.[0];
    if (d) this.openDecision(d.id); else this.flyToFeature(fid);
  }
  openDecision(id: string, noFly = false) {
    const sim = this.M.sim, d = sim.DEC[id]; if (!d || !d.open) return;
    if (this.S.open) this.closeFeature(false);
    d.isNew = false;
    this.set({ dec: id, hl: null, hover: null, morning: false, hlOpt: null });
    if (!noFly && !this.S.phone) {
      const T = this.M.L.TILE[d.f], R = { l: this.SAFE.l, t: this.SAFE.t, r: Math.min(this.SAFE.r, this.FW - overlayRight(this.S) * this.U) - 400 * this.U, b: this.SAFE.b };
      const c = this.fitCam({ x: T.x - 30, y: T.y - 30, w: T.w + 60, h: T.h + 60 }, { t: 60, r: 40, b: 60, l: 40 }, 1, R);
      c.k = clamp(Math.min(c.k, 1.25), this.cam.KMIN, this.cam.KMAX);
      const cx = (R.l + R.r) / 2, cy = (R.t + R.b) / 2, k = Math.max(c.k, Math.min(1.0, (160 * this.U) / T.w));
      this.cam.flyTo({ x: T.x + T.w / 2 - (cx - this.FW / 2) / k, y: T.y + T.h / 2 - (cy - this.FH / 2) / k, k });
    }
  }
  closeDecision() { this.set({ dec: null, hlOpt: null }); }
  stepDecision(dir: number) {
    const list = this.M.sim.cardOrder(this.S.who, this.S.view); if (!list.length) return;
    let i = list.findIndex((d) => d.id === this.S.dec);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    this.openDecision(list[i].id);
  }
  /**
   * Answer a question. Live products: optimistic, then written to the product's store (option 0 =
   * approve, 1 = decline, with the optional note); a refusal rolls it back with a toast saying why.
   */
  decide(id: string, oi: number, note?: string) {
    const sim = this.M.sim, d = sim.DEC[id], live = this.M.live;
    const open = !!d?.open;
    if (live && sim.live && this.refuseReadOnly()) return;
    sim.decide(id, oi);
    if (this.S.dec === id) this.store.set({ dec: null });
    if (this.S.hlOpt) this.store.set({ hlOpt: null });
    this.scheduleSimSync(true); this.forceStatic();
    if (!live || !sim.live || !d || !open) return;
    const pid = d.base, body = { decision: oi === 0 ? 'approve' as const : 'decline' as const, ...(note ? { note } : {}) };
    // the tile's track takes over from the question at once: saving, then the store's row (a 409: the decision it holds)
    const tracks = this.M.tracks, sent = tracks ? tracks.decide(pid, body, (i, b) => live.decide(i, b)) : live.decide(pid, body);
    sent.then(
      () => { if (this.destroyed) return; sim.settle(pid, null, false); this.dirty(); },
      (e: Error & { status?: number }) => {
        if (this.destroyed) return;
        const w = saveFailWords(e);
        sim.settle(pid, w.text, w.retry);
        this.scheduleSimSync(true); this.forceStatic();
      },
    );
  }
  /** True while the live product's server runs with BP_WRITES=off: decisions are read-only (approve / decline, dispatch,
   *  triage). Kettle's sim always takes them. */
  readOnly(): boolean { return this.M.live?.writes?.() === false; }
  /** readOnly(), saying so in a toast: a key or a stale control reached a decision the server would refuse (403). */
  refuseReadOnly(): boolean {
    if (!this.readOnly()) return false;
    this.toast('Read only', 'decisions are turned off on this blueprint (BP_WRITES=off)');
    return true;
  }
  /** Answer and keep it as a standing order (sample only): signed like a written order, scoped to the target if one is set, else the question's room. */
  keepAnswer(id: string, oi: number) {
    const sim = this.M.sim; if (sim.live) return;
    if (!sim.keepAnswer(id, oi, this.signer(), this.S.tgt.n ? this.S.tgt : null)) return;
    if (this.S.dec === id) this.store.set({ dec: null });
    if (this.S.hlOpt) this.store.set({ hlOpt: null });
    this.scheduleSimSync(true); this.forceStatic();
  }
  /** Decide a batch of like questions at their recommendations, with one undo (sample only; never an urgent one). */
  decideBatch(key: string) {
    const sim = this.M.sim; if (sim.live) return;
    if (!sim.decideBatch(key)) return;
    if (this.S.dec && !sim.DEC[this.S.dec]?.open) this.store.set({ dec: null });
    if (this.S.hlOpt) this.store.set({ hlOpt: null });
    this.scheduleSimSync(true); this.forceStatic();
  }
  /** U on the plan and the toast's UNDO: the reader's last gesture (answer, batch, kept answer or command) taken back, newest first. */
  undoLast() {
    if (!this.M.sim.undoLast()) return;   // nothing left (the sim toasts why) or a live sim (no history)
    this.store.set({ toast: null }); this.scheduleSimSync(true); this.forceStatic();
  }
  private forceStatic() { this.simSeenV = this.M.sim.version; this.simStaticV++; this.simStaticAt = performance.now(); this.simPatch = true; this.dirty(); }

  // ============================================================================ targeting + steering
  setTarget(ids: Record<string, 1>, label: string) { this.set({ tgt: { ids, n: Object.keys(ids).length, label }, prev: null, lprev: null }); }
  clearTarget() { this.set({ tgt: { ids: {}, n: 0, label: '' }, prev: null, lprev: null, ordMenu: false }); }
  lookAtTarget() {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const id in this.S.tgt.ids) { const T = this.M.L.TILE[id]; if (!T) continue; x0 = Math.min(x0, T.x); y0 = Math.min(y0, T.y); x1 = Math.max(x1, T.x + T.w); y1 = Math.max(y1, T.y + T.h); }
    if (x1 > x0) this.cam.flyTo(this.fitCam({ x: x0 - 40, y: y0 - 40, w: x1 - x0 + 80, h: y1 - y0 + 80 }, { t: 40, r: 30, b: 60, l: 30 }, 1));
  }
  private needTarget() { this.toast('Point at a place first:', 'shift-click a wing, room or fixture, or shift-drag a box.', undefined, undefined, 'warn'); }
  /** A sample steer's preview. Refused on a live product (its verbs are measure, build and stop: `previewLive`). */
  preview(kind: 'ga' | 'research' | 'push' | 'pause' | 'resume' | 'order', tpl?: OrderTemplate, fid?: string) {
    const sim = this.M.sim;
    if (sim.live) { this.toast(SAMPLE_REFUSED.strong, SAMPLE_REFUSED.text, undefined, undefined, 'bad'); return; }
    let tgt: Target = this.S.tgt;
    if (fid) { tgt = { ids: { [fid]: 1 }, n: 1, label: this.M.P.F[fid].name }; this.store.set({ tgt }); }
    let p: Preview | null = null;
    if (kind === 'ga') { p = sim.previewGA(this.wingName); if (!p) this.toast('Nothing to pull:', 'no agent is on M3 or M4 work.', undefined, undefined, 'warn'); }
    else if (kind === 'research') { p = sim.previewResearch(); if (!p) this.toast('The research crew is already paused.', '', undefined, undefined, 'warn'); }
    else {
      if (!tgt.n) { this.needTarget(); return; }
      if (kind === 'push') { p = sim.previewPushHere(tgt, this.wingName); if (!p) this.toast('Nothing to move:', 'no free working agent, or the selection is already live.', undefined, undefined, 'warn'); }
      else if (kind === 'pause' || kind === 'resume') { p = sim.previewPause(tgt, kind === 'resume'); if (!p) this.toast(kind === 'resume' ? 'No paused agent' : 'No agent is working', 'inside the selection.', undefined, undefined, 'warn'); }
      else if (kind === 'order' && tpl) p = sim.previewOrder(tgt, tpl, this.signer());
    }
    this.set({ prev: p, lprev: null, ordMenu: false });
  }
  /** A live product's steer over the target (planned by `planLive`): shown under NOT ISSUED YET, or its reason toasted when it cannot run. */
  previewLive(p: LivePlan) {
    if (!this.M.sim.live || !this.M.live) return;
    if (p.off) { this.toast(LIVE_VERB_LABEL[p.verb] + ':', p.off, undefined, undefined, 'warn'); return; }
    this.set({ lprev: p, prev: null, ordMenu: false });
  }
  commitPreview() {
    const lp = this.S.lprev;
    if (lp) { this.set({ lprev: null }); this.commitLive(lp); return; }
    const p = this.S.prev; if (!p) return;
    this.set({ prev: null });
    if (!commitSample(this.M.sim, p, this.signer())) { this.toast(SAMPLE_REFUSED.strong, SAMPLE_REFUSED.text, undefined, undefined, 'bad'); return; }
    this.scheduleSimSync(true); this.forceStatic();
  }
  /** Run a live steer through the product's routes; the swarm answers through the jobs and the scan feed, and the toast says what started. */
  private commitLive(p: LivePlan) {
    const live = this.M.live; if (!live) return;
    void runLivePlan({ slug: live.slug, sim: null }, p, (id) => this.M.P.LENS[id]?.name ?? id).then((t) => { if (!this.destroyed) this.toast(t.strong, t.text); });
  }
  /** Who signs a written order: the reader, else the one person who reads the current lens; null = nobody (refused). */
  signer(): string | null { return this.S.who ?? lensPerson(this.M.P, this.S.view); }
  cancelPreview() { this.set({ prev: null, lprev: null }); }

  // ============================================================================ places, crumbs, levels
  private visShare(o: Box): number {
    const c = this.cam, S = this.SAFE;
    const x0 = Math.max(S.l, c.sx(o.x)), x1 = Math.min(S.r, c.sx(o.x + o.w)), y0 = Math.max(S.t, c.sy(o.y)), y1 = Math.min(S.b, c.sy(o.y + o.h));
    return x1 <= x0 || y1 <= y0 ? 0 : (x1 - x0) * (y1 - y0);
  }
  private pickShare<T extends Box>(list: T[]): T | null { let best: T | null = null, bs = 0; for (const o of list) { const s = this.visShare(o); if (s > bs) { bs = s; best = o; } } return best; }
  /** The best-covered place at each level. The returned array and its records are reused by the next call: read it at once. */
  private chainBest(): Chain {
    const out = this.bestBuf; out.length = 0;
    const B = this.pickShare(this.M.L.blds); if (!B) return out;
    if (this.M.P.scale > 1) this.put(out, 'bld', B);
    const W = this.pickShare(B.wings); if (!W) return out; this.put(out, 'wing', W);
    const R = this.pickShare(W.rooms); if (!R) return out; this.put(out, 'room', R);
    const Bay = this.pickShare(R.bays); if (Bay) this.put(out, 'bay', Bay);
    return out;
  }
  private put(out: Chain, t: Crumb['t'], o: PlaceNode) { const r = this.bestPool[out.length]; r.t = t; r.o = o; out.push(r); }
  chainAt(wx: number, wy: number): Chain {
    const out: Chain = [];
    const B = this.M.L.blds.find((b) => inside(b, wx, wy)); if (!B) return out;
    if (this.M.P.scale > 1) out.push({ t: 'bld', o: B });
    const W = B.wings.find((w) => inside(w, wx, wy)); if (!W) return out; out.push({ t: 'wing', o: W });
    const R = W.rooms.find((r) => inside(r, wx, wy)); if (!R) return out; out.push({ t: 'room', o: R });
    const Bay = R.bays.find((b) => inside(b, wx, wy)); if (Bay) out.push({ t: 'bay', o: Bay });
    return out;
  }
  private entered(c: Chain[number]) { return this.cam.k >= this.fitKOf(c) * 0.86 && this.cam.k >= this.HOME.k * 1.18; }
  private computePlace(): Chain {
    if (this.S.open && this.M.L.TILE[this.S.open]) { const T = this.M.L.TILE[this.S.open]; return this.chainAt(T.x + T.w / 2, T.y + T.h / 2); }
    const ch = this.chainBest(); let deepest = -1;
    for (let i = 0; i < ch.length; i++) if (this.entered(ch[i])) deepest = i;
    const out = this.placeBuf; out.length = 0;
    for (let i = 0; i <= deepest; i++) { const r = this.placePool[i]; r.t = ch[i].t; r.o = ch[i].o; out.push(r); }
    return out;
  }
  private syncPlace() {
    const c = this.cam, g = this.placeSig, R = this.SAFE, open = this.S.open, force = this.placeKey === '';
    if (!force && g.x === c.x && g.y === c.y && g.k === c.k && g.FW === this.FW && g.FH === this.FH && g.l === R.l && g.t === R.t && g.r === R.r && g.b === R.b && g.U === this.U && g.hk === this.HOME.k && g.open === open) return;
    g.x = c.x; g.y = c.y; g.k = c.k; g.FW = this.FW; g.FH = this.FH; g.l = R.l; g.t = R.t; g.r = R.r; g.b = R.b; g.U = this.U; g.hk = this.HOME.k; g.open = open;
    const pl = this.place = this.computePlace(), ids = this.placeIds;
    let same = !force && this.placeOpen === open && ids.length === pl.length;
    for (let i = 0; same && i < pl.length; i++) if (ids[i] !== pl[i].o.id) same = false;
    if (same) return;
    ids.length = 0; for (let i = 0; i < pl.length; i++) ids.push(pl[i].o.id);
    this.placeKey = '1'; this.placeOpen = open;
    const names = this.levelNames();
    this.store.set({ place: pl.map((c) => ({ t: c.t, id: c.o.id })), level: open ? names.length - 1 : pl.length });
    this.writeHashSoon();
  }

  // ============================================================================ hit testing
  hitAt(px: number, py: number): { t: Crumb['t'] | 'tile'; o: PlaceNode | TileNode; chain: Chain } | null {
    const c = this.cam, wx = c.wx(px), wy = c.wy(py), k = c.k, lod = this.lod();
    if (lod > 0.5) {
      for (const T of this.M.L.tiles) if (wx >= T.x - 3 / k && wx <= T.x + T.w + 3 / k && wy >= T.y - 3 / k && wy <= T.y + T.h + 3 / k) return { t: 'tile', o: T, chain: this.chainAt(wx, wy) };
    } else {
      const ch0 = this.chainAt(wx, wy), Bay = ch0.find((x) => x.t === 'bay');
      if (Bay) {
        const b = Bay.o as BayNode, rb = b.rib;
        if (wx >= rb.x && wx <= rb.x + rb.w && wy >= rb.y - 4 && wy <= rb.y + rb.h + 4) {
          const n = b.tiles.length, i2 = clamp(Math.floor(((wx - rb.x) / rb.w) * n), 0, n - 1);
          return { t: 'tile', o: b.tiles[i2], chain: ch0 };
        }
      }
    }
    const ch = this.chainAt(wx, wy);
    return ch.length ? { t: ch[ch.length - 1].t, o: ch[ch.length - 1].o, chain: ch } : null;
  }
  private hitTarget(h: ReturnType<Engine['hitAt']>): HoverInfo | null {
    if (!h) return null;
    if (h.t === 'tile' && this.lod() > 0.5) return { type: 'tile', id: h.o.id };
    const pk = h.chain.find((c) => !this.entered(c)) || null;
    if (h.t === 'tile') return pk ? { type: pk.t, id: pk.o.id } : { type: 'tile', id: h.o.id };
    return pk ? { type: pk.t, id: pk.o.id } : null;
  }
  /** A coarse pointer's minimum target (the touch floor), 0 for a mouse. */
  touchMin(): number { return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? TOUCH : 0; }
  /** The topmost drawn target at (px, py) - flag, track, pin, "+N" chip or agent - or, with `kinds`, the topmost of those. */
  hitUnder(px: number, py: number, kinds?: readonly HitKind[]): Hit | null {
    if (this.S.open) return null;
    return this.freshHits().at(px, py, this.touchMin(), kinds);
  }
  private pinOf(h: Hit): { list: SimDecision[]; d: SimDecision; cluster: boolean; at: string } {
    if (h.kind === 'pin') { const d = h.ref as SimDecision; return { list: [d], d, cluster: false, at: this.M.L.TILE[h.id]?.f.name ?? h.id }; }
    const sim = this.M.sim, S = this.S;
    const ds = this.roomDecs()[h.i].slice().sort((a, b) => Number(sim.emph(b, S.who, S.view)) - Number(sim.emph(a, S.who, S.view)) || sim.queueCmp(a, b));
    return { list: ds, d: ds[0], cluster: true, at: h.id };
  }
  /** The question pin (a tile's, or a room's cluster) drawn under the pointer. */
  pinAt(px: number, py: number): { list: SimDecision[]; d: SimDecision; cluster: boolean; at: string } | null {
    const h = this.hitUnder(px, py, PIN_KINDS); return h ? this.pinOf(h) : null;
  }
  /** The answer track under the pointer: a tile's glyph, or its label where one is drawn (tile levels only). */
  trackAt(px: number, py: number): string | null { return this.hitUnder(px, py, TRACK_KINDS)?.id ?? null; }
  /** The agent drawn under the pointer (an agent the "+N" chip stands for is not drawn, so not hit). */
  agentAt(px: number, py: number): SimAgent | null {
    const h = this.hitUnder(px, py, AGENT_KINDS); return h ? (h.ref as SimAgent) : null;
  }

  // ============================================================================ pointer input
  private local(e: { clientX: number; clientY: number }) { const r = this.cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * this.FW, y: ((e.clientY - r.top) / r.height) * this.FH }; }
  setHoverEl(el: HTMLElement | null) { this.hoverEl = el; }
  private hoverPt = { x: 0, y: 0 };
  private setHover(h: HoverInfo | null, px = 0, py = 0) {
    const cur = this.S.hover;
    const same = (!cur && !h) || (cur && h && cur.type === h.type && cur.id === h.id);
    this.hoverPt = { x: px, y: py };
    if (!same) this.set({ hover: h });
    this.cv.dataset.cursor = this.S.selMode ? 'sel' : !h ? '' : h.type === 'tile' || h.type === 'agent' || h.type === 'pin' || h.type === 'track' || h.type === 'scan' ? 'pt' : 'zin';
    this.placeHover();
  }
  /** Position the hover card next to its target (called on pointer move and after React renders it). */
  placeHover() {
    const el = this.hoverEl, h = this.S.hover; if (!el || !h) return;
    const u = this.U, w = 360 * u, hh = (el.offsetHeight || 140) * u, S = this.SAFE, R = this.FW - overlayRight(this.S) * u, px = this.hoverPt.x, py = this.hoverPt.y;
    let x: number, y: number;
    if (h.type === 'tile') {
      const r = this.featureRect(h.id) || { x: px, y: py, w: 0, h: 0 };
      x = r.x + r.w + 14; y = r.y - 6;
      if (x + w > R) x = r.x - w - 14;
      if (x < 6) { x = clamp(px + 18, 6, R - w - 6); y = r.y + r.h + 12; }
    } else { x = px + 22; y = py + 20; if (x + w > R) x = px - w - 22; }
    if (y + hh > S.b) y = S.b - hh; if (y < S.t) y = S.t; if (x < 6) x = 6;
    el.style.transform = `translate(${x / u}px, ${y / u}px)`;
  }
  private targetFromHit(h: ReturnType<Engine['hitAt']>): { ids: Record<string, 1>; label: string } | null {
    const t = this.hitTarget(h); if (!t) return null;
    const ids: Record<string, 1> = {};
    if (t.type === 'tile') { ids[t.id] = 1; return { ids, label: this.M.P.F[t.id].name }; }
    const o = this.placeById(t.type, t.id); if (!o) return null;
    for (const f of o.feats) ids[f.id] = 1;
    const label = t.type === 'wing' ? (o as WingNode).def.name + ' wing' : t.type === 'room' ? (o as RoomNode).name : t.type === 'bay' ? (o as BayNode).name : (o as BldNode).name;
    return { ids, label };
  }
  /**
   * A click on a flag: one feature opens in the flag's lens; a cluster of several flies to them so they
   * split (and, when the camera cannot get meaningfully closer, opens the first).
   */
  private flagClick(F: Flag) {
    const fids = [...new Set(F.fids)];
    if (fids.length > 1) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of fids) { const T = this.M.L.TILE[id]; if (!T) continue; x0 = Math.min(x0, T.x); y0 = Math.min(y0, T.y); x1 = Math.max(x1, T.x + T.w); y1 = Math.max(y1, T.y + T.h); }
      const c = this.fitCam({ x: x0 - 40, y: y0 - 60, w: x1 - x0 + 80, h: y1 - y0 + 100 }, { t: 60, r: 40, b: 60, l: 40 }, 1);
      if (c.k > this.cam.k * 1.15) { this.flagHot = null; this.cam.flyTo(c); return; }
    }
    this.flagHot = null;
    this.setView(F.lens);
    this.openFeature(F.fid);
  }
  private clickAt(px: number, py: number) {
    // the topmost drawn target first (hit order is draw order: render/hits.ts)
    const hu = this.hitUnder(px, py);
    if (hu?.kind === 'flag') { this.flagClick(hu.ref as Flag); return; }
    if (hu?.kind === 'pin' || hu?.kind === 'cluster') { this.openDecision(this.pinOf(hu).d.id); return; }
    if (hu?.kind === 'track') { this.openTrack(hu.id); return; }
    // a scan's chip: the Agents flyout opens on its job (Cancel at hand); the flyout overlays the plan, the camera stays
    if (hu?.kind === 'scan') { this.set({ dtab: 'swarm', tl: false, scanJob: hu.id }); return; }
    if (hu?.kind === 'more') { if (this.lod() > 0.5) this.openFeature(hu.id); else this.flyToFeature(hu.id, false); return; }
    const ag = hu?.kind === 'agent' ? (hu.ref as SimAgent) : null;
    if (ag) {
      const dq = ag.wait && this.M.sim.DEC[ag.wait]?.open ? this.M.sim.DEC[ag.wait] : null;
      if (dq) this.openDecision(dq.id); else if (ag.blk && ag.status === 'blocked' && this.M.P.F[ag.blk]) this.goToBlocker(ag.blk); else if (this.lod() > 0.5) this.openFeature(ag.f); else this.flyToFeature(ag.f, false);
      return;
    }
    const h = this.hitAt(px, py);
    if (!h) { if (this.S.open) this.closeFeature(); else if (this.S.dec) this.closeDecision(); return; }
    if (h.t === 'tile' && h.o.w * this.cam.k >= 96 * this.U && this.lod() > 0.5) { this.openFeature(h.o.id); return; }
    for (const c of h.chain) { const fk = this.fitOf(c); if (fk.k > this.cam.k * 1.12) { this.cam.flyTo(fk); return; } }
    if (h.t === 'tile') this.openFeature(h.o.id);
  }
  /**
   * A plain click. The second click of a double-click lands on the plan the first one is already flying to and would
   * step one level deeper (or open a feature): a click within the double-click window (500 ms, 8 px) of one that
   * navigated is dropped, so a double-click is exactly one step. A real second click elsewhere or later still works.
   */
  private navClick(px: number, py: number, at: number) {
    const n = this.lastNav;
    if (n && at - n.at < 500 && Math.hypot(px - n.x, py - n.y) <= 8) return;
    const S = this.S, k0 = this.cam.k, open0 = S.open, dec0 = S.dec, sel0 = S.sel;
    this.clickAt(px, py);
    const S1 = this.S;
    if (this.cam.flying || this.cam.k !== k0 || S1.open !== open0 || S1.dec !== dec0 || S1.sel !== sel0) {
      this.lastNav = { x: px, y: py, at };
      if (this.cam.flying && S1.hover) this.setHover(null);
    }
  }
  private lastNav: { x: number; y: number; at: number } | null = null;
  /** What the pointer rests on: flag, pin, agent or place; sets the hover card and cursor. */
  private hoverAt(px: number, py: number) {
    const hu = this.hitUnder(px, py), fl = hu?.kind === 'flag' ? (hu.ref as Flag) : null, fk = fl ? flagKey(fl) : null;
    if (fk !== this.flagHot) { this.flagHot = fk; this.dirty(); }
    if (fl) { this.setHover(new Set(fl.fids).size === 1 ? { type: 'tile', id: fl.fid } : null, px, py); this.cv.dataset.cursor = 'pt'; return; }
    if (hu?.kind === 'pin' || hu?.kind === 'cluster') { const pn = this.pinOf(hu); this.setHover({ type: 'pin', id: pn.d.id, ids: pn.cluster ? pn.list.map((d) => d.id) : undefined }, px, py); return; }
    if (hu?.kind === 'track') { this.setHover({ type: 'track', id: hu.id }, px, py); return; }
    if (hu?.kind === 'scan') { this.setHover({ type: 'scan', id: hu.id }, px, py); return; }
    if (hu?.kind === 'more') { this.setHover({ type: 'tile', id: hu.id }, px, py); return; }
    if (hu?.kind === 'agent') { this.setHover({ type: 'agent', id: hu.id }, px, py); return; }
    this.setHover(this.hitTarget(this.hitAt(px, py)), px, py);
  }
  /** Last mouse / pen position over the canvas (null once it left); the hover is re-tested there when the camera settles. */
  private ptr: { x: number; y: number } | null = null; private retest = false;
  private lassoSelect(l: { x0: number; y0: number; x1: number; y1: number }) {
    const x0 = Math.min(l.x0, l.x1), x1 = Math.max(l.x0, l.x1), y0 = Math.min(l.y0, l.y1), y1 = Math.max(l.y0, l.y1), lod = this.lod(), v = this.view;
    const ids: Record<string, 1> = {}; let n = 0;
    for (const T of this.M.L.tiles) {
      const r = featRect(this, v, T.id, lod); if (!r) continue;
      const ox = Math.min(x1, r.x + r.w) - Math.max(x0, r.x), oy = Math.min(y1, r.y + r.h) - Math.max(y0, r.y);
      if (ox > 0 && oy > 0 && ox * oy >= 0.4 * r.w * r.h) { ids[T.id] = 1; n++; }
    }
    return { ids, n };
  }
  private bind() {
    const cv = this.cv;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, ev: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts); this.disposers.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(cv, 'pointerdown', (e: PointerEvent) => {
      if (this.S.page === 'ledger') return;
      if (this.S.menu) this.set({ menu: null }); // a click on the plan closes the scan menu (a right-click reopens it at the new point)
      if (e.button !== 0) return; // right / middle / pen barrel: the scan menu (contextmenu) or nothing, never a navigation
      this.endIntro();
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const p = this.local(e); this.ptrs.set(e.pointerId, p);
      if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.cam.k, wx: this.cam.wx((a.x + b.x) / 2), wy: this.cam.wy((a.y + b.y) / 2) }; this.drag = null; this.lasso = null; return; }
      this.drag = { x0: p.x, y0: p.y, cx: this.cam.x, cy: this.cam.y, moved: false, lasso: e.shiftKey || this.S.selMode, shift: e.shiftKey };
    });
    on(cv, 'pointermove', (e: PointerEvent) => {
      // coalesced events: only the latest position matters for pan; skip the rest
      const p = this.local(e);
      if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p);
      if (this.pinch) {
        if (this.ptrs.size < 2) return;
        const [a, b] = [...this.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        this.cam.pinchTo(this.pinch.wx, this.pinch.wy, (a.x + b.x) / 2, (a.y + b.y) / 2, (this.pinch.k * d) / this.pinch.d);
        return;
      }
      const dg = this.drag;
      if (dg) {
        const dx = p.x - dg.x0, dy = p.y - dg.y0;
        if (dg.moved || Math.hypot(dx, dy) > 5) {
          if (!dg.moved) { dg.moved = true; if (!dg.lasso) cv.dataset.cursor = 'pan'; this.setHover(null); }
          if (dg.lasso) { this.lasso = { x0: dg.x0, y0: dg.y0, x1: p.x, y1: p.y }; this.dirty(); }
          else this.cam.panBy(dx, dy, { x: dg.cx, y: dg.cy, k: this.cam.k });
        }
        return;
      }
      if (e.pointerType !== 'touch') this.ptr = p;
      this.hoverAt(p.x, p.y);
    });
    const end = (e: PointerEvent) => {
      const p = this.ptrs.get(e.pointerId); this.ptrs.delete(e.pointerId);
      if (this.pinch) {
        this.drag = null; this.lasso = null;
        if (this.ptrs.size < 2) {
          this.pinch = null;
          // one finger stays down: it carries on as a pan from where it is, and its lift is not a tap
          const r = this.ptrs.values().next().value;
          if (r) { this.drag = { x0: r.x, y0: r.y, cx: this.cam.x, cy: this.cam.y, moved: true, lasso: false, shift: false }; cv.dataset.cursor = 'pan'; }
        }
        return;
      }
      const dg = this.drag;
      if (dg && e.type === 'pointerup' && p) {
        if (dg.moved && dg.lasso && this.lasso) { const r = this.lassoSelect(this.lasso); this.lasso = null; if (r.n) this.setTarget(r.ids, r.n + ' features in the box'); }
        else if (!dg.moved) {
          if (dg.shift || this.S.selMode) {
            const tg = this.targetFromHit(this.hitAt(p.x, p.y));
            if (tg) {
              if (dg.shift && this.S.tgt.n) { const ids = { ...this.S.tgt.ids, ...tg.ids }; this.setTarget(ids, Object.keys(ids).length + ' places'); }
              else this.setTarget(tg.ids, tg.label);
            }
          } else this.navClick(p.x, p.y, e.timeStamp);
        }
      }
      this.lasso = null; this.drag = null; if (cv.dataset.cursor === 'pan') cv.dataset.cursor = ''; this.lastCamMove = performance.now(); this.dirty();
    };
    on(cv, 'pointerup', end); on(cv, 'pointercancel', end);
    on(cv, 'pointerleave', () => { this.ptr = null; if (!this.drag) this.setHover(null); });
    on(cv, 'wheel', (e: WheelEvent) => {
      e.preventDefault(); this.endIntro();
      if (this.S.open || this.S.page === 'ledger') return; // the feature page holds the wheel; the plan behind it stays put
      if (this.S.menu) this.set({ menu: null });
      if (this.S.hover) this.setHover(null);
      const p = this.local(e), wi = this.wheelI;
      wi.classify(e.deltaX, e.deltaY, e.deltaMode, e.ctrlKey, e.shiftKey, (e as unknown as { wheelDeltaY?: number }).wheelDeltaY || 0, performance.now(), this.FW, this.FH);
      if (wi.kind === 'pan') this.cam.panPx(wi.dx, wi.dy); else this.cam.zoomAt(p.x, p.y, wi.zoom);
    }, { passive: false });
    on(cv, 'dblclick', (e: MouseEvent) => e.preventDefault());
    // right-click: the scan menu for what is under the pointer (src/components/ScanMenu.tsx); never the browser's own
    on(cv, 'contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const S = this.S;
      if (S.open || S.page === 'ledger' || S.phone) return;
      this.endIntro();
      const p = this.local(e), h = this.hitAt(p.x, p.y);
      this.setHover(null);
      this.set({ menu: { x: p.x, y: p.y, chain: h ? h.chain.map((c) => ({ t: c.t, id: c.o.id })) : [], tile: h && h.t === 'tile' ? h.o.id : null } });
    });
    on(window, 'resize', () => { clearTimeout(this.resizeTimer); this.resizeTimer = window.setTimeout(() => this.fit(), 60); });
    // a DPR change without a resize (the window moved to another monitor, browser zoom via a shortcut): the query matches only the current ratio, so it re-arms on each change
    if (typeof matchMedia !== 'undefined') {
      let mq: MediaQueryList | null = null;
      const onDpr = () => { if (this.destroyed) return; arm(); this.fit(); };
      const arm = () => { mq?.removeEventListener('change', onDpr); mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); mq.addEventListener('change', onDpr); };
      arm(); this.disposers.push(() => { mq?.removeEventListener('change', onDpr); mq = null; });
    }
    on(document, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    // back / forward and a hash pasted into the tab: popstate for the one, hashchange for the other (restoreHash ignores the second of a pair)
    on(window, 'popstate', () => this.restoreHash()); on(window, 'hashchange', () => this.restoreHash());
    // theme changes: re-read tokens and re-raster
    const mo = new MutationObserver(() => { this.readTheme(); this.dirty(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.disposers.push(() => mo.disconnect());
    // reduced motion follows the OS/browser setting live, like the DOM chrome (useReducedMotion)
    if (typeof matchMedia !== 'undefined') {
      const rm = matchMedia('(prefers-reduced-motion: reduce)');
      const onRm = () => { this.cam.reduced = rm.matches; if (rm.matches && this.mix.moving) this.mix.to(this.S.view, true); };
      rm.addEventListener('change', onRm); this.disposers.push(() => rm.removeEventListener('change', onRm));
    }
    // the dashed "marching" styles only move while frames are drawn anyway
  }

  // ============================================================================ keyboard
  private onKey(e: KeyboardEvent) {
    if (this.introOn) { this.endIntro(); if (e.key !== '/' && e.key !== 'Escape') return; }
    const S = this.S, tgt = e.target as HTMLElement | null, tag = (tgt?.tagName || '').toLowerCase();
    if (S.phone) return;
    if (tag === 'input' || tag === 'textarea' || tgt?.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (tgt?.closest?.('[data-keys="own"]')) return;
    const k = e.key;
    // the findings ledger is a page over the plan: no plan key fires under it, wherever focus is (Esc only closes what overlays it)
    if (S.page === 'ledger') { if (k === 'Escape') { e.preventDefault(); this.goUp(); } return; }
    if (S.open && k.length === 1 && '/mMpPsStT\\'.includes(k)) return; // the feature page is modal: no flyout, timeline, mode or search opens under it (Esc and the lens digits still work)
    if (k === '/') { e.preventDefault(); this.focusSearch(); return; }
    if (k === 'Escape') { e.preventDefault(); this.goUp(); return; }
    if (NAV_KEYS.has(k) && (e.defaultPrevented || isControl(tgt) || tgt?.closest?.(OWN_ZONES))) return;
    const ctl = isControl(tgt); // Enter / Space on a focused control belong to that control
    if (S.morning) { if (k === 'Enter' && !ctl) { e.preventDefault(); this.set({ morning: false }); const l = this.M.sim.cardOrder(S.who, S.view); if (l.length) this.openDecision(l[0].id); } return; }
    if ((S.prev || S.lprev) && k === 'Enter' && !ctl) { e.preventDefault(); this.commitPreview(); return; }
    const dc = S.dec ? this.M.sim.DEC[S.dec] : null;
    if (dc && dc.open) {
      if (/^[1-9]$/.test(k) && +k <= dc.opts.length) { e.preventDefault(); this.decide(dc.id, +k - 1); return; }
      if (k === 'Enter' && !ctl) { e.preventDefault(); this.decide(dc.id, dc.rec); return; }
    }
    // 1 = General, 2.. = the enabled lenses in order (up to 9; the tab strip reaches the rest)
    if (/^[1-9]$/.test(k)) { const vs = views(this.M.P); if (+k <= vs.length) this.setView(vs[+k - 1]); return; }
    if (k === 'u' || k === 'U') { this.undoLast(); return; }
    if (k === 'j' || k === 'J') { this.stepDecision(1); return; }
    if (k === 'k' || k === 'K') { this.stepDecision(-1); return; }
    if (k === 'm' || k === 'M') { this.toggleMorning(); return; }
    if (k === 'p' || k === 'P') { this.setDockTab('view'); return; }
    if (k === 's' || k === 'S') { this.toggleSelMode(); return; }
    if (k === '\\') { this.toggleDock(); return; }
    if (k === ' ' && !ctl) { e.preventDefault(); this.togglePlay(); return; }
    if (k === ',') { this.stepSpeed(-1); return; }
    if (k === '.') { this.stepSpeed(1); return; }
    if (k === 't' || k === 'T') { this.setTimeline(); return; }
    if (S.open) { if (k === 'b' || k === 'B') this.toggleBlast(); return; } // the plan behind the feature page does not move
    if (k === 'ArrowRight') { e.preventDefault(); this.walk(1); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); this.walk(-1); return; }
    if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); this.zoomBy(k === 'ArrowUp' ? 1 : -1); return; }
    if (k === '+' || k === '=') { this.zoomBy(1); return; }
    if (k === '-' || k === '_') { this.zoomBy(-1); return; }
    if (k === '0' || k === 'Home') { this.goHome(); return; }
    if (k === 'Enter') {
      if (ctl) return;
      const T = this.nearestTile(), cx = (this.SAFE.l + this.SAFE.r) / 2, cy = (this.SAFE.t + this.SAFE.b) / 2;
      if (T && T.w * this.cam.k >= 96 * this.U && this.lod() > 0.5) this.openFeature(T.id); else this.clickAt(cx, cy);
      return;
    }
    if (k === 'b' || k === 'B') { this.toggleBlast(); return; }
    if ((k === 'g' || k === 'G') && this.hasGA) { this.toggleGA(); return; }
    if (k === '[') { this.stepWeek(-1); return; }
    if (k === ']') { this.stepWeek(1); return; }
  }

  // ============================================================================ DOM registrations
  setKeyplan(cv: HTMLCanvasElement | null) {
    this.keyplan = cv ? new KeyPlan(this, cv) : null;
    if (this.keyplan) { const c = this.S.compact; this.keyplan.W = c ? 132 : 162; this.keyplan.H = c ? 44 : 72; cv!.style.width = this.keyplan.W + 'px'; cv!.style.height = this.keyplan.H + 'px'; }
    this.dirty();
  }
  scaleText(): { text: string; bar: number } { return { text: 'SCALE 1:' + Math.round(100 / this.cam.k), bar: (160 * this.cam.k) / this.U }; }

  // ============================================================================ intro, hash, teardown
  private endIntro() { if (!this.introOn) return; this.introOn = false; this.introP = 1; this.store.set({ intro: false }); this.dirty(); }
  private hashTimer = 0; private hashLock = false; private pushTimer = 0;
  /** The place part of the current history entry (what the last write committed), the last hash this engine wrote or read, whether the next place change is explicit navigation, and the end of the restore window. */
  private hashPlace = ''; private hashSeen = ''; private navPush = false; private restoreUntil = 0; private adopt = false;
  /** Rest time at a new place before it earns a history entry (a fly-through pushes nothing). */
  private static readonly PUSH_MS = 600;
  /** `nav`: an explicit navigation (opening or closing a feature) pushes without waiting for the place to rest. */
  private writeHashSoon(nav = false) { if (nav) this.navPush = true; clearTimeout(this.hashTimer); this.hashTimer = window.setTimeout(() => this.writeHash(), 250); }
  private placeParam(): string {
    const S = this.S;
    return S.open ? 'open=' + S.open : this.place.length ? 'at=' + encodeURIComponent(this.place[this.place.length - 1].o.id) : '';
  }
  private hashOf(place: string): string {
    const S = this.S, p: string[] = [];
    if (S.view !== GENERAL) p.push('lens=' + S.view);
    if (place) p.push(place);
    if (!this.isNow) p.push('t=' + S.t);
    if (S.blast) p.push('blast=' + S.blast);
    if (S.ga) p.push('ga=1');
    if (S.delta !== 7) p.push('d=' + S.delta);
    if (S.who) p.push('who=' + S.who);
    if (S.page === 'ledger') { p.push('page=ledger'); if (S.lv !== 'triage') p.push('lv=' + S.lv); }
    return p.length ? '#' + p.join('&') : '';
  }
  /** Write the hash. Lens, time and toggles replace the current entry; a new place pushes one once it has rested (or at once when navigation was explicit). A restore (back / forward / pasted hash) and the first second after load only adopt. */
  private writeHash() {
    if (this.hashLock || this.destroyed) return;
    clearTimeout(this.pushTimer);
    if (this.cam.flying || performance.now() < this.restoreUntil) { this.writeHashSoon(); return; } // the camera is still arriving: the place is not known yet
    const place = this.placeParam(), nav = this.navPush; this.navPush = false;
    if (this.adopt) { this.adopt = false; this.commitHash(place, false); return; }
    if (place === this.hashPlace) { this.commitHash(place, false); return; }
    if (nav) { this.commitHash(place, true); return; }
    this.commitHash(this.hashPlace, false); // the entry keeps its place while the new one proves itself
    this.pushTimer = window.setTimeout(() => {
      if (this.destroyed || this.hashLock) return;
      const now = this.placeParam();
      if (now !== this.hashPlace) this.commitHash(now, true);
    }, Engine.PUSH_MS);
  }
  private commitHash(place: string, push: boolean) {
    const h = this.hashOf(place), url = location.pathname + location.search + h;
    this.hashPlace = place;
    try {
      if (push && h !== location.hash) history.pushState(history.state, '', url); else history.replaceState(history.state, '', url);
      this.hashSeen = location.hash;
    } catch { /* ignore */ }
  }
  private parseHash(): Record<string, string> {
    const h: Record<string, string> = {};
    // A mangled share link (truncated at a %-escape) skips that pair; the valid ones still apply.
    const dec = (s: string): string | null => { try { return decodeURIComponent(s); } catch { return null; } };
    location.hash.replace(/^#/, '').split('&').forEach((kv) => { const a = kv.split('='); const v = dec(a[1] || ''); if (a[0] && v !== null) h[a[0]] = v; });
    return h;
  }
  private placeOfHash(h: Record<string, string>): string {
    return h.open && this.M.P.F[h.open] ? 'open=' + h.open : h.at ? 'at=' + encodeURIComponent(h.at) : '';
  }
  private readHash() {
    const h = this.parseHash();
    // a deep link (?page=ledger&tab=release, deep-link.ts) says what the hash has not said, once: the query drops it and
    // the hash written next carries the page from here on
    const deep = deepLinkHash(location.search);
    if (deep.page && !h.page) { h.page = deep.page; if (deep.lv) h.lv = deep.lv; }
    const q = new URLSearchParams(location.search);
    if (DEEP_LINK_KEYS.some((k) => q.has(k))) {
      try { history.replaceState(history.state, '', location.pathname + withoutDeepLink(location.search) + location.hash); } catch { /* ignore */ }
    }
    this.hashSeen = location.hash; this.restoreUntil = performance.now() + 1000; this.adopt = true; this.hashPlace = this.placeOfHash(h);
    if (!Object.keys(h).length) return;
    this.hashLock = true;
    try {
    this.endIntro();
    if (h.lens && h.lens !== GENERAL && lensOf(this.M.P, h.lens)) { this.store.set({ view: h.lens }); this.mix.to(h.lens, true); }
    if (h.d && ['1', '7', '14'].includes(h.d)) this.store.set({ delta: +h.d as 1 | 7 | 14 });
    if (h.t && /^\d{4}-\d\d-\d\d$/.test(h.t)) this.setTime(h.t);
    if (h.who && this.M.P.P[h.who]) this.store.set({ who: h.who });
    if (h.ga === '1' && this.hasGA) this.store.set({ ga: true });
    if (h.blast && this.M.P.F[h.blast]) this.store.set({ blast: h.blast });
    if (h.page === 'ledger') { this.store.set({ page: 'ledger', lv: ledgerVariant(h.lv) }); this.lightSim(true); }
    if (h.at) {
      const t = this.placeById('bld', h.at) ? 'bld' : this.M.L.WING[h.at] ? 'wing' : this.M.L.ROOM[h.at] ? 'room' : this.M.L.BAY[h.at] ? 'bay' : null;
      if (t) this.cam.set(this.fitOf({ t: t as Crumb['t'], o: this.placeById(t, h.at)! }));
    }
    if (h.open && this.M.P.F[h.open]) this.openFeature(h.open);
    } finally { this.hashLock = false; }
  }
  /** Back / forward / a hash pasted into the same tab: bring lens, time, modes, place and the open feature to what the hash says (absent = the default). Writes are held until the camera arrives, then adopt. */
  private restoreHash() {
    if (this.destroyed || location.hash === this.hashSeen) return; // our own write, or popstate + hashchange for one move
    const h = this.parseHash();
    this.hashSeen = location.hash; this.restoreUntil = performance.now() + 400; this.adopt = true;
    clearTimeout(this.pushTimer); this.navPush = false; this.hashPlace = this.placeOfHash(h);
    this.hashLock = true;
    try {
      this.endIntro();
      const view = h.lens && lensOf(this.M.P, h.lens) ? h.lens : GENERAL;
      if (view !== this.S.view && isView(this.M.P, view)) this.setView(view);
      this.setDelta(h.d && ['1', '7', '14'].includes(h.d) ? (+h.d as 1 | 7 | 14) : 7);
      this.setTime(h.t && /^\d{4}-\d\d-\d\d$/.test(h.t) ? h.t : this.M.P.asOf);
      const who = h.who && this.M.P.P[h.who] ? h.who : null;
      if (who !== this.S.who) this.store.set({ who });
      const blast = h.blast && this.M.P.F[h.blast] ? h.blast : null, ga = h.ga === '1' && this.hasGA;
      const moded = !!(blast || ga);
      if (blast !== this.S.blast || ga !== this.S.ga) this.setMode({ blast, ga });
      if (h.page === 'ledger') this.setPage('ledger', ledgerVariant(h.lv)); else this.setPage('plan');
      if (h.open && this.M.P.F[h.open]) { if (this.S.open !== h.open) this.openFeature(h.open); return; }
      if (this.S.open) this.closeFeature(false);
      if (this.S.phone || moded) return; // a mode frames its own features
      const t = h.at ? (this.placeById('bld', h.at) ? 'bld' : this.M.L.WING[h.at] ? 'wing' : this.M.L.ROOM[h.at] ? 'room' : this.M.L.BAY[h.at] ? 'bay' : null) : null;
      if (t) this.cam.flyTo(this.fitOf({ t: t as Crumb['t'], o: this.placeById(t, h.at)! })); else this.goHome();
    } finally { this.hashLock = false; }
  }
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf); clearTimeout(this.settleTimer); this.settleArmed = false; clearTimeout(this.simSyncTimer); clearTimeout(this.hashTimer); clearTimeout(this.pushTimer); clearInterval(this.phoneTimer); clearTimeout(this.hlTimer); clearTimeout(this.resizeTimer);
    this.cam.stopFly(); this.mix.destroy(); this.M.sim.listen(null);
    for (const d of this.disposers) d();
    const w = window as unknown as { __bp?: Engine }; if (w.__bp === this) delete w.__bp;
  }
  /** Current mix weights (debug and tests). */
  get mixWeights() { return { ...this.mix.mix }; }
  get hourSec() { return HOUR; }
}
