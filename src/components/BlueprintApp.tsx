'use client';
// The blueprint for one variant. The first render (server and client) is an empty sheet; after mount
// it reads `?scale=`, builds the model, mounts the canvas engine and renders the chrome around it.
import { useEffect, useRef, useState } from 'react';
import { Engine } from '@/engine/Engine';
import { buildModel, clampScale } from '@/lib/model';
import { getVariant } from '@/variants/registry';
import type { VariantId } from '@/variants/types';
import { EngineCtx, VariantCtx, shallowEqual, useBp } from './hooks';
import { Header } from './Header';
import { Dock } from './Dock';
import { BaseBar } from './BaseBar';
import { Callout, DecisionCard, HoverCard, Ladder, Morning, ScaleBar, SelBar, Ticker, Toast } from './Overlays';
import { FeatureSheet } from './FeatureSheet';
import { Phone } from './Phone';
import './blueprint.css';

function Chrome() {
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
}

function RootFlags({ root }: { root: HTMLDivElement }) {
  const s = useBp((s) => ({ phone: s.phone, compact: s.compact, intro: s.intro }), shallowEqual);
  useEffect(() => {
    root.classList.toggle('bp-compact', s.compact);
    root.classList.toggle('bp-intro', s.intro);
    root.classList.toggle('bp-phone', s.phone);
  }, [root, s]);
  return s.phone ? <Phone /> : null;
}

export function BlueprintApp({ variantId }: { variantId: VariantId }) {
  const variant = getVariant(variantId)!;
  const root = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), ui = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    // ?lenses=-security,+com.kettle.cost switches lenses off or on for the session, on top of the map's `enabled`
    const model = buildModel(clampScale(qs.get('scale')), () => performance.now(), qs.get('lenses'));
    const e = new Engine({ canvas: cv.current!, ui: ui.current!, root: root.current!, model, expression: variant.expression, intro: qs.get('intro') !== '0' && !location.hash });
    setEngine(e);
    return () => { e.destroy(); setEngine(null); };
  }, [variant]);
  return (
    <div className="bp" ref={root} data-variant={variant.id} data-view="general">
      <div className="bp-paper" />
      <canvas ref={cv} className="bp-map" tabIndex={0} role="application"
        aria-label="Zoomable floor plan of the product with the simulated agent swarm working over it. Scroll or pinch to zoom, drag to pan, click to go one level deeper. Plus and minus zoom, arrows walk rooms, Enter opens, Escape goes back. Shift-drag draws a selection." />
      <div className="bp-vig" />
      <div className="bp-frame" />
      <div className="bp-ui" ref={ui}>
        {engine && (
          <EngineCtx.Provider value={engine}>
            <VariantCtx.Provider value={variant}>
              <Chrome />
            </VariantCtx.Provider>
          </EngineCtx.Provider>
        )}
      </div>
      {engine && root.current && (
        <EngineCtx.Provider value={engine}>
          <VariantCtx.Provider value={variant}>
            <RootFlags root={root.current} />
          </VariantCtx.Provider>
        </EngineCtx.Provider>
      )}
    </div>
  );
}
