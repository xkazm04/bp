'use client';
// The decision brief on a card: packages/core/src/scan/brief.ts computed here, in the browser, over the map the app already
// holds (briefMapOfStructure) and the scan - the same function GET .../proposals/<id>/brief and the plan.brief tool run on
// the server, so the person and the agents read identical context. It follows the stream: a decision elsewhere updates it.
// A live proposal gets the whole brief. A Kettle question (the sample's swarm) gets the facts that apply to a question -
// what it touches and how decisions under its lens went in the sample's own history (its ScanSim) - and not the undo or
// cost lines, which describe a proposal's build path the sample question does not take.
// Each fact is one plain line; a fact with evidence opens it (the similar decisions, the declines, the dependents, the
// builds the cost comes from). `compact` (the plan's decision card) keeps the evidence lists short.
import { useMemo, useState } from 'react';
import { baseId, type SimDecision } from '@bp/core/model';
import { briefFor, briefMapOfStructure, subjectOf, type Brief, type BriefDecided, type BriefFact, type FactKey } from '@bp/core/scan/brief';
import { useBp, useEngine, useLive } from './hooks';
import './decision-brief.css';

const QUESTION_FACTS: readonly FactKey[] = ['blast', 'declined', 'precedent'];

/** The brief of a decision on the card: a live proposal's, or a Kettle question's (sample: fewer facts); null without data. */
export function useBrief(d: SimDecision | null | undefined): Brief | null {
  const E = useEngine(), M = E.M, product = useLive()?.product, simV = useBp((s) => s.simV);
  const scan = product?.scan, rev = product?.structureRev;
  const map = useMemo(() => briefMapOfStructure(M.P.base), [M, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    if (!d) return null;
    if (M.sim.live) {
      const p = scan?.proposals.find((x) => x.id === d.base);
      return p && scan ? briefFor(subjectOf(p), scan, map) : null;
    }
    const s = M.scanSim?.snapshot();
    if (!s) return null;
    const b = briefFor({ feature: baseId(d.f), title: d.q, lens: d.lens }, s, map);
    return { ...b, facts: b.facts.filter((f) => QUESTION_FACTS.includes(f.key)), lines: b.facts.filter((f) => QUESTION_FACTS.includes(f.key)).map((f) => f.text) };
  }, [d, M, scan, map, simV]); // eslint-disable-line react-hooks/exhaustive-deps
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
