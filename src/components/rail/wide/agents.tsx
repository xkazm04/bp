'use client';
// A · Agents: the list holds an overview row, the scan jobs (newest first) and, when the simulated swarm has them,
// the crews. The detail reads the selection in full: a job's progress, clock, Cancel and log; a crew's agents and
// tasks; or the overview, which keeps the steering of the current selection and the swarm's latest lines.
import { useEffect, useMemo, useState } from 'react';
import { TICK_CLASS, astat, type SimAgent } from '@/lib/model';
import { cancelJob, refusalText } from '@/lib/scan/actions';
import type { ScanJob } from '@/lib/scan/jobs';
import { jobProgress } from '@/lib/scan/scan-views';
import type { ScanSnapshot } from '@/lib/scan/types';
import { ScanGlyph } from '../../ScanMenu';
import { Mark, agentMark } from '../../Symbols';
import { shallowEqual, useBp, useEngine, useLive, useScanCtx } from '../../hooks';
import { PreviewBox, mmss, useScanJobs } from '../panels';
import { Fig, Group, Row, Sec, Workbench, useListRef, useWalk } from './shell';

type Kind = 'job' | 'crew';
const key = (k: Kind, id: string) => k + ':' + id;
const STATES = ['working', 'waiting', 'blocked', 'failed', 'paused'] as const;
const TONE: Record<(typeof STATES)[number], 'mint' | 'amber' | 'red' | 'ink'> = { working: 'mint', waiting: 'amber', blocked: 'red', failed: 'red', paused: 'ink' };

function tally(ag: readonly SimAgent[]) {
  const c = { working: 0, waiting: 0, blocked: 0, failed: 0, paused: 0, idle: 0 };
  for (const a of ag) c[astat(a)]++;
  return c;
}

/** A job's figures, shared by its row and its detail. */
function jobFacts(j: ScanJob, scan: ScanSnapshot | undefined, total: number, now: number) {
  const measure = j.kind === 'measure', pr = measure ? jobProgress(j, scan, total) : null;
  const built = !measure && scan ? scan.proposals.filter((p) => j.proposals?.includes(p.id) && p.status === 'done').length : 0;
  const n = measure ? (pr && j.status === 'done' ? pr.m : pr?.n ?? 0) : built, m = measure ? pr?.m ?? 0 : j.proposals?.length ?? 0;
  const t0 = Date.parse(j.started_at ?? j.queued_at), t1 = j.ended_at ? Date.parse(j.ended_at) : now;
  return { measure, n, m, clock: j.status === 'queued' ? mmss(now - Date.parse(j.queued_at)) : mmss(t1 - t0), open: j.status === 'queued' || j.status === 'running' };
}

