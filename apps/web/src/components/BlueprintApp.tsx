'use client';
// The blueprint for one variant. The first render (server and client) is an empty sheet; after mount
// it reads `?scale=` and `?product=`, builds the model, mounts the canvas engine and renders the chrome
// around it. No `?product` = Kettle, built in, exactly as before. `?product=<slug>` = a live product:
// its structure and scan come from `useLiveProduct`; the model is built once the structure and the
// first snapshot are in, and every later scan goes into the sim in place (`engine.feed`), so the
// engine and the layout are never rebuilt for a delta. A new structure builds a new model, and so does a
// change of the lens set alone (a temporary lens added, retired or deleted), in place: the camera stays.
// Scans: the jobs (live: the stream's; Kettle: the scan sim's) become the plan's scan views on every discrete
// change, and the Kettle sim's readings go over the model the way a live scan's do (LiveFacets).
import { Component, memo, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { Engine } from '@/engine/Engine';
import type { Cam } from '@/engine/camera';
import { EMPTY_SCAN, clampScale, type Model } from '@bp/core/model';
import { applyScan, buildLiveModel, lensesOnly, liveSwarm, refreshLiveModel } from '@bp/core/model/live-feed';
import { LiveFacets } from '@bp/core/model/live-health';
import type { ScanSim } from '@bp/core/model/scan-sim';
import { decideProposal, useLiveProduct, type LiveProduct } from '@/lib/scan/client';
import type { JobStatus, ScanJob } from '@bp/core/scan/jobs';
import type { Proposal, ScanSnapshot } from '@bp/core/scan/types';
import { holdsBuild } from '@bp/core/scan/admit';
import type { ScanCtx } from '@/lib/scan/actions';
import { scanViews } from '@/lib/scan/scan-views';
import { readTempLenses, subscribeTempLenses } from '@/lib/scan/temp-lens';
import { projectHref, refreshProjects, useProductName } from '@/lib/scan/projects';
import { getVariant, loadVariant } from '@/variants/registry';
import type { Variant, VariantId } from '@/variants/types';
import { EngineCtx, LiveCtx, ScanCtxCtx, VariantCtx, shallowEqual, useBp, type LiveInfo } from './hooks';
import { Header } from './Header';
import { CompanionHost } from './companion/CompanionHost';
import { CrossingHost } from './crossing/CrossingHost';
import { Dock } from './Dock';
import { BaseBar } from './BaseBar';
import { Callout, DecisionCard, HoverCard, Ladder, Morning, ScaleBar, SelBar, Ticker, Toast } from './Overlays';
import { FeatureSheet } from './FeatureSheet';
import { LedgerPageLazy, Phone } from './Phone';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ScanMenu } from './ScanMenu';
import { LensesButton, LensesPanel } from './ledger/lens/LensesPanel';
import { GENERAL } from '@bp/core/data/types';
import './blueprint.css';

// The Kettle sample (~770 KB of map, events and swarm) is its own chunk, fetched only when the sample is shown.
// Nothing reachable from here imports it statically (@/lib/model/sample is the only door). Started at module load on
// a sample URL so the download overlaps hydration.
type BuildSample = typeof import('@bp/core/model/sample').buildModel;
let sampleChunk: Promise<BuildSample> | null = null;
const loadSample = () => (sampleChunk ??= import('@bp/core/model/sample').then((m) => m.buildModel));
if (typeof window !== 'undefined' && !new URLSearchParams(location.search).get('product')) loadSample().catch(() => { sampleChunk = null; });

// memo: the app re-renders on every scan delta (the live context); the chrome re-renders only where it reads it.
// The findings ledger is a chunk of its own (Phone.tsx's LedgerPageLazy), mounted only while its page shows.
const Chrome = memo(function Chrome() {
  const s = useBp((s) => ({ phone: s.phone, ledger: s.page === 'ledger' }), shallowEqual);
  if (s.phone) return null;
  return (
    <>
      <Header />
      <Dock />
      <BaseBar />
      <Ladder />
      <ScaleBar />
      <Ticker />
      <SelBar />
      <Callout />
      <HoverCard />
      <DecisionCard />
      <Toast />
      <FeatureSheet />
      {s.ledger ? <LedgerPageLazy lensButton={<LensesButton />} lensPanel={<LensesPanel />} /> : null}
      <ScanMenu />
      <Morning />
      <CompanionHost />
      <CrossingHost />
    </>
  );
});

