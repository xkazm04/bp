'use client';
// The owner's standing rules where they decide (Review, a live product): a finding an order holds says so, and so does
// one a grant lets agents approve alone. The same pure gate the doors run (scan/rules.ts gate, grantFor) over the rules
// the panel reads (lib/rules/client.ts), so what the row says is what an agent would meet. A cautious grant needs the
// server's trust table, so this mark leaves it out rather than guess.
import { useMemo } from 'react';
import { citeWords, gate, grantFor, isLive, type Rule } from '@bp/core/scan/rules';
import { pickRule, useRules } from '@/lib/rules/client';
import { useEngine, useLive } from '../../hooks';

interface Finding { id: string; feature: string; lens: string; tier?: number }
export interface Mark { held?: Rule; grant?: Rule }

/** What the live rules say about one open finding. */
export function useRuleMark(p: Finding | undefined): Mark {
  const live = useLive(), v = useRules(live?.slug ?? null);
  return useMemo(() => {
    if (!p) return {};
    const now = Date.now(), on = v.rules.filter((r) => isLive(r, now));
    if (!on.length) return {};
    const h = gate(on, { kind: 'build', tool: 'review', items: [{ id: p.id, feature: p.feature, lens: p.lens }] }, now).held[0];
    if (h) return { held: on.find((r) => r.id === h.order.id) };
    const g = grantFor(on.filter((r) => !r.cautious), 'decision.answer', [{ feature: p.feature, ...(p.tier !== undefined ? { tier: p.tier } : {}) }], now);
    return g ? { grant: g } : {};
  }, [p, v.rules]);
}

/** The row's chip: "held · O-1" or "G-1 may approve". */
export function RuleChip({ m }: { m: Mark }) {
  if (m.held) return <span className="rlmk held" title={'Held by ' + m.held.id + ': ' + m.held.text}>held · {m.held.id}</span>;
  if (m.grant) return <span className="rlmk grant" title={m.grant.id + ': ' + m.grant.text}>{m.grant.id} may approve</span>;
  return null;
}

/** The detail's line, with the rule one tap away. */
export function RuleNote({ m }: { m: Mark }) {
  const E = useEngine();
  const r = m.held ?? m.grant;
  if (!r) return null;
  const open = () => { pickRule(r.id); E.setDockTab('orders'); };
  return (
    <p className={'wb-note rlmk-note' + (m.grant ? ' grant' : '')}>
      {m.held
        ? <>Held by {citeWords({ id: r.id, kind: r.kind, by: r.by, at: r.at, text: r.text, place: r.scope.label })}. Your decision is recorded either way, but no agent door will build it until you lift {r.id}, and approving it here reads as a breach of {r.id}. </>
        : <>{r.id} lets agents approve this on their own ({r.text.toLowerCase()}); deciding it yourself also tests the grant. </>}
      <button type="button" className="bt" onClick={open}>Open {r.id}</button>
    </p>
  );
}
