'use client';
// The rail's flyout panels, one per rail item: Find, View (window, modes, reader, swarm health),
// Agents, Orders, Plan and Steer (Kettle's steering presets). The decisions panel is `AsksTab` in
// ../Queue. Each returns a flat list of blocks so the flyout can stagger them in. Agents opens with the
// scan jobs (live: the product's routes; Kettle: the scan sim), newest first.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Stage } from '@/lib/data';
import {
  GA_MILESTONE, SPEND_CAP, STAGE_WORD, TICK_CLASS, astat, healthUnder, personLens, revAt, searchPage, sheetOf, stageAt, views,
  type RoomNode, type BayNode, type BldNode,
} from '@/lib/model';
import { cancelJob, refusalText } from '@/lib/scan/actions';
import { useLiveJobs } from '@/lib/scan/client';
import { latestRun } from '@/lib/scan/derive';
import type { ScanJob } from '@/lib/scan/jobs';
import { jobProgress } from '@/lib/scan/scan-views';
import type { ScanSnapshot } from '@/lib/scan/types';
import { Legend } from '../Legend';
import { ScanGlyph } from '../ScanMenu';
import { Mark, PatternDefs, StageSym, agentMark } from '../Symbols';
import { shallowEqual, useBp, useEngine, useLive, useScanCtx, useVariant } from '../hooks';
import '../scan.css';

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
          {results.length ? results.map((f, i) => (
            <li key={f.id} id={'res-' + f.id} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onPointerEnter={() => preview(i)} onClick={() => open(f.id)}>
              <StageSym st={f.stage} w={18} h={12} />
              <span className="t">{f.name}</span>
              <span className="r">{M.P.scale > 1 ? E.M.L.TILE[f.id].wing.bld.b.short + ' · ' : ''}{M.P.D[f.domain].name} · {f.stage ? STAGE_WORD[f.stage] : 'Stage unknown'}</span>
            </li>
          )) : <li className="none">No feature matches “{q}”.{M.live ? '' : ' Try “gift”, “waitlist” or “tax”.'}</li>}
        </ul>
        {total > results.length && <div className="fly-note">{total - results.length} more · refine the search to narrow it.</div>}
        </>
      ) : (
        <div className="fly-note">Type part of a name. <b>↑ ↓</b> preview each match on the plan, <b>Enter</b> opens it, <b>Esc</b> clears, then closes.</div>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------ view
export function ViewPanel() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ delta: s.delta, ga: s.ga, blast: s.blast, who: s.who, simV: s.simV, t: s.t }), shallowEqual);
  const persons = M.P.people.filter((x) => x.kind === 'human'), open = sim.has ? sim.openDecs() : [];
  const c = sim.has ? sim.tallyStatus() : null;
  const now = s.t === M.P.asOf, h = now ? M.agg.healthOf('ALL', M.P.features, 'general') : null;
  const rows = [{ id: null as string | null, name: 'Everyone', sub: 'the whole product, all sheets', n: open.length }]
    .concat(persons.map((x) => ({ id: x.id, name: x.name, sub: x.title + ' · ' + sheetOf(M.P, personLens(M.P, x.id)).nm, n: open.filter((d) => d.decider === x.id).length })));
  return (
    <>
      <h3 className="dsec-h"><span>What changed · window</span><span>{s.delta === 1 ? 'last 24 h' : 'last ' + s.delta + ' days'}</span></h3>
      <div className="fly-row">
        <div className="seg" role="group" aria-label="What changed: window">
          {([1, 7, 14] as const).map((d) => <button key={d} type="button" aria-pressed={s.delta === d} title={d === 1 ? 'Show what changed in the last 24 hours' : 'Last ' + d + ' days'} onClick={() => E.setDelta(d)}>{d === 1 ? '24h' : d + 'd'}</button>)}
        </div>
      </div>
      <h3 className="dsec-h"><span>Modes</span><span>keys</span></h3>
      <div className="fly-row">
        {E.hasGA && <button type="button" className="tog ga" aria-pressed={s.ga} title={M.P.MS[GA_MILESTONE].name + ' readiness (G)'} onClick={() => E.toggleGA()}>{M.P.MS[GA_MILESTONE].name} <kbd>G</kbd></button>}
        <button type="button" className="tog bl" aria-pressed={!!s.blast} title="Blast radius of the selected feature (B)" onClick={() => E.toggleBlast()}>Blast <kbd>B</kbd></button>
      </div>
      {sim.has && persons.length > 0 && <>
        <h3 className="dsec-h"><span>Whose desk · P</span><span>questions</span></h3>
        <ul className="who-list" role="listbox" aria-label="View as">
          {rows.map((r) => {
            const on = (s.who || '') === (r.id || '');
            return (
              <li key={r.id ?? 'all'} role="option" tabIndex={0} aria-selected={on} className={on ? 'on' : ''}
                onClick={() => E.setWho(r.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); E.setWho(r.id); } }}>
                <span className="av">{r.name.charAt(0)}</span><span>{r.name}<small>{r.sub}</small></span><span className="n">{r.n}</span>
              </li>
            );
          })}
        </ul>
      </>}
      <h3 className="dsec-h"><span>Health</span><span>{now ? 'now' : s.t}</span></h3>
      <div className="vit">
        {c && <>
          <span title="Agents working"><Mark k="work" w={20} h={14} /><b>{c.working}</b> working</span>
          <span title="Agents waiting for a person"><Mark k="wait" w={20} h={14} /><b>{c.waiting}</b> waiting</span>
          <span title="Agents blocked"><Mark k="block" w={20} h={14} /><b>{c.blocked}</b> blocked</span>
          <span title="Agents failed"><Mark k="fail" w={20} h={14} /><b>{c.failed}</b> failed</span>
          {c.paused ? <span title="Agents paused by you"><Mark k="paused" w={20} h={14} /><b>{c.paused}</b> paused</span> : null}
        </>}
        <span title="Features bad under any lens"><Mark k="cloud" w={20} h={14} /><b>{h ? h.bad : '—'}</b> in trouble</span>
      </div>
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
 * Scans that run and are not already on the plan as agents. Kettle: every running job (the sim's swarm has no scan
 * agents). Live: the latest run's lenses already stand as working agents (swarmFromScan), so a running job counts
 * unless it is that run.
 */
