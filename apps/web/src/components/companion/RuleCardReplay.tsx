'use client';
// A rule.propose card (an agent proposing a standing rule, catalog.ts) carries its evidence: the draft replayed over the
// owner's own decided findings (POST /api/products/<slug>/rules preview, lib/rules/client.ts), so the person approves a
// rule on the record, not on the agent's say-so. One line of figures, the flag that should stop it (a stop-ship it would
// approve, every tier, no evidence), and "Open in Rules": the writer, filled with the draft, for the full replay (the
// person may set it there, changed or not, or approve the card as it is). Any other card shows nothing here.
import { useEffect, useState } from 'react';
import type { Card } from '@bp/core/companion/contract';
import { pickDraft, previewRule, type DraftBody, type Replay } from '@/lib/rules/client';
import { useEngine } from '../hooks';

/** The draft a rule.propose card's args make (the route checks it again), or null. */
function draftOf(c: Card): { slug: string; d: DraftBody } | null {
  const a = c.args as Record<string, unknown> | undefined;
  if (c.tool !== 'rule.propose' || !a || typeof a.slug !== 'string' || typeof a.kind !== 'string' || !a.scope || typeof a.scope !== 'object') return null;
  const { slug, ...rest } = a;
  return { slug, d: rest as unknown as DraftBody };
}

export function RuleCardReplay({ card }: { card: Card }) {
  const E = useEngine();
  const [st, setSt] = useState<{ r?: Replay; error?: string }>({});
  const x = draftOf(card), key = x ? JSON.stringify(x) : '';
  useEffect(() => {
    if (!x) return;
    const ac = new AbortController();
    previewRule(x.slug, x.d, ac.signal).then((r) => setSt({ r }), (e: Error) => { if (!ac.signal.aborted) setSt({ error: e.message }); });
    return () => ac.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!x) return null;
  if (st.error) return <p className="cp-replay bad">Replay failed: {st.error}</p>;
  const bt = st.r?.backtest;
  if (!bt) return <p className="cp-replay">Replaying it over your decisions…</p>;
  const spoke = bt.matched + bt.differed, pct = spoke ? Math.round((bt.matched * 100) / spoke) : null;
  const flag = bt.flags.find((f) => f.key === 'stop-ship') ?? bt.flags.find((f) => f.key === 'any-tier') ?? bt.flags.find((f) => f.key === 'silent');
  return (
    <div className={'cp-replay' + (flag && flag.key !== 'silent' ? ' bad' : '')}>
      <span><b>{pct === null ? '–' : pct + '%'}</b> agreed with you on {spoke} of {bt.decided} past decisions{bt.synthetic ? ' (' + bt.synthetic + ' synthetic)' : ''}; differed on {bt.differed}.</span>
      {st.r && <span>Now: {st.r.now.hits.length} open finding{st.r.now.hits.length === 1 ? '' : 's'} {x.d.kind === 'grant' ? 'agents could approve alone' : 'held'}.</span>}
      {flag && <span className="fl">{flag.text}</span>}
      <button type="button" onClick={() => { pickDraft(x.d); if (E.S.dtab !== 'orders') E.setDockTab('orders'); }}>Open in Rules</button>
    </div>
  );
}
