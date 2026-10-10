'use client';
// Chrome floating over the map: level ladder, scale bar, live ticker, hover card, decision card,
// selection bar, callouts (blast radius, GA readiness, "what is going on"), toasts and the morning watch.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  GA_MILESTONE, STAGE_PLAIN, STAGE_WORD, ORDER_TEMPLATES, TICK_CLASS, astat, dnum, fmtWait, isAgentId, isLiveSt, lensOf, morningStats,
  pname, sheetOf, stageAt, type BayNode, type BldNode, type OrderTemplate, type RoomNode, type WingNode,
} from '@/lib/model';
import { illoSVG } from '@/engine/render/illo';
import { shallowEqual, useBp, useEngine, useVariant } from './hooks';
import { lensWords } from './sheet/words';

// ---------------------------------------------------------------------------------- ladder, scale
export function Ladder() {
  const E = useEngine();
  const s = useBp((s) => ({ level: s.level, names: s.levelNames, selMode: s.selMode, open: s.open }), shallowEqual);
  return (
    <nav id="ladder" aria-label="Zoom level">
      <button type="button" className="zb" aria-label="Zoom out" title="Zoom out (−)" onClick={() => E.zoomBy(-1)}>−</button>
      <button type="button" className="zb" aria-label="Zoom in" title="Zoom in (+)" onClick={() => E.zoomBy(1)}>+</button>
      <span className="lvl">LEVEL</span>
      <button type="button" aria-pressed={s.selMode} title="Target mode: click or drag to select places (S). Shift-click and shift-drag work anytime." onClick={() => E.toggleSelMode()}>⌖ TARGET</button>
      {s.names.map((n, i) => (
        <button key={n} type="button" className={i === s.level ? 'cur' : ''} aria-current={i === s.level ? 'true' : undefined} title={'Go to level ' + i} onClick={() => E.goLevel(i)}>L{i} {n.toUpperCase()}</button>
      ))}
    </nav>
  );
}

export function ScaleBar() {
  const E = useEngine();
  const ref = useRef<HTMLDivElement>(null), txt = useRef<HTMLSpanElement>(null), bar = useRef<HTMLElement>(null), tail = useRef<HTMLSpanElement>(null);
  useEffect(() => E.onFrame(() => {
    const el = ref.current; if (!el) return;
    const sc = E.scaleText(), U = E.U;
    if (txt.current && txt.current.textContent !== sc.text) txt.current.textContent = sc.text;
    const show = sc.bar <= 150;
    if (bar.current) { bar.current.style.display = show ? '' : 'none'; bar.current.style.width = Math.round(Math.max(sc.bar, 10)) + 'px'; }
    if (tail.current) tail.current.style.display = show ? '' : 'none';
    el.style.right = Math.round((E.FW - E.SAFE.r) / U + 12) + 'px';
    const ladder = document.getElementById('ladder');
    el.style.visibility = E.SAFE.r / U - 12 - el.offsetWidth < (ladder?.offsetWidth || 560) + 28 ? 'hidden' : 'visible';
  }), [E]);
  return <div id="scalebar" ref={ref}><span ref={txt} /><i ref={bar} className="sb" /><span ref={tail}>= one feature</span></div>;
}

export function Ticker() {
  const E = useEngine();
  const s = useBp((s) => ({ e: s.ticker, t: s.t, intro: s.intro }), shallowEqual);
  if (!s.e || s.t !== E.M.P.asOf || s.intro) return null;
  const e = s.e, a = E.M.sim.AG[e.agent], tm = new Date(E.M.sim.at0 + e.t * 1000).toISOString().slice(11, 16);
  const tx = e.type === 'move' ? e.text.replace(/^[a-z]+(?:-\d)?\.\d+(?:-[A-Z])?/, a ? a.base : e.agent) : (a ? a.base : e.agent) + ' ' + e.text;
  return <div id="ticker" aria-live="off"><div className={TICK_CLASS[e.type] || ''}><i>{tm}</i><span>{tx}</span></div></div>;
}