function RootFlags({ root }: { root: HTMLDivElement }) {
  const s = useBp((s) => ({ phone: s.phone, compact: s.compact, intro: s.intro }), shallowEqual);
  useEffect(() => {
    root.classList.toggle('bp-compact', s.compact);
    root.classList.toggle('bp-intro', s.intro);
    root.classList.toggle('bp-phone', s.phone);
  }, [root, s]);
  return s.phone ? <Phone /> : null;
}

/**
 * A render failure in the chrome (a malformed scan row, a lens manifest a panel cannot read) would
 * otherwise unmount the whole app, plan included, behind a page that names nothing. Here it is logged,
 * the plan stays, and the standard empty-state panel says what failed.
 */
class ChromeBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error('blueprint chrome failed', err, info.componentStack); }
  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    return (
      <div className="bp-empty" role="alert">
        <b>The blueprint chrome failed</b>
        <span>{err.message || String(err)}</span>
        <a href={typeof location !== 'undefined' ? location.pathname + location.search : '/'}>Reload</a>
      </div>
    );
  }
}

/** How long the Kettle sample's chunk may take before the loading panel stops promising it is about to arrive. */
const SAMPLE_SLOW_MS = 12000;

/** The Kettle sample's loading panel. A chunk that never settles is not an error (loadSample rejects only on failure), so
 *  after SAMPLE_SLOW_MS the panel adds what is being fetched and a Reload, and a hung load reads differently from a fresh one. */
function SampleLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), SAMPLE_SLOW_MS); return () => clearTimeout(t); }, []);
  return (
    <div className="bp-empty" role="status" data-slow={slow ? '' : undefined}>
      <b>Loading the Kettle sample…</b>
      {slow && <span>Still waiting on the sample (about 770 KB). The connection may be slow or stalled.</span>}
      {slow && <a href={typeof location !== 'undefined' ? location.pathname + location.search : '/'}>Reload</a>}
    </div>
  );
}

/** The standard empty state of a live product that cannot be drawn (unknown slug, no structure, an error), or that is still connecting. */
function LiveEmpty({ slug, live, kettle = false }: { slug: string; live: LiveProduct; kettle?: boolean }) {
  if (live.status === 'loading' || (live.status === 'offline' && !live.structure)) {
    return <div className="bp-empty" role="status"><b>Connecting to {slug}…</b><span>Reading its structure and scan store.</span></div>;
  }
  const err = live.error ?? '';
  const store = /^no structure at (.+)[\\/]app-structure\.json$/.exec(err)?.[1];
  const head = kettle ? 'The Kettle sample failed to build' : store ? 'No scan store at ' + store : /^unknown product/.test(err) ? 'No product “' + slug + '” in bp.products.local.json' : 'Cannot open ' + slug;
  return (
    <div className="bp-empty" role="alert">
      <b>{head}</b>
      <span>{store ? 'Run /lens-scan in that repo (phase 1 writes the structure), then reload.' : err || 'The structure request failed.'}</span>
      {/* projectHref keeps the route and every other parameter (?theme, ?scale, ?lenses, ?intro) and drops only ?product */}
      {kettle
        ? <a href={typeof location !== 'undefined' ? location.pathname + location.search : '/'}>Reload</a>
        : <a href={typeof location !== 'undefined' ? projectHref(null) : '/'}>Open the Kettle sample instead</a>}
    </div>
  );
}

