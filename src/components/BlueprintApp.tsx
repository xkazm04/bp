'use client';
// The blueprint for one variant. The first render (server and client) is an empty sheet; after mount
// it reads `?scale=` and `?product=`, builds the model, mounts the canvas engine and renders the chrome
// around it. No `?product` = Kettle, built in, exactly as before. `?product=<slug>` = a live product:
// its structure and scan come from `useLiveProduct`; the model is built once the structure and the
// first snapshot are in, and every later scan goes into the sim in place (`engine.feed`), so the
// engine and the layout are never rebuilt for a delta. A new structure builds a new model.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Engine } from '@/engine/Engine';
import { EMPTY_SCAN, buildModel, clampScale } from '@/lib/model';
import { buildLiveModel, liveSwarm } from '@/lib/model/live-feed';
import { decideProposal, useLiveProduct, type LiveProduct } from '@/lib/scan/client';
import { getVariant } from '@/variants/registry';
import type { VariantId } from '@/variants/types';
import { EngineCtx, LiveCtx, VariantCtx, shallowEqual, useBp, type LiveInfo } from './hooks';
import { Header } from './Header';
import { Dock } from './Dock';
import { BaseBar } from './BaseBar';
import { Callout, DecisionCard, HoverCard, Ladder, Morning, ScaleBar, SelBar, Ticker, Toast } from './Overlays';
import { FeatureSheet } from './FeatureSheet';
import { Phone } from './Phone';
import './blueprint.css';

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
  const live = useLiveProduct(product ?? null);
  const structure = product ? live.structure : undefined;
  // a live product is drawn once its structure is in and the stream has answered (or given up for now)
  const settled = !!structure && (!!live.scan || live.status !== 'loading');
  const liveRef = useRef(live); liveRef.current = live;
  useEffect(() => {
    if (product === undefined || (product && !settled)) return;
    const qs = new URLSearchParams(location.search), scale = clampScale(qs.get('scale')), now = () => performance.now();
    // ?lenses=-security,+com.kettle.cost switches lenses off or on for the session, on top of the map's `enabled`
    const L = liveRef.current;
    setBuildErr(null);
    let e: Engine;
    try {
      const model = product
        ? buildLiveModel(structure, L.events, L.scan ?? EMPTY_SCAN, { slug: product, decide: (id, body) => decideProposal(product, id, body) }, scale, now, qs.get('lenses'))
        : buildModel(scale, now, qs.get('lenses'));
      e = new Engine({ canvas: cv.current!, ui: ui.current!, root: root.current!, model, expression: variant.expression, intro: qs.get('intro') !== '0' && !location.hash });
    } catch (err) {
      console.error(err);
      setBuildErr(err instanceof Error ? err.message : String(err));
      return;
    }
    setEngine(e);
    if (product && L.status === 'missing') e.toast('No scan store yet', 'every feature reads unmeasured until /lens-scan writes one');
    return () => { e.destroy(); setEngine(null); };
  }, [variant, product, structure, settled]);
  // every later scan: into the sim in place (the first one built the model)
  useEffect(() => {
    if (engine?.M.live && live.scan) engine.feed(liveSwarm(engine.M.P, live.scan));
  }, [engine, live.scan]);
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
      <div className="bp-ui" ref={ui}>
        {engine && (
          <EngineCtx.Provider value={engine}>
            <VariantCtx.Provider value={variant}>
              <LiveCtx.Provider value={info}>
                <Chrome />
              </LiveCtx.Provider>
            </VariantCtx.Provider>
          </EngineCtx.Provider>
        )}
      </div>
      {engine && root.current && (
        <EngineCtx.Provider value={engine}>
          <VariantCtx.Provider value={variant}>
            <LiveCtx.Provider value={info}>
              <RootFlags root={root.current} />
            </LiveCtx.Provider>
          </VariantCtx.Provider>
        </EngineCtx.Provider>
      )}
    </div>
  );
}