// ----------------------------------------------------------------------------------- hover card
function plainStage(E: ReturnType<typeof useEngine>, f: import('@/lib/data').Feature, st: ReturnType<typeof stageAt>, now: boolean) {
  let s = st ? STAGE_PLAIN[st] : 'Not yet on the drawing at this date';
  if (now) {
    if (st === 'flagged' && E.M.sim.rolloutOf(f) < 100) s = 'Live for ' + E.M.sim.rolloutOf(f) + '% of studios, behind a switch';
    if (st === 'in-dev') s = 'Being built, about ' + Math.round(E.M.sim.progOf(f)) + '% done';
  }
  return s;
}
function SwarmLines({ fs }: { fs: readonly import('@/lib/data').Feature[] }) {
  const E = useEngine(), sim = E.M.sim, S = E.S;
  if (!sim.has || S.t !== E.M.P.asOf) return null;
  const ss = sim.stats(fs, S.who, S.view);
  return (
    <>
      {ss.n ? <div className="sw">{ss.n} agent{ss.n > 1 ? 's' : ''}: {[ss.working && ss.working + ' working', ss.waiting && ss.waiting + ' waiting for a person', ss.blocked && ss.blocked + ' blocked', ss.failed && ss.failed + ' failed', ss.paused && ss.paused + ' paused'].filter(Boolean).join(' · ')}</div> : null}
      {ss.asks ? <div className="sw q">{ss.asks} open question{ss.asks > 1 ? 's' : ''}{ss.mine ? ', ' + ss.mine + ' for ' + (S.who ? pname(E.M.P, S.who).split(' ')[0] : 'this sheet') : ''}</div> : null}
    </>
  );
}
function HoverBody() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ hover: s.hover, view: s.view, t: s.t, delta: s.delta, simV: s.simV, selMode: s.selMode }), shallowEqual);
  const h = s.hover; if (!h) return null;
  const now = s.t === M.P.asOf;
  if (h.type === 'pin') {
    const ids = h.ids ?? [h.id], d = sim.DEC[ids[0]]; if (!d) return null;
    const cluster = ids.length > 1 || !!h.ids;
    return (
      <>
        <div className="k">{cluster ? ids.length + ' question' + (ids.length > 1 ? 's' : '') + ' in ' + M.P.D[d.dom]?.name : 'Question for ' + pname(M.P, d.decider) + ' · ' + d.base}</div>
        <div className="n q">{d.q}</div>
        {cluster ? ids.slice(1, 4).map((x) => { const o = sim.DEC[x]; return <div key={x} className="sw q" style={{ fontSize: 13 }}>{o.base} · {o.q.length > 70 ? o.q.slice(0, 68) + '…' : o.q}</div>; })
          : <div className="sw q">waiting {fmtWait(sim.waitMin(d))} · holds {sim.blocksNow(d)} agent{sim.blocksNow(d) === 1 ? '' : 's'}</div>}
        <div className="h">Click to answer it here</div>
      </>
    );
  }
  if (h.type === 'agent') {
    const A = sim.AG[h.id]; if (!A) return null;
    const f = M.P.F[A.f], st = astat(A), dq = A.wait && sim.DEC[A.wait]?.open ? sim.DEC[A.wait] : null;
    const word = { working: 'working', waiting: 'waiting for a person', blocked: 'blocked', failed: 'stopped, failed', paused: 'paused by you', idle: 'idle' }[st];
    const col = st === 'working' ? 'var(--mint)' : st === 'waiting' ? 'var(--amber)' : st === 'paused' ? 'var(--ink)' : 'var(--red)';
    return (
      <>
        <div className="k">{sim.crewName(A.sq)} crew · {A.role}{M.P.scale > 1 ? ' · ' + M.P.buildings[A.b].short : ''}</div>
        <div className="n" style={{ fontSize: 21 }}>{A.base} <span style={{ fontSize: 15, fontWeight: 500, color: col }}>{word}</span></div>
        <div className="s">{A.task}</div>
        <div className="e">{f.name} · {Math.round(A.pct)}%{sim.live ? '' : ' · $' + A.cost.toFixed(0) + ' today'} · {A.done} {sim.live ? 'measured' : 'tasks done'}</div>
        {dq && <div className="sw q">Waiting on {pname(M.P, dq.decider)} · {dq.base}</div>}
        <div className="h">{dq ? 'Click to answer its question' : 'Click to open the feature'}</div>
      </>
    );
  }
  if (h.type === 'tile') {
    const f = M.P.F[h.id]; if (!f) return null;
    const st = stageAt(f, s.t, M.P.asOf);
    let line = plainStage(E, f, st, now);
    if (now) { const ag = f.builtBy.filter((p) => isAgentId(M.P, p)); if (ag.length) line += '. Built by ' + ag.map((p) => pname(M.P, p)).join(' & '); }
    const lw = now && lensOf(M.P, s.view) ? lensWords(M.P, f, s.view, sim) : null;
    const br = now && sim.has ? sim.breachesOn(f.id) : [];
    return (
      <>
        <div className="k">{f.code ? f.code + ' · ' : ''}{M.P.D[f.domain].name} › {M.P.C[f.capability].name}</div>
        <div className="n">{f.name}</div>
        <div className="s">{line}.</div>
        {lw && <div className="e">{lw}</div>}
        {now && f.trouble.length ? <div className="t">{f.trouble.slice(0, 3).map((t) => <div key={t.lens} style={t.h === 'watch' ? { color: 'var(--amber-2)' } : undefined}>◆ {M.P.LENS[t.lens].name}: {t.why}</div>)}</div> : null}
        <SwarmLines fs={[f]} />
        {now && sim.has && (sim.AGF[f.id] || []).slice(0, 4).map((a) => <div key={a.id} className="sw dim">{a.base} · {a.task}</div>)}
        {br.length ? <div className="t">● Breaches order {br.map((b) => b.id).join(', ')}</div> : null}
        <div className="h">Click to open the full sheet{s.selMode ? ' · Shift-click targets it' : ''}</div>
      </>
    );
  }
  const o = E.placeById(h.type, h.id); if (!o) return null;
  let title = '', kick = '', sub = '', art: string | null = null;
  if (h.type === 'wing') { const w = o as WingNode; title = w.def.name; kick = 'Wing ' + w.def.letter + (M.P.scale > 1 ? ' · ' + w.bld.name : ''); sub = w.def.plain + '. ' + w.rooms.length + ' rooms: ' + w.rooms.map((r) => r.d.name).join(', ') + '.'; art = w.def.art; }
  else if (h.type === 'room') { const r = o as RoomNode; title = r.d.name; kick = 'Room · wing ' + r.wing.def.letter + ' ' + r.wing.def.name; sub = r.d.summary; art = r.d.base; }
  else if (h.type === 'bay') { const b = o as BayNode; title = b.cap.name; kick = 'Bay · ' + b.room.d.name; sub = b.tiles.length + ' features: ' + b.tiles.map((T) => T.f.name).join(', ') + '.'; art = b.room.d.base; }
  else { const b = o as BldNode; title = b.name; kick = 'Building'; sub = b.wings.length + ' wings, ' + b.wings.reduce((n, w) => n + w.rooms.length, 0) + ' rooms'; }
  const c = M.agg.countsOf(o.id, o.feats, s.t, s.delta);
  const parts = lensOf(M.P, s.view) && now ? [o.feats.length + ' features', ...E.lensAgg(o.id, s.view, o.feats).parts] : [o.feats.length + ' features', c.live + c.flagged + ' live', c.build + ' building', c.paper + ' on paper'];
  const bad = now ? M.agg.healthOf(o.id, o.feats, s.view).bad : 0, tot = Math.max(1, c.n);
  return (
    <>
      {art && <div className="art" dangerouslySetInnerHTML={{ __html: illoSVG(art, 'currentColor') }} style={{ color: 'var(--lens)' }} />}
      <div className="k">{kick}</div><div className="n">{title}</div><div className="s">{sub}</div>
      <div className="bar">
        {[[c.live, 0.85], [c.flagged, 0.5], [c.build, 0.25], [c.paper + c.none, 0.08]].map(([n, a], i) => n ? <i key={i} style={{ width: (100 * n) / tot + '%', background: 'var(--ink)', opacity: a }} /> : null)}
        {c.dep ? <i style={{ width: (100 * c.dep) / tot + '%', background: 'var(--red)', opacity: 0.4 }} /> : null}
      </div>
      <div className="e">{parts.join(' · ')}</div>
      {bad ? <div className="t">{bad} in trouble</div> : null}
      <SwarmLines fs={o.feats} />
      <div className="h">Click or scroll to go inside · Shift-click to target</div>
    </>
  );
}
export function HoverCard() {
  const E = useEngine();
  const h = useBp((s) => s.hover, shallowEqual);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { E.setHoverEl(wrap.current); return () => E.setHoverEl(null); }, [E]);
  useLayoutEffect(() => { E.placeHover(); });
  return (
    <div ref={wrap} style={{ position: 'absolute', left: 0, top: 0, zIndex: 5, pointerEvents: 'none' }} aria-hidden="true">
      <AnimatePresence>
        {h && (
          <motion.div id="hov" key="hov" style={{ position: 'relative' }} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.14 }}>
            <HoverBody />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// -------------------------------------------------------------------------------- decision card
export function DecisionCard() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ dec: s.dec, simV: s.simV, who: s.who, view: s.view }), shallowEqual);
  const ref = useRef<HTMLDivElement>(null);
  const d = s.dec ? sim.DEC[s.dec] : null;
  useEffect(() => {
    if (!d) return;
    return E.onFrame(() => {
      const el = ref.current; if (!el) return;
      const r = E.featureRect(d.f); if (!r) return;
      const u = E.U, S = E.SAFE, w = 372 * u, h = (el.offsetHeight || 380) * u;
      let x = r.x + r.w + 16 * u, y = r.y + r.h / 2 - h / 2;
      if (x + w > S.r) x = r.x - w - 16 * u;
      if (x < S.l) x = Math.max(S.l, Math.min(S.r, S.r - w - 8 * u));
      y = Math.max(S.t, Math.min(Math.max(S.t, S.b - h), y));
      el.style.transform = `translate(${x / u}px, ${y / u}px)`;
    });
  }, [E, d]);
  useLayoutEffect(() => { E.dirty(); });
  return (
    <AnimatePresence>
      {d && d.open && (() => {
        const f = M.P.F[d.f], A = sim.AG[d.by], list = sim.cardOrder(s.who, s.view), pos = list.indexOf(d) + 1, wa = sim.agents.filter((a) => a.wait === d.id), bn = sim.blocksNow(d);
        return (
          <div ref={ref} style={{ position: 'absolute', left: 0, top: 0, zIndex: 8 }}>
            <motion.div id="dcard" key={d.id} className={'u-' + d.urg} role="dialog" aria-label="Decision" style={{ position: 'relative' }}
              initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
              <div className="k"><span>RFI · {d.base} · {d.urg === 'high' ? 'urgent' : d.urg === 'medium' ? 'soon' : 'when you can'} · sheet {sheetOf(M.P, d.lens).no}</span><button type="button" className="x" aria-label="Close" onClick={() => E.closeDecision()}>Esc</button></div>
              <h3>{d.q}</h3>
              <div className="by"><b>{A ? A.base : d.by}</b> ({A ? sim.crewName(A.sq) : ''}) stopped at <b>{f.name}</b> and asks <b>{pname(M.P, d.decider)}</b>.</div>
              <div className="meta"><span>waiting {fmtWait(sim.waitMin(d))}</span><span>holds {bn} agent{bn === 1 ? '' : 's'}</span><span>touches {d.affects.length}</span></div>
              {d.opts.map((o, i) => (
                <button key={i} type="button" className={'op' + (i === d.rec ? ' rec' : '')} onClick={() => E.decide(d.id, i)}>
                  <i className="no">{i + 1}</i><b>{o.label}{i === d.rec && <em>agent suggests</em>}</b><span>{o.consequence}</span>
                </button>
              ))}
              <div className="fx">{wa.length ? 'Answering frees ' + wa.map((a) => a.base).join(', ') + '. ' : 'Nobody is blocked on it. '}The amber outlines on the plan are the {d.affects.length} feature{d.affects.length > 1 ? 's' : ''} it touches.</div>
              <div className="nav"><button type="button" aria-label="Previous question" onClick={() => E.stepDecision(-1)}>‹ K</button><span>{pos || '–'} of {list.length}</span><button type="button" aria-label="Next question" onClick={() => E.stepDecision(1)}>J ›</button></div>
            </motion.div>
          </div>
        );
      })()}
    </AnimatePresence>
  );
}

