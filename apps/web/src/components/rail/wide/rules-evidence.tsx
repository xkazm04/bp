'use client';
// The evidence a rule earns trust on (scan/rules.ts backtest): the rule replayed over the owner's own decided findings.
// The figures say how often it spoke and agreed; the differing rows are the interface: each finding's title, where it is,
// what the owner decided and what the rule would have, newest first, each flying to its feature. Seeded history is
// counted and marked SYNTHETIC wherever it shows. Flags (a stop-ship it would approve, a grant over every tier, a rule
// that never spoke) lead, in red, before any number.
import { useState } from 'react';
import { TIER_WORD, type Backtest, type BacktestRow } from '@bp/core/scan/rules';
import { useEngine } from '../../hooks';
import { Fig, Sec } from './shell';

const VERB = { approve: 'approved', decline: 'declined', hold: 'held' } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function RowLine({ r }: { r: BacktestRow }) {
  const E = useEngine(), P = E.M.P, f = P.F[r.feature];
  const ruleSays = r.rule === 'approve' ? 'approved' : 'held';
  return (
    <li className={'rl-row' + (r.agree ? ' ok' : ' bad') + (r.stopShip ? ' stop' : '')}>
      <button type="button" onClick={() => f && E.flyToFeature(r.feature)} onPointerEnter={() => f && E.setHl(r.feature)} onPointerLeave={() => E.setHl(null)} disabled={!f}>
        <span className="tx">
          <small>{f ? f.name : r.feature} · {P.LENS[r.lens]?.name ?? r.lens}{r.tier !== undefined ? ' · ' + TIER_WORD[r.tier] : ' · untiered'} · {day(r.at)}{r.synthetic ? <em className="syn">synthetic</em> : null}</small>
          {r.title}
        </span>
        <span className="vs">
          <b className={r.owner === 'approve' ? 't-mint' : 't-amber'}>you {VERB[r.owner]}</b>
          <b className={r.agree ? 't-mint' : r.stopShip ? 't-red' : 't-amber'}>rule {ruleSays}</b>
        </span>
      </button>
    </li>
  );
}

/** The replay of one rule: figures, flags, then the rows where it would have disagreed with the owner. */
export function Evidence({ bt, busy, error }: { bt: Backtest | null; busy?: boolean; error?: string }) {
  const [more, setMore] = useState(false);
  if (error) return <p className="wb-err">The replay failed: {error}</p>;
  if (!bt) return <p className="wb-meta">{busy ? 'Replaying it over your decisions…' : 'Pick a place and a rule to replay it over your decisions.'}</p>;
  const spoke = bt.matched + bt.differed, pct = spoke ? Math.round((bt.matched * 100) / spoke) : null;
  const diff = bt.rows.filter((r) => !r.agree), same = bt.rows.filter((r) => r.agree);
  const shown = more ? same : same.slice(0, 4);
  return (
    <div className={'rl-ev' + (busy ? ' busy' : '')} aria-busy={busy}>
      {bt.flags.filter((f) => f.key !== 'disagrees').map((f) => <p key={f.key} className={f.key === 'silent' ? 'wb-note' : 'wb-err'}>{f.text}</p>)}
      <div className="wb-figs">
        <Fig n={bt.decided} label="of your decisions replayed" />
        <Fig n={bt.matched} label="it agreed with you" tone="mint" />
        <Fig n={bt.differed} label={bt.differed === 1 ? 'it would have differed' : 'it would have differed'} tone={bt.differed ? (bt.flags.some((f) => f.key === 'stop-ship') ? 'red' : 'amber') : 'mint'} />
        <Fig n={bt.abstained} label="not its business" />
        {pct !== null && <Fig n={pct + '%'} label={'agreement where it spoke (' + spoke + ')'} tone={pct >= 90 ? 'mint' : pct >= 75 ? 'amber' : 'red'} />}
      </div>
      {bt.synthetic > 0 && <p className="wb-meta rl-syn">{bt.synthetic} of these {bt.decided} decisions are <b>SYNTHETIC</b> seeded history (scripts/seed-rules-history.mjs), marked in every row; the rest are this store’s real decisions.</p>}
      <Sec head="Where it would have disagreed with you" aside={diff.length || 'nowhere'}>
        {diff.length ? <ul className="rl-rows" aria-label="Decisions the rule would have made differently">{diff.map((r) => <RowLine key={r.id} r={r} />)}</ul>
          : <p className="none">{spoke ? 'On every decision it spoke on, it decided as you did.' : 'It spoke on none of your decisions.'}</p>}
      </Sec>
      {same.length > 0 && (
        <Sec head="Where it agreed" aside={same.length}>
          <ul className="rl-rows" aria-label="Decisions the rule would have made as you did">{shown.map((r) => <RowLine key={r.id} r={r} />)}</ul>
          {same.length > shown.length || more ? <button type="button" className="bt rl-more" onClick={() => setMore(!more)}>{more ? 'Show fewer' : 'Show all ' + same.length}</button> : null}
        </Sec>
      )}
    </div>
  );
}
