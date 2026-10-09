'use client';
// The per-person queue: questions agents asked, most urgent first. The reader (person, else lens)
// decides what rises; items reorder with a layout animation when the lens changes, and one click
// accepts the agent's recommendation (undo sits in the toast). A live product's questions are its
// scan's open proposals: each card says the metric move it promises (the latest reading, then
// latest + expected delta), the standard it rests on, size and risk, and offers Approve and Decline
// (with an optional note, asked inline). Both are written to the product's store. It lives in the
// rail's decisions flyout.
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { fmtWait, metricHistory, morningStats, pname, sheetOf, type SimDecision } from '@/lib/model';
import type { Proposal } from '@/lib/scan/types';
import { shallowEqual, useBp, useEngine, useLive, useVariant } from './hooks';

const fmtN = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : (Math.round(n * 100) / 100).toLocaleString('en-US'));

/** `metric: before → expected unit`, from the latest reading of that feature, lens and metric; null when the proposal names no metric. */
function metricMove(p: Proposal, unitOf: (lens: string, key: string) => string | undefined, scan: Parameters<typeof metricHistory>[0]): string | null {
  if (!p.metric) return null;
  const h = metricHistory(scan, p.feature, p.lens, p.metric), last = h[h.length - 1];
  const unit = last?.unit ?? unitOf(p.lens, p.metric), u = unit ? ' ' + unit : '';
  if (p.expected_delta === undefined) return p.metric + ': ' + (last ? fmtN(last.value) + u : 'not measured yet');
  const d = p.expected_delta, move = (d > 0 ? '+' : '') + fmtN(d) + u;
  return last ? `${p.metric}: ${fmtN(last.value)} → ${fmtN(last.value + d)}${u}` : `${p.metric}: ${move} (not measured yet)`;
}

function LiveItem({ d }: { d: SimDecision }) {
  const E = useEngine(), M = E.M, sim = M.sim, live = useLive();
  const s = useBp((s) => ({ dec: s.dec, who: s.who, view: s.view }), shallowEqual);
  const [declining, setDeclining] = useState(false), [note, setNote] = useState('');
  const f = M.P.F[d.f], on = s.dec === d.id, scan = live?.product.scan;
  const p = scan?.proposals.find((x) => x.id === d.base);
  const urg = d.urg === 'high' ? 'Urgent' : d.urg === 'medium' ? 'Soon' : 'When you can';
  const field = (lens: string, key: string) => M.P.LENS[lens]?.F[key];
  const mv = p ? metricMove(p, (l, k) => field(l, k)?.unit, scan) : null;
  const label = p?.metric ? field(p.lens, p.metric)?.label : undefined;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <motion.li
      layout="position" initial={{ opacity: 0, x: 18 }} animate={{ opacity: sim.emph(d, s.who, s.view) ? 1 : 0.55, x: 0 }} exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className={'qi lq u-' + d.urg + (on ? ' on' : '')} tabIndex={0} aria-current={on}
      onClick={() => E.openDecision(d.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); E.openDecision(d.id); } }}
      onPointerEnter={() => !E.S.dec && E.setHlDec(d.id)} onPointerLeave={() => E.setHlDec(null)}
    >
      <div className="k"><span>{urg} · <span className="lz">{sheetOf(M.P, d.lens).no}</span></span><span>{p?.kind && p.kind !== 'fix' ? p.kind + ' · ' : ''}{d.base}{d.isNew ? ' · NEW' : ''}</span></div>
      <h4>{d.q}</h4>
      {mv && <div className="mv" title={label ? label + (p?.expected_delta !== undefined ? ', expected after the change' : '') : undefined}>{mv}</div>}
      <div className="tags">
        {p && <span className="std" title="The standard this item rests on">{p.standard === 'none' ? 'no standard' : p.standard}</span>}
        {p?.size && <span title="Size">{p.size}</span>}
        {p?.risk !== undefined && <span title="Risk, 1 to 10" className={p.risk >= 7 ? 'hi' : ''}>risk {p.risk}</span>}
      </div>
      <div className="mt">{f.name} · {M.P.D[f.domain]?.name ?? f.domain} · waiting <b>{fmtWait(sim.waitMin(d))}</b></div>
      {declining ? (
        <form className="dn" onClick={stop} onSubmit={(e) => { e.preventDefault(); E.decide(d.id, 1, note.trim() || undefined); setDeclining(false); }}>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not? (optional)" aria-label="Decline note (optional)" maxLength={500} autoFocus
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); setDeclining(false); } }} />
          <button type="submit" className="bt">Decline</button>
          <button type="button" className="bt" onClick={() => setDeclining(false)}>Cancel</button>
        </form>
      ) : (
        <div className="row" style={{ marginTop: 7 }}>
          <button type="button" className="bt go answer" title="Approve: the scan executes it in its next execute phase" onClick={(e) => { stop(e); E.decide(d.id, 0); }}>✓ Approve</button>
          <button type="button" className="bt answer" title="Decline, with an optional note" onClick={(e) => { stop(e); setDeclining(true); }}>Decline…</button>
        </div>
      )}
    </motion.li>
  );
}

