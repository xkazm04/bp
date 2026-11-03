'use client';
// The autonomy ladder, as the store records it (scan-finding/1 "Autonomy ladder"; @bp/core/scan/trust): a compact disclosure in
// the ledger's top bar. The button names the slices and their top level; the panel lists every slice (category | lens | risk
// class | size) with its level L0-L3 and what the level lets the machine do, where the level comes from (its latest event's
// agreement and n, or "start" when the slice has no event yet: technical 2, product 0, capped at 1 for secret / authz /
// money) and the latest events (from -> to, the reason, when). It reads the stream's trust_events and the findings' slices,
// and never writes trust: lens-scan's own `store.mjs trust` is the ledger's writer. Esc or the button closes it.
// Beside agreement, the outcome (@bp/core/scan/outcome): what the slice's items on main came to - held, short, not
// measured since - and the same by decider (who accepted at judging, who approved for building), with the predictor's
// calls against what happened. Counts always; a rate only from RATE_N measured, judgement apart from static and probe.
// The landings are read only while the panel is open.
import { useMemo, useState } from 'react';
import { LEVEL_WORDS, latestEvents, trustSlices } from '@bp/core/scan/trust';
import { onMain, outcomeOf, predictorWords, ratesOf, tallyWords, type DeciderOutcome, type Tally } from '@bp/core/scan/outcome';
import { dayHhmmUTC } from '@bp/core/model';
import { useLandings } from '@/lib/scan/landings';
import { useScanCtx } from '../hooks';
import type { Proposal } from '@bp/core/scan/types';
import type { Ledger } from './useLedger';

const pct = (x: number | undefined) => (x === undefined ? '' : Math.round(x * 100) + '%');
/** An event's day and time through the one clock (packages/core/src/model/time.ts). */
const when = (iso: string | undefined) => (iso ? dayHhmmUTC(iso) : '');

/** A slice's outcome in a cell: "6 held · 1 short · 10 unmeasured", the rate when there is one; the full words on hover. */
function OutcomeCell({ t }: { t: Tally | undefined }) {
  if (!t || !onMain(t)) return <td className="lg-trust-s">none on main</td>;
  const r = ratesOf(t), rate = r.measured ?? r.judgement;
  const terms = [[t.held, 'held'], [t.short, 'short'], [t.unmeasured, 'unmeasured'], [t.noTarget, 'no target']] as const;
  return <td className="lg-trust-oc" title={tallyWords(t)}>{terms.filter(([n]) => n).map(([n, w]) => n + ' ' + w).join(' · ')}{rate !== undefined ? ' · ' + pct(rate) + ' held' + (r.measured === undefined ? ' by judgement' : '') : ''}</td>;
}

function Deciders({ head, rows }: { head: string; rows: DeciderOutcome[] }) {
  if (!rows.length) return null;
  return (
    <>
      <h3>{head}</h3>
      <ul className="lg-trust-o">{rows.map((d) => <li key={d.by}><code>{d.by}</code> {tallyWords(d.tally)}</li>)}</ul>
    </>
  );
}

function TrustBody({ L, proposals }: { L: Ledger; proposals: Proposal[] }) {
  const events = L.scan?.trust_events, scan = L.scan;
  const landed = useLandings(useScanCtx(), scan, proposals);
  const slices = useMemo(() => trustSlices(events ?? [], proposals), [events, proposals]);
  const latest = useMemo(() => latestEvents(events ?? []), [events]);
  const items = landed?.state === 'known' ? landed.items : undefined;
  const out = useMemo(() => (scan ? outcomeOf({ ...scan, proposals }, { landed: items }) : null), [scan, proposals, items]);
  const predictor = out ? predictorWords(out.predictor) : null;
  return (
    <div id="lg-trust-panel" className="lg-trust-p" role="region" aria-label="Autonomy by slice">
      {slices.length ? (
        <table>
          <caption className="vh">Each slice's autonomy level and what its items on main came to</caption>
          <thead><tr><th scope="col">Slice</th><th scope="col">Level</th><th scope="col">Agreement</th><th scope="col">n</th><th scope="col">Outcome</th><th scope="col">Since</th></tr></thead>
          <tbody>
            {slices.map((s) => (
              <tr key={s.slice} className={'lv-' + s.level}>
                <th scope="row"><code>{s.slice}</code></th>
                <td title={s.ceiling < 3 ? 'Ceiling L' + s.ceiling + ' (this risk class never goes higher)' : undefined}><b>L{s.level}</b> {LEVEL_WORDS[s.level] ?? ''}{s.ceiling < 3 ? ' · max L' + s.ceiling : ''}</td>
                <td>{s.from === 'start' ? <span className="lg-trust-s">start</span> : pct(s.agreement)}</td>
                <td>{s.n ?? ''}</td>
                <OutcomeCell t={out?.slices.get(s.slice)} />
                <td title={s.reason}>{s.from === 'start' ? '' : when(s.changedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="lg-trust-n">No slice yet: no finding carries a category and the store has no trust event. Every decision is a person's.</p>}
      {out && onMain(out.all) ? (
        <>
          <Deciders head="Outcome on main, by who accepted it" rows={out.accepted} />
          <Deciders head="By who approved it for building" rows={out.approved} />
        </>
      ) : <p className="lg-trust-n">{landed ? 'Nothing accepted is on main yet: no outcome to grade a decider by.' : 'Reading what landed on main…'}</p>}
      {predictor ? <p className="lg-trust-n">{predictor}.</p> : null}
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
      <p className="lg-trust-n">Read from the store; lens-scan writes it. A person's veto of a machine decision counts as a reversal and demotes its slice. Outcomes are read from each item's track: held or short by a reading taken after it shipped; a rate only from 10 measured, judgement apart.</p>
    </div>
  );
}

export function TrustPanel({ L }: { L: Ledger }) {
  const [open, setOpen] = useState(false);
  const events = L.scan?.trust_events;
  const proposals = useMemo(() => L.all.map((f) => f.p), [L.all]);
  const slices = useMemo(() => trustSlices(events ?? [], proposals), [events, proposals]);
  const top = slices.length ? Math.max(...slices.map((s) => s.level)) : null;
  return (
    <div className="lg-trust" data-keys="own" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className="bt" aria-expanded={open} aria-controls="lg-trust-panel" onClick={() => setOpen(!open)}
        title="What the machine may decide per slice: the store's trust ledger, read only">
        Trust{top === null ? ' · none' : ' · ' + slices.length + (slices.length === 1 ? ' slice' : ' slices') + ', up to L' + top}
      </button>
      {open ? <TrustBody L={L} proposals={proposals} /> : null}
    </div>
  );
}
