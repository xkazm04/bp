// What the measurement says: the item's before and after evidence lines (the latest reading of its own metric in each
// phase) with the run and the commit each was taken on, and the standard the item was built against.
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
      <span>{m.evidence ?? 'no evidence text'}{sha ? <> <code>{sha}</code></> : null} <span className="dim">· {m.run_id}</span></span>
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
          <b>Standard</b><span><code>{p.standard}</code></span>
        </div>
      </div>
    </section>
  );
});
