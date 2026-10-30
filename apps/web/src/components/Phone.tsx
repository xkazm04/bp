'use client';
// The phone view: the person's queue first, then a searchable reading list. No plan on a phone. The title line's
// "drawing set | findings ledger" switch swaps both for the findings ledger, triage list only (ledger/LedgerPage.tsx).
// The ledger is its own chunk (LedgerPageLazy, below; BlueprintApp mounts the same one), fetched the first time the
// ledger page shows: `/`'s first-load JS carries none of it (scripts/check-train-budget.ts --bundle proves it).
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { GENERAL } from '@bp/core/data/types';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { LIVE_DECIDER, fmtWait, pname, sheetOf, type BldNode, type RoomNode, type SimDecision, type WingNode } from '@bp/core/model';
import type { Feature } from '@bp/core/data';
import { useProductName } from '@/lib/scan/projects';
import { livenessWords, scanLiveness } from '@bp/core/scan/liveness';
import { SheetBody } from './FeatureSheet';
import { Toast } from './Overlays';
import { URG, metricMove, oncePerProposal, proposalSummary } from './Queue';
import { BriefFacts, useBrief } from './Brief';
import { LiveFoot } from './sheet/SheetBody';
import { PatternDefs, StageSym } from './Symbols';
import { ThemeToggle } from './ThemeToggle';
import { shallowEqual, useBp, useEngine, useLive, useWritesOn } from './hooks';
import { PageSwitch } from './Header';
import type { LedgerPageProps } from './ledger/LedgerPage';

const LedgerChunk = lazy(() => import('./ledger/LedgerPage').then((m) => ({ default: m.LedgerPage })));
/**
 * The findings ledger, loaded on demand: mount it only while the store's `page` is 'ledger' (the import starts at the
 * first mount, and nothing shows until it lands: the page fades in as it always did). The one door to the ledger's
 * chunk; nothing else imports ledger/LedgerPage.tsx or train/** statically.
 */
export function LedgerPageLazy(props: LedgerPageProps) {
  return <Suspense fallback={null}><LedgerChunk {...props} /></Suspense>;
}

const SHOWN = 12;
/**
 * The reading list under the phone's search box, with every empty level dropped: a room with no hit, a wing whose
 * rooms all have none, and a building whose wings all have none. Without this the headings rendered whatever the
 * query was, so a search for one feature printed every wing of the plan with nothing under most of them.
 * Exported pure so check-overlays can hold the rule (it is not reachable through a server render: `q` is state).
 */
export function phoneFind(blds: readonly BldNode[], q: string): { B: BldNode; wings: { W: WingNode; rooms: { R: RoomNode; hits: Feature[] }[] }[] }[] {
  const v = q.trim().toLowerCase();
  const hit = (x: Feature) => !v || (x.id + ' ' + x.name + ' ' + x.summary).toLowerCase().includes(v);
  return blds
    .map((B) => ({
      B,
      wings: B.wings
        .map((W) => ({ W, rooms: W.rooms.map((R) => ({ R, hits: R.feats.filter(hit) })).filter((r) => r.hits.length > 0) }))
        .filter((w) => w.rooms.length > 0),
    }))
    .filter((b) => b.wings.length > 0);
}
/** A decline note survives a refused write (the card remounts when the decision reopens). */
const drafts = new Map<string, string>();

/** The scan's state as a compact pill in the header: the desktop pill's verdict (@bp/core/scan/liveness) in its short form. */
function PhoneStatus() {
  const L = useLive()?.product;
  if (!L) return null;
  const { cls, text, title } = livenessWords(scanLiveness(L, Date.now()), 'short');
  return <span className={'livepill ' + cls} role="status" title={title}><i />{text}</span>;
}

