'use client';
// The subtle legend: the six glyphs and their line types are the whole vocabulary, so the key shows
// them first (General: the fixed order of the strip; a lens: what its rail measures), then the shared
// legend underneath.
import { useEffect, useRef } from 'react';
import type { LensId, ViewId } from '@/lib/data';
import { readTheme } from '@/engine/theme';
import { Legend as BaseLegend } from '@/components/Legend';
import { useTheme } from '@/components/ThemeToggle';
import { ORDER, glyph, lineType, railRest } from './marks';

const NAME: Record<LensId, string> = { business: 'Business', design: 'Design', development: 'Development', operations: 'Operations', security: 'Security', quality: 'Quality' };
const RAIL: Record<LensId, [string, string]> = {
  business: ['Double rule', 'value to the business, 1 to 5'],
  design: ['Dotted line', 'how far design got, sketch to polished'],
  development: ['Comb', 'build progress; dots are open PRs'],
  operations: ['Chain line', 'rollout in production; × an incident, red bar no alerting'],
  security: ['Hatched band', 'how sensitive the data, public to card; ] reviewed'],
  quality: ['Dimension line', 'end-to-end tests passing; dots are bugs, red P1'],
};

function Swatch({ lens, w, h, measure }: { lens: LensId; w: number; h: number; measure: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mode = useTheme();
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d')!, th = readTheme(dpr).theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const gs = Math.min(h - 4, 12), cy = h / 2;
    glyph(ctx, lens, 1, cy - gs / 2, gs, th.inkA(0.9));
    const x0 = gs + 6, x1 = w - 2, rh = 5, len = (x1 - x0) * measure;
    railRest(ctx, th, x0 + len, x1, cy - rh / 2, rh);
    lineType(ctx, th, lens, x0, cy - rh / 2, len, rh, th.inkA(0.92), 1);
  }, [lens, w, h, measure, mode]);
  return <canvas ref={ref} style={{ width: w, height: h, flex: '0 0 auto' }} aria-hidden="true" />;
}

export function SubtleLegend({ view }: { view: ViewId }) {
  if (view === 'general') {
    return (
      <>
        <div className="sl-key">
          <p>Along each fixture&apos;s top edge, one mark per lens, always in this order. Its colour is that lens&apos;s health.</p>
          <div className="sl-grid">
            {ORDER.map((l) => <div key={l}><Swatch lens={l} w={48} h={16} measure={0.7} /><span>{NAME[l]}</span></div>)}
          </div>
        </div>
        <BaseLegend view={view} />
      </>
    );
  }
  const [line, what] = RAIL[view];
  return (
    <>
      <div className="sl-key">
        <div className="sl-one"><Swatch lens={view} w={92} h={18} measure={0.62} /><span><b>{line}</b> along the top edge: {what}.</span></div>
      </div>
      <BaseLegend view={view} />
    </>
  );
}