export function Agents() {
  const E = useEngine(), M = E.M, sim = M.sim, live = useLive();
  const s = useBp((s) => ({ simV: s.simV, crew: s.crew }), shallowEqual);
  const { jobs, scan } = useScanJobs(true, true);
  const [sel, setSel] = useState<string | null>(null);
  const listRef = useListRef();
  const running = jobs.some((j) => j.status === 'running' || j.status === 'queued');
  // the elapsed clocks: one 1 s interval, only while something runs
  const [, setTick] = useState(0);
  useEffect(() => { if (!running) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, [running]);

  const rev = useMemo(() => jobs.slice().reverse(), [jobs]);
  const squads = sim.has ? sim.squads : [];
  const ids = useMemo(() => [null as string | null, ...rev.map((j) => key('job', j.id)), ...squads.map((q) => key('crew', q.id))], [rev, squads]);
  const cur = sel && ids.includes(sel) ? sel : null;
  const onKey = useWalk(ids, cur, setSel, listRef);
  // a selected crew lights up on the plan (the classic crew toggle); leaving it, or the panel, clears it
  const crewSel = cur?.startsWith('crew:') ? cur.slice(5) : null;
  useEffect(() => { if (E.S.crew !== crewSel) E.patch({ crew: crewSel }); }, [E, crewSel]);
  useEffect(() => () => { if (E.S.crew) E.patch({ crew: null }); }, [E]);

  const now = Date.now(), total = M.P.base.features.length;
  const t = sim.has ? sim.tallyStatus() : null;
  const nRun = jobs.filter((j) => j.status === 'running').length, nQ = jobs.filter((j) => j.status === 'queued').length;

  const list = (
    <>
      <ul role="listbox" aria-label="Overview" className="wb-solo">
        <Row id={null} on={cur === null} onPick={() => setSel(null)} cls="ov">
          <span className="rt">Overview</span>
          <span className="rm"><span>{sim.has ? 'steering · latest from the swarm' : 'scans only'}</span>{t && <span>{t.working} working</span>}</span>
        </Row>
      </ul>
      <Group head="Scans" n={jobs.length ? nRun + ' running · ' + nQ + ' queued' : live ? 'Claude Code' : 'simulated'} label="Scan jobs, newest first">
        {rev.length ? rev.map((j) => {
          const d = j.lens ? M.P.LENS[j.lens] : undefined, x = jobFacts(j, scan, total, now), k = key('job', j.id);
          return (
            <Row key={j.id} id={k} on={cur === k} onPick={() => setSel(k)} cls={'job st-' + j.status}>
              <span className="rk">{d?.glyph ? <ScanGlyph g={d.glyph} px={16} /> : null}<span className={'st ' + j.status}>{j.status}</span><span>{x.clock}</span></span>
              <span className="rt one">{x.measure ? d?.name ?? j.lens : 'Execute · ' + (j.proposals?.length ?? 0) + ' finding' + (j.proposals?.length === 1 ? '' : 's')}</span>
              <span className="rm"><span>{x.measure ? j.scope?.label ?? 'Everything' : (j.proposals ?? []).join(', ')}</span><span>{x.n}/{x.m}</span></span>
              <span className="bar" aria-hidden="true"><i style={{ width: (x.m ? (100 * x.n) / x.m : 0) + '%' }} /></span>
            </Row>
          );
        }) : <li className="wb-none">No scans yet. Right-click a feature, bay, room or wing on the plan to scan it.</li>}
      </Group>
      {squads.length > 0 && (
        <Group head="Crews" n={squads.length} label="Crews">
          {squads.map((q) => {
            const ag = sim.agents.filter((a) => a.sq === q.id), c = tally(ag), k = key('crew', q.id);
            return (
              <Row key={q.id} id={k} on={cur === k} onPick={() => setSel(k)} cls="wcrew">
                <span className="rt one">{q.name.replace(' crew', '')}<small>{q.role}</small></span>
                <span className="rm"><span>{q.focus}</span><span className="cc"><b className="t-mint">{c.working}</b><b className="t-amber">{c.waiting}</b><b className="t-red">{c.blocked + c.failed}</b></span></span>
                <span className="wstk" aria-hidden="true">{STATES.map((st) => c[st] ? <i key={st} className={'s-' + st} style={{ width: (100 * c[st]) / (ag.length || 1) + '%' }} /> : null)}</span>
              </Row>
            );
          })}
        </Group>
      )}
    </>
  );

  let detail;
  if (cur?.startsWith('job:')) {
    const j = rev.find((x) => key('job', x.id) === cur)!;
    detail = <JobDetail j={j} scan={scan} total={total} now={now} live={!!live} />;
  } else if (crewSel) {
    detail = <CrewDetail id={crewSel} />;
  } else {
    detail = <Overview />;
  }
  return (
    <Workbench cls="wb-agents" list={list} listLabel="Scans and crews" listRef={listRef} onKey={onKey} detailKey={cur ?? 'overview'} detailLabel="Selected scan, crew or overview"
      strip={(
        <>
          {t && STATES.map((st) => st === 'paused' && !t.paused ? null : <div key={st} className={'wb-count t-' + TONE[st]}><b>{t[st]}</b><span>{st}</span></div>)}
          <div className="wb-count"><b>{nRun}</b><span>scan{nRun === 1 ? '' : 's'} running</span></div>
          {!sim.has && <div className="wb-count"><span>No swarm data</span></div>}
          <span className="wb-src">{sim.live ? 'live scan' : sim.has ? 'simulated swarm' : ''}</span>
        </>
      )}
      detail={<div className="wb-scroll">{detail}</div>} />
  );
}

function JobDetail({ j, scan, total, now, live }: { j: ScanJob; scan: ScanSnapshot | undefined; total: number; now: number; live: boolean }) {
  const E = useEngine(), M = E.M, ctx = useScanCtx();
  const [busy, setBusy] = useState(false);
  const d = j.lens ? M.P.LENS[j.lens] : undefined, x = jobFacts(j, scan, total, now);
  const cancel = () => { setBusy(true); cancelJob(ctx, j.id).catch((e) => E.toast('Not cancelled', refusalText(e))).finally(() => setBusy(false)); };
  const pct = x.m ? Math.round((100 * x.n) / x.m) : 0;
  return (
    <>
      <div className="wb-kick"><span className={'st ' + j.status}>{j.status}</span><span>{x.measure ? 'Measure' : 'Execute'}</span><span>{j.id}</span></div>
      <h3 className="wb-title wb-glyph">{d?.glyph ? <ScanGlyph g={d.glyph} px={24} /> : null}{x.measure ? d?.name ?? j.lens ?? 'Scan' : 'Execute ' + (j.proposals?.length ?? 0) + ' approved finding' + (j.proposals?.length === 1 ? '' : 's')}</h3>
      <p className="wb-lede">{x.measure ? 'Scope: ' + (j.scope?.label ?? 'everything') : (j.proposals ?? []).join(', ') || 'No proposals named.'}</p>
      <div className="wb-figs">
        <Fig n={x.n + '/' + x.m} label={x.measure ? 'features measured' : 'findings built'} tone={j.status === 'done' ? 'mint' : undefined} />
        <Fig n={pct + '%'} label="progress" />
        <Fig n={x.clock} label={j.status === 'queued' ? 'waiting' : x.open ? 'elapsed' : 'took'} />
        {j.exit_code !== undefined && <Fig n={j.exit_code} label="exit code" tone={j.exit_code ? 'red' : undefined} />}
      </div>
      <div className="wb-prog" role="progressbar" aria-valuemin={0} aria-valuemax={x.m} aria-valuenow={x.n} aria-label="Progress"><i style={{ width: pct + '%' }} /></div>
      <div className="wb-inline">
        {x.open && <button type="button" className="bt" disabled={busy} onClick={cancel} aria-label={'Cancel ' + (d?.name ?? 'execute') + ' job ' + j.id}>Cancel job</button>}
        <span className="wb-meta">queued {j.queued_at.slice(11, 19)}{j.started_at ? ' · started ' + j.started_at.slice(11, 19) : ''}{j.ended_at ? ' · ended ' + j.ended_at.slice(11, 19) : ''}{j.run_id ? ' · run ' + j.run_id : ''}</span>
      </div>
      {j.error && <div className="wb-err">{j.error}</div>}
      <Sec head="Log" aside={live ? 'last lines' : 'simulated'}>
        {j.log_tail ? <pre className="wb-log" tabIndex={0} aria-label="Job log">{j.log_tail}</pre>
          : <p className="none">{live ? 'No log lines yet.' : 'The simulated scan keeps no log. A live product shows the Claude Code run’s last lines here.'}</p>}
      </Sec>
    </>
  );
}

function CrewDetail({ id }: { id: string }) {
  const E = useEngine(), M = E.M, sim = M.sim;
  const q = sim.SQ[id];
  if (!q) return <div className="wb-empty"><b>Crew gone</b>This crew is no longer in the swarm.</div>;
  const ag = sim.agents.filter((a) => a.sq === q.id), c = tally(ag);
  return (
    <>
      <div className="wb-kick"><span>Crew</span><span>{q.role}</span><span>{ag.length} agents</span></div>
      <h3 className="wb-title">{q.name}</h3>
      <p className="wb-lede">{q.focus}</p>
      <div className="wb-figs">{STATES.map((st) => st === 'paused' && !c.paused ? null : <Fig key={st} n={c[st]} label={st} tone={c[st] ? TONE[st] : undefined} />)}</div>
      <Sec head="Agents and tasks" aside="click to find on the plan">
        <ul className="wb-agents-l" aria-label={'Agents of ' + q.name}>
          {ag.map((a) => {
            const st = astat(a);
            return (
              <li key={a.id}>
                <button type="button" onClick={() => E.flyToFeature(a.f)} onPointerEnter={() => E.setHl(a.f)} onPointerLeave={() => E.setHl(null)}>
                  <span className="mk"><Mark k={agentMark(st)} w={22} h={16} /></span>
                  <span className="tx"><small>{a.base} · {M.P.F[a.f]?.name ?? a.f} · {st}</small>{a.task}</span>
                  <span className="pc"><b>{Math.round(a.pct)}%</b><span className="bar"><i style={{ width: Math.round(a.pct) + '%' }} /></span></span>
                </button>
              </li>
            );
          })}
        </ul>
      </Sec>
    </>
  );
}

function Overview() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ simV: s.simV, prev: s.prev, tgt: s.tgt }), shallowEqual);
  if (!sim.has) return <div className="wb-empty"><b>No swarm data</b>The swarm file did not load. Scans still run from the plan’s right-click menu.</div>;
  const tm = (t: number) => new Date(sim.at0 + t * 1000).toISOString().slice(11, 16);
  const log = sim.log.filter((e) => !(sim.speed > 60 && e.syn)).slice(0, 40);
  return (
    <>
      <Sec head={s.tgt.n ? 'On your selection' : 'Point at a place'} aside={s.tgt.n ? s.tgt.n + ' features' : 'steer'}>
        {s.tgt.n ? (
          <div className="wb-steer">
            <p>{s.tgt.label} · {s.tgt.n} features</p>
            {s.prev && !s.prev.order ? <PreviewBox /> : (
              <div className="wb-inline">
                <button type="button" className="bt" onClick={() => E.preview('push')}>Put the swarm here</button>
                <button type="button" className="bt" onClick={() => E.preview('pause')}>Pause</button>
                <button type="button" className="bt" onClick={() => E.preview('resume')}>Resume</button>
              </div>
            )}
          </div>
        ) : <p>Shift-click a wing, room or fixture, or shift-drag a box, then pull agents, pause them or write an order for exactly that place.</p>}
      </Sec>
      <Sec head="Latest from the swarm" aside={sim.live ? 'live scan' : 'simulated'}>
        {log.length ? (
          <ul className="wb-feed" aria-label="Latest from the swarm">
            {log.map((e, i) => {
              const a = sim.AG[e.agent];
              return (
                <li key={i + e.agent + e.t}>
                  <button type="button" className={TICK_CLASS[e.type] || ''} onClick={() => E.flyToFeature(e.f)}>
                    <time>{tm(e.t)}</time><span><small>{a ? a.base : e.agent}{M.P.F[e.f] ? ' · ' + M.P.F[e.f].name : ''}</small>{e.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="none">Nothing yet this hour.</p>}
      </Sec>
    </>
  );
}