function Question({ d, rm }: { d: SimDecision; rm: boolean }) {
  const E = useEngine(), M = E.M, P = M.P, sim = M.sim, live = useLive(), writes = useWritesOn();
  const [declining, setDeclining] = useState(() => drafts.has(d.base)), [note, setNote] = useState(() => drafts.get(d.base) ?? '');
  const scan = live?.product.scan, prop = sim.live ? scan?.proposals.find((x) => x.id === d.base) : undefined;
  const sum = prop ? proposalSummary(prop) : null, mv = prop ? metricMove(prop, (l, k) => P.LENS[l]?.F[k]?.unit, scan) : null;
  const brief = useBrief(d);
  return (
    <motion.div layout={!rm} className={'ph-q u-' + d.urg} exit={rm ? { opacity: 0 } : { opacity: 0, height: 0, marginBottom: 0 }} transition={rm ? { duration: 0 } : undefined}>
      <div className="k">{d.base} · {URG[d.urg]}{sim.live && d.decider === LIVE_DECIDER ? '' : ' · ' + pname(P, d.decider)}</div>
      <h4>{d.q}</h4>
      {sum && <div className="psum">{sum}</div>}
      {mv && <div className="mv">{mv}</div>}
      <div className="mt">{P.F[d.f].name} · waiting {fmtWait(sim.waitMin(d))}{sim.live ? '' : ' · holds ' + sim.blocksNow(d) + ' agent' + (sim.blocksNow(d) === 1 ? '' : 's')}</div>
      {brief && <BriefFacts b={brief} d={d} compact />}
      {sim.live ? (
        !writes ? null : declining ? (
          <form className="dn" onSubmit={(e) => { e.preventDefault(); drafts.set(d.base, note.trim()); E.decide(d.id, 1, note.trim()); }}>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not? (optional)" aria-label="Decline note (optional)" maxLength={500} />
            <button type="submit" className="bt">Decline</button>
            <button type="button" className="bt" onClick={() => { drafts.delete(d.base); setNote(''); setDeclining(false); }}>Cancel</button>
          </form>
        ) : (
          <div className="row">
            {d.recNote ? <button type="button" className="bt go" title={'Decline, noting: ' + d.recNote} onClick={() => E.decide(d.id, 1, d.recNote)}>✓ Decline · a repeat</button> : null}
            <button type="button" className={'bt' + (d.recNote ? '' : ' go')} onClick={() => E.decide(d.id, 0)}>{d.recNote ? 'Approve anyway' : '✓ Approve'}</button>
            <button type="button" className="bt" onClick={() => setDeclining(true)}>{d.recNote ? 'My own note…' : 'Decline…'}</button>
          </div>
        )
      ) : d.opts.map((o, i) => <button key={i} type="button" className={'op' + (i === d.rec ? ' rec' : '')} onClick={() => E.decide(d.id, i)}><i className="no">{i + 1}</i><b>{o.label}{i === d.rec && <em>suggested</em>}</b><span>{o.consequence}</span></button>)}
    </motion.div>
  );
}

