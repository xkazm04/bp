'use client';
// The autonomy ladder, as the store records it (scan-finding/1 "Autonomy ladder"; @bp/core/scan/trust): a compact disclosure in
// the ledger's top bar. The button names the slices and their top level; the panel lists every slice (category | lens | risk
// class | size) with its level L0-L3 and what the level lets the machine do, where the level comes from (its latest event's
// agreement and n, or "start" when the slice has no event yet: technical 2, product 0, capped at 1 for secret / authz /
// money) and the latest events (from -> to, the reason, when). It reads the stream's trust_events and the findings' slices,
// and never writes trust: lens-scan's own `store.mjs trust` is the ledger's writer. Esc or the button closes it.
import { useMemo, useState } from 'react';
import { LEVEL_WORDS, latestEvents, trustSlices } from '@bp/core/scan/trust';
import { dayHhmmUTC } from '@bp/core/model';
import type { Ledger } from './useLedger';

const pct = (x: number | undefined) => (x === undefined ? '' : Math.round(x * 100) + '%');
/** An event's day and time through the one clock (packages/core/src/model/time.ts). */
const when = (iso: string | undefined) => (iso ? dayHhmmUTC(iso) : '');

export function TrustPanel({ L }: { L: Ledger }) {
  const [open, setOpen] = useState(false);
  const events = L.scan?.trust_events;
  const proposals = useMemo(() => L.all.map((f) => f.p), [L.all]);
  const slices = useMemo(() => trustSlices(events ?? [], proposals), [events, proposals]);
  const latest = useMemo(() => latestEvents(events ?? []), [events]);
  const top = slices.length ? Math.max(...slices.map((s) => s.level)) : null;
  return (
    <div className="lg-trust" data-keys="own" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className="bt" aria-expanded={open} aria-controls="lg-trust-panel" onClick={() => setOpen(!open)}
        title="What the machine may decide per slice: the store's trust ledger, read only">
        Trust{top === null ? ' · none' : ' · ' + slices.length + (slices.length === 1 ? ' slice' : ' slices') + ', up to L' + top}
      </button>
      {open ? (
        <div id="lg-trust-panel" className="lg-trust-p" role="region" aria-label="Autonomy by slice">
          {slices.length ? (
            <table>
              <caption className="vh">Each slice's autonomy level</caption>
              <thead><tr><th scope="col">Slice</th><th scope="col">Level</th><th scope="col">Agreement</th><th scope="col">n</th><th scope="col">Since</th></tr></thead>
              <tbody>
                {slices.map((s) => (
                  <tr key={s.slice} className={'lv-' + s.level}>
                    <th scope="row"><code>{s.slice}</code></th>
                    <td title={s.ceiling < 3 ? 'Ceiling L' + s.ceiling + ' (this risk class never goes higher)' : undefined}><b>L{s.level}</b> {LEVEL_WORDS[s.level] ?? ''}{s.ceiling < 3 ? ' · max L' + s.ceiling : ''}</td>
                    <td>{s.from === 'start' ? <span className="lg-trust-s">start</span> : pct(s.agreement)}</td>
                    <td>{s.n ?? ''}</td>
                    <td title={s.reason}>{s.from === 'start' ? '' : when(s.changedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="lg-trust-n">No slice yet: no finding carries a category and the store has no trust event. Every decision is a person's.</p>}
          {latest.length ? (
            <>
              <h3>Latest events</h3>
              <ul>
                {latest.map((e) => (
                  <li key={e.id}><code>{e.slice}</code> L{e.from_level} → L{e.to_level} · {e.reason}{e.agreement !== undefined ? ' · ' + pct(e.agreement) + (e.n !== undefined ? ' of ' + e.n : '') : ''} · {when(e.at)}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="lg-trust-n">Read from the store; lens-scan writes it. A person's veto of a machine decision counts as a reversal and demotes its slice.</p>
        </div>
      ) : null}
    </div>
  );
}
