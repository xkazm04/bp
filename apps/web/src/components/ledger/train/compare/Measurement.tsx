// What the measurement says: the item's before and after evidence lines (the latest reading of its own metric in each
// phase) with the commit each was taken on (its run on hover), in the winner A/1's two-line block, and a third line,
// Main now: the product's latest current reading of the metric (scan/track.ts: its value, day and method, and whether it
// is evidence, taken after the change landed or was released, or an observation), with the outcome on the base branch
// when the change is there (held / short of expected, track.ts's words). The method shows because a judged metric is
// noisy. The standard the item was built against heads the item's own text below ("The item · <standard>"), as in A/1.
import { memo } from 'react';
import type { Comparison } from '@bp/core/scan/compare';
import { mainOutcome, type Track } from '@bp/core/scan/track';
import type { Measurement as Reading } from '@bp/core/scan/types';
import { latestOf } from './MetricStrip';
import './MetricStrip.css';

const short = (sha: string | undefined) => (sha ? sha.slice(0, 7) : undefined);
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

function Line({ label, m }: { label: string; m: Reading }) {
  const sha = short(m.commit_sha);
  return (
    <>
      <b>{label}</b>
      <span title={'run ' + m.run_id}>{m.evidence ?? 'no evidence text'}{sha ? <> <code>{sha}</code></> : null}</span>
    </>
  );
}

const OUTCOME = { held: 'held', short: 'short of expected', unmeasured: 'not measured since', 'no-target': 'no expected value', 'out-of-bounds': 'target out of bounds' } as const;

/** The reading on main in words: "50 % on 2026-10-30 · judgement · evidence, after it landed · short of expected 100 %". */
export function mainNow(t: Track): string | null {
  if (t.current === undefined || !t.currentAt) return null;
  const u = t.unit ? ' ' + t.unit : '', o = mainOutcome(t), landed = !!t.landed && t.status === 'accepted';
  const kind = t.evidence ? 'evidence, after ' + (landed ? 'it landed' : 'the release') + (t.by === 'commit' ? ' (by commit)' : ' (by time; commit not recorded)') : 'an observation' + (landed ? ', from before it landed' : o ? ', from before the release' : '');
  const out = o === 'held' || o === 'short' || o === 'out-of-bounds' ? ' · ' + OUTCOME[o] + (t.expected !== undefined ? ' ' + num(t.expected) + u : '') : '';
  return `${num(t.current)}${u} on ${t.currentAt.slice(0, 10)} · ${t.currentMethod ?? 'method not recorded'} · ${kind}${out}`;
}

export const Measurement = memo(function Measurement({ c, now }: { c: Comparison; now?: Track | null }) {
  const p = c.p, b = latestOf(c.before, p.lens, p.metric), a = latestOf(c.after, p.lens, p.metric);
  const main = now ? mainNow(now) : null;
  return (
    <section className="tr-sec" data-role="tr-cmp-meas">
      <h4>What the measurement says</h4>
      <div className="tr-met">
        <div className="evid">
          {b ? <Line label="Before" m={b} /> : <><b>Before</b><span className="dim">no reading</span></>}
          {a ? <Line label="After" m={a} /> : <><b>After</b><span className="dim">no reading{p.status === 'failed' ? ': the build did not get that far' : ''}</span></>}
          {p.metric ? <><b>Main now</b>{main ? <span data-role="tr-cmp-main">{main}</span> : <span className="dim">no current reading of {p.metric}</span>}</> : null}
        </div>
      </div>
    </section>
  );
});