/** Toast a job that failed since it was last seen (or failed within 15 s of being queued here); the first pass only learns the statuses. */
function toastFailures(E: Engine, jobs: readonly ScanJob[], seen: { init: boolean; st: Map<string, JobStatus> }) {
  const now = Date.now();
  for (const j of jobs) {
    const was = seen.st.get(j.id);
    if (seen.init && j.status === 'failed' && (was ? was !== 'failed' : now - Date.parse(j.queued_at) < 15000)) {
      E.toast(j.kind === 'measure' ? 'Scan failed' : j.kind === 'release' ? 'Release ' + (j.version ?? '') + ' failed' : j.kind === 'prepare' ? 'Repo preparation failed' : 'Execute run failed', (j.lens ? j.lens + ': ' : '') + (j.error ?? 'no reason given'), undefined, undefined, 'bad');
    }
    seen.st.set(j.id, j.status);
  }
  seen.init = true;
}
/** The plan's scan views for these jobs and rows; returns when the next lingering one expires (ms from now), or null. */
function pushViews(E: Engine, jobs: readonly ScanJob[], scan: ScanSnapshot | undefined, proposals: readonly Proposal[] = []): number | null {
  const now = Date.now(), { views, next } = scanViews(jobs, scan, E.M, (l) => E.lensAccent(l), now);
  E.setScans(views);
  E.setBusy(busyTiles(E.M, jobs, proposals));
  return next === Infinity ? null : Math.max(0, next - now) + 20;
}
/** The plan's tiles (every product line) whose findings were dispatched and are not built yet: in a queued or running execute job, or executing. */
function busyTiles(M: Model, jobs: readonly ScanJob[], proposals: readonly Proposal[]): string[] {
  const held = new Set<string>();
  for (const j of jobs) if (holdsBuild(j)) for (const id of j.proposals ?? []) held.add(id);
  const feats = new Set<string>();
  for (const p of proposals) if (p.status === 'executing' || held.has(p.id)) feats.add(p.feature);
  const out: string[] = [];
  for (const f of feats) for (const b of M.P.buildings.slice(0, M.P.scale)) if (M.L.TILE[f + (b?.sf ?? '')]) out.push(f + (b?.sf ?? ''));
  return out;
}
/** What the Kettle scan sim needs of the model: base slugs in layout order, the enabled lenses, the facet values now. */
function bindSim(sim: ScanSim, M: Model) {
  const P = M.P, base = new Map(P.base.features.map((f) => [f.id, f])), on = new Set(P.lenses.map((l) => l.id));
  const order = [...new Set(M.L.tiles.filter((T) => T.wing.bld.i === 0).map((T) => T.f.slug))];
  sim.bind({
    order,
    manifest: (l) => (on.has(l) ? P.LENS[l]?.manifest : undefined),
    value: (f, l, k) => { const v = base.get(f)?.lens[l]?.facet?.values?.[k]; return typeof v === 'number' ? v : undefined; },
    // every lens the model knows, enabled or not: the ids and looks a new Kettle lens may not repeat
    lenses: () => Object.values(P.LENS).map((d) => ({ id: d.id, version: d.manifest.version, source: d.source, enabled: d.i >= 0, manifest: d.manifest, ...(d.temporary ? { temporary: true as const } : {}) })),
  });
}

