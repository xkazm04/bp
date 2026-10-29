'use client';
// The evidence a rule earns trust on, and the steer it makes (scan/rules.ts backtest and impact):
//   Now        what the rule does to the open backlog the moment it is set: the open findings it holds (a cap: whose
//              builds it caps) or lets agents approve alone, each flying to its feature
//   Evidence   the rule replayed over the owner's own decided findings. Flags (a stop-ship it would approve, a grant over
//              every tier, a rule that never spoke) lead in red, then the figures, then WHERE it disagreed, by room, each
//              room a one-tap "leave it out" when the writer offers it, then the differing rows themselves: the finding's
//              title, where it is, what the owner decided and what the rule would have. Seeded history is counted and
//              marked SYNTHETIC wherever it shows.
// useReplay asks the server for both, 250 ms after the draft last changed.
import { useEffect, useMemo, useState } from 'react';
import { TIER_WORD, type Backtest, type BacktestRow, type Impact, type RuleKind } from '@bp/core/scan/rules';
import { previewRule, type DraftBody, type Replay } from '@/lib/rules/client';
import { useEngine } from '../../hooks';
import { Fig, Sec } from './shell';

export interface ReplayState { r: Replay | null; busy: boolean; error?: string }
/** The replay of a draft, re-asked 250 ms after it last changed; the last answer stays on screen while the next is asked. */
export function useReplay(slug: string, d: DraftBody | null): ReplayState {
  const [st, setSt] = useState<ReplayState>({ r: null, busy: false });
  const key = d ? JSON.stringify(d) : '';
  useEffect(() => {
    if (!d) { setSt({ r: null, busy: false }); return; }
    const ac = new AbortController();
    setSt((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => previewRule(slug, d, ac.signal).then((r) => setSt({ r, busy: false }), (e: Error) => { if (!ac.signal.aborted) setSt({ r: null, busy: false, error: e.message }); }), 250);
    return () => { clearTimeout(t); ac.abort(); };
  }, [slug, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}

const VERB = { approve: 'approved', decline: 'declined', hold: 'held' } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function RowLine({ r }: { r: BacktestRow }) {
  const E = useEngine(), P = E.M.P, f = P.F[r.feature];
  return (
    <li className={'rl-row' + (r.agree ? ' ok' : ' bad') + (r.stopShip ? ' stop' : '')}>
      <button type="button" onClick={() => f && E.flyToFeature(r.feature)} onPointerEnter={() => f && E.setHl(r.feature)} onPointerLeave={() => E.setHl(null)} disabled={!f}>
        <span className="tx">
          <small>{f ? f.name : r.feature} · {P.LENS[r.lens]?.name ?? r.lens}{r.tier !== undefined ? ' · ' + TIER_WORD[r.tier] : ' · untiered'} · {day(r.at)}{r.synthetic ? <em className="syn">synthetic</em> : null}</small>
          {r.title}
        </span>
        <span className="vs">
          <b className={r.owner === 'approve' ? 't-mint' : 't-amber'}>you {VERB[r.owner]}</b>
          <b className={r.agree ? 't-mint' : r.stopShip ? 't-red' : 't-amber'}>rule {r.rule === 'approve' ? 'approved' : 'held'}</b>
        </span>
      </button>
    </li>
  );
}

/** What the rule does to the open backlog now. */
export function Now({ now, kind, busy }: { now: Impact | undefined; kind: RuleKind; busy?: boolean }) {
  const E = useEngine(), P = E.M.P;
  if (!now) return <p className="wb-meta">{busy ? 'Reading the open backlog…' : 'Pick a place and a rule to see what it does now.'}</p>;
  const verb = kind === 'grant' ? 'agents may approve alone' : kind === 'cap' ? 'builds capped' : 'held';
  return (
    <div className={'rl-now' + (busy ? ' busy' : '')}>
      <p className="rl-now-l"><b>{now.hits.length}</b> of {now.open} open finding{now.open === 1 ? '' : 's'} {kind === 'grant' ? 'agents could approve without asking you' : kind === 'cap' ? 'would build under its cap' : 'would be held'}, across <b>{now.features}</b> feature{now.features === 1 ? '' : 's'}{kind === 'hold' || kind === 'only' ? '; scans there are refused too' : ''}.</p>
      {now.hits.length > 0 ? (
        <ul className="rl-rows" aria-label="Open findings it acts on now">
          {now.hits.slice(0, 8).map((h) => {
            const f = P.F[h.feature];
            return (
              <li key={h.id} className={'rl-row ' + (kind === 'grant' ? 'ok' : 'bad')}>
                <button type="button" onClick={() => f && E.flyToFeature(h.feature)} onPointerEnter={() => f && E.setHl(h.feature)} onPointerLeave={() => E.setHl(null)} disabled={!f}>
                  <span className="tx"><small>{f ? f.name : h.feature} · {P.LENS[h.lens]?.name ?? h.lens}{h.tier !== undefined ? ' · ' + TIER_WORD[h.tier] : ''}</small>{h.title}</span>
                  <span className="vs"><b className={kind === 'grant' ? 't-mint' : 't-amber'}>{verb}</b></span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="none">Nothing open there right now: it governs what agents bring next.</p>}
      {now.hits.length > 8 && <p className="wb-meta">and {now.hits.length - 8} more</p>}
    </div>
  );
}

/** Differing rows by room (the plan's capability), most first: where the rule and the owner part ways. */
function byRoom(rows: readonly BacktestRow[], P: ReturnType<typeof useEngine>['M']['P']): { id: string; name: string; n: number; features: string[] }[] {
  const m = new Map<string, { id: string; name: string; n: number; features: string[] }>();
  for (const r of rows) {
    const c = P.F[r.feature]?.capability, cap = c ? P.C[c] : undefined, id = cap?.id ?? '?';
    const x = m.get(id) ?? { id, name: cap?.name ?? 'elsewhere', n: 0, features: cap?.features ?? [] };
    x.n++; m.set(id, x);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

/** The replay of one rule: flags, figures, where it disagreed, then the rows. `onLeaveOut` offers each room as a one-tap scope-out. */
export function Evidence({ bt, busy, error, onLeaveOut }: { bt: Backtest | null | undefined; busy?: boolean; error?: string; onLeaveOut?: (name: string, features: string[]) => void }) {
  const E = useEngine(), P = E.M.P;
  const [more, setMore] = useState(false);
  const diff = useMemo(() => bt?.rows.filter((r) => !r.agree) ?? [], [bt]);
  const rooms = useMemo(() => byRoom(diff, P), [diff, P]);
  if (error) return <p className="wb-err">The replay failed: {error}</p>;
  if (!bt) return <p className="wb-meta">{busy ? 'Replaying it over your decisions…' : 'Pick a place and a rule to replay it over your decisions.'}</p>;
  const spoke = bt.matched + bt.differed, pct = spoke ? Math.round((bt.matched * 100) / spoke) : null;
  const same = bt.rows.filter((r) => r.agree), shown = more ? same : same.slice(0, 4);
  const stop = bt.flags.some((f) => f.key === 'stop-ship');
  return (
    <div className={'rl-ev' + (busy ? ' busy' : '')} aria-busy={busy}>
      {bt.flags.filter((f) => f.key !== 'disagrees').map((f) => <p key={f.key} className={f.key === 'silent' ? 'wb-note' : 'wb-err'}>{f.text}</p>)}
      <div className="wb-figs rl-figs">
        <Fig n={bt.decided} label="of your decisions replayed" />
        <Fig n={bt.matched} label="it decided as you did" tone="mint" />
        <Fig n={bt.differed} label="it would have differed" tone={bt.differed ? (stop ? 'red' : 'amber') : 'mint'} />
        <Fig n={bt.abstained} label="not its business" />
        <Fig n={pct === null ? '–' : pct + '%'} label={'agreement, where it spoke (' + spoke + ')'} tone={pct === null ? undefined : pct >= 90 ? 'mint' : pct >= 75 ? 'amber' : 'red'} />
      </div>
      {bt.synthetic > 0 && <p className="wb-meta rl-syn">{bt.synthetic} of these {bt.decided} decisions are <b>SYNTHETIC</b> seeded history (scripts/seed-rules-history.mjs), marked in every row; the rest are this store’s real decisions.</p>}
      <Sec head="Where it would have disagreed with you" aside={diff.length || 'nowhere'}>
        {rooms.length > 0 && (
          <div className="rl-rooms" aria-label="Disagreements by room">
            {rooms.slice(0, 6).map((x) => (
              <div key={x.id} className="rl-room">
                <span className="nm">{x.name}</span>
                <span className="bar"><i style={{ width: Math.round((100 * x.n) / rooms[0].n) + '%' }} /></span>
                <b>{x.n}</b>
                {onLeaveOut && x.features.length > 0 && <button type="button" className="bt" onClick={() => onLeaveOut(x.name, x.features)}>Leave {x.name} out</button>}
              </div>
            ))}
          </div>
        )}
        {diff.length ? <ul className="rl-rows" aria-label="Decisions the rule would have made differently">{diff.map((r) => <RowLine key={r.id} r={r} />)}</ul>
          : <p className="none">{spoke ? 'On every decision it spoke on, it decided as you did.' : 'It spoke on none of your decisions.'}</p>}
      </Sec>
      {same.length > 0 && (
        <Sec head="Where it agreed" aside={same.length}>
          <ul className="rl-rows" aria-label="Decisions the rule would have made as you did">{shown.map((r) => <RowLine key={r.id} r={r} />)}</ul>
          {same.length > 4 && <button type="button" className="bt rl-more" onClick={() => setMore(!more)}>{more ? 'Show fewer' : 'Show all ' + same.length}</button>}
        </Sec>
      )}
    </div>
  );
}

/** The one-line verdict the sticky bar carries beside the button. */
export function Verdict({ bt }: { bt: Backtest | null | undefined }) {
  if (!bt) return <span className="rl-vd">Not replayed yet</span>;
  const spoke = bt.matched + bt.differed, pct = spoke ? Math.round((bt.matched * 100) / spoke) : null;
  const flag = bt.flags.find((f) => f.key === 'stop-ship') ?? bt.flags.find((f) => f.key === 'any-tier') ?? bt.flags.find((f) => f.key === 'silent');
  return (
    <span className="rl-vd">
      <b className={pct === null ? '' : pct >= 90 ? 't-mint' : pct >= 75 ? 't-amber' : 't-red'}>{pct === null ? '–' : pct + '%'}</b>
      <span>agreed {bt.matched} · differed {bt.differed} of {bt.decided}</span>
      {flag && <em className={flag.key === 'silent' ? 't-amber' : 't-red'}>{flag.key === 'stop-ship' ? 'approves stop-ships' : flag.key === 'any-tier' ? 'every tier' : 'no evidence'}</em>}
    </span>
  );
}
