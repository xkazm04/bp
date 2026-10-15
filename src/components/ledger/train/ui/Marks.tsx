// The release train's small marks: a status, a verdict, a metric's before -> after, a lens tag and the sample tag. One
// component per visual thing (port-quality.md Q3); every surface of the ledger renders these.
import { memo } from 'react';
import type { ProposalStatus } from '@/lib/scan/types';
import type { Verdict } from '@/lib/scan/compare';
import { useEngine } from '../../../hooks';
import { lensMeta } from '../../useLedger';
import { LensGlyph } from '../../variants/bits';
import { STATE, VERDICT, num } from './marks';
import './ui.css';

/** A status as its mark and word. `flagged`: accepted although it failed or did not move (⚑); `pending`: a decision
 *  on it is on its way to the store. */
export const StateMark = memo(function StateMark({ status, flagged = false, pending = false }: { status: ProposalStatus; flagged?: boolean; pending?: boolean }) {
  const m = STATE[status];
  return (
    <span className={'tr-st s-' + status + (pending ? ' pending' : '')} title={m.hint} data-role="tr-state">
      <b aria-hidden="true">{m.mark}</b>{m.word}
      {flagged ? <i title="accepted with a flag"> ⚑</i> : null}
      {pending ? <span className="tr-vh"> · deciding</span> : null}
    </span>
  );
});

/** A verdict as its mark and word; `label` replaces the word (a failed build says "build failed"). */
export const VerdictChip = memo(function VerdictChip({ verdict, label }: { verdict: Verdict; label?: string }) {
  const m = VERDICT[verdict];
  return <span className={'tr-vd v-' + verdict} title={m.hint}><b aria-hidden="true">{m.mark}</b>{label ?? m.word}</span>;
});

/** `before → after unit`, with the metric key under it when given. A missing side reads "–". */
export const MetricMove = memo(function MetricMove({ before, after, unit, metric }: { before?: number; after?: number; unit?: string; metric?: string }) {
  const side = (n: number | undefined) => (n === undefined ? '–' : num(n));
  return (
    <span className="tr-mv" data-role="tr-row-metric">
      {side(before)} → {side(after)}{unit ? ' ' + unit : ''}
      {metric ? <small>{metric}</small> : null}
    </span>
  );
});

/** A lens as its glyph and short name (the full name with `full`); lenses differ by glyph, never by colour alone. */
export const LensTag = memo(function LensTag({ id, full = false }: { id: string; full?: boolean }) {
  const l = lensMeta(useEngine().M.P, id);
  return <span className="tr-lens" title={l.name}><LensGlyph g={l.glyph} />{full ? l.name : l.short}</span>;
});

/** Marks sample data (Kettle's packs, a simulated job). */
export function SampleTag({ children = 'sample' }: { children?: string }) {
  return <span className="tr-sample">{children}</span>;
}
