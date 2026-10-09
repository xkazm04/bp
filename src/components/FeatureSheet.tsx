'use client';
// One feature as a document. The lens panels (one per enabled lens, from the manifests) follow the lens
// mix: in General they all sit side by side; in a lens, its panel moves to the top and grows to its
// reader's density while the others collapse to their headline (a Motion layout animation,
// interruptible like the canvas tween). Each panel ends with its metric rows (MetricRows, from the
// manifest); the Business section (as-is, core, variations) follows the panels, and a live product's
// Screens strip follows that.
import { useEffect, useRef } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import type { Feature } from '@/lib/data';
import { REV_DESC, STAGE_WORD, astat, fmtWait, isAgentId, lensOf, pname, type Model } from '@/lib/model';
import { illoSVG } from '@/engine/render/illo';
import { DefaultLensPanel, MetricRows } from './sheet/LensPanel';
import { BusinessSection } from './sheet/Business';
import { ScreensStrip } from './sheet/Screens';
import { plainLine } from './sheet/words';
import { Mark, PatternDefs, StageSym, agentMark } from './Symbols';
import { shallowEqual, useBp, useDensity, useEngine, useLive, useVariant } from './hooks';

function SwarmSection({ f }: { f: Feature }) {
  const E = useEngine(), M = E.M, sim = M.sim;
  useBp((s) => s.simV);
  if (!sim.has) return null;
  const ag = sim.AGF[f.id] || [], ds = sim.DOF[f.id] || [], ords = sim.ordersOn(f.id), ev = sim.log.filter((e) => e.f === f.id).slice(0, 4);
  return (
    <div className="swm">
      <h4>{sim.live ? 'The scan on this feature · live' : 'The swarm on this feature · simulated'}</h4>
      {!ag.length && !ds.length && !ev.length && <div style={{ color: 'var(--ink-2)', fontSize: 14, padding: '4px 0' }}>No agent is working here right now.{f.stage === 'live' ? ' It is live and quiet.' : ''}</div>}
      {ag.map((a) => (
        <div key={a.id} className="arow">
          <span><Mark k={agentMark(astat(a))} w={18} h={13} /></span>
          <span><b style={{ color: 'var(--ink-hi)', fontWeight: 500 }}>{a.base}</b> <span style={{ color: 'var(--ink-2)' }}>· {sim.crewName(a.sq)} · {astat(a)}</span><br /><span style={{ color: 'var(--ink-2)', fontSize: 13 }}>{a.task}</span></span>
          <span className="pb"><i style={{ width: Math.round(a.pct) + '%' }} /></span>
          <span style={{ font: '500 12px var(--mono)', color: 'var(--ink-2)' }}>{Math.round(a.pct)}%{sim.live ? '' : ' · $' + a.cost.toFixed(0)}</span>
        </div>
      ))}
      {ds.map((d) => (
        <div key={d.id} className="dq">
          <b>{d.base} · {d.q}</b>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', margin: '2px 0 4px' }}>{sim.live ? 'For whoever reviews' : pname(M.P, d.decider) + ' decides'} · waiting {fmtWait(sim.waitMin(d))} · holds {sim.blocksNow(d)} agent{sim.blocksNow(d) === 1 ? '' : 's'}</div>
          {d.opts.map((o, i) => <button key={i} type="button" className={'op' + (i === d.rec ? ' rec' : '')} onClick={() => E.decide(d.id, i)}><i className="no">{i + 1}</i><b>{o.label}{i === d.rec && <em>agent suggests</em>}</b><span>{o.consequence}</span></button>)}
        </div>
      ))}
      {ords.length ? <div style={{ marginTop: 8, fontSize: 14 }}>{ords.map((x) => <div key={x.id}><span className="ag" style={{ margin: '0 6px 0 0', color: x.vf.includes(f.id) ? 'var(--red-2)' : 'var(--amber)', borderColor: 'currentColor' }}>{x.id}{x.vf.includes(f.id) ? ' BREACHED' : ''}</span>{x.text}</div>)}</div> : null}
      {ev.length ? <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-2)' }}>{ev.map((e, i) => <div key={i}>{new Date(sim.at0 + e.t * 1000).toISOString().slice(11, 16)} · {e.text}</div>)}</div> : null}
      {!sim.live && <div className="btns">
        <button type="button" className="btn" onClick={() => E.preview(ag.some((a) => a.paused) ? 'resume' : 'pause', undefined, f.id)}>{ag.some((a) => a.paused) ? 'Resume agents here' : 'Pause agents here'}</button>
        <button type="button" className="btn" onClick={() => E.preview('push', undefined, f.id)}>Put the swarm on this…</button>
        <button type="button" className="btn" onClick={() => { E.setTarget({ [f.id]: 1 }, f.name); E.patch({ ordMenu: true }); }}>Write an order here…</button>
      </div>}
    </div>
  );
}

