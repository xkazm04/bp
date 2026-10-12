'use client';
// The blueprint for one variant. The first render (server and client) is an empty sheet; after mount
// it reads `?scale=` and `?product=`, builds the model, mounts the canvas engine and renders the chrome
// around it. No `?product` = Kettle, built in, exactly as before. `?product=<slug>` = a live product:
// its structure and scan come from `useLiveProduct`; the model is built once the structure and the
// first snapshot are in, and every later scan goes into the sim in place (`engine.feed`), so the
// engine and the layout are never rebuilt for a delta. A new structure builds a new model.
import { Component, memo, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Engine } from '@/engine/Engine';
import { EMPTY_SCAN, clampScale, type Model } from '@/lib/model';
import { applyScan, buildLiveModel, liveSwarm, refreshLiveModel } from '@/lib/model/live-feed';
import { decideProposal, useLiveProduct, type LiveProduct } from '@/lib/scan/client';
import { refreshProjects, useProductName } from '@/lib/scan/projects';
import { getVariant } from '@/variants/registry';
import type { VariantId } from '@/variants/types';
import { EngineCtx, LiveCtx, VariantCtx, shallowEqual, useBp, type LiveInfo } from './hooks';
import { Header } from './Header';
import { Dock } from './Dock';
import { BaseBar } from './BaseBar';
import { Callout, DecisionCard, HoverCard, Ladder, Morning, ScaleBar, SelBar, Ticker, Toast } from './Overlays';
import { FeatureSheet } from './FeatureSheet';
import { Phone } from './Phone';
import { ProjectSwitcher } from './ProjectSwitcher';
import './blueprint.css';

// The Kettle sample (~770 KB of map, events and swarm) is its own chunk, fetched only when the sample is shown.
// Nothing reachable from here imports it statically (@/lib/model/sample is the only door). Started at module load on
// a sample URL so the download overlaps hydration.
type BuildSample = typeof import('@/lib/model/sample').buildModel;
let sampleChunk: Promise<BuildSample> | null = null;
const loadSample = () => (sampleChunk ??= import('@/lib/model/sample').then((m) => m.buildModel));
if (typeof window !== 'undefined' && !new URLSearchParams(location.search).get('product')) loadSample().catch(() => { sampleChunk = null; });

