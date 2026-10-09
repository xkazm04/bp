'use client';
// The subtle legend: the glyphs and their line types are the whole vocabulary, so the key shows them
// first (General: the registry order of the strip; a lens: what its rail measures), then the shared
// legend underneath. Everything here comes from the lens manifests.
import { useEffect, useRef } from 'react';
import type { LensDef, ViewId } from '@/lib/data';
import type { LineName } from '@/lib/standard/types';
import { lensOf } from '@/lib/model/lens';
import { readTheme } from '@/engine/theme';
import { Legend as BaseLegend } from '@/components/Legend';
import { useEngine } from '@/components/hooks';
import { useTheme } from '@/components/ThemeToggle';
import { glyph, lineType, railRest } from './marks';

const LINE_WORD: Record<LineName, string> = {
  solid: 'Solid rule', double: 'Double rule', dotted: 'Dotted line', comb: 'Comb', chain: 'Chain line', hatched: 'Hatched band', dimension: 'Dimension line',
};

function Swatch({ d, w, h, measure }: { d: LensDef; w: number; h: number; measure: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mode = useTheme();
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d')!, th = readTheme(dpr).theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const gs = Math.min(h - 4, 12), cy = h / 2;
    glyph(ctx, d.glyph, 1, cy - gs / 2, gs, th.inkA(0.9));
    const x0 = gs + 6, x1 = w - 2, rh = 5, len = (x1 - x0) * measure;
    railRest(ctx, th, x0 + len, x1, cy - rh / 2, rh);
    lineType(ctx, th, d.line, x0, cy - rh / 2, len, rh, th.inkA(0.92), 1);
  }, [d, w, h, measure, mode]);
  return <canvas ref={ref} style={{ width: w, height: h, flex: '0 0 auto' }} aria-hidden="true" />;
}

/** What a lens's rail measures, in words, from its manifest. */
function railWords(d: LensDef): string {
  const m = d.measures;
  let s = m ? m.label.toLowerCase() : 'nothing (no measured field)';
  if (m?.type === 'enum') s += ', ' + m.values[0] + ' to ' + m.values[m.values.length - 1];
  else if (m?.type === 'percent') s += ', 0 to 100%';
  else if (m && m.max !== undefined) s += ', up to ' + m.max;
  const count = d.density === 'simple' ? null : d.evidence.find((f) => f.type === 'integer' && f.min === 0 && f.max === undefined && !f.unit && !f.source && f !== m);
  if (count) s += '; dots count ' + count.label.toLowerCase();
  return s;
}

export function SubtleLegend({ view }: { view: ViewId }) {
  const E = useEngine(), P = E.M.P;
  const d = lensOf(P, view);
  if (!d) {
    return (
      <>
        <div className="sl-key">
          <p>Along each fixture&apos;s top edge, one mark per lens, always in this order. Its colour is that lens&apos;s health.</p>
          <div className="sl-grid">
            {P.lenses.map((l) => <div key={l.id}><Swatch d={l} w={48} h={16} measure={0.7} /><span>{l.name}</span></div>)}
          </div>
        </div>
        <BaseLegend view={view} />
      </>
    );
  }
  return (
    <>
      <div className="sl-key">
        <div className="sl-one"><Swatch d={d} w={92} h={18} measure={0.62} /><span><b>{LINE_WORD[d.line]}</b> along the top edge: {railWords(d)}.</span></div>
      </div>
      <BaseLegend view={view} />
    </>
  );
}