// --------------------------------------------------------------------------------- selection bar
export function SelBar() {
  const E = useEngine(), sim = E.M.sim;
  const s = useBp((s) => ({ tgt: s.tgt, prev: s.prev, ordMenu: s.ordMenu, simV: s.simV }), shallowEqual);
  const p = s.prev;
  let body: React.ReactNode = null;
  if (p) {
    body = (
      <motion.div id="selbar" key="prev" className="prev" role="region" aria-label="Preview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
        <div className="kk">ADDENDUM · NOT ISSUED YET</div>
        <div className="big">{p.title}</div>
        <ul>{p.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="bt go" onClick={() => E.commitPreview()}>Commit · Enter</button>
          <button type="button" className="bt" onClick={() => E.cancelPreview()}>Cancel · Esc</button>
          <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--ink-2)' }}>Nothing has moved yet. The plan shows what would.</span>
        </div>
      </motion.div>
    );
  } else if (s.tgt.n) {
    const ag = sim.agentsIn(s.tgt.ids), ds = Object.keys(s.tgt.ids).flatMap((id) => sim.DOF[id] || []), wk = ag.filter((a) => a.status === 'working' && !a.paused).length;
    body = (
      <motion.div id="selbar" key="sel" role="region" aria-label="Selection" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
        <span className="sm"><b>{s.tgt.label}</b> · {s.tgt.n} feature{s.tgt.n > 1 ? 's' : ''} · {ag.length} agent{ag.length === 1 ? '' : 's'}{ag.length ? ' (' + wk + ' working)' : ''} · {ds.length} question{ds.length === 1 ? '' : 's'}</span>
        <button type="button" className="btn" onClick={() => E.lookAtTarget()}>Look closer</button>
        <button type="button" className="btn" onClick={() => E.patch({ info: true })}>What is going on?</button>
        <button type="button" className="btn" onClick={() => E.preview('push')}>Put the swarm here…</button>
        <button type="button" className="btn" onClick={() => E.preview('pause')}>Pause…</button>
        <button type="button" className="btn" onClick={() => E.preview('resume')}>Resume…</button>
        {s.ordMenu ? (Object.keys(ORDER_TEMPLATES) as OrderTemplate[]).map((k) => (
          <button key={k} type="button" className="btn ord-tpl" onClick={() => E.preview('order', k)}>{{ review: 'Human review first', ask: 'Ask me before rollout', first: 'Agents here go first', hold: 'Hold here' }[k]}</button>
        )) : <button type="button" className="btn" onClick={() => E.patch({ ordMenu: true })}>Write an order…</button>}
        <button type="button" className="btn" title="Clear (Esc)" aria-label="Clear selection" onClick={() => E.clearTarget()}>✕</button>
      </motion.div>
    );
  }
  return <AnimatePresence mode="wait">{body}</AnimatePresence>;
}

