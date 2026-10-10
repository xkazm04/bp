// The canvas engine. It owns the camera, the frame loop (draws only when dirty), level of detail,
// hit testing, the cached static layer and the dynamic layers, the lens mix and the simulation clock.
// React talks to it through the imperative methods below and reads discrete state from `store`.
import type { Feature, LensDef, Scalar, ViewId } from '@/lib/data';
import {
  BLAST_DEFAULT, GA_MILESTONE, HOUR, LINES, SPEEDS, AWAY_SINCE, inside, isView, lensOf, personLens, revAt, views, type Box, type BldNode, type BayNode, type Counts, type Model,
  type OrderTemplate, type PlaceNode, type Preview, type RoomNode, type SimDecision, type SimEvent, type Target, type TileNode, type WingNode,
} from '@/lib/model';
import { Camera, clamp, type Cam, type Pad, type Region } from './camera';
import type { ChannelAggregate, FeatureLive, LensChannel, LensExpression } from './lens/contract';
import { MixDriver, type MixState } from './lens/mix';
import { createStore, type Store } from './store';
import { baseHeight, overlayRight, railWidth } from './chrome';
import { initialState, type Crumb, type DockTab, type HoverInfo, type UIState } from './state';
import { readTheme, type Theme } from './theme';
import { Text } from './text';
import { StaticCache } from './render/static-cache';
import { buildWallPaths, drawBuildings, drawDecor, drawGrid, drawLabels, featRect } from './render/plan';
import {
  agentPos, drawAgents, drawBreaches, drawFocus, drawHeat, drawLasso, drawOrderZones, drawOverlays, drawPins, drawPreview,
  drawPulses, drawReleases, drawTargets, type APos,
} from './render/dynamic';
import { KeyPlan } from './render/keyplan';
import { loadArt } from './render/illo';
import { rs, smooth, type SRect, type View } from './render/view';

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
  blastSet: Set<string> | null = null;
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
  private themeV = 0; private fontsV = 0; private mixV = 0; private simStaticV = 0; private simStaticAt = 0; private simSeenV = -1; private simT10 = -1;
  private camSig = ''; private placeKey = ''; private hoverEl: HTMLElement | null = null;
  private place: Chain = [];
  private introOn = false; private introT0 = 0;
  private drag: { x0: number; y0: number; cx: number; cy: number; moved: boolean; lasso: boolean; shift: boolean } | null = null;
  private ptrs = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; k: number } | null = null;
  private simSyncTimer = 0; private lastTickerAt = 0; private pendingTicker: SimEvent | null = null;
  private toastN = 0;
  private aggLensCache = new Map<string, ChannelAggregate>();
  private statsCache = new Map<string, ReturnType<Model['sim']['stats']>>(); private statsKey = '';
  private roomDecCache: SimDecision[][] | null = null; private roomDecV = -1;
  private breachCache: Set<string> | null = null; private breachV = -1;
  private camListeners = new Set<() => void>();
  private simTimeListeners = new Set<(t: number) => void>();
  private lastSimSec = -1;
  private disposers: (() => void)[] = [];
  /** Frame-time probe for the perf report (window.__bpPerf). */
  perf = { frames: 0, rasters: 0, lastRasterMs: 0 };

  constructor(o: EngineOptions) {
    this.M = o.model; this.expr = o.expression; this.cv = o.canvas; this.ui = o.ui; this.root = o.root;
    this.ctx = this.cv.getContext('2d', { alpha: true })!;
    this.store = createStore(initialState(this.M.P.scale, this.M.P.asOf));
    this.cam = new Camera(() => this.camMoved());
    this.cam.world = this.M.L.world;
    this.cam.reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.tx = new Text('sans-serif', 'monospace');
    this.lensIds = this.M.P.lenses.map((l) => l.id);
    this.mix = new MixDriver(this.lensIds, 'general', () => { this.mixV++; this.mixS = this.mix.state; this.dirty(); }, this.expr.spring);
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
  lod(k = this.cam.k) { return smooth(1.2, 1.5, k / this.KB1); }
  levelNames(): string[] { return (this.M.P.scale > 1 ? ['Campus', 'Building'] : ['Site']).concat(['Wing', 'Room', 'Bay', 'Feature']); }
  placeById(t: string, id: string): PlaceNode | null {
    const L = this.M.L;
    if (t === 'bld') return L.blds.find((b) => b.id === id) || null;
    if (t === 'wing') return L.WING[id] || null;
    if (t === 'room') return L.ROOM[id] || null;
    if (t === 'bay') return L.BAY[id] || null;
    return null;
  }
  get view(): View { const c = this.cam; return { x: c.x, y: c.y, k: c.k, FW: this.FW, FH: this.FH, c0x: 0, c0y: 0, c1x: this.FW, c1y: this.FH }; }
  /** Screen rect (CSS px of the page) of a feature at the current zoom. */
  featureRect(fid: string): SRect | null { return featRect(this, this.view, fid, this.lod()); }
  wingName = (fid: string) => { const T = this.M.L.TILE[fid]; return T ? T.wing.def.name : '?'; };

  // ============================================================================ theme, layout
  private readTheme() {
    const h = readTheme(this.RES);
    this.th = h.theme; this.anchor = h.anchor;
    this.tx.setFamilies(this.th.sans, this.th.mono);
    this.art = loadArt(this.th.ink, () => { this.themeV++; this.dirty(); });
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
    this.root.style.setProperty('--lens', this.accentOf(v === 'general' ? null : v));
  }
  fit() {
    const w = window.innerWidth, h = window.innerHeight;
    // narrow, or a touch device held landscape (a short mouse window stays the desktop plan)
    const phone = w < 760 || (h < 480 && typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
    if (phone !== this.S.phone) this.store.set({ phone });
    if (phone) return;
    this.U = 1 + 0.5 * (clamp(Math.min(w / 1280, h / 800), 1, 2) - 1);
    this.tx.setU(this.U);
    const U = this.U, compact = h < 740;
    if (compact !== this.S.compact) this.store.set({ compact });
    this.ui.style.width = w / U + 'px'; this.ui.style.height = h / U + 'px'; this.ui.style.transform = U === 1 ? 'none' : `scale(${U})`;
    this.FW = w; this.FH = h; this.cam.FW = w; this.cam.FH = h;
    let r = Math.min(window.devicePixelRatio || 1, 2);
    if (w * h * r * r > 6.5e6) r = Math.sqrt(6.5e6 / (w * h));
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
  private camMoved() { this.lastCamMove = performance.now(); this.dirty(); }
  private staticKey(): string {
    const S = this.S;
    return [this.themeV, this.fontsV, this.U, this.FW, this.FH, this.SAFE.r, this.mixV, S.t, S.delta, S.blast, S.ga, S.key, S.who, S.view, this.simStaticV].join('|');
  }
  private frame = (now: number) => {
    this.raf = 0;
    if (this.destroyed || this.S.phone) return;
    const dt = this.lastT ? now - this.lastT : 16; this.lastT = now;
    const wheel = this.cam.stepWheel();
    if (wheel) this.lastCamMove = now;
    const sim = this.M.sim, S = this.S;
    if (this.introOn) { this.introP = clamp((now - this.introT0) / 1700, 0, 1); if (this.introP >= 1) this.endIntro(); }
    const live = sim.has && this.isNow && sim.playing && !this.introOn;
    if (live) sim.advance(dt);
    const gesture = wheel || this.cam.flying || !!this.drag?.moved || !!this.pinch;
    const animating = sim.has && this.isNow && sim.animating(now);
    // only the simulation is moving: draw at ~30 fps
    if (!gesture && !this.mix.moving && !this.introOn && (live || animating) && now - this.lastDraw < 30) { this.raf = requestAnimationFrame(this.frame); return; }
    this.lastDraw = now;
    this.dashT = (now / 40) % 1000;
    // throttle static changes driven by the simulation
    if (sim.version !== this.simSeenV || (live && Math.floor(sim.t / 15) !== this.simT10)) {
      if (!live || now - this.simStaticAt > 900) { this.simSeenV = sim.version; this.simT10 = Math.floor(sim.t / 15); this.simStaticV++; this.simStaticAt = now; }
    }
    this.draw(now, gesture);
    this.syncPlace();
    this.afterFrame(now);
    if (sim.pulses.length > 40 || (now | 0) % 50 === 0) sim.expire(now);
    if (gesture || this.mix.moving || this.introOn || live || animating) this.raf = requestAnimationFrame(this.frame);
  };
  private draw(now: number, gesture: boolean) {
    const ctx = this.ctx, c = this.cam, S = this.S;
    this.perf.frames++;
    ctx.setTransform(this.RES, 0, 0, this.RES, 0, 0);
    ctx.clearRect(0, 0, this.FW, this.FH);
    this.dimFn = S.ga ? (f) => f.milestone === GA_MILESTONE : S.key ? ((k: string) => (f: Feature) => { const h = f.lens[k]?.h; return h === 'bad' || h === 'watch'; })(S.key) : null;
    this.blastSet = S.blast ? new Set(this.M.closure.of(S.blast)) : null;
    // static layer: transform the cached raster during gestures, re-raster when it settles
    const key = this.staticKey();
    const st = this.cache.check(c, key, this.FW, this.FH);
    const settled = performance.now() - this.lastCamMove > 140;
    if (st === 'stale' || (st === 'transform' && settled && !gesture)) {
      this.cache.render(c, key, this.FW, this.FH, this.RES, (g, v) => {
        this.anchor(this.FW / 2 - v.x * v.k, this.FH / 2 - v.y * v.k);
        drawGrid(this, g, v); drawDecor(this, g, v); drawBuildings(this, g, v); drawLabels(this, g, v);
      });
      this.perf.rasters++; this.perf.lastRasterMs = this.cache.lastMs;
    } else if (st === 'transform' && !settled) {
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.dirty(), 160);
    } else if (st === 'transform') {
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.dirty(), 160);
    }
    const reveal = this.introOn ? (this.FW + 60) * this.introP : undefined;
    this.cache.draw(ctx, c, reveal);
    // dynamic layers at the live camera
    this.anchor(this.FW / 2 - c.x * c.k, this.FH / 2 - c.y * c.k);
    const v = this.view, lod = this.lod();
    drawOverlays(this, ctx, v, lod);
    if (this.introOn) return;
    drawOrderZones(this, ctx, v, lod); drawTargets(this, ctx, v, lod);
    drawHeat(this, ctx, v, lod, now);
    drawAgents(this, ctx, v, lod, now); drawPulses(this, ctx, v, lod, now);
    drawPins(this, ctx, v, lod, now); drawBreaches(this, ctx, v, lod, now);
    drawPreview(this, ctx, v, lod, now); drawFocus(this, ctx, v, lod, now); drawReleases(this, ctx, v, lod, now);
    drawLasso(this, ctx);
  }
  private afterFrame(now: number) {
    const c = this.cam, sig = c.x.toFixed(2) + ',' + c.y.toFixed(2) + ',' + c.k.toFixed(5) + ',' + this.FW + ',' + this.FH;
    const camChanged = sig !== this.camSig;
    this.camSig = sig;
    if (this.keyplan && (camChanged || now - this.kpAt > 1000)) {
      this.kpAt = now;
      this.keyplan.draw(this.themeV + '|' + this.S.t + '|' + this.S.delta + '|' + this.simStaticV, this.RES);
    }
    for (const fn of this.camListeners) fn();
    const sec = Math.floor(this.M.sim.t);
    if (sec !== this.lastSimSec) { this.lastSimSec = sec; for (const fn of this.simTimeListeners) fn(this.M.sim.t); }
  }
  private kpAt = 0;
  /** Subscribe to every drawn frame (positioned DOM like the decision card and scale bar). */
  onFrame(fn: () => void) { this.camListeners.add(fn); return () => { this.camListeners.delete(fn); }; }
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
  togglePlay() { if (!this.isNow) { this.setTime(this.M.P.asOf); return; } this.M.sim.togglePlay(); this.scheduleSimSync(true); this.dirty(); }
  setSpeed(n: number) { this.M.sim.setSpeed(n); this.scheduleSimSync(true); this.dirty(); }
  stepSpeed(dir: number) { const i = SPEEDS.indexOf(this.M.sim.speed as (typeof SPEEDS)[number]); this.setSpeed(SPEEDS[clamp(i + dir, 0, SPEEDS.length - 1)]); }
  restart() { this.M.sim.reset(); this.set({ tgt: { ids: {}, n: 0, label: '' }, prev: null, dec: null }); this.scheduleSimSync(true); }
  /** Expand or collapse the timeline panel (it overlays the plan; the safe area keeps the collapsed strip). */
  /** The timeline panel and a rail flyout never stand open together: opening one closes the other. */
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
  toast(strong: string, text: string, action?: 'undo' | 'undo2' | 'replay', fid?: string) { this.toastN++; this.store.set({ toast: { strong, text, action, fid, n: this.toastN } }); }
  dismissToast() { this.store.set({ toast: null }); }

  // ============================================================================ navigation
  goHome(dur?: number) { this.cam.flyTo(this.HOME, dur); }
  private fitOf(c: Chain[number]): Cam { return this.fitCam(c.o, PADS[c.t], OVER[c.t] ?? 1); }
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
    if (S.tl) { this.set({ tl: false }); return; }
    if (S.morning) { this.set({ morning: false }); return; }
    if (S.whoMenu) { this.set({ whoMenu: false }); return; }
    if (S.dtab) { this.set({ dtab: null }); return; }
    if (S.info) { this.set({ info: false }); return; }
    if (S.open) { this.closeFeature(); return; }
    if (S.dec) { this.closeDecision(); return; }
    if (S.prev) { this.set({ prev: null }); return; }
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
    if (this.S.open) this.closeFeature(false);
    this.set({ morning: false });
    this.cam.flyTo(this.fitCam({ x: T.x - 120, y: T.y - 90, w: T.w + 240, h: T.h + 180 }, { t: 40, r: 30, b: 60, l: 30 }, 1));
    if (highlight) { this.set({ hl: id }); window.setTimeout(() => { if (this.S.hl === id) this.set({ hl: null }); }, 2600); }
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
    this.set({ open: id, sel: null, hl: null, dec: null, hover: null, morning: false });
    if (this.S.phone) return;
    this.placeKey = ''; this.writeHashSoon();
  }
  /** Back to the plan: the page shrinks into the tile, so the camera does not move. */
  closeFeature(focus = true) {
    if (!this.S.open) return;
    this.set({ open: null });
    this.placeKey = ''; this.writeHashSoon();
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
      this.cam.flyTo(this.fitCam({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { t: 40, r: 370, b: 56, l: 30 }));
    }
    this.placeKey = ''; this.writeHashSoon();
  }
  toggleGA() { this.setMode({ ga: !this.S.ga, blast: null }); }
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
  setOrdHi(id: string | null) { if (this.S.ordHi !== id) this.set({ ordHi: id }); }
  /** Open a rail flyout; the open one again (or null) closes it. */
  setDockTab(t: DockTab | null) { const dtab = t === this.S.dtab ? null : t; this.set(dtab ? { dtab, tl: false } : { dtab }); }
  patch(p: Partial<UIState>) { this.set(p); }
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
  morningShow() {
    const ids: Record<string, 1> = {};
    for (const a of this.M.P.base.activity) if (a.at >= AWAY_SINCE && a.feature) for (let b = 0; b < this.M.P.scale; b++) ids[a.feature + (this.M.P.scale > 1 ? '-' + LINES[b][1] : '')] = 1;
    this.set({ morning: false });
    this.setTarget(ids, 'changed since 18:00');
    this.lookAtTarget();
  }

  // ============================================================================ decisions
  openDecision(id: string, noFly = false) {
    const sim = this.M.sim, d = sim.DEC[id]; if (!d || !d.open) return;
    if (this.S.open) this.closeFeature(false);
    d.isNew = false;
    this.set({ dec: id, hl: null, hover: null, morning: false });
    if (!noFly && !this.S.phone) {
      const T = this.M.L.TILE[d.f], R = { l: this.SAFE.l, t: this.SAFE.t, r: this.SAFE.r - 400 * this.U, b: this.SAFE.b };
      const c = this.fitCam({ x: T.x - 30, y: T.y - 30, w: T.w + 60, h: T.h + 60 }, { t: 60, r: 40, b: 60, l: 40 }, 1, R);
      c.k = clamp(Math.min(c.k, 1.25), this.cam.KMIN, this.cam.KMAX);
      const cx = (R.l + R.r) / 2, cy = (R.t + R.b) / 2, k = Math.max(c.k, Math.min(1.0, (160 * this.U) / T.w));
      this.cam.flyTo({ x: T.x + T.w / 2 - (cx - this.FW / 2) / k, y: T.y + T.h / 2 - (cy - this.FH / 2) / k, k });
    }
  }
  closeDecision() { this.set({ dec: null }); }
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
    sim.decide(id, oi);
    if (this.S.dec === id) this.store.set({ dec: null });
    this.scheduleSimSync(true); this.forceStatic();
    if (!live || !sim.live || !d || !open) return;
    const pid = d.base, body = { decision: oi === 0 ? 'approve' as const : 'decline' as const, ...(note ? { note } : {}) };
    live.decide(pid, body).then(
      () => sim.settle(pid, null, false),
      (e: Error & { status?: number }) => {
        if (this.destroyed) return;
        sim.settle(pid, e.status === 409 ? 'Already decided elsewhere' : 'Not saved: ' + e.message, e.status !== 409);
        this.scheduleSimSync(true); this.forceStatic();
      },
    );
  }
  undoDecision() { this.M.sim.undoDecision(); this.store.set({ toast: null }); this.scheduleSimSync(true); this.forceStatic(); }
  private forceStatic() { this.simSeenV = this.M.sim.version; this.simStaticV++; this.simStaticAt = performance.now(); this.dirty(); }

  // ============================================================================ targeting + steering
  setTarget(ids: Record<string, 1>, label: string) { this.set({ tgt: { ids, n: Object.keys(ids).length, label }, prev: null }); }
  clearTarget() { this.set({ tgt: { ids: {}, n: 0, label: '' }, prev: null, ordMenu: false }); }
  lookAtTarget() {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const id in this.S.tgt.ids) { const T = this.M.L.TILE[id]; if (!T) continue; x0 = Math.min(x0, T.x); y0 = Math.min(y0, T.y); x1 = Math.max(x1, T.x + T.w); y1 = Math.max(y1, T.y + T.h); }
    if (x1 > x0) this.cam.flyTo(this.fitCam({ x: x0 - 40, y: y0 - 40, w: x1 - x0 + 80, h: y1 - y0 + 80 }, { t: 40, r: 30, b: 60, l: 30 }, 1));
  }
  private needTarget() { this.toast('Point at a place first:', 'shift-click a wing, room or fixture, or shift-drag a box.'); }
  preview(kind: 'ga' | 'research' | 'push' | 'pause' | 'resume' | 'order', tpl?: OrderTemplate, fid?: string) {
    const sim = this.M.sim;
    let tgt: Target = this.S.tgt;
    if (fid) { tgt = { ids: { [fid]: 1 }, n: 1, label: this.M.P.F[fid].name }; this.store.set({ tgt }); }
    let p: Preview | null = null;
    if (kind === 'ga') { p = sim.previewGA(this.wingName); if (!p) this.toast('Nothing to pull:', 'no agent is on M3 or M4 work.'); }
    else if (kind === 'research') { p = sim.previewResearch(); if (!p) this.toast('The research crew is already paused.', ''); }
    else {
      if (!tgt.n) { this.needTarget(); return; }
      if (kind === 'push') { p = sim.previewPushHere(tgt, this.wingName); if (!p) this.toast('Nothing to move:', 'no free working agent, or the selection is already live.'); }
      else if (kind === 'pause' || kind === 'resume') { p = sim.previewPause(tgt, kind === 'resume'); if (!p) this.toast(kind === 'resume' ? 'No paused agent' : 'No agent is working', 'inside the selection.'); }
      else if (kind === 'order' && tpl) p = sim.previewOrder(tgt, tpl);
    }
    this.set({ prev: p, ordMenu: false });
  }
  commitPreview() { const p = this.S.prev; if (!p) return; this.M.sim.commit(p, this.S.who); this.set({ prev: null }); this.scheduleSimSync(true); this.forceStatic(); }
  cancelPreview() { this.set({ prev: null }); }
  undoCommand() { this.M.sim.undoCommand(); this.scheduleSimSync(true); this.forceStatic(); }

  // ============================================================================ places, crumbs, levels
  private visShare(o: Box): number {
    const c = this.cam, S = this.SAFE;
    const x0 = Math.max(S.l, c.sx(o.x)), x1 = Math.min(S.r, c.sx(o.x + o.w)), y0 = Math.max(S.t, c.sy(o.y)), y1 = Math.min(S.b, c.sy(o.y + o.h));
    return x1 <= x0 || y1 <= y0 ? 0 : (x1 - x0) * (y1 - y0);
  }
  private pickShare<T extends Box>(list: T[]): T | null { let best: T | null = null, bs = 0; for (const o of list) { const s = this.visShare(o); if (s > bs) { bs = s; best = o; } } return best; }
  private chainBest(): Chain {
    const out: Chain = [], B = this.pickShare(this.M.L.blds); if (!B) return out;
    if (this.M.P.scale > 1) out.push({ t: 'bld', o: B });
    const W = this.pickShare(B.wings); if (!W) return out; out.push({ t: 'wing', o: W });
    const R = this.pickShare(W.rooms); if (!R) return out; out.push({ t: 'room', o: R });
    const Bay = this.pickShare(R.bays); if (Bay) out.push({ t: 'bay', o: Bay });
    return out;
  }
  chainAt(wx: number, wy: number): Chain {
    const out: Chain = [];
    const B = this.M.L.blds.find((b) => inside(b, wx, wy)); if (!B) return out;
    if (this.M.P.scale > 1) out.push({ t: 'bld', o: B });
    const W = B.wings.find((w) => inside(w, wx, wy)); if (!W) return out; out.push({ t: 'wing', o: W });
    const R = W.rooms.find((r) => inside(r, wx, wy)); if (!R) return out; out.push({ t: 'room', o: R });
    const Bay = R.bays.find((b) => inside(b, wx, wy)); if (Bay) out.push({ t: 'bay', o: Bay });
    return out;
  }
  private entered(c: Chain[number]) { return this.cam.k >= this.fitOf(c).k * 0.86 && this.cam.k >= this.HOME.k * 1.18; }
  private computePlace(): Chain {
    if (this.S.open && this.M.L.TILE[this.S.open]) { const T = this.M.L.TILE[this.S.open]; return this.chainAt(T.x + T.w / 2, T.y + T.h / 2); }
    const ch = this.chainBest(); let deepest = -1;
    for (let i = 0; i < ch.length; i++) if (this.entered(ch[i])) deepest = i;
    return ch.slice(0, deepest + 1);
  }
  private syncPlace() {
    this.place = this.computePlace();
    const key = this.place.map((c) => c.o.id).join('>') + '|' + (this.S.open || '');
    if (key === this.placeKey) return;
    this.placeKey = key;
    const names = this.levelNames();
    this.store.set({ place: this.place.map((c) => ({ t: c.t, id: c.o.id })), level: this.S.open ? names.length - 1 : this.place.length });
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
  pinAt(px: number, py: number): { list: SimDecision[]; d: SimDecision; cluster: boolean; at: string } | null {
    const sim = this.M.sim; if (!sim.has || !this.isNow || this.S.open) return null;
    const lod = this.lod(), u = this.U, v = this.view, S = this.S;
    if (lod < 0.6) {
      const rd = this.roomDecs();
      for (let i = 0; i < rd.length; i++) {
        if (!rd[i].length) continue;
        const R = this.M.L.rooms[i], r = rs(v, R), bx = r.x + r.w - 18 * u, by = r.y + 32 * u;
        if (px >= bx - 15 * u && px <= bx + 16 * u && py >= by - 27 * u && py <= by + 4 * u) {
          const ds = rd[i].slice().sort((a, b) => Number(sim.emph(b, S.who, S.view)) - Number(sim.emph(a, S.who, S.view)) || sim.score(b) - sim.score(a));
          return { list: ds, d: ds[0], cluster: true, at: R.d.name };
        }
      }
    }
    if (lod > 0.4) {
      for (const fid in sim.DOF) {
        const dd = sim.DOF[fid], T = this.M.L.TILE[fid]; if (!T || !dd.length) continue;
        const rr = rs(v, T);
        for (let j = 0; j < dd.length; j++) {
          const qx = rr.x + rr.w - 12 * u - j * 18 * u, qy = rr.y + rr.h - 5 * u;
          if (px >= qx - 9 * u && px <= qx + 14 * u && py >= qy - 24 * u && py <= qy + 3 * u) return { list: [dd[j]], d: dd[j], cluster: false, at: T.f.name };
        }
      }
    }
    return null;
  }
  agentAt(px: number, py: number) {
    const sim = this.M.sim; if (!sim.has || !this.isNow || this.S.open) return null;
    const lod = this.lod(), now = performance.now(), u = this.U, v = this.view;
    let best = null as null | (typeof sim.agents)[number], bd = 1e9;
    const p: APos = { x: 0, y: 0, chip: false, r: { x: 0, y: 0, w: 0, h: 0 }, idx: 0, n: 1, moving: false, trail: null, ok: false };
    for (const A of sim.agents) {
      if (!agentPos(this, v, A, lod, now, p)) continue;
      if (p.chip && !p.moving) { if (px >= p.x - 13 * u && px <= p.x + 45 * u && py >= p.y - 10 * u && py <= p.y + 10 * u) { const d0 = Math.abs(px - p.x); if (d0 < bd) { bd = d0; best = A; } } continue; }
      const d = Math.hypot(px - p.x, py - p.y); if (d < 10 * u && d < bd) { bd = d; best = A; }
    }
    return best;
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
    this.cv.dataset.cursor = this.S.selMode ? 'sel' : !h ? '' : h.type === 'tile' || h.type === 'agent' || h.type === 'pin' ? 'pt' : 'zin';
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
    const label = t.type === 'wing' ? (o as WingNode).def.name + ' wing' : t.type === 'room' ? (o as RoomNode).d.name : t.type === 'bay' ? (o as BayNode).cap.name : (o as BldNode).name;
    return { ids, label };
  }
  private clickAt(px: number, py: number) {
    const pn = this.pinAt(px, py); if (pn) { this.openDecision(pn.d.id); return; }
    const ag = this.agentAt(px, py);
    if (ag) {
      const dq = ag.wait && this.M.sim.DEC[ag.wait]?.open ? this.M.sim.DEC[ag.wait] : null;
      if (dq) this.openDecision(dq.id); else if (this.lod() > 0.5) this.openFeature(ag.f); else this.flyToFeature(ag.f, false);
      return;
    }
    const h = this.hitAt(px, py);
    if (!h) { if (this.S.open) this.closeFeature(); else if (this.S.dec) this.closeDecision(); return; }
    if (h.t === 'tile' && h.o.w * this.cam.k >= 96 * this.U && this.lod() > 0.5) { this.openFeature(h.o.id); return; }
    for (const c of h.chain) { const fk = this.fitOf(c); if (fk.k > this.cam.k * 1.12) { this.cam.flyTo(fk); return; } }
    if (h.t === 'tile') this.openFeature(h.o.id);
  }
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
      this.endIntro();
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const p = this.local(e); this.ptrs.set(e.pointerId, p);
      if (this.ptrs.size === 2) { const [a, b] = [...this.ptrs.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.cam.k }; this.drag = null; return; }
      this.drag = { x0: p.x, y0: p.y, cx: this.cam.x, cy: this.cam.y, moved: false, lasso: e.shiftKey || this.S.selMode, shift: e.shiftKey };
    });
    on(cv, 'pointermove', (e: PointerEvent) => {
      // coalesced events: only the latest position matters for pan; skip the rest
      const p = this.local(e);
      if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p);
      if (this.pinch) {
        if (this.ptrs.size < 2) return;
        const [a, b] = [...this.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        this.cam.zoomTo((a.x + b.x) / 2, (a.y + b.y) / 2, (this.pinch.k * d) / this.pinch.d);
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
      const pn = this.pinAt(p.x, p.y);
      if (pn) { this.setHover({ type: 'pin', id: pn.d.id, ids: pn.cluster ? pn.list.map((d) => d.id) : undefined }, p.x, p.y); return; }
      const ag = this.agentAt(p.x, p.y);
      if (ag) { this.setHover({ type: 'agent', id: ag.id }, p.x, p.y); return; }
      this.setHover(this.hitTarget(this.hitAt(p.x, p.y)), p.x, p.y);
    });
    const end = (e: PointerEvent) => {
      const p = this.ptrs.get(e.pointerId); this.ptrs.delete(e.pointerId);
      if (this.pinch) { if (this.ptrs.size < 2) this.pinch = null; this.drag = null; return; }
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
          } else this.clickAt(p.x, p.y);
        }
      }
      this.lasso = null; this.drag = null; if (cv.dataset.cursor === 'pan') cv.dataset.cursor = ''; this.lastCamMove = performance.now(); this.dirty();
    };
    on(cv, 'pointerup', end); on(cv, 'pointercancel', end);
    on(cv, 'pointerleave', () => { if (!this.drag) this.setHover(null); });
    on(cv, 'wheel', (e: WheelEvent) => {
      e.preventDefault(); this.endIntro();
      if (this.S.open) return; // the feature page holds the wheel; the plan behind it stays put
      if (this.S.hover) this.setHover(null);
      const p = this.local(e); let dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      if (e.ctrlKey) dy *= 2.5;
      this.cam.zoomAt(p.x, p.y, Math.exp(-dy * 0.0016));
    }, { passive: false });
    on(cv, 'dblclick', (e: MouseEvent) => e.preventDefault());
    let rt = 0;
    on(window, 'resize', () => { clearTimeout(rt); rt = window.setTimeout(() => this.fit(), 60); });
    on(document, 'keydown', (e: KeyboardEvent) => this.onKey(e));
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
    if (k === '/') { e.preventDefault(); this.focusSearch(); return; }
    if (k === 'Escape') { e.preventDefault(); this.goUp(); return; }
    if (S.morning) { if (k === 'Enter') { e.preventDefault(); this.set({ morning: false }); const l = this.M.sim.cardOrder(S.who, S.view); if (l.length) this.openDecision(l[0].id); } return; }
    if (S.prev && k === 'Enter') { e.preventDefault(); this.commitPreview(); return; }
    const dc = S.dec ? this.M.sim.DEC[S.dec] : null;
    if (dc && dc.open) {
      if (/^[1-9]$/.test(k) && +k <= dc.opts.length) { e.preventDefault(); this.decide(dc.id, +k - 1); return; }
      if (k === 'Enter' && tag !== 'button') { e.preventDefault(); this.decide(dc.id, dc.rec); return; }
    }
    // 1 = General, 2.. = the enabled lenses in order (up to 9; the tab strip reaches the rest)
    if (/^[1-9]$/.test(k)) { const vs = views(this.M.P); if (+k <= vs.length) this.setView(vs[+k - 1]); return; }
    if (k === 'j' || k === 'J') { this.stepDecision(1); return; }
    if (k === 'k' || k === 'K') { this.stepDecision(-1); return; }
    if (k === 'm' || k === 'M') { this.toggleMorning(); return; }
    if (k === 'p' || k === 'P') { this.setDockTab('view'); return; }
    if (k === 's' || k === 'S') { this.toggleSelMode(); return; }
    if (k === '\\') { this.toggleDock(); return; }
    if (k === ' ' && tag !== 'button') { e.preventDefault(); this.togglePlay(); return; }
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
      if (tag === 'button' || tag === 'a') return;
      const T = this.nearestTile(), cx = (this.SAFE.l + this.SAFE.r) / 2, cy = (this.SAFE.t + this.SAFE.b) / 2;
      if (T && T.w * this.cam.k >= 96 * this.U && this.lod() > 0.5) this.openFeature(T.id); else this.clickAt(cx, cy);
      return;
    }
    if (k === 'b' || k === 'B') { this.toggleBlast(); return; }
    if (k === 'g' || k === 'G') { this.toggleGA(); return; }
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
  private hashTimer = 0; private hashLock = false;
  private writeHashSoon() { clearTimeout(this.hashTimer); this.hashTimer = window.setTimeout(() => this.writeHash(), 250); }
  private writeHash() {
    if (this.hashLock || this.destroyed) return;
    const S = this.S, p: string[] = [];
    if (S.view !== 'general') p.push('lens=' + S.view);
    if (S.open) p.push('open=' + S.open); else if (this.place.length) p.push('at=' + encodeURIComponent(this.place[this.place.length - 1].o.id));
    if (!this.isNow) p.push('t=' + S.t);
    if (S.blast) p.push('blast=' + S.blast);
    if (S.ga) p.push('ga=1');
    if (S.delta !== 7) p.push('d=' + S.delta);
    if (S.who) p.push('who=' + S.who);
    const h = p.length ? '#' + p.join('&') : '';
    try { history.replaceState(history.state, '', location.pathname + location.search + h); } catch { /* ignore */ }
  }
  private readHash() {
    const h: Record<string, string> = {};
    // A mangled share link (truncated at a %-escape) skips that pair; the valid ones still apply.
    const dec = (s: string): string | null => { try { return decodeURIComponent(s); } catch { return null; } };
    location.hash.replace(/^#/, '').split('&').forEach((kv) => { const a = kv.split('='); const v = dec(a[1] || ''); if (a[0] && v !== null) h[a[0]] = v; });
    if (!Object.keys(h).length) return;
    this.hashLock = true;
    try {
    this.endIntro();
    if (h.lens && h.lens !== 'general' && lensOf(this.M.P, h.lens)) { this.store.set({ view: h.lens }); this.mix.to(h.lens, true); }
    if (h.d && ['1', '7', '14'].includes(h.d)) this.store.set({ delta: +h.d as 1 | 7 | 14 });
    if (h.t && /^\d{4}-\d\d-\d\d$/.test(h.t)) this.setTime(h.t);
    if (h.who && this.M.P.P[h.who]) this.store.set({ who: h.who });
    if (h.ga === '1') this.store.set({ ga: true });
    if (h.blast && this.M.P.F[h.blast]) this.store.set({ blast: h.blast });
    if (h.at) {
      const t = this.placeById('bld', h.at) ? 'bld' : this.M.L.WING[h.at] ? 'wing' : this.M.L.ROOM[h.at] ? 'room' : this.M.L.BAY[h.at] ? 'bay' : null;
      if (t) this.cam.set(this.fitOf({ t: t as Crumb['t'], o: this.placeById(t, h.at)! }));
    }
    if (h.open && this.M.P.F[h.open]) this.openFeature(h.open);
    } finally { this.hashLock = false; }
  }
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf); clearTimeout(this.settleTimer); clearTimeout(this.simSyncTimer); clearTimeout(this.hashTimer);
    this.cam.stopFly(); this.mix.destroy(); this.M.sim.listen(null);
    for (const d of this.disposers) d();
    const w = window as unknown as { __bp?: Engine }; if (w.__bp === this) delete w.__bp;
  }
  /** Current mix weights (debug and tests). */
  get mixWeights() { return { ...this.mix.mix }; }
  get hourSec() { return HOUR; }
}
