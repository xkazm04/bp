'use client';
// Orders: the list holds a "Write an order" row and the standing orders, breached first. The detail reads the
// selected order in full: its words, who set it and when, the place it governs, every breach (each flies to its
// feature) and the governed features; the plan lights the order's places while it is selected. The writer row turns
// the current selection into an order from the four templates, through the same preview and commit as the
// selection bar.
import { useEffect, useMemo, useState } from 'react';
import { ORDER_TEMPLATES, STAGE_WORD, pname, sheetOf, stageAt, type OrderTemplate, type SimOrder } from '@/lib/model';
import { StageSym } from '../../Symbols';
import { shallowEqual, useBp, useEngine } from '../../hooks';
import { PreviewBox } from '../panels';
import { Fig, Group, Row, Sec, Workbench, useListRef, useWalk } from './shell';

const WRITE = 'write';

export function Orders() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ simV: s.simV }), shallowEqual);
  const [sel, setSel] = useState<string | null>(null);
  const listRef = useListRef();
  // breached first, then the newest; the order of the file otherwise
  const orders = useMemo(() => sim.has ? sim.orders.slice().sort((a, b) => (b.vf.length ? 1 : 0) - (a.vf.length ? 1 : 0)) : [], [sim, s.simV]);
  const ids = useMemo(() => [WRITE, ...orders.map((o) => o.id)], [orders]);
  const cur = sel && ids.includes(sel) ? sel : orders.find((o) => o.vf.length)?.id ?? orders[0]?.id ?? WRITE;
  const onKey = useWalk(ids, cur, setSel, listRef);
  // the selected order's places light up on the plan; leaving the panel clears them
  const hi = cur !== WRITE ? cur : null;
  useEffect(() => { E.setOrdHi(hi); }, [E, hi]);
  useEffect(() => () => E.setOrdHi(null), [E]);

  if (!sim.has) return <div className="wb-empty"><b>No swarm data</b>Standing orders govern a simulated swarm; this product has none.</div>;
  const breached = orders.filter((o) => o.vf.length), holding = orders.filter((o) => !o.vf.length);
  const breaches = orders.reduce((n, o) => n + o.vf.length, 0), mine = orders.filter((o) => o.user).length;
  const row = (o: SimOrder) => (
    <Row key={o.id} id={o.id} on={cur === o.id} onPick={() => setSel(o.id)} cls={o.vf.length ? 'u-high' : ''} label={o.id + ': ' + o.text}>
      <span className="rk"><span>{o.id}</span><span>{sheetOf(M.P, o.lens).no}</span>{o.user && <span>new</span>}</span>
      <span className="rt">{o.text}</span>
      <span className="rm"><span>{sim.scopeWords(o)}</span><span>{o.vf.length ? o.vf.length + ' breach' + (o.vf.length > 1 ? 'es' : '') : 'holding'}</span></span>
    </Row>
  );
  const list = (
    <>
      <ul role="listbox" aria-label="Write an order" className="wb-solo">
        <Row id={WRITE} on={cur === WRITE} onPick={() => setSel(WRITE)} cls="ov">
          <span className="rt">Write an order</span>
          <span className="rm"><span>for the places you selected</span></span>
        </Row>
      </ul>
      {breached.length > 0 && <Group head="Breached" n={breached.length} label="Breached orders">{breached.map(row)}</Group>}
      {holding.length > 0 && <Group head="Holding" n={holding.length} label="Orders holding">{holding.map(row)}</Group>}
      {!orders.length && <p className="wb-none">No standing orders yet.</p>}
    </>
  );
  const o = orders.find((x) => x.id === cur);
  return (
    <Workbench cls="wb-orders" list={list} listLabel="Standing orders" listRef={listRef} onKey={onKey} detailKey={cur} detailLabel="Selected order"
      strip={(
        <>
          <div className="wb-count"><b>{orders.length}</b><span>standing orders</span></div>
          <div className={'wb-count' + (breaches ? ' t-red' : '')}><b>{breaches}</b><span>breaches</span></div>
          <div className={'wb-count' + (breached.length ? ' t-amber' : '')}><b>{breached.length}</b><span>orders breached</span></div>
          {mine > 0 && <div className="wb-count"><b>{mine}</b><span>written today</span></div>}
          <span className="wb-src">{sim.live ? 'live scan' : 'simulated swarm'}</span>
        </>
      )}
      detail={<div className="wb-scroll">{o ? <OrderDetail o={o} /> : <Writer />}</div>} />
  );
}