// memo: the app re-renders on every scan delta (the live context); the chrome re-renders only where it reads it
const Chrome = memo(function Chrome() {
  const s = useBp((s) => ({ phone: s.phone }), shallowEqual);
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
      <Morning />
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

/** The standard empty state of a live product that cannot be drawn (unknown slug, no structure, an error), or that is still connecting. */
function LiveEmpty({ slug, live }: { slug: string; live: LiveProduct }) {
  if (live.status === 'loading' || (live.status === 'offline' && !live.structure)) {
    return <div className="bp-empty" role="status"><b>Connecting to {slug}…</b><span>Reading its structure and scan store.</span></div>;
  }
  const err = live.error ?? '';
  const store = /^no structure at (.+)[\\/]app-structure\.json$/.exec(err)?.[1];
  const head = store ? 'No scan store at ' + store : /^unknown product/.test(err) ? 'No product “' + slug + '” in bp.products.local.json' : 'Cannot open ' + slug;
  return (
    <div className="bp-empty" role="alert">
      <b>{head}</b>
      <span>{store ? 'Run /lens-scan in that repo (phase 1 writes the structure), then reload.' : err || 'The structure request failed.'}</span>
      <a href={typeof location !== 'undefined' ? location.pathname : '/'}>Open the Kettle sample instead</a>
    </div>
  );
}

export function BlueprintApp({ variantId }: { variantId: VariantId }) {
  const variant = getVariant(variantId)!;
  const root = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), ui = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  // a model or engine build that threw (a stale or malformed structure): shown through the same panel as a fetch error
  const [buildErr, setBuildErr] = useState<string | null>(null);
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
  useEffect(() => {
    if (product === undefined || (product && !settled)) return;
    let dead = false, built: Engine | null = null;
    const qs = new URLSearchParams(location.search), scale = clampScale(qs.get('scale')), now = () => performance.now();
    // ?lenses=-security,+com.kettle.cost switches lenses off or on for the session, on top of the map's `enabled`
    const L = liveRef.current;
    mapRev.current = L.structureRev ?? 0;
    setBuildErr(null);
    const mount = (model: Model) => {
      const e = new Engine({ canvas: cv.current!, ui: ui.current!, root: root.current!, model, expression: variant.expression, intro: qs.get('intro') !== '0' && !location.hash });
      built = e;
      setEngine(e);
      if (product && L.status === 'missing') e.toast('No scan store yet', 'every feature reads unmeasured until /lens-scan writes one');
    };
    const fail = (err: unknown) => { console.error(err); setBuildErr(err instanceof Error ? err.message : String(err)); };
    try {
      if (product) mount(buildLiveModel(L.structure, L.events, L.scan ?? EMPTY_SCAN, { slug: product, decide: (id, body) => decideProposal(product, id, body) }, scale, now, qs.get('lenses')));
      else void loadSample().then((build) => { if (!dead) mount(build(scale, now, qs.get('lenses'))); }).catch((err) => { sampleChunk = null; if (!dead) fail(err); });
    } catch (err) { fail(err); return; }
    return () => { dead = true; built?.destroy(); built = null; setEngine(null); };
    // not on `structure`: a newer map refreshes this model in place (below), never rebuilds it (the camera and the layout stay)
  }, [variant, product, settled]);
  // every later scan: its readings over the facets of the features it touched, then into the sim (the first one built the model)
  useEffect(() => {
    if (!engine?.M.live || !live.scan) return;
    applyScan(engine.M, live.scan);
    engine.feed(liveSwarm(engine.M.P, live.scan));
  }, [engine, live.scan]);
  // a newer map (the skill wrote its metrics back): the same features take the new fields in place; nothing moves
  useEffect(() => {
    const rev = live.structureRev ?? 0;
    if (!engine?.M.live || !live.structure || rev === mapRev.current) return;
    mapRev.current = rev;
    try {
      const r = refreshLiveModel(engine.M, live.structure, live.events, live.scan ?? EMPTY_SCAN, new URLSearchParams(location.search).get('lenses'));
      engine.feed(liveSwarm(engine.M.P, live.scan ?? EMPTY_SCAN));
      if (r.structural) engine.toast('The map has changed shape', 'features that moved or are new appear after a reload');
    } catch (err) {
      console.error(err);
      engine.toast('Could not read the updated map', 'the page keeps the one it has; ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [engine, live.structureRev, live.structure, live.events, live.scan]);
  const info = useMemo<LiveInfo | null>(() => (product ? { slug: product, product: live } : null), [product, live]);
  return (
    <div className="bp" ref={root} data-variant={variant.id} data-view="general">
      <div className="bp-paper" />
      <canvas ref={cv} className="bp-map" tabIndex={0} role="application"
        aria-label={'Zoomable floor plan of the product with the ' + (product ? 'live lens scan' : 'simulated agent swarm') + ' working over it. Scroll or pinch to zoom, drag to pan, click to go one level deeper. Plus and minus zoom, arrows walk rooms, Enter opens, Escape goes back. Shift-drag draws a selection.'} />
      <div className="bp-vig" />
      <div className="bp-frame" />
      {!engine && buildErr && <LiveEmpty slug={product || 'kettle'} live={{ ...live, status: 'error', error: buildErr }} />}
      {product && !engine && !buildErr && <LiveEmpty slug={product} live={live} />}
      {product === null && !engine && !buildErr && <div className="bp-empty" role="status"><b>Loading the Kettle sample…</b></div>}
      {product && !engine && <div className="bp-hdr-lite"><ProjectSwitcher current={product} /></div>}
      <div className="bp-ui" ref={ui}>
        {engine && (
          <EngineCtx.Provider value={engine}>
            <VariantCtx.Provider value={variant}>
              <LiveCtx.Provider value={info}>
                <ChromeBoundary><Chrome /></ChromeBoundary>
              </LiveCtx.Provider>
            </VariantCtx.Provider>
          </EngineCtx.Provider>
        )}
      </div>
      {engine && root.current && (
        <EngineCtx.Provider value={engine}>
          <VariantCtx.Provider value={variant}>
            <LiveCtx.Provider value={info}>
              <ChromeBoundary><RootFlags root={root.current} /></ChromeBoundary>
            </LiveCtx.Provider>
          </VariantCtx.Provider>
        </EngineCtx.Provider>
      )}
    </div>
  );
}
