'use client';
// Steer (Kettle's simulated swarm; a live product has no steering): the list holds the spend overview, the two
// presets and, when places are selected, steering for that selection. The detail reads the selection in full: a
// preset's reason, the standing order it rests on and its preview (what moves, then Commit or Cancel); the overview
// is today's spend against the cap, by crew.
import { useMemo, useState } from 'react';
import { SPEND_CAP, astat } from '@bp/core/model';
import { shallowEqual, useBp, useEngine } from '../../hooks';
import { STEER_HERE, STEER_PRESET_ORDER, seatHere, type PreviewSeat } from '@/lib/model/preview-seat';
import { PreviewBox } from '../panels';
import { Fig, Group, Row, Sec, Workbench, useListRef, usePreviewSeat, useWalk } from './shell';

type Preset = { id: 'ga' | 'research'; order: string; title: string; why: string; what: string };
const PRESETS: readonly Preset[] = [
  { id: 'ga', order: STEER_PRESET_ORDER.ga, title: 'Payments GA first', why: 'Payments GA is the next milestone and its unfinished features are short of hands.', what: 'Pulls the agents working on M3 and M4 onto the unfinished Payments GA features. M3 and M4 slow down until you send the agents back.' },
  { id: 'research', order: STEER_PRESET_ORDER.research, title: 'Pause the research crew', why: 'The daily spend cap order says research stops first when spend runs high.', what: 'Pauses every research agent where it stands. Their features keep their progress; Resume picks them up again.' },
];
const OVER = 'overview', HERE = STEER_HERE;
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

export function Steer() {
  const E = useEngine(), sim = E.M.sim;
  const s = useBp((s) => ({ simV: s.simV, tgt: s.tgt }), shallowEqual);
  const [sel, setSel] = useState<string>(OVER);
  // a pending preview a row here owns (a preset's, or a steer of the selection) selects that row when it arrives
  const seat = usePreviewSeat((r) => setSel(r ?? OVER));
  const listRef = useListRef();
  const ids = useMemo(() => [OVER, ...PRESETS.map((p) => p.id), ...(s.tgt.n ? [HERE] : [])], [s.tgt.n]);
  const cur = ids.includes(sel) ? sel : OVER;
  const onKey = useWalk(ids, cur, (v) => setSel(v ?? OVER), listRef);
  if (!sim.has) return <div className="wb-empty"><b>No swarm data</b>Steering moves a simulated swarm; this product has none.</div>;
  const spend = sim.spend(), pct = Math.round((100 * spend) / SPEND_CAP);
  const t = sim.tallyStatus(), tone = pct >= 100 ? 'red' : pct >= 80 ? 'amber' : undefined;
  const list = (
    <>
      <ul role="listbox" aria-label="Overview" className="wb-solo">
        <Row id={OVER} on={cur === OVER} onPick={() => setSel(OVER)} cls="ov">
          <span className="rt">Spend and crews</span>
          <span className="rm"><span>{usd(spend)} of {usd(SPEND_CAP)}</span><span>{pct}%</span></span>
          <span className={'bar' + (tone ? ' t-' + tone : '')} aria-hidden="true"><i style={{ width: Math.min(100, pct) + '%' }} /></span>
        </Row>
      </ul>
      <Group head="Presets" n={PRESETS.length} label="Steering presets">
        {PRESETS.map((p) => (
          <Row key={p.id} id={p.id} on={cur === p.id} onPick={() => setSel(p.id)} label={p.title}>
            <span className="rk"><span>order {p.order}</span>{seat.row === p.id && <span>previewing</span>}</span>
            <span className="rt">{p.title}</span>
            <span className="rm"><span>{p.why}</span></span>
          </Row>
        ))}
      </Group>
      <Group head="Your selection" n={s.tgt.n ? s.tgt.n + ' features' : 'none'} label="Steer the selection">
        {s.tgt.n ? (
          <Row id={HERE} on={cur === HERE} onPick={() => setSel(HERE)} label={'Steer ' + s.tgt.label}>
            <span className="rt">{s.tgt.label}</span>
            <span className="rm"><span>push, pause or resume agents here</span></span>
          </Row>
        ) : <li className="wb-none">Shift-click or shift-drag on the plan to steer one place.</li>}
      </Group>
    </>
  );
  const preset = PRESETS.find((p) => p.id === cur);
  return (
    <Workbench cls="wb-steerp" list={list} listLabel="Steering" listRef={listRef} onKey={onKey} detailKey={cur} detailLabel="Selected steering" seat={seat} row={cur}
      strip={(
        <>
          <div className={'wb-count' + (tone ? ' t-' + tone : '')}><b>{pct}%</b><span>of today’s spend cap</span></div>
          <div className="wb-count t-mint"><b>{t.working}</b><span>working</span></div>
          <div className="wb-count"><b>{t.paused}</b><span>paused</span></div>
          <span className="wb-src">{sim.playing ? 'Space pauses the whole swarm' : 'swarm paused · Space resumes'}</span>
        </>
      )}
      detail={<div className="wb-scroll">{preset ? <PresetDetail p={preset} seat={seat} /> : cur === HERE ? <HereDetail seat={seat} /> : <SpendDetail />}</div>} />
  );
}

