'use client';
// The right-hand dock: search, the "what changed" window, GA and blast, whose desk, swarm vitals and
// four tabs (Asks, Swarm, Orders, Plan).
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Stage } from '@/lib/data';
import {
  SPEND_CAP, STAGE_WORD, TICK_CLASS, astat, lensHealth, personLens, pname, revAt, search, sheetOf, stageAt, views,
  type RoomNode, type BayNode,
} from '@/lib/model';
import type { DockTab } from '@/engine/state';
import { AsksTab } from './Queue';
import { Legend } from './Legend';
import { Mark, PatternDefs, StageSym, agentMark } from './Symbols';
import { shallowEqual, useBp, useEngine, useVariant } from './hooks';

function SearchBox() {
  const E = useEngine(), M = E.M;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { E.focusSearch = () => { ref.current?.focus(); ref.current?.select(); }; }, [E]);
  const results = q.trim() ? search(M.P, q) : [];
  const preview = (i: number) => { setSel(i); E.setSel(results[i]?.id ?? null); };
  const close = () => { setQ(''); E.setSel(null); };
  const open = (id: string) => { close(); ref.current?.blur(); E.openFeature(id); };
  return (
    <div id="searchbox">
      <svg className="mg" viewBox="0 0 18 18" aria-hidden="true"><circle cx="7.5" cy="7.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11.5 11.5 L16 16" stroke="currentColor" strokeWidth="1.8" /></svg>
      <input id="q" ref={ref} type="search" autoComplete="off" spellCheck={false} placeholder="Find a feature, e.g. gift cards" aria-label="Search features" aria-controls="results" value={q}
        onChange={(e) => { setQ(e.target.value); const r = e.target.value.trim() ? search(M.P, e.target.value) : []; setSel(0); E.setSel(r[0]?.id ?? null); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) preview((sel + 1) % results.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) preview((sel - 1 + results.length) % results.length); }
          else if (e.key === 'Enter') { e.preventDefault(); const f = results[sel]; if (f) open(f.id); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); ref.current?.blur(); }
        }} />
      <span className="kb">/</span>
      {q.trim() && (
        <ul id="results" role="listbox">
          {results.length ? results.map((f, i) => (
            <li key={f.id} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onPointerEnter={() => preview(i)} onClick={() => open(f.id)}>
              <StageSym st={f.stage} w={18} h={12} />
              <span className="t">{f.name}</span>
              <span className="r">{M.P.scale > 1 ? E.M.L.TILE[f.id].wing.bld.b.short + ' · ' : ''}{M.P.D[f.domain].name} · {f.stage ? STAGE_WORD[f.stage] : 'Stage unknown'}</span>
            </li>
          )) : <li className="none">No feature matches “{q}”. Try “gift”, “waitlist” or “tax”.</li>}
        </ul>
      )}
    </div>
  );
}

function Tools() {
  const E = useEngine();
  const s = useBp((s) => ({ delta: s.delta, ga: s.ga, blast: s.blast }), shallowEqual);
  return (
    <div id="tools">
      <div className="seg" role="group" aria-label="What changed: window">
        {([1, 7, 14] as const).map((d) => <button key={d} type="button" aria-pressed={s.delta === d} title={d === 1 ? 'Show what changed in the last 24 hours' : 'Last ' + d + ' days'} onClick={() => E.setDelta(d)}>{d === 1 ? '24h' : d + 'd'}</button>)}
      </div>
      <button type="button" className="ga" aria-pressed={s.ga} title="Payments GA readiness (G)" onClick={() => E.toggleGA()}>Payments GA</button>
      <button type="button" className="bl" aria-pressed={!!s.blast} title="Blast radius of the selected feature (B)" onClick={() => E.toggleBlast()}>Blast</button>
    </div>
  );
}

