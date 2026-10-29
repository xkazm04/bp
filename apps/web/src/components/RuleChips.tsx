'use client';
// The owner's live standing rules in the header (a live product only): one chip per live rule, orders amber and grants
// mint, each with its id, its kind and the time it has left, so a rule that steers every agent is visible from every
// page, not only inside the Orders panel. A chip opens the Orders panel on that rule (lib/rules/client.ts pickRule).
// At most two chips (the header is shared with the lens tabs); the rest fold into "+n". The kind is the colour and the title.
import { memo, useEffect, useState } from 'react';
import { isLive, isOrder, type Rule } from '@bp/core/scan/rules';
import { pickRule, useRules } from '@/lib/rules/client';
import { useEngine, useLive } from './hooks';

const MAX = 2;
/** "2d", "5h", "40m", "∞" (until lifted). */
function short(r: Rule, now: number): string {
  if (!r.expiresAt) return '∞';
  const ms = Math.max(0, Date.parse(r.expiresAt) - now), h = Math.floor(ms / 3600000);
  return h >= 48 ? Math.floor(h / 24) + 'd' : h >= 1 ? h + 'h' : Math.max(1, Math.floor(ms / 60000)) + 'm';
}

export const RuleChips = memo(function RuleChips() {
  const live = useLive();
  return live ? <Chips slug={live.slug} /> : null;
});

function Chips({ slug }: { slug: string }) {
  const E = useEngine(), v = useRules(slug);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const on = v.rules.filter((r) => isLive(r, now));
  if (!on.length) return null;
  const open = (id: string) => { pickRule(id); if (E.S.dtab !== 'orders') E.setDockTab('orders'); };
  return (
    <span className="rulechips" role="group" aria-label={'Standing rules: ' + on.length + ' live'}>
      {on.slice(0, MAX).map((r) => (
        <button key={r.id} type="button" className={'rulechip ' + (isOrder(r.kind) ? 'ord' : 'grant')} onClick={() => open(r.id)}
          title={r.id + ' · ' + r.text + ' · ' + r.scope.label + (r.expiresAt ? ' · until ' + new Date(r.expiresAt).toLocaleString() : ' · until lifted') + ' (set by ' + r.by + ')'}>
          <b>{r.id}</b><em>{short(r, now)}</em>
        </button>
      ))}
      {on.length > MAX && <button type="button" className="rulechip more" onClick={() => open(on[MAX].id)} title={on.slice(MAX).map((r) => r.id + ' ' + r.text).join('\n')}>+{on.length - MAX}</button>}
    </span>
  );
}
