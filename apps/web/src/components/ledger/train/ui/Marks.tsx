// The release train's small marks: a status, a verdict, a metric's before -> after, a lens tag and the sample tag. One
// component per visual thing (port-quality.md Q3); every surface of the ledger renders these.
import { memo } from 'react';
import type { ProposalStatus } from '@bp/core/scan/types';
import type { Verdict } from '@bp/core/scan/compare';
import { useEngine } from '../../../hooks';
import { lensMeta } from '../../useLedger';
import { LensGlyph } from '../../variants/bits';
import { STATE, VERDICT, num } from './tables';
import './ui.css';

/** How a state mark is drawn: `tag` the boxed mark and word (a row, the decision strip), `box` the mark alone in a
 *  square (a pack row's progress), `glyph` the bare mark in its colour (a matrix cell, a status chip). */
export type StateForm = 'tag' | 'box' | 'glyph';
/** An execute job on the item (the backlog): the mark becomes a ring that turns while it runs. */
export interface StateJob { id: string; status: string; started_at?: string }

/** A status as its mark and word. `flagged`: accepted although it failed or did not move (⚑); `pending`: a decision
 *  on it is on its way to the store; `title` replaces the hint (a pack row's progress names its item). */
export const StateMark = memo(function StateMark({ status, flagged = false, pending = false, form = 'tag', job, title }: { status: ProposalStatus; flagged?: boolean; pending?: boolean; form?: StateForm; job?: StateJob | null; title?: string }) {
  const m = STATE[status];
  if (form !== 'tag') return <i className={(form === 'box' ? 'tr-stb' : 'tr-stg') + ' s-' + status} title={title ?? m.word + ': ' + m.hint} aria-hidden={form === 'glyph' ? true : undefined} data-role="tr-state">{m.mark}</i>;
  const jt = job ? 'Execute job ' + job.id + ' ' + job.status + (job.started_at ? ' since ' + job.started_at.slice(11, 16) : '') : undefined;
  return (
    <span className={'tr-st s-' + status + (pending ? ' pending' : '')} title={title ?? jt ?? m.hint} data-role="tr-state">
      {job ? <i className={'tr-job ' + job.status} aria-hidden="true" /> : <b aria-hidden="true">{m.mark}</b>}{m.word}
      {flagged ? <i title="accepted with a flag"> ⚑</i> : null}
      {pending ? <><i className="tr-job running" aria-hidden="true" /><span className="tr-vh"> · deciding</span></> : null}
      {job ? <span className="tr-vh"> · job {job.status}</span> : null}
    </span>
  );
});

/** A verdict as its mark and word; `label` replaces the word. `failed`: the item's build failed, which outranks what
 *  its metric did, so it reads "build failed" in the failure tone whatever the verdict. */
export const VerdictChip = memo(function VerdictChip({ verdict, label, failed = false }: { verdict: Verdict; label?: string; failed?: boolean }) {
  const m = VERDICT[verdict];
  return <span className={'tr-vd v-' + (failed ? 'failed' : verdict)} title={failed ? 'did not build or broke a gate; ' + m.word : m.hint}><b aria-hidden="true">{failed ? '✕' : m.mark}</b>{failed ? 'build failed' : label ?? m.word}</span>;
});

/** `before → after unit`, with the metric key under it when given. A missing side reads "–". `cell`: it is the
 *  table row's own cell (A/1's `.c-mv.mv`: the cell carries the type, so its padding and width are the type's box). */
export const MetricMove = memo(function MetricMove({ before, after, unit, metric, cell = false }: { before?: number; after?: number; unit?: string; metric?: string; cell?: boolean }) {
  const side = (n: number | undefined) => (n === undefined ? '–' : num(n));
  return (
    <span className={cell ? 'c-mv tr-mv' : 'tr-mv'} role={cell ? 'cell' : undefined} data-role="tr-row-metric">
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