function WhoRow() {
  const E = useEngine(), M = E.M;
  const s = useBp((s) => ({ who: s.who, whoMenu: s.whoMenu, simV: s.simV }), shallowEqual);
  if (!M.sim.has) return null;
  const c = M.sim.tallyStatus(), p = s.who ? M.P.P[s.who] : null;
  const persons = M.P.people.filter((x) => x.kind === 'human'), open = M.sim.openDecs();
  return (
    <>
      <div id="whoRow">
        <button id="who" type="button" aria-haspopup="listbox" aria-expanded={s.whoMenu} title="Whose desk is this? (P)" onClick={() => E.patch({ whoMenu: !s.whoMenu })}>
          <span className="av">{p ? p.name.charAt(0) : '·'}</span><span className="nm">{p ? p.name.split(' ')[0] : 'Everyone'}</span><span className="cv">▾</span>
        </button>
        <div id="vitals" aria-live="polite">
          <span title="Agents working"><Mark k="work" w={20} h={14} />{c.working}</span>
          <span title="Agents waiting for a person"><Mark k="wait" w={20} h={14} />{c.waiting}</span>
          <span title="Agents blocked"><Mark k="block" w={20} h={14} />{c.blocked}</span>
          <span title="Agents failed"><Mark k="fail" w={20} h={14} />{c.failed}</span>
          {c.paused ? <span title="Agents paused by you">{c.paused} paused</span> : null}
        </div>
      </div>
      {s.whoMenu && (
        <ul id="whoMenu" role="listbox" aria-label="View as" data-keys="own" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); E.patch({ whoMenu: false }); } }}>
          {[{ id: null as string | null, name: 'Everyone', sub: 'the whole product, all sheets', n: open.length }].concat(persons.map((x) => ({ id: x.id, name: x.name, sub: x.title + ' · ' + sheetOf(M.P, personLens(M.P, x.id)).nm, n: open.filter((d) => d.decider === x.id).length }))).map((r) => (
            <li key={r.id ?? 'all'} role="option" tabIndex={0} aria-selected={(s.who || '') === (r.id || '')} className={(s.who || '') === (r.id || '') ? 'on' : ''}
              onClick={() => E.setWho(r.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); E.setWho(r.id); } }}>
              <span className="av">{r.name.charAt(0)}</span><span>{r.name}<small>{r.sub}</small></span><span className="n">{r.n}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PreviewBox() {
  const E = useEngine();
  const p = useBp((s) => s.prev);
  if (!p) return null;
  return (
    <div className="prev">
      <div className="big">{p.title}</div>
      <ul>{p.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <div className="row"><button type="button" className="bt go" onClick={() => E.commitPreview()}>Commit · Enter</button><button type="button" className="bt" onClick={() => E.cancelPreview()}>Cancel · Esc</button></div>
    </div>
  );
}

function SwarmTab() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ simV: s.simV, prev: s.prev, tgt: s.tgt, crew: s.crew, ticker: s.ticker }), shallowEqual);
  if (!sim.has) return <div className="qempty">No swarm data.</div>;
  const spend = sim.spend().toLocaleString('en-US');
  const tm = (t: number) => new Date(sim.at0 + t * 1000).toISOString().slice(11, 16);
  return (
    <>
      <h3 className="dsec-h"><span>Steer the swarm</span><span>{sim.agents.length} agents</span></h3>
      {!sim.live && <><div className="steer"><h5>Payments GA first</h5><p>Pull the agents working on M3 and M4 onto the unfinished Payments GA features. Order O-4 allows it.</p>
        {s.prev && s.prev.order === 'O-4' ? <PreviewBox /> : <button type="button" className="bt" onClick={() => E.preview('ga')}>Preview what it moves</button>}</div>
      <div className="steer"><h5>Pause the research crew</h5><p>The daily spend cap order (O-7) says research stops first. Spend today: ${spend} of ${SPEND_CAP.toLocaleString('en-US')}.</p>
        {s.prev && s.prev.order === 'O-7' ? <PreviewBox /> : <button type="button" className="bt" onClick={() => E.preview('research')}>Preview</button>}</div></>}
      {s.tgt.n ? (
        <div className="steer"><h5>On your selection</h5><p>{s.tgt.label} · {s.tgt.n} features</p>
          {s.prev && !s.prev.order ? <PreviewBox /> : <div className="row"><button type="button" className="bt" onClick={() => E.preview('push')}>Put the swarm here</button><button type="button" className="bt" onClick={() => E.preview('pause')}>Pause</button><button type="button" className="bt" onClick={() => E.preview('resume')}>Resume</button></div>}</div>
      ) : <div className="steer"><h5>Point at a place</h5><p>Shift-click a wing, room or fixture, or shift-drag a box, then pull agents, pause them or write an order for exactly that place.</p></div>}
      <h3 className="dsec-h"><span>Latest from the swarm</span><span>{sim.live ? 'live scan' : 'simulated'}</span></h3>
      <div className="lat">
        {sim.log.length ? sim.log.filter((e) => !(sim.speed > 60 && e.syn)).slice(0, 7).map((e, i) => {
          const a = sim.AG[e.agent];
          return <button key={i + e.agent + e.t} type="button" className={TICK_CLASS[e.type] || ''} onClick={() => E.flyToFeature(e.f)}><i>{tm(e.t)}</i><span>{(a ? a.base + ' ' : '') + e.text}</span></button>;
        }) : <div style={{ padding: '6px 12px', color: 'var(--ink-2)' }}>Nothing yet this hour.</div>}
      </div>
      <h3 className="dsec-h"><span>Crews</span><span>working · waiting · blocked</span></h3>
      {sim.squads.map((q) => {
        const ag = sim.agents.filter((a) => a.sq === q.id), cc = { working: 0, waiting: 0, blocked: 0, failed: 0, paused: 0, idle: 0 };
        for (const a of ag) cc[astat(a)]++;
        const on = s.crew === q.id;
        return (
          <div key={q.id}>
            <button type="button" className={'crew' + (on ? ' on' : '')} onClick={() => E.patch({ crew: on ? null : q.id })} aria-expanded={on}>
              <span className="n">{q.name.replace(' crew', '')}<i>{q.role}</i></span>
              <span className="c"><span style={{ color: 'var(--mint)' }}>{cc.working}</span><span style={{ color: 'var(--amber)' }}>{cc.waiting}</span><span style={{ color: 'var(--red)' }}>{cc.blocked + cc.failed}</span></span>
              <span className="f">{q.focus}</span>
              <span className="stk">{(['working', 'waiting', 'blocked', 'failed', 'paused'] as const).map((k) => cc[k] ? <i key={k} style={{ width: (100 * cc[k]) / ag.length + '%', background: k === 'working' ? 'var(--mint)' : k === 'waiting' ? 'var(--amber)' : k === 'paused' ? 'var(--ink-3)' : 'var(--red)' }} /> : null)}</span>
            </button>
            <AnimatePresence initial={false}>
              {on && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                  {ag.map((a) => (
                    <button key={a.id} type="button" className="agrow" onClick={() => E.flyToFeature(a.f)}>
                      <span><Mark k={agentMark(astat(a))} w={16} h={12} /></span>
                      <span className="t"><small>{a.base} · {M.P.F[a.f].name}</small>{a.task}</span><span className="p">{Math.round(a.pct)}%</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </>
  );
}

function OrdersTab() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ simV: s.simV, ordHi: s.ordHi }), shallowEqual);
  if (!sim.has) return <div className="qempty">No swarm data.</div>;
  return (
    <>
      <h3 className="dsec-h"><span>Standing orders</span><span>{sim.orders.length} · {sim.orders.reduce((n, o) => n + o.vf.length, 0)} breached</span></h3>
      {sim.orders.map((o) => {
        const n = o.vf.length, by = M.P.P[o.by];
        return (
          <div key={o.id} className={'ord' + (n ? ' v' : '') + (s.ordHi === o.id ? ' on' : '')} role="button" tabIndex={0}
            onPointerEnter={() => E.setOrdHi(o.id)} onPointerLeave={() => E.setOrdHi(null)} onClick={() => E.setOrdHi(s.ordHi === o.id ? null : o.id)}>
            <span className="st">{o.id}</span>
            <span className="tx">{o.text}</span>
            <span className="sc">{sim.scopeWords(o)} · {by ? by.name.split(' ')[0] : o.by}{o.user ? ' · new' : ' · since ' + o.since.slice(5)}</span>
            <span className="vi">{n ? <>{n} breach{n > 1 ? 'es' : ''}: {o.vf.slice(0, 4).map((id) => <button key={id} type="button" onClick={(e) => { e.stopPropagation(); E.flyToFeature(id); }}>{id.replace(/-[A-Z]$/, '')}</button>)}{n > 4 ? '+' + (n - 4) : ''}</> : 'No breach'}</span>
          </div>
        );
      })}
      <div className="qempty" style={{ fontSize: 13 }}>Hover an order to see the places it governs. Select places on the plan, then write an order from the selection bar.</div>
    </>
  );
}

const HINT = (
  <div className="hint"><b>Scroll</b> zoom · <b>drag</b> pan · <b>click</b> go in · <b>Esc</b> back<br /><b>Shift-drag</b> box-select · <b>Shift-click</b> target · <b>S</b> target mode<br /><b>/</b> find · <b>1–9</b> sheets · <b>J K</b> questions · <b>1–3</b> answer · <b>Space</b> pause swarm<br /><b>M</b> morning watch · <b>P</b> person · <b>G</b> GA · <b>B</b> blast · <b>\</b> panel</div>
);

function TitleBlock() {
  const E = useEngine(), M = E.M;
  const s = useBp((s) => ({ view: s.view, t: s.t, delta: s.delta }), shallowEqual);
  const sh = sheetOf(M.P, s.view), vs = views(M.P), c = M.agg.countsOf('ALL', M.P.features, s.t, s.delta), now = s.t === M.P.asOf;
  const bad = now ? M.agg.healthOf('ALL', M.P.features, 'general').bad : null;
  return (
    <div className="tbk">
      <div className="proj"><div className="v">{M.P.name.toUpperCase()}</div><span className="lab">{M.P.scale > 1 ? 'Campus ×' + M.P.scale : 'Project'}</span></div>
      <div className="sheet"><span className="lab">Sheet</span><span className="no">{sh.no}</span><span className="of">{vs.indexOf(sh.k) + 1} of {vs.length}</span></div>
      <div className="ttl"><span className="lab">{s.t} · rev {revAt(M.P.weeks, s.t)}/27</span><div className="v">{sh.title}</div></div>
      <div className="schedT"><span className="lab">Schedule · {M.P.features.length - c.none} features</span>
        <table><tbody>
          <tr><td className="sy"><StageSym st="live" w={18} h={11} /></td><td>Built, live for all</td><td className="n">{c.live}</td></tr>
          <tr><td className="sy"><StageSym st="flagged" w={18} h={11} /></td><td>Partly open, flagged</td><td className="n">{c.flagged}</td></tr>
          <tr><td className="sy"><StageSym st="in-dev" w={18} h={11} /></td><td>Being built or reviewed</td><td className="n">{c.build}</td></tr>
          <tr><td className="sy"><StageSym st="specified" w={18} h={11} /></td><td>On paper, promised</td><td className="n">{c.paper + c.dep}</td></tr>
          <tr className="tr"><td className="sy"><Mark k="cloud" w={20} h={14} /></td><td>In trouble</td><td className="n">{bad ?? '—'}</td></tr>
          <tr><td className="sy"><Mark k="delta" w={20} h={14} /></td><td>Changed, last {s.delta === 1 ? '24 h' : s.delta + ' days'}</td><td className="n">{c.chg}</td></tr>
        </tbody></table></div>
      <div className="disc">Sample data · simulated swarm · artwork stylised</div>
    </div>
  );
}

function PlanTab() {
  const E = useEngine(), M = E.M, V = useVariant();
  const s = useBp((s) => ({ view: s.view, place: s.place, ga: s.ga, blast: s.blast, key: s.key, t: s.t, simV: s.simV }), shallowEqual);
  const deep = s.place.find((c) => c.t === 'room' || c.t === 'bay');
  if (deep && !s.ga && !s.blast) {
    const o = E.placeById(deep.t, deep.id);
    const R = (deep.t === 'bay' ? (o as BayNode).room : (o as RoomNode));
    return (
      <>
        <PatternDefs />
        <h3 className="dsec-h"><span>Room schedule · {R.d.code || R.d.name}</span><span>{R.feats.length} features</span></h3>
        <ul className="sched">
          {R.bays.map((Bay) => (
            <li key={Bay.id} style={{ display: 'contents' }}>
              <div className="cap">{Bay.cap.name}</div>
              {Bay.tiles.map((T) => {
                const f = T.f, st: Stage | null = stageAt(f, s.t, M.P.asOf), now = s.t === M.P.asOf, hl = lensHealth(f, s.view), ag = M.sim.has ? (M.sim.AGF[f.id] || []).length : 0;
                return (
                  <button key={f.id} type="button" onClick={() => E.openFeature(f.id)} onPointerEnter={() => E.setHl(f.id)} onPointerLeave={() => E.setHl(null)}>
                    <StageSym st={st} w={20} h={13} />
                    <span>{f.name}{ag ? <span style={{ color: 'var(--mint)', font: '500 12px var(--mono)' }}> ◉{ag}</span> : null}</span>
                    <span className="w" style={{ color: now && hl === 'bad' ? 'var(--red-2)' : now && hl === 'watch' ? 'var(--amber)' : undefined }}>{st ? STAGE_WORD[st] : 'Not yet'}</span>
                  </button>
                );
              })}
            </li>
          ))}
        </ul>
        {HINT}
      </>
    );
  }
  // trouble per enabled lens (bad or watch), from the health computed at load: click to find
  const kc: Record<string, number> = {};
  for (const f of M.P.features) for (const t of f.trouble) kc[t.lens] = (kc[t.lens] || 0) + 1;
  const L = V.ui?.Legend ?? Legend;
  return (
    <>
      <PatternDefs />
      <h3 className="dsec-h"><span>Legend · {sheetOf(M.P, s.view).no}</span><span>{sheetOf(M.P, s.view).nm}</span></h3>
      <L view={s.view} />
      <h3 className="dsec-h"><span>Trouble by lens · click to find</span><span>features</span></h3>
      <ul className="kn">
        {M.P.lenses.map(({ id: k, name }) => (
          <li key={k} tabIndex={0} role="button" aria-pressed={s.key === k} className={s.key === k ? 'on' : ''} onClick={() => E.setKey(s.key === k ? null : k)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); E.setKey(s.key === k ? null : k); } }}>
            <span className="d" /><span>{name}: bad or to watch</span><span className="c">{kc[k] || 0}</span>
          </li>
        ))}
      </ul>
      <TitleBlock />
      {HINT}
    </>
  );
}

