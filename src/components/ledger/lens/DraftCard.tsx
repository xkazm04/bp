'use client';
// The lens Claude drafted in the onboarding chat, shown whole before it is accepted: name, glyph and
// line as the plan will draw them, the fields, the health rules in words and the scan instructions.
// Everything from the manifest is rendered as text (React escapes it); nothing is parsed as markup.
// Also exports the small pieces the temporary-lens list shares: the drawn glyph and line sample.
import { useEffect, useRef } from 'react';
import type { Condition, GlyphName, HealthRule, LensField, LensManifest, LineName, Rollup } from '@/lib/standard/types';
import { readTheme } from '@/engine/theme';
import { glyph, lineType } from '@/variants/subtle/marks';
import { useTheme } from '../../ThemeToggle';

/** A lens glyph drawn by the canvas's own glyph() (so the card shows exactly what the plan will). */
export function LensGlyph({ g, size = 18 }: { g: GlyphName | { path: string } | null; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null), mode = useTheme();
  const key = g === null ? '' : typeof g === 'string' ? g : g.path;
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), th = readTheme(dpr).theme;
    cv.width = size * dpr; cv.height = size * dpr;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
    const pad = Math.round(size * 0.12);
    glyph(ctx, g, pad, pad, size - 2 * pad, th.ink);
    // `key` stands for `g` (a fresh object each render would redraw every time)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size, mode]);
  return <canvas ref={ref} className="tl-gl" style={{ width: size, height: size }} aria-hidden="true" />;
}

/** A short run of the lens line type (the measured part of a tile's evidence rail). */
export function LineSample({ line, w = 56, h = 10 }: { line: LineName; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null), mode = useTheme();
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), th = readTheme(dpr).theme;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    lineType(ctx, th, line, 1, 1, w - 2, h - 2, th.ink, 1.2);
  }, [line, w, h, mode]);
  return <canvas ref={ref} className="tl-ln" style={{ width: w, height: h }} aria-hidden="true" />;
}

// ------------------------------------------------------------------------------------------ words
const OPS: Record<string, string> = { eq: '=', ne: '≠', lt: '<', lte: '<=', gt: '>', gte: '>=' };
const val = (v: unknown): string => (typeof v === 'string' ? `"${v}"` : String(v));

/** A condition in words: "riskScore >= 7 and files > 3", "not (stage is one of "idea", "specified")". */
export function conditionText(c: Condition, nested = false): string {
  const o = c as Record<string, unknown>;
  if (Array.isArray(o.all) || Array.isArray(o.any)) {
    const all = Array.isArray(o.all), parts = ((all ? o.all : o.any) as Condition[]).map((x) => conditionText(x, true));
    const s = parts.join(all ? ' and ' : ' or ') || (all ? 'always' : 'never');
    return nested && parts.length > 1 ? `(${s})` : s;
  }
  if (o.not !== undefined) return `not ${conditionText(o.not as Condition, true)}`;
  const f = String(o.field ?? '?');
  for (const k of Object.keys(OPS)) if (k in o) return `${f} ${OPS[k]} ${val(o[k])}`;
  if (Array.isArray(o.in)) return `${f} is one of ${o.in.map(val).join(', ')}`;
  if (Array.isArray(o.nin)) return `${f} is none of ${o.nin.map(val).join(', ')}`;
  if ('missing' in o) return `${f} is missing`;
  if ('present' in o) return `${f} is present`;
  return f;
}

export const ruleText = (r: HealthRule): string => `${r.health} when ${conditionText(r.when)}`;

export function rollupText(r: Rollup): string {
  if (r.method === 'share') return `share: watch at ${Math.round(r.watch * 100)}% of measured features, bad at ${Math.round(r.bad * 100)}%`;
  if (r.method === 'weighted') return `weighted by ${r.by}`;
  return 'worst-of: a place is as bad as its worst feature';
}

function fieldText(f: LensField): string {
  const bits: string[] = [f.type];
  if (f.unit) bits.push(f.unit);
  if (f.metric) bits.push(f.metric.better === 'up' ? 'higher is better' : 'lower is better');
  if (f.headline) bits.push('headline');
  return bits.join(' · ');
}

// ------------------------------------------------------------------------------------------- card
export type DraftState = 'new' | 'saving' | 'added';

export interface DraftCardProps {
  draft: LensManifest;
  state: DraftState;
  /** Why the last Accept failed (validation, a duplicate id, storage): shown on the card. */
  error: string | null;
  onAccept: () => void;
  /** Focus the chat's textarea. */
  onRefine: () => void;
  /** Start a scan of the added lens. */
  onScan: () => void;
  scanBusy: boolean;
}

export function DraftCard({ draft: m, state, error, onAccept, onRefine, onScan, scanBusy }: DraftCardProps) {
  const h = m.health, p = m.presentation;
  return (
    <article className="tl-card" aria-label={'Drafted lens ' + m.name}>
      <header className="tl-card-h">
        <LensGlyph g={p.glyph} size={22} />
        <div className="tl-card-t">
          <h4>{m.name}{m.short ? <span className="tl-short">{m.short}</span> : null}</h4>
          <code>{m.id} · v{m.version}</code>
        </div>
      </header>
      {m.description ? <p className="tl-desc">{m.description}</p> : null}
      <dl className="tl-dl">
        <dt>Line</dt><dd><LineSample line={p.line} /> <span>{p.line}</span></dd>
        <dt>Reader</dt><dd>{(m.reader.role ? m.reader.role + ' · ' : '') + m.reader.density}</dd>
        <dt>Fields</dt>
        <dd>
          <ul className="tl-fields">
            {m.fields.map((f) => <li key={f.key}><b>{f.label}</b> <code>{f.key}</code><span>{fieldText(f)}</span></li>)}
          </ul>
        </dd>
        <dt>Health</dt>
        <dd>
          <ul className="tl-rules">
            {h.rules.map((r, i) => <li key={i} className={'h-' + r.health}><b>{ruleText(r)}</b><span>{r.reason}</span></li>)}
            <li className="tl-def">otherwise {h.default}</li>
          </ul>
          <p className="tl-roll">Rollup {rollupText(h.rollup)}</p>
        </dd>
        {m.scan ? <><dt>Scan</dt><dd className="tl-instr">{m.scan.method === 'judgement' ? m.scan.instructions : m.scan.steps.map((st) => (st.kind === 'script' ? 'script: ' + st.run : st.kind === 'skill' ? 'skill: /' + st.skill + (st.budget ? ' (budget ' + st.budget + ')' : '') : 'judgement: ' + st.instructions)).join(' -> ')}</dd></> : null}
      </dl>
      {error ? <p className="tl-err" role="alert">{error}</p> : null}
      <div className="tl-acts">
        {state === 'added' ? (
          <>
            <span className="tl-ok" role="status">Added</span>
            <button type="button" className="tl-bt go" disabled={scanBusy} onClick={onScan}>{scanBusy ? 'Starting…' : 'Scan now'}</button>
          </>
        ) : (
          <>
            <button type="button" className="tl-bt go" disabled={state === 'saving'} onClick={onAccept}>{state === 'saving' ? 'Adding…' : 'Accept'}</button>
            <button type="button" className="tl-bt" onClick={onRefine}>Keep refining</button>
          </>
        )}
      </div>
    </article>
  );
}