function Item({ d }: { d: SimDecision }) {
  const E = useEngine(), V = useVariant(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ dec: s.dec, who: s.who, view: s.view }), shallowEqual);
  const f = M.P.F[d.f], on = s.dec === d.id, urg = d.urg === 'high' ? 'Urgent' : d.urg === 'medium' ? 'Soon' : 'When you can';
  const emph = sim.emph(d, s.who, s.view), bn = sim.blocksNow(d);
  const note = V.ui?.queueNote?.(d, s.view, M) ?? null;
  return (
    <motion.li
      layout="position" initial={{ opacity: 0, x: 18 }} animate={{ opacity: emph ? 1 : 0.55, x: 0 }} exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className={'qi u-' + d.urg + (on ? ' on' : '')} tabIndex={0} aria-current={on}
      onClick={() => E.openDecision(d.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); E.openDecision(d.id); } }}
      onPointerEnter={() => !E.S.dec && E.setHlDec(d.id)} onPointerLeave={() => E.setHlDec(null)}
    >
      <div className="k"><span>{urg} · <span className="lz">{sheetOf(M.P, d.lens).no}</span></span><span>{d.base}{M.P.scale > 1 ? ' · ' + M.P.buildings[d.b].short : ''}{d.isNew ? ' · NEW' : ''}</span></div>
      <h4>{d.q}</h4>
      <div className="mt">{f.name} · {M.P.D[f.domain].name}<br />{pname(M.P, d.decider)} decides · waiting <b>{fmtWait(sim.waitMin(d))}</b> · holds <b>{bn}</b> agent{bn === 1 ? '' : 's'}</div>
      {note && <div className="note">{note}</div>}
      <div style={{ marginTop: 7 }}>
        <button type="button" className="bt go answer" title="Accept the agent’s recommendation (Enter)" onClick={(e) => { e.stopPropagation(); E.decide(d.id, d.rec); }}>✓ {d.opts[d.rec].label}</button>
      </div>
    </motion.li>
  );
}

/** The morning watch's entry ("While you were away"), in the decisions flyout's header (Kettle only). */
export function MorningButton() {
  const E = useEngine(), M = E.M;
  useBp((s) => s.simV);
  const ms = morningStats(M);
  return (
    <button type="button" className="bt morning-btn" title="Morning watch (M)" onClick={() => { E.setDockTab(null); E.toggleMorning(true); }}>
      <span>While you were away</span><span className="am">{ms.changes} changes · {ms.asked} asked</span>
    </button>
  );
}

/** The decisions flyout: the reader's queue, most urgent first. */
export function AsksTab() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ who: s.who, view: s.view, simV: s.simV, askAll: s.askAll }), shallowEqual);
  if (!sim.has) return <div className="qempty"><b>No swarm data</b>The swarm file did not load.</div>;
  const q = sim.queueFor(s.who, s.view);
  const first = s.who ? pname(M.P, s.who).split(' ')[0] : '';
  const more = (total: number) => total > (s.who ? 4 : 8) && (
    <button type="button" className="qmore" onClick={() => E.patch({ askAll: !s.askAll })}>{s.askAll ? 'Show fewer' : 'Show all ' + total}</button>
  );
  const Card = sim.live ? LiveItem : Item;
  const list = (ds: SimDecision[]) => (
    <ul className="qlist"><AnimatePresence initial={false} mode="popLayout">{ds.map((d) => <Card key={d.id} d={d} />)}</AnimatePresence></ul>
  );
  if (sim.live) {
    // a scan's proposals wait for whoever reviews (no person, no overnight digest); the reader's lens still sorts them
    const all = s.view === 'general' ? q.all : q.rest;
    return (
      <>
        <h3 className="dsec-h"><span>{s.view === 'general' ? 'Proposals to review' : 'Sheet ' + sheetOf(M.P, s.view).no + ' first'}</span><span>{q.all.length}</span></h3>
        {all.length ? list(!s.askAll && all.length > 8 ? all.slice(0, 8) : all) : <div className="qempty"><b>Nothing to review</b>The scan has no open proposal. New ones appear here as it proposes them.</div>}
        {more(all.length)}
      </>
    );
  }
  return (
    <>
      {s.who ? (
        <>
          <h3 className="dsec-h"><span>Waiting for {first}</span><span>{q.mine.length}</span></h3>
          {q.mine.length ? list(q.mine) : <div className="qempty"><b>Nothing waits for you</b>Every agent that needs {first} has what it needs. The swarm is working.</div>}
          <h3 className="dsec-h"><span>Everyone else</span><span>{q.rest.length}</span></h3>
          {list(s.askAll ? q.rest : q.rest.slice(0, 4))}
          {more(q.rest.length)}
        </>
      ) : (
        <>
          <h3 className="dsec-h"><span>{s.view === 'general' ? 'Waiting for a person' : 'Sheet ' + sheetOf(M.P, s.view).no + ' first'}</span><span>{q.all.length}</span></h3>
          {list((() => { const all = s.view === 'general' ? q.all : q.rest; return !s.askAll && all.length > 8 ? all.slice(0, 8) : all; })())}
          {more(q.all.length)}
        </>
      )}
    </>
  );
}