const DTABS: [DockTab, string][] = [['asks', 'Asks'], ['swarm', 'Swarm'], ['orders', 'Orders'], ['plan', 'Plan']];

export function Dock() {
  const E = useEngine(), sim = E.M.sim;
  const s = useBp((s) => ({ dtab: s.dtab, hidden: s.dockHidden, simV: s.simV }), shallowEqual);
  const nAsk = sim.has ? sim.openDecs().length : 0, nOrd = sim.has ? sim.orders.filter((o) => o.vf.length).length : 0;
  return (
    <>
      <motion.aside id="dock" aria-label="Swarm panel" initial={false} animate={s.hidden ? { x: 360, opacity: 0 } : { x: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 34 }} style={{ pointerEvents: s.hidden ? 'none' : 'auto' }}>
        <div id="dtop"><SearchBox /><Tools /><WhoRow /></div>
        <div id="dtabs" role="tablist" aria-label="Panel">
          {DTABS.map(([k, label]) => {
            const n = k === 'asks' ? nAsk : k === 'orders' ? nOrd : 0;
            return <button key={k} type="button" role="tab" aria-selected={s.dtab === k} onClick={() => E.setDockTab(k)}>{label}{n ? <b>{n}</b> : null}</button>;
          })}
        </div>
        <div id="dbody" tabIndex={-1}>
          {s.dtab === 'asks' ? <AsksTab /> : s.dtab === 'swarm' ? <SwarmTab /> : s.dtab === 'orders' ? <OrdersTab /> : <PlanTab />}
        </div>
        <button id="dhide" type="button" aria-label="Hide panel" title="Hide / show panel ( \ )" onClick={() => E.toggleDock(false)}>⟩</button>
      </motion.aside>
      {s.hidden && <button id="dshow" type="button" aria-label="Show panel" title="Show panel ( \ )" onClick={() => E.toggleDock(true)}>⟨</button>}
    </>
  );
}

export { pname };
