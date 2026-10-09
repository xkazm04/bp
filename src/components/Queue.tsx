'use client';
// The per-person queue: questions agents asked, most urgent first. The reader (person, else lens)
// decides what rises; items reorder with a layout animation when the lens changes, and one click
// accepts the agent's recommendation (undo sits in the toast).
import { AnimatePresence, motion } from 'motion/react';
import { SHEET, fmtWait, morningStats, pname, type SimDecision } from '@/lib/model';
import { shallowEqual, useBp, useEngine, useVariant } from './hooks';

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
      <div className="k"><span>{urg} · <span className="lz">{SHEET[d.lens].no}</span></span><span>{d.base}{M.P.scale > 1 ? ' · ' + M.P.buildings[d.b].short : ''}{d.isNew ? ' · NEW' : ''}</span></div>
      <h4>{d.q}</h4>
      <div className="mt">{f.name} · {M.P.D[f.domain].name}<br />{pname(M.P, d.decider)} decides · waiting <b>{fmtWait(sim.waitMin(d))}</b> · holds <b>{bn}</b> agent{bn === 1 ? '' : 's'}</div>
      {note && <div className="note">{note}</div>}
      <div style={{ marginTop: 7 }}>
        <button type="button" className="bt go answer" title="Accept the agent’s recommendation (Enter)" onClick={(e) => { e.stopPropagation(); E.decide(d.id, d.rec); }}>✓ {d.opts[d.rec].label}</button>
      </div>
    </motion.li>
  );
}

export function AsksTab() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ who: s.who, view: s.view, simV: s.simV, askAll: s.askAll }), shallowEqual);
  if (!sim.has) return <div className="qempty"><b>No swarm data</b>The swarm file did not load.</div>;
  const q = sim.queueFor(s.who, s.view), ms = morningStats(M);
  const first = s.who ? pname(M.P, s.who).split(' ')[0] : '';
  const more = (total: number) => total > (s.who ? 4 : 8) && (
    <button type="button" className="qmore" onClick={() => E.patch({ askAll: !s.askAll })}>{s.askAll ? 'Show fewer' : 'Show all ' + total}</button>
  );
  const list = (ds: SimDecision[]) => (
    <ul className="qlist"><AnimatePresence initial={false} mode="popLayout">{ds.map((d) => <Item key={d.id} d={d} />)}</AnimatePresence></ul>
  );
  return (
    <>
      <button type="button" className="bt" style={{ margin: '10px 12px 2px', width: 'calc(100% - 24px)', justifyContent: 'space-between', height: 34, letterSpacing: '.02em', padding: '0 8px' }} onClick={() => E.toggleMorning(true)}>
        <span>While you were away</span><span style={{ color: 'var(--amber)' }}>{ms.changes} changes · {ms.asked} asked</span>
      </button>
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
          <h3 className="dsec-h"><span>{s.view === 'general' ? 'Waiting for a person' : 'Sheet ' + SHEET[s.view].no + ' first'}</span><span>{q.all.length}</span></h3>
          {list((() => { const all = s.view === 'general' ? q.all : q.rest; return !s.askAll && all.length > 8 ? all.slice(0, 8) : all; })())}
          {more(q.all.length)}
        </>
      )}
    </>
  );
}