export function useRunningScans(): number {
  const live = useLive(), { jobs } = useScanJobs(false, false);
  const latest = live ? latestRun(live.product.scan) : null, own = latest?.status === 'running' ? latest.id : null;
  let n = 0;
  for (const j of jobs) if (j.status === 'running' && (!own || j.run_id !== own)) n++;
  return n;
}
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/** The Agents flyout's Scans section: every job, newest first, with its progress, elapsed time, Cancel, and (live) the log tail. */
function ScansSection() {
  const E = useEngine(), M = E.M, ctx = useScanCtx(), live = useLive();
  const { jobs, scan } = useScanJobs(true, true);
  const running = jobs.some((j) => j.status === 'running' || j.status === 'queued');
  // the elapsed clocks: one 1 s interval, only while something runs
  const [, setTick] = useState(0);
  useEffect(() => { if (!running) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, [running]);
  const [busy, setBusy] = useState<string | null>(null);
  const cancel = (id: string) => { setBusy(id); cancelJob(ctx, id).catch((e) => E.toast('Not cancelled', refusalText(e))).finally(() => setBusy(null)); };
  const now = Date.now(), total = M.P.base.features.length;
  return (
    <>
      <h3 className="dsec-h"><span>Scans</span><span>{jobs.length ? jobs.filter((j) => j.status === 'running').length + ' running · ' + jobs.filter((j) => j.status === 'queued').length + ' queued' : live ? 'Claude Code' : 'simulated'}</span></h3>
      {jobs.length ? (
        <ul className="scans" aria-label="Scan jobs, newest first">
          {jobs.slice().reverse().map((j) => {
            const d = j.lens ? M.P.LENS[j.lens] : undefined, measure = j.kind === 'measure';
            const pr = measure ? jobProgress(j, scan, total) : null;
            const built = !measure && scan ? scan.proposals.filter((p) => j.proposals?.includes(p.id) && p.status === 'done').length : 0;
            const nm = measure ? (pr && j.status === 'done' ? pr.m : pr?.n ?? 0) + '/' + (pr?.m ?? 0) : built + '/' + (j.proposals?.length ?? 0);
            const t0 = Date.parse(j.started_at ?? j.queued_at), t1 = j.ended_at ? Date.parse(j.ended_at) : now;
            const open = j.status === 'queued' || j.status === 'running';
            return (
              <li key={j.id} className="scan-j">
                {d ? <ScanGlyph g={d.glyph} /> : <span aria-hidden="true" />}
                <span className="nm" title={j.lens}>{measure ? d?.name ?? j.lens : 'Execute · ' + (j.proposals?.length ?? 0) + ' finding' + (j.proposals?.length === 1 ? '' : 's')}</span>
                <span className={'st ' + j.status}>{j.status}</span>
                <span className="sc" title={j.scope?.label}>{measure ? j.scope?.label ?? 'Everything' : (j.proposals ?? []).join(', ')}</span>
                <span className="row">
                  <span>{nm}</span><span>{j.status === 'queued' ? 'waiting ' + mmss(now - Date.parse(j.queued_at)) : mmss(t1 - t0)}</span><span className="sp" />
                  {open && <button type="button" disabled={busy === j.id} onClick={() => cancel(j.id)} aria-label={'Cancel ' + (d?.name ?? 'execute') + ' job ' + j.id}>Cancel</button>}
                </span>
                {j.error && <span className="er">{j.error}</span>}
                {live && j.log_tail ? <details className="row" style={{ display: 'block' }}><summary>Log</summary><pre>{j.log_tail}</pre></details> : null}
              </li>
            );
          })}
        </ul>
      ) : <div className="fly-note">No scans yet. Right-click a feature, bay, room or wing on the plan (or empty plan for everything) to scan it.</div>}
    </>
  );
}

// ------------------------------------------------------------------------------------------ agents
export function SwarmPanel() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ simV: s.simV, prev: s.prev, tgt: s.tgt, crew: s.crew }), shallowEqual);
  if (!sim.has) return <><ScansSection /><div className="qempty">No swarm data.</div></>;
  const tm = (t: number) => new Date(sim.at0 + t * 1000).toISOString().slice(11, 16);
  return (
    <>
      <ScansSection />
      {s.tgt.n ? (
        <div className="steer"><h5>On your selection</h5><p>{s.tgt.label} · {s.tgt.n} features</p>
          {s.prev && !s.prev.order ? <PreviewBox /> : <div className="row"><button type="button" className="bt" onClick={() => E.preview('push')}>Put the swarm here</button><button type="button" className="bt" onClick={() => E.preview('pause')}>Pause</button><button type="button" className="bt" onClick={() => E.preview('resume')}>Resume</button></div>}</div>
      ) : <div className="steer"><h5>Point at a place</h5><p>Shift-click a wing, room or fixture, or shift-drag a box, then pull agents, pause them or write an order for exactly that place.</p></div>}
      <h3 className="dsec-h"><span>Latest from the swarm</span><span>{sim.live ? 'live scan' : 'simulated'}</span></h3>
      <div className="lat">
        {sim.log.length ? sim.log.filter((e) => !(sim.speed > 60 && e.syn)).slice(0, 7).map((e, i) => {
          const a = sim.AG[e.agent];
          return <button key={i + e.agent + e.t} type="button" className={TICK_CLASS[e.type] || ''} onClick={() => E.flyToFeature(e.f)}><i>{tm(e.t)}</i><span>{(a ? a.base + ' ' : '') + e.text}</span></button>;
        }) : <div className="fly-note">Nothing yet this hour.</div>}
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
              <span className="c"><span style={{ color: 'var(--mint-2)' }}>{cc.working}</span><span style={{ color: 'var(--amber-2)' }}>{cc.waiting}</span><span style={{ color: 'var(--red-2)' }}>{cc.blocked + cc.failed}</span></span>
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

// ------------------------------------------------------------------------------------------ steer
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

/** Kettle's steering presets (a live product has none). */
export function SteerPanel() {
  const E = useEngine(), sim = E.M.sim;
  const s = useBp((s) => ({ simV: s.simV, prev: s.prev }), shallowEqual);
  const spend = sim.spend(), pct = Math.min(100, Math.round((100 * spend) / SPEND_CAP));
  return (
    <>
      <div className="spend">
        <div className="k"><span>Spend today</span><span>${spend.toLocaleString('en-US')} of ${SPEND_CAP.toLocaleString('en-US')}</span></div>
        <div className={'bar' + (pct >= 100 ? ' over' : pct >= 80 ? ' hi' : '')}><i style={{ width: pct + '%' }} /></div>
      </div>
      <div className="steer"><h5>Payments GA first</h5><p>Pull the agents working on M3 and M4 onto the unfinished Payments GA features. Order O-4 allows it.</p>
        {s.prev && s.prev.order === 'O-4' ? <PreviewBox /> : <button type="button" className="bt" onClick={() => E.preview('ga')}>Preview what it moves</button>}</div>
      <div className="steer"><h5>Pause the research crew</h5><p>The daily spend cap order (O-7) says research stops first.</p>
        {s.prev && s.prev.order === 'O-7' ? <PreviewBox /> : <button type="button" className="bt" onClick={() => E.preview('research')}>Preview</button>}</div>
      <div className="fly-note">Selected places steer from the Agents panel or the selection bar. Space pauses the whole swarm.</div>
    </>
  );
}

// ------------------------------------------------------------------------------------------ orders
export function OrdersPanel() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ simV: s.simV, ordHi: s.ordHi }), shallowEqual);
  if (!sim.has) return <div className="qempty">No swarm data.</div>;
  if (!sim.orders.length) return <div className="qempty"><b>No standing orders</b>Select places on the plan, then write an order from the selection bar.</div>;
  return (
    <>
      <h3 className="dsec-h"><span>Standing orders</span><span>{sim.orders.length} · {sim.orders.reduce((n, o) => n + o.vf.length, 0)} breached</span></h3>
      {sim.orders.map((o) => {
        const n = o.vf.length, by = M.P.P[o.by];
        return (
          <div key={o.id} className={'ord' + (n ? ' v' : '') + (s.ordHi === o.id ? ' on' : '')} role="button" tabIndex={0}
            onPointerEnter={() => E.setOrdHi(o.id)} onPointerLeave={() => E.setOrdHi(null)} onClick={() => E.setOrdHi(s.ordHi === o.id ? null : o.id)}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); E.setOrdHi(s.ordHi === o.id ? null : o.id); } }}>
            <span className="st">{o.id}</span>
            <span className="tx">{o.text}</span>
            <span className="sc">{sim.scopeWords(o)} · {by ? by.name.split(' ')[0] : o.by}{o.user ? ' · new' : ' · since ' + o.since.slice(5)}</span>
            <span className="vi">{n ? <>{n} breach{n > 1 ? 'es' : ''}: {o.vf.slice(0, 4).map((id) => <button key={id} type="button" onClick={(e) => { e.stopPropagation(); E.flyToFeature(id); }}>{id.replace(/-[A-Z]$/, '')}</button>)}{n > 4 ? '+' + (n - 4) : ''}</> : 'No breach'}</span>
          </div>
        );
      })}
      <div className="fly-note">Hover an order to see the places it governs. Select places on the plan, then write an order from the selection bar.</div>
    </>
  );
}