function LensPanels({ f, M }: { f: Feature; M: Model }) {
  const V = useVariant(), dens = useDensity();
  const view = useBp((s) => s.view);
  const Panel = V.ui?.SheetPanel ?? DefaultLensPanel, scan = useLive()?.product.scan;
  const ids = M.P.lenses.map((l) => l.id);
  const order = lensOf(M.P, view) ? [view, ...ids.filter((l) => l !== view)] : ids;
  return (
    <LayoutGroup>
      <div className="ev6">
        {order.map((l) => {
          const cur = view === l, mini = view !== 'general' && !cur;
          return (
            <motion.div key={l} layout transition={{ type: 'spring', stiffness: 260, damping: 30 }} className={'evp ' + (f.lens[l]?.h ?? 'unmeasured') + (cur ? ' cur' : '') + (mini ? ' mini' : '')}>
              <Panel lens={l} def={M.P.LENS[l]} f={f} model={M} density={dens(l)} expanded={cur} view={view} />
              {!mini && <MetricRows def={M.P.LENS[l]} f={f} model={M} scan={scan} all={cur} fl={f.lens[l]} />}
            </motion.div>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

export function SheetBody({ f }: { f: Feature }) {
  const E = useEngine(), M = E.M, P = M.P, T = M.L.TILE[f.id];
  const pl = plainLine(P, f, M.sim), ms = f.milestone ? P.MS[f.milestone] : null;
  const acts = P.activity.filter((a) => a.feature === f.id).slice(0, 8);
  const who = (id: string) => <>{pname(P, id)}{isAgentId(P, id) && <span className="ag">AGENT</span>}</>;
  const dl = (ids: string[], empty: string) => ids.length ? ids.map((id) => { const g = P.F[id]; return <button key={id} type="button" onClick={() => E.openFeature(id)}><StageSym st={g.stage} w={20} h={13} /><span>{g.name}</span><span className="w">{g.stage ? STAGE_WORD[g.stage] : 'Unknown'}</span></button>; }) : <div className="none">{empty}</div>;
  return (
    <>
      <PatternDefs />
      <div className="dh">
        <div className="bubble" title="Detail callout: detail number over feature code"><span className="a">{T.idx}</span><span className="b">{f.code || '—'}</span></div>
        <div>
          <div className="k">{P.scale > 1 ? T.wing.bld.name + ' › ' : ''}Wing {T.wing.def.letter} {T.wing.def.name} › {P.D[f.domain].name} › {P.C[f.capability].name}<br />{[f.priority, f.kind, ms ? (ms.code ? ms.code + ' ' : '') + ms.name : null].filter(Boolean).join(' · ')}</div>
          <h2>{f.name}</h2>
          <div className="sum">{f.summary}</div>
          <div className="plain"><b>{pl.strong}</b> {pl.rest.join(' ')} {pl.bad && <span className="bad">{pl.bad}</span>}</div>
          {(f.trouble.length || f.blockedBy.length) ? (
            <div className="tens">
              {f.trouble.filter((t) => t.h === 'bad').map((t) => <span key={t.lens}><i />{P.LENS[t.lens].name}: {t.why}</span>)}
              {f.blockedBy.length ? <span><i />Blocked by {f.blockedBy.map((x) => <button key={x} type="button" className="btn" style={{ height: 24, marginLeft: 4, textTransform: 'none', fontSize: 14 }} onClick={() => E.openFeature(x)}>{P.F[x].name}</button>)}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      <SwarmSection f={f} />
      <div className="dgrid">
        <div>
          <div className="illo"><div dangerouslySetInnerHTML={{ __html: illoSVG(P.D[f.domain].base, 'currentColor') }} style={{ color: 'var(--ink)' }} /><span className="cap">DETAIL {T.idx} · {(P.D[f.domain].code || P.D[f.domain].name).toUpperCase()} · STYLISED</span></div>
          <div className="mtb">
            <div><span className="l">Drawn by</span>{f.builtBy.length ? f.builtBy.map((id, i) => <span key={id}>{i ? ', ' : ''}{who(id)}</span>) : '—'}</div>
            <div><span className="l">Flagged by</span>{(() => {
              const bad = f.trouble.filter((t) => t.h === 'bad').map((t) => P.LENS[t.lens]?.name ?? t.lens), watch = f.trouble.length - bad.length;
              return bad.length ? <span className="nc">{bad.join(', ')}</span> : watch ? watch + ' lens' + (watch > 1 ? 'es' : '') + ' to watch' : f.health === 'good' ? 'No lens ✓' : 'Not measured yet';
            })()}</div>
            <div><span className="l">Owner</span>{pname(P, f.owner)}</div>
            <div><span className="l">Stage</span>{f.stage ? STAGE_WORD[f.stage] + ' · since ' + f.stageSince : 'Unknown'}</div>
            <div className="full"><span className="l">Lives in</span>{f.surfaces.map((s) => <span key={s} className="ag" style={{ margin: '0 4px 0 0' }}>{s}</span>)}</div>
          </div>
          <table className="revt"><thead><tr><th>REV</th><th>DATE</th><th>DESCRIPTION</th></tr></thead><tbody>
            {f.revs.map((h, i) => <tr key={i} className={i === f.revs.length - 1 ? 'now' : ''}><td className="m">{String.fromCharCode(65 + i)}</td><td className="m">{h.date}</td><td>{REV_DESC[h.stage]}</td></tr>)}
          </tbody></table>
          {f.parts && <div className="dsec"><h4>Parts · {f.parts.filter((p) => p.done).length} of {f.parts.length} done</h4><div className="parts">{f.parts.map((p) => <span key={p.name} className={p.done ? 'd' : ''}>{p.done ? '✓ ' : '○ '}{p.name}</span>)}</div></div>}
        </div>
        <div>
          <LensPanels f={f} M={M} />
          <BusinessSection f={f} />
          <ScreensStrip f={f} />
          <div className="dsec deps">
            <div className="dl"><h4>Depends on · {f.dependsOn.length}</h4>{dl(f.dependsOn, 'Nothing, it stands on its own')}</div>
            <div className="dl"><h4>Used by · {f.usedBy.length} · blast radius {M.closure.of(f.id).length}</h4>{dl(f.usedBy, 'Nothing depends on it')}</div>
          </div>
          {f.notes.length ? <div className="dsec"><h4>Red-pencil notes</h4><div className="notes">{f.notes.map((n, i) => <div key={i} className="pn">“{n.text}”<small>— {pname(P, n.by)}, {n.date}</small></div>)}</div></div> : null}
          <div className="dsec"><h4>Recent activity · 14 days</h4>
            {acts.length ? <ul className="acts">{acts.map((a, i) => <li key={i} className={a.type === 'incident' ? 'inc' : ''}><span className="m">{a.at.slice(5, 10)} {a.at.slice(11, 16)}</span><span className="a">{pname(P, a.actor)}{isAgentId(P, a.actor) ? ' ◇' : ''}</span><span>{a.text}{a.severity ? ' · ' + a.severity : ''}</span></li>)}</ul> : <div className="dl"><div className="none">Quiet, no events in the last 14 days</div></div>}
          </div>
          <div className="foot">Illustrative sample data · drawings are stylised, not screenshots</div>
        </div>
      </div>
    </>
  );
}

export function FeatureSheet() {
  const E = useEngine(), M = E.M;
  const s = useBp((s) => ({ open: s.open, phone: s.phone }), shallowEqual);
  const closeRef = useRef<HTMLButtonElement>(null), scroll = useRef<HTMLDivElement>(null);
  const f = s.open ? M.P.F[s.open] : null;
  useEffect(() => { if (f) { scroll.current?.scrollTo({ top: 0 }); const t = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 420); return () => clearTimeout(t); } }, [f]);
  const width = `min(950px, calc(100% - 300px))`;
  return (
    <AnimatePresence>
      {f && !s.phone && (
        <motion.section id="detail" key="sheet" aria-label="Feature detail sheet" style={{ width }} initial={{ x: '105%' }} animate={{ x: 0 }} exit={{ x: '105%' }} transition={{ type: 'spring', stiffness: 220, damping: 32 }}>
          <div className="frame" />
          <div id="dbar">
            <button type="button" className="btn" onClick={() => E.toggleBlast(f.id)}>Blast radius · B</button>
            <button type="button" className="btn" ref={closeRef} onClick={() => E.closeFeature()}>Back to plan · Esc</button>
          </div>
          <div id="dscroll" ref={scroll} tabIndex={-1}><SheetBody key={f.id} f={f} /></div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
