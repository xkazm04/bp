'use client';
// Parts every ledger variant shows the same way: the lens glyph (the plan's own glyph set, drawn once per lens, colour
// and resolution into an image), the kind tag, risk and size, the feature link and the before -> expected move. The
// state mark and the lens tag are train/ui/Marks.tsx's (one component each); the dispatch bar is the backlog's
// (Triage.tsx). Lenses differ by glyph and short name here, never by colour.
import { useLayoutEffect, useRef, useState } from 'react';
import { glyph, type GlyphSpec } from '@/engine/render/lens-glyph';
import type { Proposal } from '@bp/core/scan/types';
import { useTheme } from '../../ThemeToggle';
import { riskBand, type Finding } from '../useLedger';

// ------------------------------------------------------------------------------------------- lens glyph
const URLS = new Map<string, string>();
/** The glyph as a data URL, cached by glyph, colour, size and device resolution (drawn by the canvas's own `glyph()`). */
function glyphUrl(g: GlyphSpec, col: string, px: number): string {
  const dpr = Math.min(2, window.devicePixelRatio || 1), key = JSON.stringify(g) + '|' + col + '|' + px + '|' + dpr;
  let u = URLS.get(key);
  if (u !== undefined) return u;
  const cv = document.createElement('canvas'), n = Math.ceil(px * dpr), ctx = cv.getContext('2d');
  cv.width = cv.height = n;
  if (ctx) { ctx.scale(dpr, dpr); glyph(ctx, g, 1.5, 1.5, px - 3, col); }
  u = ctx ? cv.toDataURL() : '';
  URLS.set(key, u);
  return u;
}
/** The ink a drawing on `el` should use: `--ink` as RESOLVED AT `el`, so ledger-theme.css's `.lg-page` override reaches it
 *  (the document root still holds the drawing set's ink). The dark ink stands when the property is not set. */
export function inkAt(el: Element): string {
  return getComputedStyle(el).getPropertyValue('--ink').trim() || '#dff0ff';
}
/** The lens's glyph at 14 px (decorative: its short name always stands next to it). The ink is read off the glyph's own
 *  element in a layout effect, because `.lg-page` does not exist yet when the first render resolves a `useMemo`. */
export function LensGlyph({ g, px = 14 }: { g: GlyphSpec; px?: number }) {
  const mode = useTheme(), ref = useRef<HTMLImageElement>(null), [src, setSrc] = useState('');
  useLayoutEffect(() => {
    if (ref.current) setSrc(glyphUrl(g, inkAt(ref.current), px));
    // the theme changes the ink
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, px, mode]);
  return <img ref={ref} className="lg-gl" src={src || undefined} width={px} height={px} alt="" aria-hidden="true" />;
}
// ------------------------------------------------------------------------------------------- kind, risk, size
export function KindTag({ p }: { p: Proposal }) {
  if (p.kind === 'fix') return null;
  const word = p.kind === 'baseline-upgrade' ? 'baseline upgrade' : p.kind === 'work-item' ? 'work item' : 'propagation' + (p.parent_id ? ' of ' + p.parent_id : '');
  return <span className="lg-kind" title={p.parent_id ? 'Follows ' + p.parent_id : undefined}>{word}</span>;
}
const RISK_MARK = { high: '▲', medium: '◆', low: '▽' } as const;
export function Risk({ p }: { p: Proposal }) {
  const b = riskBand(p.risk);
  return <span className={'lg-risk r-' + b} title={'Risk ' + (p.risk ?? 'not stated') + ' of 10 (' + b + ')'}><b aria-hidden="true">{RISK_MARK[b]}</b>{p.risk ?? '–'}</span>;
}
export function Size({ p }: { p: Proposal }) {
  return <span className="lg-size" title="Size">{p.size ?? '–'}</span>;
}
/** The feature name: opens the feature on the finding's lens tab, in the drawing set. `act` false keeps it out of the
 *  Tab order (only the focused row's controls are tabbable; J/K move between rows). */
export function FeatureLink({ f, onOpen, act = true }: { f: Finding; onOpen(f: Finding): void; act?: boolean }) {
  return (
    <button type="button" className="lg-feat" disabled={!f.fid} tabIndex={act ? 0 : -1} title={f.fid ? 'Open ' + f.fname + ' on its ' + f.p.lens + ' tab' : f.p.feature + ' is not in this map'}
      onClick={(e) => { e.stopPropagation(); onOpen(f); }}>{f.fname}</button>
  );
}
/** Before -> expected (the ledger's `move`, useLedger's stable callback). */
export function Move({ f, move }: { f: Finding; move(p: Proposal): string | null }) {
  const mv = move(f.p);
  return mv ? <span className="lg-mv">{mv}</span> : null;
}

/** Row and card clicks select; a click on a control inside (feature link, checkbox, a button) is that control's own. */
export function fromControl(e: React.SyntheticEvent): boolean {
  const t = e.target as HTMLElement;
  return !!t.closest('button, input, a, select, textarea, label') && t !== e.currentTarget;
}