export function Phone() {
  const E = useEngine(), M = E.M, P = M.P, sim = M.sim;
  const s = useBp((s) => ({ who: s.who, view: s.view, simV: s.simV, open: s.open, page: s.page }), shallowEqual);
  const [q, setQ] = useState(''), [all, setAll] = useState(false), rm = !!useReducedMotion();
  const name = useProductName(M.live?.slug ?? null, P.name);
  // the sim runs on a timer here (no frames): a re-render every 30 simulated seconds keeps the waits honest
  const [, setTick] = useState(0);
  useEffect(() => E.onSimTime((t) => setTick(Math.floor(t / 30))), [E]);
  const c = M.agg.countsOf('ALL', P.features, P.asOf, 7), qq = sim.queueFor(s.who, s.view);
  const once = (ds: SimDecision[]) => (sim.live ? oncePerProposal(ds) : ds);
  const list = once(s.who ? qq.mine : qq.all), v = q.trim().toLowerCase();
  const found = phoneFind(M.L.blds, q);
  const persons = P.people.filter((p) => p.kind === 'human'), open = sim.openDecs();
  const f = s.open ? P.F[s.open] : null;
  const detailOpen = !!s.open;
  const detail = useRef<HTMLDivElement>(null);
  // The full-screen detail owns a history entry, so the platform Back gesture closes it instead of leaving the app.
  useEffect(() => {
    if (!detailOpen) return;
    history.pushState({ ...(history.state ?? {}), phDetail: true }, '');
    const onPop = () => E.closeFeature(false);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (history.state?.phDetail) history.back();   // closed some other way: consume the stranded entry
    };
  }, [E, detailOpen]);
  // It covers the whole screen (aria-modal), so the reading position goes into it on open and back to the row
  // that opened it on close - the morning watch's pattern (Overlays.tsx Morning).
  useEffect(() => {
    if (!detailOpen) return;
    const was = document.activeElement as HTMLElement | null;
    detail.current?.focus({ preventScroll: true });
    return () => { if (was && was !== document.body && was.isConnected) was.focus({ preventScroll: true }); };
  }, [detailOpen]);
  return (
    <>
    <div className="ph">
      <PatternDefs />
      <div className="ph-top"><b className="ph-brand">{name}</b><PhoneStatus /><ThemeToggle /></div>
      <div className="ph-h"><div className="k">PROJECT {P.name.toUpperCase()} · <PageSwitch /> · SHEET {sheetOf(P, s.view).no} · {P.asOf} · {M.live ? 'LIVE LENS SCAN' : 'SIMULATED SWARM'}</div><h1>{P.name.toUpperCase()}</h1><p>{P.tagline}</p></div>
      {s.page === 'ledger' ? <LedgerPageLazy phone /> : <>
      <div className="ph-sum">
        <div><b>{P.features.length}</b>features</div><div><b>{c.live + c.flagged}</b>live</div><div><b>{c.build}</b>being built</div>
        <div className="am"><b>{sim.has ? once(qq.all).length : 0}</b>questions waiting</div>
        <div><b>{sim.has ? sim.agents.filter((a) => a.status === 'working').length : 0}</b>agents working</div>
        <div className="tr"><b>{P.features.filter((x) => x.health === 'bad').length}</b>in trouble</div>
      </div>
      {sim.has && (
        <>
          <div className="ph-sec"><span>Whose desk</span></div>
          <div className="ph-who">
            <button type="button" aria-pressed={!s.who} onClick={() => E.setWho(null)}>Everyone</button>
            {persons.map((p) => <button key={p.id} type="button" aria-pressed={s.who === p.id} onClick={() => E.setWho(p.id)}>{p.name.split(' ')[0]} · {open.filter((d) => d.decider === p.id).length}</button>)}
          </div>
          <div className="ph-sec"><span>{s.who ? 'Waiting for ' + pname(P, s.who).split(' ')[0] : 'Waiting for a person'}</span><span>{list.length}</span></div>
          <AnimatePresence initial={false}>
            {(all ? list : list.slice(0, SHOWN)).map((d) => <Question key={d.id} d={d} rm={rm} />)}
          </AnimatePresence>
          {list.length > SHOWN && <button type="button" className="ph-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : 'Show ' + (list.length - SHOWN) + ' more'}</button>}
          {s.who && !qq.mine.length && <div className="qempty"><b>Nothing waits for you.</b>The swarm has what it needs.</div>}
        </>
      )}
      <div className="ph-sec"><span>Find a feature</span></div>
      <input className="ph-search" type="search" placeholder="Find a feature…" aria-label="Search features" value={q} onChange={(e) => setQ(e.target.value)} />
      {v && !found.length && (
        <div className="qempty">
          <b>No feature matches “{q.trim()}”.</b>
          Nothing in {P.features.length} features has that in its name, summary or id.
          <button type="button" className="bt" style={{ height: 44, marginTop: 10 }} onClick={() => setQ('')}>Clear the search</button>
        </div>
      )}
      {found.map(({ B, wings }) => (
        <div key={B.id}>
          {P.scale > 1 && <div className="ph-wing" style={{ fontSize: 14, color: 'var(--ink-hi)' }}>{B.name}</div>}
          {wings.map(({ W, rooms }) => (
            <div key={W.id}>
              <div className="ph-wing">Wing {W.def.letter} · {W.def.name}</div>
              {rooms.map(({ R, hits }) => {
                const rc = M.agg.countsOf(R.id, R.feats, P.asOf, 7), bad = M.agg.healthOf(R.id, R.feats, GENERAL).bad;
                return (
                  <details key={R.id + (v ? '-q' : '')} className="ph-dom" open={!!v}>
                    <summary>{R.name}<span>{rc.n} · {rc.live + rc.flagged} live{bad ? ' · ' + bad + ' trouble' : ''}</span></summary>
                    {R.bays.map((Bay) => {
                      const fs = Bay.tiles.filter((T) => hits.includes(T.f));
                      if (!fs.length) return null;
                      return (
                        <div key={Bay.id}>
                          <h3>{Bay.name}</h3>
                          {fs.map((T) => {
                            const h = T.f.health, bad = h === 'bad';   // health reads by shape (◆ trouble, ● watch) and by name, not hue alone
                            return <button key={T.id} type="button" aria-label={bad || h === 'watch' ? T.f.name + (bad ? ', in trouble' : ', needs watching') : undefined} onClick={() => E.openFeature(T.id)}><StageSym st={T.f.stage} w={22} h={14} /><span>{T.f.name}</span><span aria-hidden="true" style={{ color: bad ? 'var(--red)' : 'var(--amber)' }}>{bad ? '◆' : h === 'watch' ? '●' : null}</span></button>;
                          })}
                        </div>
                      );
                    })}
                  </details>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      </>}
      <LiveFoot />
      <div className="foot">Open on a wider screen for the zoomable plan.</div>
      <AnimatePresence>
        {f && (
          <motion.div ref={detail} tabIndex={-1} className="ph-detail" role="dialog" aria-modal="true" aria-label="Feature detail" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={rm ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 32 }}>
            <button type="button" className="btn" style={{ marginBottom: 10, height: 44 }} onClick={() => { if (history.state?.phDetail) history.back(); else E.closeFeature(false); }}>‹ Back</button>
            <SheetBody key={f.id} f={f} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    <Toast />
    </>
  );
}