// -------------------------------------------------------------------------------------- callouts
export function Callout() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ blast: s.blast, ga: s.ga, info: s.info, tgt: s.tgt, simV: s.simV, dock: s.dockHidden }), shallowEqual);
  const pos = { left: Math.max(10, E.SAFE.r / E.U - 340), top: E.SAFE.t / E.U + 4, maxHeight: `calc(100% - ${E.SAFE.t / E.U + 140}px)` };
  let body: React.ReactNode = null, cls = '';
  if (s.info && s.tgt.n) {
    const ids = s.tgt.ids, ag = sim.agentsIn(ids), ds = Object.keys(ids).flatMap((id) => sim.DOF[id] || []), ev = sim.log.filter((e) => ids[e.f]).slice(0, 6);
    cls = 'info';
    body = (
      <>
        <button type="button" className="x" onClick={() => E.patch({ info: false })}>CLOSE</button>
        <h4>What is going on here</h4><div className="big">{s.tgt.label}</div>
        <div className="row"><span>Features</span><b>{s.tgt.n}</b></div>
        <div className="row"><span>Agents on them</span><b style={{ color: 'var(--mint-2)' }}>{ag.length}</b></div>
        <div className="row"><span>Questions open</span><b style={{ color: 'var(--amber-2)' }}>{ds.length}</b></div>
        <div className="sub">AGENTS</div>
        {ag.length ? ag.slice(0, 8).map((a) => <button key={a.id} type="button" className="lnk" onClick={() => E.flyToFeature(a.f)}><i>{a.base}</i>{astat(a)} · {a.task.length > 60 ? a.task.slice(0, 58) + '…' : a.task}</button>) : <div style={{ color: 'var(--ink-2)' }}>No agent is working here right now.</div>}
        <div className="sub">QUESTIONS</div>
        {ds.length ? ds.slice(0, 5).map((d) => <button key={d.id} type="button" className="lnk" onClick={() => E.openDecision(d.id)}><i>{d.base}</i>{d.q}</button>) : <div style={{ color: 'var(--ink-2)' }}>None open.</div>}
        <div className="sub">LATEST</div>
        {ev.length ? ev.map((e, i) => <div key={i} style={{ color: 'var(--ink-2)', fontSize: 13 }}>{new Date(sim.at0 + e.t * 1000).toISOString().slice(11, 16)} · {e.text}</div>) : <div style={{ color: 'var(--ink-2)' }}>Quiet so far this hour.</div>}
      </>
    );
  } else if (s.blast) {
    const bl = M.closure.of(s.blast), f0 = M.P.F[s.blast], direct = f0.usedBy;
    const prodAll = bl.filter((id) => isLiveSt(M.P.F[id].stage)), prodDir = direct.filter((id) => isLiveSt(M.P.F[id].stage));
    body = (
      <>
        <button type="button" className="x" onClick={() => E.setMode({ blast: null })}>CLEAR · ESC</button>
        <h4>Blast radius{f0.code ? ' · ' + f0.code : ''}</h4><div className="big">If {f0.name} breaks</div>
        <div className="row"><span>Depend on it directly</span><b>{direct.length}</b></div>
        <div className="row"><span>…of them live for customers</span><b style={{ color: 'var(--red-2)' }}>{prodDir.length}</b></div>
        <div className="row"><span>Reached through the chain</span><b>{bl.length}</b></div>
        <div className="row"><span>…of them live for customers</span><b>{prodAll.length}</b></div>
        {sim.has && <div className="row"><span>Agents working inside that radius</span><b style={{ color: 'var(--mint-2)' }}>{sim.agents.filter((a) => a.f === s.blast || bl.includes(a.f)).length}</b></div>}
        <div className="sub">DIRECT DEPENDENTS</div>
        {direct.map((id) => { const g = M.P.F[id]; return <button key={id} type="button" className="lnk" onClick={() => { E.setMode({ blast: null }); E.openFeature(id); }}>{g.code ? <i>{g.code}</i> : null}{g.name} <span style={{ color: 'var(--ink-2)' }}>· {g.stage ? STAGE_WORD[g.stage].toLowerCase() : 'stage unknown'}</span></button>; })}
      </>
    );
  } else if (s.ga) {
    // done but unsafe = live (or flagged) and in trouble under any enabled lens; blocked = has open blockers
    const ga = M.P.MS[GA_MILESTONE], m2 = M.P.features.filter((f) => f.milestone === GA_MILESTONE), cnt = (fn: (f: (typeof m2)[number]) => boolean) => m2.filter(fn).length;
    const blocked = m2.filter((f) => f.blockedBy.length > 0), unsafe = m2.filter((f) => isLiveSt(f.stage) && f.health === 'bad');
    const days = ga ? Math.round(dnum(ga.date) - dnum(M.P.asOf)) : 0, onM2 = sim.has ? sim.agents.filter((a) => sim.msOf(a.f) === GA_MILESTONE).length : 0;
    cls = 'ga';
    body = (
      <>
        <button type="button" className="x" onClick={() => E.setMode({ ga: false })}>CLOSE · G</button>
        <h4>Milestone {ga?.code ?? ''} · {ga?.date}</h4><div className="big">{ga?.name ?? 'The milestone'} in {days} days</div>
        <div className="row"><span>Features in this release</span><b>{m2.length}</b></div>
        <div className="row"><span>Done, live for all</span><b>{cnt((f) => f.stage === 'live')}</b></div>
        <div className="row"><span>Partly open (flagged)</span><b>{cnt((f) => f.stage === 'flagged')}</b></div>
        <div className="row"><span>Still being built or reviewed</span><b>{cnt((f) => f.stage === 'in-dev' || f.stage === 'in-review')}</b></div>
        <div className="row"><span>Not started</span><b>{cnt((f) => f.stage === 'specified' || f.stage === 'idea')}</b></div>
        <div className="row"><span>Blocked</span><b style={{ color: 'var(--amber-2)' }}>{blocked.length}</b></div>
        <div className="row"><span>Done but unsafe</span><b style={{ color: 'var(--red-2)' }}>{unsafe.length}</b></div>
        {sim.has && <><div className="row"><span>Agents on it right now</span><b style={{ color: 'var(--mint-2)' }}>{onM2} of {sim.agents.length}</b></div><div style={{ marginTop: 8 }}><button type="button" className="bt go" style={{ width: '100%', justifyContent: 'center' }} onClick={() => E.preview('ga')}>Put the swarm on it…</button></div></>}
        <div className="sub">DONE BUT UNSAFE</div>
        {unsafe.map((f) => <button key={f.id} type="button" className="lnk" onClick={() => E.openFeature(f.id)}>{f.code ? <i>{f.code}</i> : null}{f.name}</button>)}
        <div className="sub">BLOCKED</div>
        {blocked.map((f) => <button key={f.id} type="button" className="lnk" onClick={() => E.openFeature(f.id)}>{f.code ? <i>{f.code}</i> : null}{f.name} <span style={{ color: 'var(--ink-2)' }}>← {f.blockedBy.map((b) => M.P.F[b].name).join(', ')}</span></button>)}
      </>
    );
  }
  return (
    <AnimatePresence>
      {body && <motion.div id="callout" key={cls || 'blast'} className={cls} role="dialog" aria-live="polite" style={pos} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>{body}</motion.div>}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------------------------------------ toast
export function Toast() {
  const E = useEngine();
  const t = useBp((s) => s.toast);
  const [paused, setPaused] = useState(false);       // hover/focus holds the dwell; leaving restarts it in full
  useEffect(() => { setPaused(false); }, [t?.n]);
  useEffect(() => {
    if (!t || paused) return;
    const id = window.setTimeout(() => { if (E.S.toast?.n === t.n) E.dismissToast(); }, t.action ? 9000 : 5200);
    return () => clearTimeout(id);
  }, [E, t, paused]);
  return (
    <div className="toast-live" role="status" aria-live="polite" aria-atomic="true" style={{ display: 'contents' }}>
    <AnimatePresence>
      {t && (
        <motion.div id="toast" key={t.n} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} initial={{ opacity: 0, y: -14, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: -10, x: '-50%' }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
          <span><b>{t.strong}</b>{t.text ? ' · ' + t.text : ''}</span>
          {t.action === 'undo' && <button type="button" onClick={() => E.undoDecision()}>UNDO</button>}
          {t.action === 'undo2' && <button type="button" onClick={() => { E.undoCommand(); E.dismissToast(); }}>UNDO</button>}
          {t.action === 'replay' && <button type="button" onClick={() => { E.restart(); E.dismissToast(); }}>↺ REPLAY</button>}
          {t.fid && <button type="button" onClick={() => E.flyToFeature(t.fid!)}>SHOW</button>}
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------------------------- morning watch
export function Morning() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ on: s.morning, who: s.who, view: s.view, simV: s.simV }), shallowEqual);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (s.on) ref.current?.focus(); }, [s.on]);
  return (
    <AnimatePresence>
      {s.on && (() => {
        const ms = morningStats(M), q = sim.queueFor(s.who, s.view), mine = s.who ? q.mine : q.all.slice(0, 6), who = s.who ? pname(M.P, s.who).split(' ')[0] : null;
        const failed = sim.agents.filter((a) => a.status === 'failed'), blocked = sim.agents.filter((a) => a.status === 'blocked').length;
        const words: Record<string, string> = { commit: 'commits', 'pr-opened': 'pull requests', deploy: 'deploys', flag: 'flag changes', stage: 'stage moves', review: 'reviews', incident: 'incidents', comment: 'comments' };
        const by = Object.keys(ms.by).map((k) => ms.by[k] + ' ' + (words[k] || k)).join(' · ');
        return (
          <motion.section id="morning" key="m" ref={ref} tabIndex={-1} aria-label="While you were away" initial={{ opacity: 0, x: '-50%', y: '-46%', scale: 0.98 }} animate={{ opacity: 1, x: '-50%', y: '-50%', scale: 1 }} exit={{ opacity: 0, x: '-50%', y: '-48%', scale: 0.98 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
            <div className="kk">While you were away · since 18:00 · simulated sample</div>
            <h2>{who ? 'Good morning, ' + who + '.' : 'Good morning.'}</h2>
            <div className="lead">The swarm shipped {ms.changes} changes overnight ({by}). {failed.length ? failed.length + ' agent stopped after repeated failures. ' : ''}{blocked} are blocked. <b>{who ? mine.length + ' question' + (mine.length === 1 ? '' : 's') + ' wait for you' : q.all.length + ' questions wait for a person'}.</b></div>
            <div className="big4">
              <div><b>{ms.changes}</b>changes since 18:00</div>
              <div className="am"><b>{ms.asked}</b>questions asked while you slept</div>
              <div className="am"><b>{who ? mine.length : q.all.filter((d) => d.urg === 'high').length}</b>{who ? 'waiting for you' : 'urgent now'}</div>
              {!sim.live && <div><b>${ms.spend.toLocaleString('en-US')}</b>spent today, cap $2,400</div>}
            </div>
            <div className="cols">
              <div><h4>What moved</h4><ul>{ms.ev.slice(0, 7).map((a, i) => <li key={i}><button type="button" onClick={() => E.flyToFeature(a.feature + (M.P.scale > 1 ? '-S' : ''))}><i>{a.at.slice(11, 16)}</i><span>{a.text}</span></button></li>)}</ul></div>
              <div><h4>{who ? 'Waiting for you' : 'Most urgent'}</h4><ul>{mine.slice(0, 6).map((d) => <li key={d.id}><button type="button" onClick={() => E.openDecision(d.id)}><i>{d.base}</i><span>{d.q}</span></button></li>)}{mine.length ? null : <li style={{ color: 'var(--ink-2)', padding: '6px 0' }}>Nothing is waiting. The swarm is working.</li>}</ul></div>
            </div>
            <div className="act">
              <button type="button" className="bt" onClick={() => E.morningShow()}>Show the changes on the plan</button>
              <button type="button" className="bt" onClick={() => E.toggleMorning(false)}>Close</button>
              <button type="button" className="bt go" onClick={() => { E.toggleMorning(false); const l = sim.cardOrder(s.who, s.view); if (l.length) E.openDecision(l[0].id); }}>{mine.length ? 'Go through the questions ▸' : 'Watch the swarm ▸'}</button>
            </div>
          </motion.section>
        );
      })()}
    </AnimatePresence>
  );
}

export { useVariant };
