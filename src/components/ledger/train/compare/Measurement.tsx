// What the measurement says: the item's before and after evidence lines (the latest reading of its own metric in each
// phase) with the commit each was taken on (its run on hover), in the winner A/1's two-line block. The standard the item
// was built against heads the item's own text below ("The item · <standard>"), as in A/1.
import { memo } from 'react';
import type { Comparison } from '@/lib/scan/compare';
import type { Measurement as Reading } from '@/lib/scan/types';
import { latestOf } from './MetricStrip';
import './MetricStrip.css';

const short = (sha: string | undefined) => (sha ? sha.slice(0, 7) : undefined);

function Line({ label, m }: { label: string; m: Reading }) {
  const sha = short(m.commit_sha);
  return (
    <>
      <b>{label}</b>
      <span title={'run ' + m.run_id}>{m.evidence ?? 'no evidence text'}{sha ? <> <code>{sha}</code></> : null}</span>
    </>
  );
}

export const Measurement = memo(function Measurement({ c }: { c: Comparison }) {
  const p = c.p, b = latestOf(c.before, p.lens, p.metric), a = latestOf(c.after, p.lens, p.metric);
  return (
    <section className="tr-sec" data-role="tr-cmp-meas">
      <h4>What the measurement says</h4>
      <div className="tr-met">
        <div className="evid">
          {b ? <Line label="Before" m={b} /> : <><b>Before</b><span className="dim">no reading</span></>}
          {a ? <Line label="After" m={a} /> : <><b>After</b><span className="dim">no reading{p.status === 'failed' ? ': the build did not get that far' : ''}</span></>}
        </div>
      </div>
    </section>
  );
});
