// The compare panel's metric line: the item's metric `before → after unit` in the big figures the contest winner draws,
// the metric key with the verdict (compare.ts verdictOf: moved, flat, worse, unmeasured; a failed build says so), and
// how to read it: the better direction, the target and the method. The readings are the item's own phased ones.
import { memo } from 'react';
import type { Comparison } from '@bp/core/scan/compare';
import type { Measurement } from '@bp/core/scan/types';
import type { LensField } from '@bp/core/standard/types';
import { VerdictChip } from '../ui/Marks.tsx';
import { num } from '../ui/tables';
import './MetricStrip.css';

/** The latest reading of the item's own lens and metric in a phase's rows (they come sorted, oldest first). */
export function latestOf(rows: readonly Measurement[], lens: string, metric: string | undefined): Measurement | undefined {
  let r: Measurement | undefined;
  for (const m of rows) if (m.lens === lens && m.metric === metric) r = m;
  return r;
}

const METHOD_NOTE: Readonly<Record<string, string>> = { judgement: ' (a model re-read the code at each commit)' };

export const MetricStrip = memo(function MetricStrip({ c, field }: { c: Comparison; field?: LensField }) {
  const p = c.p, b = latestOf(c.before, p.lens, p.metric), a = latestOf(c.after, p.lens, p.metric);
  const unit = b?.unit ?? a?.unit ?? field?.unit ?? '';
  const better = field?.metric?.better ?? (p.expected_delta ? (p.expected_delta > 0 ? 'up' : 'down') : undefined);
  const method = a?.method ?? b?.method ?? field?.metric?.method;
  const how = [
    better ? (better === 'down' ? 'lower is better' : 'higher is better') : null,
    field?.metric?.target !== undefined ? 'target ' + num(field.metric.target) : null,
    'measured by ' + (method ?? '–') + (method ? METHOD_NOTE[method] ?? '' : ''),
  ].filter((x) => x !== null).join(' · ');
  return (
    <section className="tr-sec">
      <h4>Metric</h4>
      <div className="tr-met" data-role="tr-cmp-metric">
        <div className="big">
          <s>{b ? num(b.value) : '–'}</s><span className="ar" aria-label="to">→</span>
          <span data-role="tr-cmp-big">{a ? num(a.value) : '?'}</span>{unit ? <u>{unit}</u> : null}
        </div>
        <div className="k">
          {p.metric ?? 'no metric'} <VerdictChip verdict={c.verdict} failed={p.status === 'failed'} />
          <small>{how}</small>
        </div>
      </div>
    </section>
  );
});