export function BlueprintApp({ variantId }: { variantId: VariantId }) {
  // subtle (the `/` expression) is in memory at once; a prototype (shaped, bold) is a chunk of its own, loaded here,
  // and the engine mounts once it is in (variants/registry.ts). data-variant reads the prop, so it never waits.
  const [fetched, setFetched] = useState<Variant | null>(null);
  const variant = getVariant(variantId) ?? (fetched?.id === variantId ? fetched : null);
  const root = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), ui = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  // a model or engine build that threw (a stale or malformed structure): shown through the same panel as a fetch error
  const [buildErr, setBuildErr] = useState<string | null>(null);
  useEffect(() => {
    if (variant) return;
    let dead = false;
    loadVariant(variantId).then((v) => { if (!dead) { if (v) setFetched(v); else setBuildErr('no variant named ' + variantId); } },
      (err) => { console.error(err); if (!dead) setBuildErr('could not load the ' + variantId + ' variant: ' + (err instanceof Error ? err.message : String(err))); });
    return () => { dead = true; };
  }, [variant, variantId]);
  // undefined until mounted (the server render cannot read the query); null = Kettle
  const [product, setProduct] = useState<string | null | undefined>(undefined);
  useEffect(() => { setProduct(new URLSearchParams(location.search).get('product') || null); }, []);
  // a live product's tab reads "<name> · blueprint" (the name from the registry, else the slug); Kettle keeps the page metadata
  // it follows the registry name, so a rename shows at once
  const title = useProductName(product || null, product || '');
  useEffect(() => { if (product) void refreshProjects(); }, [product]);
  useEffect(() => { if (product) document.title = title + ' · blueprint'; }, [product, title]);
  const live = useLiveProduct(product ?? null);
  const structure = product ? live.structure : undefined;
  // a live product is drawn once its structure is in and the stream has answered (or given up for now)
  const settled = !!structure && (!!live.scan || live.status !== 'loading');
  const liveRef = useRef(live); liveRef.current = live;
  // the map revision the model on screen was built (or last refreshed) from
  const mapRev = useRef(0);
  // a rebuild in place (the lens set changed): the camera and the Kettle scan sim carry over to the new engine
  const [rebuild, setRebuild] = useState(0);
  const rebuilding = useRef(false), carry = useRef<{ cam: Cam; sim?: ScanSim } | null>(null);
  const rebuildNow = () => { rebuilding.current = true; setRebuild((n) => n + 1); };
  // Kettle's temporary lenses live in this browser (src/lib/scan/temp-lens.ts): a change rebuilds the model with them
  useEffect(() => (product === null ? subscribeTempLenses(rebuildNow) : undefined), [product]);
  useEffect(() => {
    if (!variant || product === undefined || (product && !settled)) return;
    let dead = false, built: Engine | null = null;
    const qs = new URLSearchParams(location.search), scale = clampScale(qs.get('scale')), now = () => performance.now();
    // ?lenses=-security,+com.kettle.cost switches lenses off or on for the session, on top of the map's `enabled`
    const L = liveRef.current;
    mapRev.current = L.structureRev ?? 0;
    setBuildErr(null);
    const kept = carry.current; carry.current = null;
    const mount = (model: Model) => {
      // the Kettle sim's jobs, rows and findings outlive a rebuild: its readings go over the new model from scratch
      if (kept?.sim && model.scanSim && !model.live) { model.scanSim.dispose(); model.scanSim = kept.sim; }
      const e = new Engine({ canvas: cv.current!, ui: ui.current!, root: root.current!, model, expression: variant.expression, intro: !kept && qs.get('intro') !== '0' && !location.hash });
      if (kept) e.cam.set(kept.cam); // the hash restored lens, place and page; the camera stands exactly where it was
      built = e;
      setEngine(e);
      if (product && L.status === 'missing') e.toast('No scan store yet', 'every feature reads unmeasured until /lens-scan writes one', undefined, undefined, 'warn');
    };
    const fail = (err: unknown) => { console.error(err); setBuildErr(err instanceof Error ? err.message : String(err)); };
    try {
      if (product) mount(buildLiveModel(L.structure, L.events, L.scan ?? EMPTY_SCAN, { slug: product, decide: (id, body) => decideProposal(product, id, body), writes: () => liveRef.current.writes !== false }, scale, now, qs.get('lenses')));
      else void loadSample().then((build) => { if (!dead) mount(build(scale, now, qs.get('lenses'), readTempLenses())); }).catch((err) => { sampleChunk = null; if (!dead) fail(err); });
    } catch (err) { fail(err); return; }
    return () => {
      dead = true;
      if (built && rebuilding.current) carry.current = { cam: { x: built.cam.x, y: built.cam.y, k: built.cam.k }, sim: built.M.scanSim };
      else built?.M.scanSim?.dispose();
      rebuilding.current = false;
      built?.destroy(); built = null; setEngine(null);
    };
    // not on `structure`: a newer map refreshes this model in place (below), never rebuilds it (the camera and the layout stay);
    // `rebuild` moves when only the lens set changed (a temporary lens), which needs a new model on the same layout
  }, [variant, product, settled, rebuild]);
  // every later scan: its readings over the facets of the features it touched, then into the sim (the first one built the model)
  useEffect(() => {
    if (!engine?.M.live || !live.scan) return;
    applyScan(engine.M, live.scan);
    engine.feed(liveSwarm(engine.M.P, live.scan));
  }, [engine, live.scan]);
  // the answer tracks read the snapshot and the jobs (an execute job holding a proposal reads "building")
  useEffect(() => { if (engine?.M.live) engine.feedTracks(live.scan ?? EMPTY_SCAN, live.jobs); }, [engine, live.scan, live.jobs]);
  // a newer map (the skill wrote its metrics back): the same features take the new fields in place; nothing moves
  useEffect(() => {
    const rev = live.structureRev ?? 0;
    if (!engine?.M.live || !live.structure || rev === mapRev.current) return;
    mapRev.current = rev;
    try {
      const r = refreshLiveModel(engine.M, live.structure, live.events, live.scan ?? EMPTY_SCAN, new URLSearchParams(location.search).get('lenses'));
      engine.feed(liveSwarm(engine.M.P, live.scan ?? EMPTY_SCAN));
      if (r.structural && lensesOnly(r.why)) rebuildNow();
      else if (r.structural) engine.toast('The map has changed shape', 'features that moved or are new appear after a reload');
    } catch (err) {
      console.error(err);
      engine.toast('Could not read the updated map', 'the page keeps the one it has; ' + (err instanceof Error ? err.message : String(err)), undefined, undefined, 'bad');
    }
  }, [engine, live.structureRev, live.structure, live.events, live.scan]);
  // Kettle: the scan sim's rows go over the model like a live scan's (readings, and `na` where a temporary lens found
  // nothing), the plan's scan views follow its jobs, and a teardown puts the loader's cached features back
  const failSeen = useRef({ init: false, st: new Map<string, JobStatus>() });
  useEffect(() => {
    const M = engine?.M, sim = M?.scanSim;
    if (!engine || !M || M.live || !sim) return;
    bindSim(sim, M);
    const facets = (M.liveFacets ??= new LiveFacets(M.P, M.agg));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      const snap = sim.snapshot(), pairs: [string, string][] = [];
      for (const [lens, fs] of sim.noImpact()) for (const f of fs) pairs.push([f, lens]);
      if (facets.apply(snap).length + facets.setNa(pairs).length) M.sim.restamp(); // re-raster the fills, '?' and fades; the sheet re-reads
      toastFailures(engine, sim.jobs(), failSeen.current);
      clearTimeout(timer);
      const over = new Map(snap.proposals.map((p) => [p.id, p])), base = M.findings ?? [];
      const next = pushViews(engine, sim.jobs(), snap, [...base.map((p) => over.get(p.id) ?? p), ...snap.proposals.filter((p) => !base.some((b) => b.id === p.id))]);
      if (next !== null) timer = setTimeout(sync, next);
    };
    sync();
    const off = sim.subscribe(sync);
    return () => { off(); clearTimeout(timer); if (facets.restore().length) M.agg.clear(); };
  }, [engine]);
  // live: the stream's jobs and rows become the plan's scan views (a lingering finished one expires on a timer)
  const [scanTick, setScanTick] = useState(0);
  useEffect(() => {
    if (!engine?.M.live) return;
    toastFailures(engine, live.jobs, failSeen.current);
    const next = pushViews(engine, live.jobs, live.scan, live.scan?.proposals);
    if (next === null) return;
    const t = setTimeout(() => setScanTick((n) => n + 1), next);
    return () => clearTimeout(t);
  }, [engine, live.jobs, live.scan, scanTick]);
  const scanCtx = useMemo<ScanCtx>(() => ({ slug: product || null, sim: product ? null : engine?.M.scanSim ?? null }), [product, engine]);
  const info = useMemo<LiveInfo | null>(() => (product ? { slug: product, product: live } : null), [product, live]);
  return (
    <MotionConfig reducedMotion="user">
    <div className="bp" ref={root} data-variant={variantId} data-view={GENERAL}>
      <div className="bp-paper" />
      <canvas ref={cv} className="bp-map" tabIndex={0} role="application"
        aria-label={'Zoomable floor plan of the product with the ' + (product ? 'live lens scan' : 'simulated agent swarm') + ' working over it. Scroll or pinch to zoom, drag to pan, click to go one level deeper. Plus and minus zoom, arrows walk rooms, Enter opens, Escape goes back. Shift-drag draws a selection.'} />
      <div className="bp-vig" />
      <div className="bp-frame" />
      {!engine && buildErr && <LiveEmpty slug={product || 'kettle'} kettle={!product} live={{ ...live, status: 'error', error: buildErr }} />}
      {product && !engine && !buildErr && <LiveEmpty slug={product} live={live} />}
      {product === null && !engine && !buildErr && <SampleLoading />}
      {product && !engine && <div className="bp-hdr-lite"><ProjectSwitcher current={product} /></div>}
      <div className="bp-ui" ref={ui}>
        {engine && variant && (
          <EngineCtx.Provider value={engine}>
            <VariantCtx.Provider value={variant}>
              <LiveCtx.Provider value={info}>
                <ScanCtxCtx.Provider value={scanCtx}>
                  <ChromeBoundary><Chrome /></ChromeBoundary>
                </ScanCtxCtx.Provider>
              </LiveCtx.Provider>
            </VariantCtx.Provider>
          </EngineCtx.Provider>
        )}
      </div>
      {engine && variant && root.current && (
        <EngineCtx.Provider value={engine}>
          <VariantCtx.Provider value={variant}>
            <LiveCtx.Provider value={info}>
              <ScanCtxCtx.Provider value={scanCtx}>
                <ChromeBoundary><RootFlags root={root.current} /></ChromeBoundary>
              </ScanCtxCtx.Provider>
            </LiveCtx.Provider>
          </VariantCtx.Provider>
        </EngineCtx.Provider>
      )}
    </div>
    </MotionConfig>
  );
}