function SpendDetail() {
  const E = useEngine(), sim = E.M.sim;
  useBp((s) => s.simV);
  const spend = sim.spend(), pct = Math.round((100 * spend) / SPEND_CAP), left = Math.max(0, SPEND_CAP - spend);
  const crews = sim.squads.map((q) => {
    const ag = sim.agents.filter((a) => a.sq === q.id);
    return { q, n: ag.length, cost: ag.reduce((c, a) => c + a.cost, 0), working: ag.filter((a) => astat(a) === 'working').length, paused: ag.filter((a) => a.paused).length };
  }).sort((a, b) => b.cost - a.cost);
  const top = Math.max(1, ...crews.map((c) => c.cost));
  return (
    <>
      <div className="wb-kick"><span>Today</span><span>simulated swarm</span></div>
      <h3 className="wb-title">{usd(spend)} spent of the {usd(SPEND_CAP)} daily cap</h3>
      <p className="wb-lede">{pct >= 100 ? 'The cap is reached: standing order O-7 says research stops first.' : pct >= 80 ? 'Spend is close to the cap. Pausing research is the first lever (order O-7).' : 'Spend is within the cap.'}</p>
      <div className="wb-figs big">
        <Fig n={pct + '%'} label="of the cap" tone={pct >= 100 ? 'red' : pct >= 80 ? 'amber' : 'mint'} />
        <Fig n={usd(left)} label="left today" />
        <Fig n={sim.agents.filter((a) => !a.paused).length} label="agents spending" />
      </div>
      <div className={'wb-prog' + (pct >= 100 ? ' t-red' : pct >= 80 ? ' t-amber' : '')} role="progressbar" aria-valuemin={0} aria-valuemax={SPEND_CAP} aria-valuenow={spend} aria-label="Spend against the cap"><i style={{ width: Math.min(100, pct) + '%' }} /></div>
      <Sec head="Spend by crew" aside="today">
        <ul className="wb-spend" aria-label="Spend by crew">
          {crews.map((c) => (
            <li key={c.q.id}>
              <span className="nm">{c.q.name.replace(' crew', '')}<small>{c.q.role} · {c.working} working{c.paused ? ' · ' + c.paused + ' paused' : ''}</small></span>
              <span className="bar" aria-hidden="true"><i style={{ width: (100 * c.cost) / top + '%' }} /></span>
              <b>{usd(c.cost)}</b>
            </li>
          ))}
        </ul>
      </Sec>
    </>
  );
}

function PresetDetail({ p, seat }: { p: Preset; seat: PreviewSeat }) {
  const E = useEngine(), M = E.M, sim = M.sim;
  const o = sim.orders.find((x) => x.id === p.order), by = o ? M.P.P[o.by] : null;
  return (
    <>
      <div className="wb-kick"><span>Preset</span><span>rests on order {p.order}</span></div>
      <h3 className="wb-title">{p.title}</h3>
      <p className="wb-lede">{p.why}</p>
      <Sec head="What it does"><p>{p.what}</p></Sec>
      {o && (
        <Sec head={'Standing order ' + o.id} aside={by ? by.name : o.by}>
          <p>{o.text}</p>
          <p className="wb-help">{sim.scopeWords(o)}{o.vf.length ? ' · ' + o.vf.length + ' breach' + (o.vf.length > 1 ? 'es' : '') + ' now' : ' · holding'}</p>
        </Sec>
      )}
      <Sec head="Preview" aside="nothing moves until you commit">
        {seatHere(seat, p.id) ? <PreviewBox /> : <div className="wb-inline"><button type="button" className="bt go" onClick={() => E.preview(p.id)}>Preview what it moves</button></div>}
      </Sec>
    </>
  );
}

function HereDetail({ seat }: { seat: PreviewSeat }) {
  const E = useEngine(), sim = E.M.sim;
  const s = useBp((s) => ({ tgt: s.tgt, simV: s.simV }), shallowEqual);
  const inside = sim.agents.filter((a) => s.tgt.ids[a.f]);
  const working = inside.filter((a) => astat(a) === 'working').length, paused = inside.filter((a) => a.paused).length;
  return (
    <>
      <div className="wb-kick"><span>Your selection</span><span>{s.tgt.n} features</span></div>
      <h3 className="wb-title">{s.tgt.label}</h3>
      <div className="wb-figs">
        <Fig n={s.tgt.n} label="features" />
        <Fig n={working} label="agents working here" tone={working ? 'mint' : undefined} />
        <Fig n={paused} label="paused here" />
      </div>
      <Sec head="Steer this place" aside="preview, then commit">
        {seatHere(seat, HERE) ? <PreviewBox /> : (
          <div className="wb-inline">
            <button type="button" className="bt" onClick={() => E.preview('push')}>Put the swarm here</button>
            <button type="button" className="bt" onClick={() => E.preview('pause')}>Pause</button>
            <button type="button" className="bt" onClick={() => E.preview('resume')}>Resume</button>
            <button type="button" className="bt" onClick={() => E.lookAtTarget()}>Look at it</button>
          </div>
        )}
        <p className="wb-help">To set a lasting rule for this place instead, write an order from the Orders panel.</p>
      </Sec>
    </>
  );
}
