'use client';
// Parts every ledger variant shows the same way: the lens glyph (the plan's own glyph set, drawn once per lens, colour
// and resolution into an image), the status chip with its job mark, the kind tag, risk and size, the feature link and
// the Dispatch bar. Lenses differ by glyph and short name here, never by colour.
import { useMemo } from 'react';
import { glyph, type GlyphSpec } from '@/engine/render/lens-glyph';
import type { Proposal, ProposalStatus } from '@/lib/scan/types';
import { useTheme } from '../../ThemeToggle';
import { riskBand, type Finding, type Ledger, type LensCol } from '../useLedger';

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
/** The lens's glyph at 14 px (decorative: its short name always stands next to it). */
export function LensGlyph({ g, px = 14 }: { g: GlyphSpec; px?: number }) {
  const mode = useTheme();
  const src = useMemo(() => {
    const col = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#dff0ff';
    return glyphUrl(g, col, px);
    // the theme changes the ink
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, px, mode]);
  return src ? <img className="lg-gl" src={src} width={px} height={px} alt="" aria-hidden="true" /> : null;
}
export function LensTag({ lens, short = true }: { lens: LensCol | undefined; short?: boolean }) {
  if (!lens) return null;
  return <span className="lg-lens" title={lens.name}><LensGlyph g={lens.glyph} />{short ? lens.short : lens.name}</span>;
}

// ------------------------------------------------------------------------------------------- status, kind, risk, size
const MARK: Record<ProposalStatus, string> = { proposed: '○', approved: '◐', executing: '◔', done: '●', failed: '✕', declined: '–' };
/** The status as a word with its own mark (shape first, colour second); a job on it adds the progress ring. */
export function StatusChip({ f }: { f: Finding }) {
  const j = f.job;
  return (
    <span className={'lg-st s-' + f.status} title={j ? 'Execute job ' + j.id + ' ' + j.status + (j.started_at ? ' since ' + j.started_at.slice(11, 16) : '') : undefined}>
      {j ? <i className={'lg-job ' + j.status} aria-hidden="true" /> : <b aria-hidden="true">{MARK[f.status]}</b>}
      {f.status}{j ? <span className="vh"> · job {j.status}</span> : null}
    </span>
  );
}
export function KindTag({ p }: { p: Proposal }) {
  if (p.kind === 'fix') return null;
  return <span className="lg-kind" title={p.parent_id ? 'Follows ' + p.parent_id : undefined}>{p.kind === 'baseline-upgrade' ? 'baseline upgrade' : 'propagation' + (p.parent_id ? ' of ' + p.parent_id : '')}</span>;
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
export function FeatureLink({ f, L, act = true }: { f: Finding; L: Ledger; act?: boolean }) {
  return (
    <button type="button" className="lg-feat" disabled={!f.fid} tabIndex={act ? 0 : -1} title={f.fid ? 'Open ' + f.fname + ' on its ' + f.p.lens + ' tab' : f.p.feature + ' is not in this map'}
      onClick={(e) => { e.stopPropagation(); L.openFeature(f); }}>{f.fname}</button>
  );
}
export function Move({ f, L }: { f: Finding; L: Ledger }) {
  const mv = L.move(f.p);
  return mv ? <span className="lg-mv">{mv}</span> : null;
}

/** Row and card clicks select; a click on a control inside (feature link, checkbox, a button) is that control's own. */
export function fromControl(e: React.SyntheticEvent): boolean {
  const t = e.target as HTMLElement;
  return !!t.closest('button, input, a, select, textarea, label') && t !== e.currentTarget;
}

// ------------------------------------------------------------------------------------------- dispatch bar
/** The same in every variant: what is selected, which lenses it spans, Dispatch (D) and Clear (Esc). */
export function DispatchBar({ L }: { L: Ledger }) {
  const n = L.ui.sel.size, m = L.ready.length;
  const spans = L.lenses.filter((l) => L.ready.some((f) => f.p.lens === l.id));
  return (
    <div className="lg-bar" role="region" aria-label="Dispatch">
      <span className="lg-bar-n" aria-live="polite">{n ? n + ' selected' : 'Nothing selected'}{n && m !== n ? ' · ' + m + ' can go' : ''}</span>
      {spans.length ? <span className="lg-bar-l" title={spans.map((l) => l.name).join(', ')}>{spans.length === 1 ? '1 lens' : spans.length + ' lenses'}{spans.map((l) => <LensTag key={l.id} lens={l} />)}</span> : null}
      {m ? <span className="lg-bar-e" title="Effort: XS 1, S 2, M 3, L 5, XL 8">effort {L.effort}</span> : null}
      <span className="lg-sp" />
      <button type="button" className="bt" disabled={!n} onClick={L.clear} title="Clear the selection (Esc)">Clear <kbd>Esc</kbd></button>
      <button type="button" className="bt go" disabled={!m || L.busy} onClick={() => void L.dispatchIds()} title="Approve the proposed ones and start one execute run over all of them (D)">
        {L.busy ? 'Dispatching…' : 'Dispatch ' + m}<kbd>D</kbd>
      </button>
    </div>
  );
}
