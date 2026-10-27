// The performance comparison table: for an item measured in baseline runs, each run, their median, the after, the change
// (and its %), the noise a change must beat (compare.ts runStats: the spread, at least one frame for a timing), the
// target and the verdict, the range strip under them (compare.ts verdictOf, so it agrees with the item's row), then context rows:
// the feature's other metrics of the same lens from their latest `before` reading, against their targets. Which metrics
// and targets come from the lens manifest's fields: no lens or metric is named here. The change's tone, the target's
// comparator and the sentence under the table come from the verdict's judgement (its verdict and `dir`), never a default.
// A context row shows a direction only when its field gives one.
import { memo } from 'react';
import { FRAME_MS, type Comparison } from '@bp/core/scan/compare';
import type { LensDef } from '@bp/core/standard/load';
import type { LensField } from '@bp/core/standard/types';
import { atTarget, isOutlier, perfFigures, reasonOf, shortUnit, signed, toneOf, type PerfFigures } from '@bp/core/train/perf';
import { VerdictChip } from '../ui/Marks.tsx';
import { num } from '../ui/tables';
import { latestOf } from './MetricStrip';
import { PerfRange } from './PerfRange';
import './PerfTable.css';

interface Context { key: string; label: string; unit: string; value: number; target?: number; better?: 'up' | 'down'; evidence?: string }
/** One item as a table row: its runs in recorded order, their figures, its field and its context rows. */
export interface PerfItem { c: Comparison; fname: string; label: string; unit: string; values: number[]; f: PerfFigures; field?: LensField; context: Context[] }

/** The item's own-metric baseline runs (its `before` readings of its lens and metric, oldest first). */
export const runsOf = (c: Comparison): number[] => c.before.filter((m) => m.lens === c.p.lens && m.metric === c.p.metric).map((m) => m.value);
/** An item is shown in the table when it was measured in two or more baseline runs. */
export const hasRuns = (c: Comparison): boolean => runsOf(c).length > 1;

export function perfItem(c: Comparison, fname: string, lens: LensDef | undefined): PerfItem {
  const p = c.p, values = runsOf(c), b = latestOf(c.before, p.lens, p.metric), a = latestOf(c.after, p.lens, p.metric);
  const field = p.metric ? lens?.F[p.metric] : undefined, unit = b?.unit ?? a?.unit ?? field?.unit ?? '';
  const seen = new Map<string, Context>();
  for (const m of c.before) {
    if (m.lens !== p.lens || m.metric === p.metric) continue;
    const fd = lens?.F[m.metric], ctx: Context = { key: m.metric, label: fd?.label ?? m.metric, unit: m.unit ?? fd?.unit ?? '', value: m.value };
    if (fd?.metric?.better) ctx.better = fd.metric.better;
    if (fd?.metric?.target !== undefined) ctx.target = fd.metric.target;
    if (m.evidence) ctx.evidence = m.evidence;
    seen.set(m.metric, ctx); // rows come oldest first: the latest reading of each metric wins
  }
  return { c, fname, label: field?.label ?? p.metric ?? '', unit, values, f: perfFigures(values, a?.value, unit), field, context: [...seen.values()] };
}

/** The table's column count (the range strip's row spans it). */
const COLS = 7;
const U = ({ u }: { u: string }) => (u ? <u>{shortUnit(u)}</u> : null);
const cmpWord = (better: 'up' | 'down' | undefined) => (better === 'up' ? '≥ ' : better === 'down' ? '≤ ' : '');

export const PerfTable = memo(function PerfTable({ items }: { items: readonly PerfItem[] }) {
  return (
    <div className="tr-pt-wrap">
      <table className="tr-perf">
        <thead>
          <tr>
            <th className="l">Scene · metric · verdict</th><th>Baseline runs</th><th>Median</th><th>After</th><th>Change</th><th>Noise ±</th><th>Target</th>
          </tr>
        </thead>
        <tbody>{items.map((it) => <Rows key={it.c.p.id} it={it} />)}</tbody>
      </table>
    </div>
  );
});

function Rows({ it }: { it: PerfItem }) {
  const { f, unit, field } = it, better = it.c.dir, target = field?.metric?.target, v = it.c.verdict, t = toneOf(v);
  const tone = t ? ' ' + t : '';
  return (
    <>
      <tr className="main">
        <th className="l" scope="row" rowSpan={2}>
          <b>{it.fname}</b><span>{it.label}{unit ? ' · ' + unit : ''}</span>
          <em><VerdictChip verdict={v} label={v === 'flat' ? 'flat · within noise' : undefined} failed={it.c.p.status === 'failed'} /></em>
        </th>
        <td className="runs">{it.values.map((x, i) => isOutlier(x, f)
          ? <span key={i} className="out" title="outlier run: more than half the noise away from the median, fast or slow — it drags the median it is part of">{num(x)}</span>
          : <span key={i}>{num(x)}</span>)}</td>
        <td>{num(f.median)}<U u={unit} /></td>
        <td className="aft">{f.after !== undefined ? <>{num(f.after)}<U u={unit} /></> : '–'}</td>
        <td className={'chg' + tone}>{f.change !== undefined ? <>{signed(f.change)}<U u={unit} />{f.pct !== undefined ? <small>{signed(Math.round(f.pct))}%</small> : null}</> : '–'}</td>
        <td>{num(f.noise)}<U u={unit} /><small>{f.frame ? '1 frame' : 'spread'}</small></td>
        <td>{target !== undefined ? <>{cmpWord(better)}{num(target)}<U u={unit} /></> : '–'}</td>
      </tr>
      {/* the range strip spans the figures' width under them: spread, after and target on one scale, legible at any panel width */}
      <tr className="strip"><td colSpan={COLS - 1} className="l rng"><PerfRange f={f} unit={unit} target={target} warn={field?.metric?.warn_at} /></td></tr>
      {it.context.map((o) => {
        const ok = o.target === undefined || !o.better ? undefined : atTarget(o.value, o.target, o.better);
        return (
          <tr key={o.key} className="ctx">
            <th className="l" scope="row"><span>{o.label}{o.unit ? ' · ' + o.unit : ''}</span></th>
            <td className="runs dim">not re-run</td>
            <td title={'reading at the base' + (o.evidence ? ': ' + o.evidence : '')}>{num(o.value)}<U u={o.unit} /></td>
            <td className="dim">–</td><td className="dim">–</td><td className="dim">–</td>
            <td>
              {ok === undefined ? null : ok ? <b className="tr-tg ok" title="at target" aria-label="at target">✓</b> : <b className="tr-tg over" title="over target" aria-label="over target">△</b>}
              {o.target !== undefined ? <>{cmpWord(o.better)}{num(o.target)}<U u={o.unit} /></> : '–'}
            </td>
          </tr>
        );
      })}
    </>
  );
}

/** The table's legend: what the strip's marks mean. */
export function PerfKey() {
  return (
    <div className="tr-pt-key">
      <span><i className="k-run" />baseline run</span><span><i className="k-out" />outlier run: over half the noise from the median, either way</span><span><i className="k-aft" />after</span>
      <span><i className="k-band" />noise: the larger of the spread and one frame ({FRAME_MS} ms)</span><span><i className="k-t" />target</span>
    </div>
  );
}

/** Why the verdict is what it is, in one sentence over the item's figures. */
export const perfReason = (it: PerfItem): string => reasonOf(it.c.verdict, it.f, it.unit);