function OrderDetail({ o }: { o: SimOrder }) {
  const E = useEngine(), M = E.M, sim = M.sim, P = M.P;
  const t = useBp((s) => s.t);
  const gov = Object.keys(sim.ordMap()[o.id] ?? {}).filter((id) => P.F[id]);
  const by = P.P[o.by];
  const feat = (id: string, breach: boolean) => {
    const f = P.F[id], st = stageAt(f, t, P.asOf), ag = (sim.AGF[id] || []).length;
    return (
      <li key={id}>
        <button type="button" onClick={() => E.flyToFeature(id)} onPointerEnter={() => E.setHl(id)} onPointerLeave={() => E.setHl(null)}>
          <span className="mk"><StageSym st={st} w={20} h={13} /></span>
          <span className="tx"><small>{f.code ? f.code + ' · ' : ''}{P.D[f.domain]?.name ?? f.domain} · {st ? STAGE_WORD[st] : 'not yet'}{ag ? ' · ' + ag + ' agent' + (ag > 1 ? 's' : '') : ''}</small>{f.name}</span>
          <span className="pc">{breach ? <b className="t-red">breach</b> : null}</span>
        </button>
      </li>
    );
  };
  return (
    <>
      <div className="wb-kick"><span className={o.vf.length ? 'st failed' : 'st done'}>{o.vf.length ? 'breached' : 'holding'}</span><span>{o.id}</span><span>sheet {sheetOf(P, o.lens).no}</span></div>
      <h3 className="wb-title">{o.text}</h3>
      <p className="wb-lede">Governs {sim.scopeWords(o).replace(/^./, (c) => c.toLowerCase()) || 'its places'}. Set by {by ? by.name : pname(P, o.by)}{o.user ? ', written in this session' : ' since ' + o.since}.{o.held?.asks.length ? ' It asked ' + o.held.asks.length + ' question' + (o.held.asks.length === 1 ? '' : 's') + '.' : ''}</p>
      <div className="wb-figs">
        <Fig n={o.vf.length} label={o.vf.length === 1 ? 'breach' : 'breaches'} tone={o.vf.length ? 'red' : 'mint'} />
        <Fig n={gov.length} label="features governed" />
        <Fig n={gov.reduce((n, id) => n + (sim.AGF[id] || []).length, 0)} label="agents inside" />
        {o.tpl && o.tpl !== 'first' && <Fig n={o.held?.n ?? 0} label={(o.held?.n ?? 0) === 1 ? 'event held' : 'events held'} />}
      </div>
      <div className="wb-inline">
        <button type="button" className="bt" onClick={() => { E.setOrdHi(o.id); if (gov.length) { E.setTarget(Object.fromEntries(gov.map((id) => [id, 1])) as Record<string, 1>, sim.scopeWords(o) || o.id); E.lookAtTarget(); } }}>Show its places</button>
        <span className="wb-meta">The plan outlines this order’s places while it is selected.</span>
      </div>
      <Sec head="Breaches" aside={o.vf.length ? 'click to find on the plan' : 'none'}>
        {o.vf.length ? <ul className="wb-agents-l" aria-label={'Breaches of ' + o.id}>{o.vf.filter((id) => P.F[id]).map((id) => feat(id, true))}</ul>
          : <p className="none">Every agent inside this order’s places is working within it.</p>}
      </Sec>
      <Sec head="Features it governs" aside={gov.length}>
        {gov.length ? <ul className="wb-agents-l" aria-label={'Features governed by ' + o.id}>{gov.filter((id) => !o.vf.includes(id)).map((id) => feat(id, false))}</ul>
          : <p className="none">Its scope matches no feature on this plan.</p>}
      </Sec>
    </>
  );
}

/** The writer: the current selection as a new order, from the four templates (preview, then commit). */
function Writer() {
  const E = useEngine();
  const s = useBp((s) => ({ tgt: s.tgt, prev: s.prev }), shallowEqual);
  const drafting = s.prev?.kind === 'order';
  return (
    <>
      <div className="wb-kick"><span>New order</span><span>{s.tgt.n ? s.tgt.n + ' features selected' : 'no selection'}</span></div>
      <h3 className="wb-title">Write an order</h3>
      <p className="wb-lede">An order is a standing rule the agents follow inside a place until you lift it. Pick the place on the plan, then a rule.</p>
      {!s.tgt.n ? (
        <Sec head="First, point at a place" aside="plan">
          <p>Shift-click a wing, room or fixture, or shift-drag a box on the plan. The selection shows here.</p>
        </Sec>
      ) : (
        <>
          <Sec head="Place" aside={s.tgt.n + ' features'}>
            <p>{s.tgt.label}</p>
            <div className="wb-inline"><button type="button" className="bt" onClick={() => E.lookAtTarget()}>Look at it</button><button type="button" className="bt" onClick={() => E.clearTarget()}>Clear the selection</button></div>
          </Sec>
          <Sec head="Rule" aside="preview before it applies">
            {drafting ? <PreviewBox /> : (
              <ul className="wb-tpl" aria-label="Order templates">
                {(Object.keys(ORDER_TEMPLATES) as OrderTemplate[]).map((k) => (
                  <li key={k}><button type="button" onClick={() => E.preview('order', k)}>{ORDER_TEMPLATES[k]}</button></li>
                ))}
              </ul>
            )}
          </Sec>
        </>
      )}
    </>
  );
}
