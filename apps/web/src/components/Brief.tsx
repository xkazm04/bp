'use client';
// The decision brief on a card: packages/core/src/scan/brief.ts computed here, in the browser, over the live product's
// own map and scan snapshot - the same function GET .../proposals/<id>/brief and the plan.brief tool run on the server,
// so the person and the agents read identical context. It follows the stream: a decision elsewhere updates the brief.
// Each fact is one plain line; a fact with evidence opens it (the similar decisions, the declines, the dependents, the
// builds the cost comes from). `compact` (the plan's decision card) keeps the evidence lists short.
import { useMemo, useState } from 'react';
import { briefFor, briefMapOf, subjectOf, type Brief, type BriefDecided, type BriefFact } from '@bp/core/scan/brief';
import { useEngine, useLive } from './hooks';
import './decision-brief.css';

/** The brief of a live proposal, or null (Kettle's swarm questions, a row not in the snapshot yet, no map yet). */
export function useBrief(id: string | undefined): Brief | null {
  const product = useLive()?.product, scan = product?.scan, structure = product?.structure;
  const map = useMemo(() => (structure ? briefMapOf(structure) : null), [structure]);
  return useMemo(() => {
    const p = id && scan ? scan.proposals.find((x) => x.id === id) : undefined;
    return p && scan && map ? briefFor(subjectOf(p), scan, map) : null;
  }, [id, scan, map]);
}

const ADVICE: Record<Brief['advice']['say'], string | null> = { withdraw: 'Repeats a decline', ask: 'Mostly declined before', proceed: null };

function Decided({ r }: { r: BriefDecided }) {
  return (
    <li className={'v-' + r.verdict}>
      <span className="vd">{r.verdict}</span>
      <span className="tt">{r.title}{r.note && <q>{r.note}</q>}</span>
      <small>{r.at} · {r.match} · {r.id}</small>
    </li>
  );
}

function Evidence({ b, f, max }: { b: Brief; f: BriefFact; max: number }) {
  const E = useEngine();
  const more = (n: number) => (n > max ? <li className="more">and {n - max} more</li> : null);
  if (f.key === 'precedent' || f.key === 'declined') {
    const rows = f.key === 'declined' ? b.declines : b.precedent.rows;
    return <ol className="bf-ev">{rows.slice(0, max).map((r) => <Decided key={r.id} r={r} />)}{more(rows.length)}</ol>;
  }
  if (f.key === 'blast') {
    return (
      <ol className="bf-ev bf-deps">
        {b.blast.dependents.slice(0, max).map((x) => (
          <li key={x.slug}><button type="button" onClick={() => E.flyToFeature(x.slug)} title="Fly to it on the plan">{x.name}</button>{x.id && <small>{x.id}</small>}</li>
        ))}{more(b.blast.dependents.length)}
      </ol>
    );
  }
  if (f.key === 'cost') return <ol className="bf-ev">{b.cost.runs.slice(0, max).map((r) => <li key={r}><small>execute run {r}</small></li>)}{more(b.cost.runs.length)}</ol>;
  return null;
}

/** The brief's facts, each opening its evidence. */
export function BriefFacts({ b, compact = false }: { b: Brief; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const advice = ADVICE[b.advice.say];
  return (
    <div className={'brief' + (compact ? ' compact' : '')} aria-label="Decision brief">
      {advice && <div className={'bf-adv a-' + b.advice.say} title={b.advice.why}>{advice}</div>}
      <ul className="bf-facts">
        {b.facts.map((f) => {
          const n = f.ids.length, on = open === f.key;
          return (
            <li key={f.key} className={'bf-' + f.key + (on ? ' on' : '')}>
              {n ? (
                <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : f.key)} title={on ? 'Hide the evidence' : 'Show the ' + n + ' behind this'}>
                  <span>{f.text}</span><i aria-hidden="true">{n} {on ? '▴' : '▾'}</i>
                </button>
              ) : <span>{f.text}</span>}
              {on && <Evidence b={b} f={f} max={compact ? 4 : 12} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