// ------------------------------------------------------------------------------------------ plan
const HINT_LIVE = (
  <div className="hint"><b>Scroll</b> zoom · <b>drag</b> pan · <b>click</b> go in · <b>Esc</b> back<br /><b>Shift-drag</b> box-select · <b>Shift-click</b> target · <b>S</b> target mode<br /><b>/</b> find · <b>1–9</b> sheets · <b>J K</b> proposals · <b>1–2</b> answer<br /><b>P</b> person · <b>B</b> blast · <b>\</b> rail<br /><b>T</b> timeline · <b>[ ]</b> week · <b>← →</b> next room · <b>↑ ↓</b> zoom · <b>0</b> home · <b>Enter</b> open</div>
);
const HINT = (
  <div className="hint"><b>Scroll</b> zoom · <b>drag</b> pan · <b>click</b> go in · <b>Esc</b> back<br /><b>Shift-drag</b> box-select · <b>Shift-click</b> target · <b>S</b> target mode<br /><b>/</b> find · <b>1–9</b> sheets · <b>J K</b> questions · <b>1–3</b> answer · <b>Space</b> pause swarm<br /><b>M</b> morning watch · <b>P</b> person · <b>G</b> GA · <b>B</b> blast · <b>\</b> rail<br /><b>T</b> timeline · <b>[ ]</b> week · <b>, .</b> speed · <b>← →</b> next room · <b>↑ ↓</b> zoom · <b>0</b> home · <b>Enter</b> open</div>
);

