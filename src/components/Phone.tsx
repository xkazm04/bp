'use client';
// The phone view: the person's queue first, then a searchable reading list. No plan on a phone.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { fmtWait, pname } from '@/lib/model';
import { SheetBody } from './FeatureSheet';
import { Toast } from './Overlays';
import { PatternDefs, StageSym } from './Symbols';
import { ThemeToggle } from './ThemeToggle';
import { shallowEqual, useBp, useEngine } from './hooks';

export function Phone() {
  const E = useEngine(), M = E.M, P = M.P, sim = M.sim;
  const s = useBp((s) => ({ who: s.who, view: s.view, simV: s.simV, open: s.open }), shallowEqual);
  const [q, setQ] = useState('');
  const c = M.agg.countsOf('ALL', P.features, P.asOf, 7), qq = sim.queueFor(s.who, s.view);
  const list = s.who ? qq.mine : qq.all, v = q.trim().toLowerCase();
  const persons = P.people.filter((p) => p.kind === 'human'), open = sim.openDecs();
  const f = s.open ? P.F[s.open] : null;
  const detailOpen = !!s.open;
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
  return (
    <>
    <div className="ph">
      <PatternDefs />
      <div className="ph-top"><ThemeToggle /></div>
      <div className="ph-h"><div className="k">PROJECT {P.name.toUpperCase()} · SHEET G-001 · {P.asOf} · {M.live ? 'LIVE LENS SCAN' : 'SIMULATED SWARM'}</div><h1>{P.name.toUpperCase()}</h1><p>{P.tagline}</p></div>
      <div className="ph-sum">
        <div><b>{P.features.length}</b>features</div><div><b>{c.live + c.flagged}</b>live</div><div><b>{c.build}</b>being built</div>
        <div className="am"><b>{sim.has ? qq.all.length : 0}</b>questions waiting</div>
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
            {list.slice(0, 12).map((d) => (
              <motion.div key={d.id} layout className={'ph-q u-' + d.urg} exit={{ opacity: 0, height: 0, marginBottom: 0 }}>
                <div className="k">{d.base} · {d.urg} · {pname(P, d.decider)}</div>
                <h4>{d.q}</h4>
                <div className="mt">{P.F[d.f].name} · waiting {fmtWait(sim.waitMin(d))} · holds {sim.blocksNow(d)} agent{sim.blocksNow(d) === 1 ? '' : 's'}</div>
                {d.opts.map((o, i) => <button key={i} type="button" className={'op' + (i === d.rec ? ' rec' : '')} onClick={() => E.decide(d.id, i)}><i className="no">{i + 1}</i><b>{o.label}{i === d.rec && <em>suggested</em>}</b><span>{o.consequence}</span></button>)}
              </motion.div>
            ))}
          </AnimatePresence>
          {s.who && !qq.mine.length && <div className="qempty"><b>Nothing waits for you.</b>The swarm has what it needs.</div>}
        </>
      )}
      <div className="ph-sec"><span>Find a feature</span></div>
      <input className="ph-search" type="search" placeholder="Find a feature…" aria-label="Search features" value={q} onChange={(e) => setQ(e.target.value)} />
      {M.L.blds.map((B) => (
        <div key={B.id}>
          {P.scale > 1 && <div className="ph-wing" style={{ fontSize: 14, color: 'var(--ink-hi)' }}>{B.name}</div>}
          {B.wings.map((W) => (
            <div key={W.id}>
              <div className="ph-wing">Wing {W.def.letter} · {W.def.name}</div>
              {W.rooms.map((R) => {
                const hits = R.feats.filter((x) => !v || (x.id + ' ' + x.name + ' ' + x.summary).toLowerCase().includes(v));
                if (!hits.length) return null;
                const rc = M.agg.countsOf(R.id, R.feats, P.asOf, 7), bad = M.agg.healthOf(R.id, R.feats, 'general').bad;
                return (
                  <details key={R.id + (v ? '-q' : '')} className="ph-dom" open={!!v}>
                    <summary>{R.d.name}<span>{rc.n} · {rc.live + rc.flagged} live{bad ? ' · ' + bad + ' trouble' : ''}</span></summary>
                    {R.bays.map((Bay) => {
                      const fs = Bay.tiles.filter((T) => hits.includes(T.f));
                      if (!fs.length) return null;
                      return (
                        <div key={Bay.id}>
                          <h3>{Bay.cap.name}</h3>
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
      <div className="foot">{M.live ? 'Read from the live scan' : 'Illustrative sample data · simulated swarm'} · open on a wider screen for the zoomable plan.</div>
      <AnimatePresence>
        {f && (
          <motion.div className="ph-detail" role="dialog" aria-label="Feature detail" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 32 }}>
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
