'use client';
// The subtle legend: the glyphs and their line types are the whole vocabulary, so the key shows them
// first (General: the registry order of the strip; a lens: what its fill measures, then the "?" of an
// unscanned feature and the fade of one the lens has nothing to say about), then the shared legend
// underneath. Everything here comes from the lens manifests; the swatches use the canvas's own fills.
import { useEffect, useMemo, useRef } from 'react';
import type { Feature, Health, LensDef, ViewId } from '@bp/core/data';
import type { LineName } from '@bp/core/standard/types';
import { lensOf } from '@bp/core/model/lens';
import { readTheme } from '@/engine/theme';
import { lineFill, unknownFill } from '@/engine/render/patterns';
import { Legend as BaseLegend } from '@/components/Legend';
import { useEngine } from '@/components/hooks';
import { useTheme } from '@/components/ThemeToggle';
import { countField } from './expression';
import { glyph, healthInk, lineType, railRest } from './marks';

const LINE_WORD: Record<LineName, string> = {
  solid: 'Solid rule', double: 'Double rule', dotted: 'Dotted line', comb: 'Comb', chain: 'Chain line', hatched: 'Hatched band', dimension: 'Dimension line', wave: 'Square wave',
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

/**
 * The health colours the strip glyphs are drawn in, in `healthInk`'s own order and words (marks.ts:9).
 * The General key says "its colour is that lens's health", so it has to show the colours it is naming:
 * 'na' is left out because `healthInk` draws it at inkA(0.38) against 'unmeasured' at inkA(0.3), which no
 * reader can tell apart at swatch size, so the one faint swatch speaks for both.
 */
const HEALTH_KEY: readonly { h: Health; word: string }[] = [
  { h: 'good', word: 'fine' }, { h: 'watch', word: 'watch' }, { h: 'bad', word: 'trouble' }, { h: 'unmeasured', word: 'n/a or not measured' },
];

/** One lens's glyph in one health's ink, drawn by the canvas's own `healthInk` (not a CSS copy of it). */
function HealthSwatch({ d, h }: { d: LensDef; h: Health }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mode = useTheme();
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), S = 14;
    cv.width = S * dpr; cv.height = S * dpr;
    const ctx = cv.getContext('2d')!, th = readTheme(dpr).theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, S, S);
    glyph(ctx, d.glyph, 1, 1, S - 2, healthInk(th, h, true));
  }, [d, h, mode]);
  return <canvas ref={ref} style={{ width: 14, height: 14, flex: '0 0 auto' }} aria-hidden="true" />;
}

type TileKind = 'fill' | 'unknown' | 'faded';
const TW = 46, TH = 28;
/** A small fixture drawn with the canvas's own fills: the lens fill at 62%, the "?" texture, or a faded tile. */
function TileSwatch({ d, kind }: { d: LensDef | null; kind: TileKind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const mode = useTheme();
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = TW * dpr; cv.height = TH * dpr;
    const ctx = cv.getContext('2d')!, th = readTheme(dpr).theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, TW, TH);
    ctx.globalAlpha = kind === 'faded' ? 0.35 : 1;
    ctx.fillStyle = th.tileBase; ctx.fillRect(1, 1, TW - 2, TH - 2);
    if (kind === 'unknown') unknownFill(ctx, th, 2, 2, TW - 4, TH - 4, 1, 1);
    else if (d) {
      glyph(ctx, d.glyph, 4, 3, 8, th.inkA(0.9));
      const fw = (TW - 6) * 0.62;
      lineFill(ctx, th, d.line, 3, 12, fw, TH - 15, 1, ctx.globalAlpha);
      ctx.fillStyle = th.inkA(0.55); ctx.fillRect(Math.round(3 + fw) - 1, 12, 1, TH - 15);
    }
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(1.5, 1.5, TW - 3, TH - 3);
  }, [d, kind, mode]);
  return <canvas ref={ref} style={{ width: TW, height: TH, flex: '0 0 auto' }} aria-hidden="true" />;
}

/** True when some feature has no measured lens among `ids`: General lays the "?" over it. */
function anyUnscanned(fs: readonly Feature[], ids: readonly string[]): boolean {
  return fs.some((f) => {
    let unknown = false;
    for (const l of ids) { const h = f.lens[l]?.h ?? 'unmeasured'; if (h === 'unmeasured') unknown = true; else if (h !== 'na') return false; }
    return unknown;
  });
}

/** What a lens's fill measures, in words, from its manifest. */
function fillWords(d: LensDef): string {
  const m = d.measures;
  let s = m ? m.label.toLowerCase() + ' progress' : 'nothing measured (no measured field)';
  if (m?.type === 'enum') s += ', ' + m.values[0] + ' to ' + m.values[m.values.length - 1];
  else if (m?.type === 'percent') s += ', 0 to 100%';
  else if (m && m.max !== undefined) s += ', up to ' + m.max;
  s += ': a ' + LINE_WORD[d.line].toLowerCase() + ' pattern from the left';
  const count = countField(d);
  if (count) s += '; dots on the top edge count ' + count.label.toLowerCase() + ' (more than 4 shows 3 dots and a +)';
  return s;
}

export function SubtleLegend({ view }: { view: ViewId }) {
  const E = useEngine(), P = E.M.P;
  const d = lensOf(P, view);
  const unscanned = useMemo(() => anyUnscanned(P.features, E.lensIds), [P, E]);
  if (!d) {
    return (
      <>
        <div className="sl-key">
          {P.lenses.length === 0
            ? <p>No lenses are enabled, so the fixtures carry no marks along their top edge. <code>?lenses=+business</code> (any lens id from the map) turns one back on for this session.</p>
            : <>
              <p>Along each fixture&apos;s top edge, one mark per lens, always in this order. Its colour is that lens&apos;s health:</p>
              <div className="sl-grid">
                {P.lenses.map((l) => <div key={l.id}><Swatch d={l} w={48} h={16} measure={0.7} /><span>{l.name}</span></div>)}
              </div>
            </>}
          {P.lenses.length > 0 && (
            <div className="sl-health">
              {HEALTH_KEY.map(({ h, word }) => <span key={h}><HealthSwatch d={P.lenses[0]} h={h} /><i>{word}</i></span>)}
            </div>
          )}
          {unscanned && <div className="sl-one"><TileSwatch d={null} kind="unknown" /><span><b>?</b> = no lens has scanned it yet - run a scan</span></div>}
        </div>
        <BaseLegend view={view} />
      </>
    );
  }
  return (
    <>
      <div className="sl-key">
        <div className="sl-one"><TileSwatch d={d} kind="fill" /><span><b>Fill</b> = {fillWords(d)}. A broken line on the top edge means not measured.</span></div>
        <div className="sl-one"><TileSwatch d={d} kind="unknown" /><span><b>?</b> = not scanned yet - run a scan</span></div>
        <div className="sl-one"><TileSwatch d={d} kind="faded" /><span><b>Faded</b> = this lens has nothing here</span></div>
      </div>
      <BaseLegend view={view} />
    </>
  );
}
