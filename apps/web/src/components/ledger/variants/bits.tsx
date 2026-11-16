'use client';
// Parts every ledger variant shows the same way: the lens glyph (the plan's own glyph set, drawn once per lens, colour
// and resolution into an image), the kind tag, risk and size, the feature link and the before -> expected move. The
// state mark and the lens tag are train/ui/Marks.tsx's (one component each); the dispatch bar is the backlog's
// (Triage.tsx). Lenses differ by glyph and short name here, never by colour.
import { useLayoutEffect, useRef, useState } from 'react';
import { glyph, type GlyphSpec } from '@/engine/render/lens-glyph';
import type { Proposal } from '@bp/core/scan/types';
import { worthText } from '@bp/core/scan/score';
import { machineDecided } from '@bp/core/scan/trust';
import { dayHhmmUTC } from '@bp/core/model';
import { useTheme } from '../../ThemeToggle';
import { riskBand, type Finding } from '../useLedger';

// ------------------------------------------------------------------------------------------- lens glyph
const URLS = new Map<string, string>();
/** The glyph as a data URL, cached by glyph, colour, size, inset and device resolution (drawn by the canvas's own `glyph()`). */
function glyphUrl(g: GlyphSpec, col: string, px: number, pad: number): string {
  const dpr = Math.min(2, window.devicePixelRatio || 1), key = JSON.stringify(g) + '|' + col + '|' + px + '|' + pad + '|' + dpr;
  let u = URLS.get(key);
  if (u !== undefined) return u;
  const cv = document.createElement('canvas'), n = Math.ceil(px * dpr), ctx = cv.getContext('2d');
  cv.width = cv.height = n;
  if (ctx) { ctx.scale(dpr, dpr); glyph(ctx, g, pad, pad, px - 2 * pad, col); }
  u = ctx ? cv.toDataURL() : '';
  URLS.set(key, u);
  return u;
}
/** The ink a drawing on `el` should use: `--ink` as RESOLVED AT `el`, so ledger-theme.css's `.lg-page` override reaches it
 *  (the document root still holds the drawing set's ink). The dark ink stands when the property is not set. */
export function inkAt(el: Element): string {
  return getComputedStyle(el).getPropertyValue('--ink').trim() || '#dff0ff';
}
/** The lens's glyph (decorative: its short name always stands next to it). The one component for every glyph in the ledger:
 *  `form` 'chip' is the 14 px glyph of chips, tabs and matrix heads (inline, a fixed 1.5 px inset); 'draft' is the glyph
 *  the Lenses panel and the draft card show at the sizes the plan draws it (a block, inset 12% of its size). The ink is read
 *  off the glyph's own element in a layout effect, because `.lg-page` does not exist yet when the first render resolves a
 *  `useMemo`. */
export function LensGlyph({ g, px = 14, form = 'chip' }: { g: GlyphSpec; px?: number; form?: 'chip' | 'draft' }) {
  const mode = useTheme(), ref = useRef<HTMLImageElement>(null), [src, setSrc] = useState('');
  const pad = form === 'draft' ? Math.round(px * 0.12) : 1.5, key = g === null ? '' : typeof g === 'string' ? g : g.path;
  useLayoutEffect(() => {
    if (ref.current) setSrc(glyphUrl(g, inkAt(ref.current), px, pad));
    // `key` stands for `g` (a fresh object each render would redraw every time); the theme changes the ink
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, px, pad, mode]);
  return <img ref={ref} className={form === 'draft' ? 'tl-gl' : 'lg-gl'} src={src || undefined} width={px} height={px} alt="" aria-hidden="true" />;
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
// ------------------------------------------------------------------------------------------- v5: score, verdict
/** The finding's worth (@bp/core/scan/score): the stored score, `est. 0.15` for a pre-v5 estimate, `unscored` (never 0),
 *  and under it impact and confidence when the scan stated them. At most three elements: the budget counts them per row. */
export function Score({ f }: { f: Finding }) {
  const p = f.p, t = worthText(f.w), sub = [p.impact !== undefined ? 'impact ' + p.impact : '', p.confidence ?? ''].filter(Boolean).join(' · ');
  const title = f.w.kind === 'score' ? 'scan-score/1, stored by the scan' + (p.impact_why ? ' · impact: ' + p.impact_why : '')
    : f.w.kind === 'est' ? 'No stored score (a pre-v5 finding): the blueprint\'s estimate, value per effort' : 'Unscored: impact or effort unknown';
  return <span className={'lg-sc k-' + f.w.kind} title={title}><b>{t}</b>{sub ? <small>{sub}</small> : null}</span>;
}
const VERDICT_WORD = { accept: 'accept', reject: 'reject', defer: 'defer' } as const;
/** The predicted verdict (recorded before any person saw the item) and, when a machine recorded the decision, `machine`. */
export function Verdict({ p }: { p: Proposal }) {
  const m = machineDecided(p);
  if (!p.predicted_verdict && !m) return null;
  const title = (p.predicted_verdict ? 'Predicted ' + p.predicted_verdict + (p.predicted_by ? ' by ' + p.predicted_by : '') + (p.predicted_why ? ': ' + p.predicted_why : '') : '')
    + (m ? (p.predicted_verdict ? ' · ' : '') + 'decided by ' + (p.decided_by?.startsWith('machine:') ? p.decided_by : p.triaged_by) + (p.veto_until ? ', veto until ' + dayHhmmUTC(p.veto_until) : '') : '');
  return <span className={'lg-pv' + (p.predicted_verdict ? ' v-' + p.predicted_verdict : '') + (m ? ' mach' : '')} title={title}>{p.predicted_verdict ? VERDICT_WORD[p.predicted_verdict] : ''}{m ? (p.predicted_verdict ? ' · ' : '') + 'machine' : ''}</span>;
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
