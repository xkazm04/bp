'use client';
// The rail's classic Find flyout, and the pieces the wide workbench panels (./wide) share: the scan jobs hooks,
// the steering preview box, the sheet's title block and the keys hints.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { STAGE_WORD, revAt, searchPage, sheetOf, views, type BldNode } from '@bp/core/model';
import { useLiveJobs } from '@/lib/scan/client';
import { latestRun } from '@bp/core/scan/derive';
import type { ScanJob } from '@bp/core/scan/jobs';
import { runningScans } from '@bp/core/scan/liveness';
import { altLabel } from '@bp/core/scan/live-plan';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { Mark, StageSym } from '../Symbols';
import { shallowEqual, useBp, useEngine, useLive } from '../hooks';
import '../scan.css';
import { GENERAL } from '@bp/core/data/types';

// ------------------------------------------------------------------------------------------ find
export function FindPanel() {
  const E = useEngine(), M = E.M;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const qRef = useRef(q); qRef.current = q;
  // the previewed tile clears when the flyout closes (the input takes focus on mount: autoFocus)
  useEffect(() => () => { if (qRef.current.trim()) E.setSel(null); }, [E]);
  // one search per distinct query: the keystroke's handler and the render share it, and a re-render
  // (the rail re-renders on every sim sync) reuses it
  // at ?scale>1 a feature shows once; the clone in the product line the reader is in wins a tie
  const bld = useBp((s) => s.place.find((c) => c.t === 'bld')?.id);
  const prefer = bld ? (E.placeById('bld', bld) as BldNode | null)?.b.i : undefined;
  const memo = useRef({ P: M.P, q: '', pr: prefer, r: { hits: [], total: 0 } as ReturnType<typeof searchPage> });
  const find = (v: string) => {
    const m = memo.current;
    if (m.P !== M.P || m.q !== v || m.pr !== prefer) memo.current = { P: M.P, q: v, pr: prefer, r: v.trim() ? searchPage(M.P, v, 8, prefer) : { hits: [], total: 0 } };
    return memo.current.r.hits;
  };
  const results = find(q), listed = !!q.trim(), total = memo.current.r.total;
  const preview = (i: number) => { setSel(i); E.setSel(results[i]?.id ?? null); };
  const open = (id: string) => { setQ(''); E.setSel(null); E.setDockTab(null); E.openFeature(id); };
  return (
    <>
      <div id="searchbox">
        <svg className="mg" viewBox="0 0 18 18" aria-hidden="true"><circle cx="7.5" cy="7.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11.5 11.5 L16 16" stroke="currentColor" strokeWidth="1.8" /></svg>
        <input id="q" ref={ref} type="search" autoComplete="off" spellCheck={false} autoFocus placeholder={M.live ? 'Find a feature' : 'Find a feature, e.g. gift cards'} aria-label="Search features" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={listed} aria-controls={listed ? 'results' : undefined}
          aria-activedescendant={listed && results.length ? 'res-' + results[Math.min(sel, results.length - 1)].id : undefined} value={q}
          onChange={(e) => { setQ(e.target.value); const r = find(e.target.value); setSel(0); E.setSel(r[0]?.id ?? null); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) preview((sel + 1) % results.length); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) preview((sel - 1 + results.length) % results.length); }
            else if (e.key === 'Enter') { e.preventDefault(); const f = results[sel]; if (f) open(f.id); }
            else if (e.key === 'Escape') {
              e.preventDefault(); e.stopPropagation();
              if (q) { setQ(''); E.setSel(null); } else E.setDockTab(null);
            }
          }} />
        <span className="kb">/</span>
      </div>
      {q.trim() ? (
        <>
        <ul id="results" role="listbox" aria-label="Matching features">
          {results.length ? results.map((f, i) => {
            // a feature can outlive its tile and its domain (refreshLiveModel copies a newer map onto the open
            // page), so both are read the way the engine reads them: the hit still lists, without the prefix
            const T = M.L.TILE[f.id];
            return (
            <li key={f.id} id={'res-' + f.id} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onPointerEnter={() => preview(i)} onClick={() => open(f.id)}>
              <StageSym st={f.stage} w={18} h={12} />
              <span className="t">{f.name}</span>
              <span className="r">{M.P.scale > 1 && T ? T.wing.bld.b.short + ' · ' : ''}{M.P.D[f.domain]?.name ?? f.domain} · {f.stage ? STAGE_WORD[f.stage] : 'Stage unknown'}</span>
            </li>
            );
          }) : <li className="none">No feature matches “{q}”.{M.live ? '' : ' Try “gift”, “waitlist” or “tax”.'}</li>}
        </ul>
        {total > results.length && <div className="fly-note">{total - results.length} more · refine the search to narrow it.</div>}
        </>
      ) : (
        <div className="fly-note">Type part of a name. <b>↑ ↓</b> preview each match on the plan, <b>Enter</b> opens it, <b>Esc</b> clears, then closes.</div>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------ scans
const NO_JOBS: readonly ScanJob[] = [];
const noSub = () => () => {};
/**
 * The scan jobs (and, with `rows`, the store rows their progress is read from). Live: the stream's jobs (with `log`,
 * every jobs event, log lines included; else only discrete changes) and scan. Kettle: the scan sim's, which notifies
 * once per tick while a job runs.
 */
export function useScanJobs(log: boolean, rows: boolean): { jobs: readonly ScanJob[]; scan: ScanSnapshot | undefined } {
  const E = useEngine(), live = useLive(), sim = live ? null : E.M.scanSim ?? null;
  const logged = useLiveJobs(log && live ? live.slug : null);
  const simJobs = useSyncExternalStore(sim ? sim.subscribe : noSub, () => (sim ? sim.jobs() : NO_JOBS), () => NO_JOBS);
  const simScan = useSyncExternalStore(sim && rows ? sim.subscribe : noSub, () => (sim && rows ? sim.snapshot() : undefined), () => undefined);
  if (live) return { jobs: log ? logged : live.product.jobs, scan: live.product.scan };
  return { jobs: simJobs, scan: simScan };
}
/**
 * Scans that run (alive: not stale) and are not already on the plan as agents. Kettle: every running job (the sim's swarm has no scan
 * agents). Live: the latest run's lenses already stand as working agents (swarmFromScan), so a running job counts
 * unless it is that run.
 */
export function useRunningScans(): number {
  const live = useLive(), { jobs, scan } = useScanJobs(false, true);
  const latest = live ? latestRun(live.product.scan) : null, own = latest?.status === 'running' ? latest.id : null;
  // a job silent past SILENT_MS is stale, not a working agent: the plan draws it so and the figure does not count it
  return runningScans(jobs, scan, Date.now(), own);
}
export const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ------------------------------------------------------------------------------------------ steer
export function PreviewBox() {
  const E = useEngine();
  const p = useBp((s) => s.lprev ?? s.prev); // a live steer's plan, else the sample's (never both)
  const alt = useBp((s) => s.lprev?.alt); // Measure here's whole plan, when the shown one leaves fresh or in-flight features out
  if (!p) return null;
  return (
    <div className="prev">
      <div className="big">{p.title}</div>
      <ul>{p.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <div className="row"><button type="button" className="bt go" onClick={() => E.commitPreview()}>Commit · Enter</button><button type="button" className="bt" onClick={() => E.cancelPreview()}>Cancel · Esc</button>{alt ? <button type="button" className="bt" onClick={() => E.previewLive(alt)}>{altLabel({ alt })}</button> : null}</div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ plan
export const HINT_LIVE = (
  <div className="hint"><b>Scroll</b> zoom · <b>drag</b> pan · <b>click</b> go in · <b>Esc</b> back<br /><b>Shift-drag</b> box-select · <b>Shift-click</b> target · <b>S</b> target mode<br /><b>/</b> find · <b>1–9</b> sheets · <b>J K</b> proposals · <b>1–2</b> answer<br /><b>P</b> person · <b>B</b> blast · <b>\</b> rail<br /><b>T</b> timeline · <b>[ ]</b> week · <b>← →</b> next room · <b>↑ ↓</b> zoom · <b>0</b> home · <b>Enter</b> open</div>
);
export const HINT = (
  <div className="hint"><b>Scroll</b> zoom · <b>drag</b> pan · <b>click</b> go in · <b>Esc</b> back<br /><b>Shift-drag</b> box-select · <b>Shift-click</b> target · <b>S</b> target mode<br /><b>/</b> find · <b>1–9</b> sheets · <b>J K</b> questions · <b>1–3</b> answer · <b>Space</b> pause swarm<br /><b>M</b> morning watch · <b>P</b> person · <b>G</b> GA · <b>B</b> blast · <b>\</b> rail<br /><b>T</b> timeline · <b>[ ]</b> week · <b>, .</b> speed · <b>← →</b> next room · <b>↑ ↓</b> zoom · <b>0</b> home · <b>Enter</b> open</div>
);

export function TitleBlock() {
  const E = useEngine(), M = E.M;
  const s = useBp((s) => ({ view: s.view, t: s.t, delta: s.delta }), shallowEqual);
  const sh = sheetOf(M.P, s.view), vs = views(M.P), now = s.t === M.P.asOf;
  const { c, bad } = useMemo(() => ({ c: M.agg.countsOf('ALL', M.P.features, s.t, s.delta), bad: now ? M.agg.healthOf('ALL', M.P.features, GENERAL).bad : null }), [M.P, M.agg, s.t, s.delta, now]);
  return (
    <div className="tbk">
      <div className="proj"><div className="v">{M.P.name.toUpperCase()}</div><span className="lab">{M.P.scale > 1 ? 'Campus ×' + M.P.scale : 'Project'}</span></div>
      <div className="sheet"><span className="lab">Sheet</span><span className="no">{sh.no}</span><span className="of">{vs.indexOf(sh.k) + 1} of {vs.length}</span></div>
      <div className="ttl"><span className="lab">{M.live ? s.t : s.t + ' · rev ' + revAt(M.P.weeks, s.t) + '/27'}</span><div className="v">{sh.title}</div></div>
      <div className="schedT"><span className="lab">Schedule · {M.P.features.length - c.none} features</span>
        <table><tbody>
          <tr><td className="sy"><StageSym st="live" w={18} h={11} /></td><td>Built, live for all</td><td className="n">{c.live}</td></tr>
          <tr><td className="sy"><StageSym st="flagged" w={18} h={11} /></td><td>Partly open, flagged</td><td className="n">{c.flagged}</td></tr>
          <tr><td className="sy"><StageSym st="in-dev" w={18} h={11} /></td><td>Being built or reviewed</td><td className="n">{c.build}</td></tr>
          <tr><td className="sy"><StageSym st="specified" w={18} h={11} /></td><td>On paper, proposed</td><td className="n">{c.paper}</td></tr>
          {c.dep ? <tr><td className="sy"><StageSym st="deprecated" w={18} h={11} /></td><td>Being retired</td><td className="n">{c.dep}</td></tr> : null}
          <tr className="tr"><td className="sy"><Mark k="cloud" w={20} h={14} /></td><td>In trouble</td><td className="n">{bad ?? '—'}</td></tr>
          <tr><td className="sy"><Mark k="delta" w={20} h={14} /></td><td>Changed, last {s.delta === 1 ? '24 h' : s.delta + ' days'}</td><td className="n">{c.chg}</td></tr>
        </tbody></table></div>
      {!M.live && <div className="disc">Sample data · simulated swarm · artwork stylised</div>}
    </div>
  );
}