function TitleBlock() {
  const E = useEngine(), M = E.M;
  const s = useBp((s) => ({ view: s.view, t: s.t, delta: s.delta }), shallowEqual);
  const sh = sheetOf(M.P, s.view), vs = views(M.P), now = s.t === M.P.asOf;
  const { c, bad } = useMemo(() => ({ c: M.agg.countsOf('ALL', M.P.features, s.t, s.delta), bad: now ? M.agg.healthOf('ALL', M.P.features, 'general').bad : null }), [M.P, M.agg, s.t, s.delta, now]);
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

export function PlanPanel() {
  const E = useEngine(), M = E.M, V = useVariant();
  const s = useBp((s) => ({ view: s.view, place: s.place, ga: s.ga, blast: s.blast, key: s.key, t: s.t, simV: s.simV }), shallowEqual);
  // trouble per enabled lens (bad or watch) is fixed at load: recount only when the model changes
  const kc = useMemo(() => {
    const kc: Record<string, number> = {};
    for (const f of M.P.features) for (const t of f.trouble) kc[t.lens] = (kc[t.lens] || 0) + 1;
    return kc;
  }, [M.P]);
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
                const f = T.f, st: Stage | null = stageAt(f, s.t, M.P.asOf), now = s.t === M.P.asOf, hl = healthUnder(f, s.view), ag = M.sim.has ? (M.sim.AGF[f.id] || []).length : 0;
                return (
                  <button key={f.id} type="button" onClick={() => E.openFeature(f.id)} onPointerEnter={() => E.setHl(f.id)} onPointerLeave={() => E.setHl(null)}>
                    <StageSym st={st} w={20} h={13} />
                    <span>{f.name}{ag ? <span style={{ color: 'var(--mint-2)', font: '500 12px var(--mono)' }}> ◉{ag}</span> : null}</span>
                    <span className="w" style={{ color: now && hl === 'bad' ? 'var(--red-2)' : now && hl === 'watch' ? 'var(--amber)' : undefined }}>{st ? STAGE_WORD[st] : 'Not yet'}</span>
                  </button>
                );
              })}
            </li>
          ))}
        </ul>
        {M.live ? HINT_LIVE : HINT}
      </>
    );
  }
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
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); E.setKey(s.key === k ? null : k); } }}>
            <span className="d" /><span>{name}: bad or to watch</span><span className="c">{kc[k] || 0}</span>
          </li>
        ))}
      </ul>
      <TitleBlock />
      {M.live ? HINT_LIVE : HINT}
    </>
  );
}
