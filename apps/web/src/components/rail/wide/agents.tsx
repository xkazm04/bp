'use client';
// A · Agents: the list holds an overview row, the scan jobs (newest first) and, when the simulated swarm has them,
// the crews. The detail reads the selection in full: a job's progress, clock, Cancel and log; a crew's agents and
// tasks; or the overview, which keeps the steering of the current selection and the swarm's latest lines.
import { useEffect, useMemo, useRef, useState } from 'react';
import { TICK_CLASS, astat, type SimAgent } from '@bp/core/model';
import { cancelJob, refusalText } from '@/lib/scan/actions';
import { jobLabel, type ScanJob } from '@bp/core/scan/jobs';
import { jobProgress } from '@/lib/scan/scan-views';
import { logBlocks, type Span } from '@/lib/scan/log-md';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { jobLiveness } from '@bp/core/scan/liveness';
import { LiveSteerButtons } from '../../LiveSteer';
import { ScanGlyph } from '../../ScanMenu';
import { Mark, agentMark } from '../../Symbols';
import { shallowEqual, useBp, useEngine, useLive, useScanCtx } from '../../hooks';
import { SCAN_NOUNS, httpUrl, streamNote } from '../../Queue';
import { seatHere, type PreviewSeat } from '@/lib/model/preview-seat';
import { PreviewBox, mmss, useScanJobs } from '../panels';
import { Fig, Group, Row, Sec, Workbench, useListRef, usePreviewSeat, useWalk } from './shell';

type Kind = 'job' | 'crew';
const key = (k: Kind, id: string) => k + ':' + id;
const STATES = ['working', 'waiting', 'blocked', 'failed', 'paused'] as const;
const TONE: Record<(typeof STATES)[number], 'mint' | 'amber' | 'red' | 'ink'> = { working: 'mint', waiting: 'amber', blocked: 'red', failed: 'red', paused: 'ink' };

function tally(ag: readonly SimAgent[]) {
  const c = { working: 0, waiting: 0, blocked: 0, failed: 0, paused: 0, idle: 0 };
  for (const a of ag) c[astat(a)]++;
  return c;
}

/** A job's figures, shared by its row and its detail. A release job names no proposals: its progress is its release's
 *  status (`rel`, when the snapshot has the row), never a count. */
function jobFacts(j: ScanJob, scan: ScanSnapshot | undefined, total: number, now: number) {
  const measure = j.kind === 'measure', release = j.kind === 'release', pr = measure ? jobProgress(j, scan, total) : null;
  const built = j.kind === 'execute' && scan ? scan.proposals.filter((p) => j.proposals?.includes(p.id) && p.status === 'done').length : 0;
  const n = measure ? (pr && j.status === 'done' ? pr.m : pr?.n ?? 0) : built, m = measure ? pr?.m ?? 0 : j.proposals?.length ?? 0;
  const rel = release && j.release ? scan?.releases.find((r) => r.id === j.release) : undefined;
  const t0 = Date.parse(j.started_at ?? j.queued_at), t1 = j.ended_at ? Date.parse(j.ended_at) : now;
  return { measure, release, rel, n, m, clock: j.status === 'queued' ? mmss(now - Date.parse(j.queued_at)) : mmss(t1 - t0), open: j.status === 'queued' || j.status === 'running' };
}

export function Agents() {
  const E = useEngine(), M = E.M, sim = M.sim, live = useLive();
  const s = useBp((s) => ({ simV: s.simV, crew: s.crew, scanJob: s.scanJob }), shallowEqual);
  const { jobs, scan } = useScanJobs(true, true);
  // a click on a scan's chip on the plan opens the panel on that job (S.scanJob): taken once, then cleared, Cancel focused
  const [sel, setSel] = useState<string | null>(() => (s.scanJob ? key('job', s.scanJob) : null));
  const focusCancel = useRef(false);
  useEffect(() => {
    if (!s.scanJob) return;
    setSel(key('job', s.scanJob)); focusCancel.current = true;
    E.patch({ scanJob: null });
  }, [E, s.scanJob]);
  const listRef = useListRef();
  // a pending steer the overview holds brings the overview back when it arrives (a preset's goes to the frame's bar)
  const seat = usePreviewSeat(setSel);
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
  const lv = jobs.map((j) => jobLiveness(j, scan, now)), nRun = lv.filter((x) => x === 'running').length, nStale = lv.filter((x) => x === 'stale').length, nQ = jobs.filter((j) => j.status === 'queued').length;

  // an empty list is only a fact on a connected stream; on any other state of it the scan may be running unseen
  const note = streamNote(live?.product, SCAN_NOUNS);
  const list = (
    <>
      <ul role="listbox" aria-label="Overview" className="wb-solo">
        <Row id={null} on={cur === null} onPick={() => setSel(null)} cls="ov">
          <span className="rt">Overview</span>
          <span className="rm"><span>{sim.has ? 'steering · latest from the swarm' : 'scans only'}</span>{t && <span>{t.working} working</span>}</span>
        </Row>
      </ul>
      <Group head="Scans" n={jobs.length ? nRun + ' running · ' + (nStale ? nStale + ' stale · ' : '') + nQ + ' queued' : live ? 'Claude Code' : 'simulated'} label="Scan jobs, newest first">
        {rev.length ? rev.map((j) => {
          const d = j.lens ? M.P.LENS[j.lens] : undefined, x = jobFacts(j, scan, total, now), k = key('job', j.id);
          return (
            <Row key={j.id} id={k} on={cur === k} onPick={() => setSel(k)} cls={'job st-' + j.status}>
              <span className="rk">{d?.glyph ? <ScanGlyph g={d.glyph} px={16} /> : null}<span className={'st ' + j.status}>{j.status}</span><span>{x.clock}</span></span>
              <span className="rt one">{x.measure ? d?.name ?? j.lens : jobLabel(j)}</span>
              {x.release
                ? <span className="rm"><span>{j.release}</span>{x.rel && <span>{x.rel.status}</span>}</span>
                : <span className="rm"><span>{x.measure ? j.scope?.label ?? 'Everything' : (j.proposals ?? []).join(', ')}</span><span>{x.n}/{x.m}</span></span>}
              {!x.release && <span className="bar" aria-hidden="true"><i style={{ width: (x.m ? (100 * x.n) / x.m : 0) + '%' }} /></span>}
            </Row>
          );
        }) : note ? <li className="wb-none"><b>{note[0]}</b> {note[1]}</li>
          : <li className="wb-none">No scans yet. Right-click a feature, bay, room or wing on the plan to scan it.</li>}
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
    detail = <JobDetail j={j} scan={scan} total={total} now={now} live={!!live} focusCancel={focusCancel} />;
  } else if (crewSel) {
    detail = <CrewDetail id={crewSel} />;
  } else {
    detail = <Overview seat={seat} />;
  }
  return (
    <Workbench cls="wb-agents" list={list} listLabel="Scans and crews" listRef={listRef} onKey={onKey} detailKey={cur ?? 'overview'} detailLabel="Selected scan, crew or overview" seat={seat} row={cur}
      strip={(
        <>
          {t && STATES.map((st) => st === 'paused' && !t.paused ? null : <div key={st} className={'wb-count t-' + TONE[st]}><b>{t[st]}</b><span>{st}</span></div>)}
          <div className="wb-count"><b>{nRun}</b><span>scan{nRun === 1 ? '' : 's'} running</span></div>
          <span className="wb-src">{sim.live ? 'live scan' : sim.has ? 'simulated swarm' : ''}</span>
        </>
      )}
      detail={<div className="wb-scroll">{detail}</div>} />
  );
}

function JobDetail({ j, scan, total, now, live, focusCancel }: { j: ScanJob; scan: ScanSnapshot | undefined; total: number; now: number; live: boolean; focusCancel: { current: boolean } }) {
  const E = useEngine(), M = E.M, ctx = useScanCtx();
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // opened from the plan's chip: Cancel takes focus (Enter cancels); a job picked in the list keeps focus on the list
  useEffect(() => { if (focusCancel.current) { focusCancel.current = false; cancelRef.current?.focus(); } });
  const d = j.lens ? M.P.LENS[j.lens] : undefined, x = jobFacts(j, scan, total, now);
  const cancel = () => { setBusy(true); cancelJob(ctx, j.id).catch((e) => E.toast('Not cancelled', refusalText(e))).finally(() => setBusy(false)); };
  const pct = x.m ? Math.round((100 * x.n) / x.m) : 0;
  // the release's pull request, only when the store's URL is safe to hand to an href (Queue.tsx httpUrl)
  const pr = httpUrl(x.rel?.pr_url);
  return (
    <>
      <div className="wb-kick"><span className={'st ' + j.status}>{j.status}</span><span>{x.measure ? 'Measure' : j.kind === 'release' ? 'Release' : 'Execute'}</span><span>{j.id}</span></div>
      <h3 className="wb-title wb-glyph">{d?.glyph ? <ScanGlyph g={d.glyph} px={24} /> : null}{x.measure ? d?.name ?? j.lens ?? 'Scan' : j.kind === 'release' ? jobLabel(j) : 'Execute ' + (j.proposals?.length ?? 0) + ' approved finding' + (j.proposals?.length === 1 ? '' : 's')}</h3>
      <p className="wb-lede">{x.release ? (j.step === 'finish' ? 'Finish: tag the merged release and publish it on GitHub.' : 'Build: cherry-pick the accepted items, run the gates, open the pull request.')
        : x.measure ? 'Scope: ' + (j.scope?.label ?? 'everything') : (j.proposals ?? []).join(', ') || 'No proposals named.'}</p>
      {x.release ? (
        <div className="wb-figs">
          <Fig n={j.step ?? 'build'} label="step" />
          {j.version && <Fig n={j.version} label="version" />}
          {x.rel && <Fig n={x.rel.status} label="release" tone={x.rel.status === 'failed' ? 'red' : x.rel.status === 'tagged' ? 'mint' : undefined} />}
          <Fig n={x.clock} label={j.status === 'queued' ? 'waiting' : x.open ? 'elapsed' : 'took'} />
          {j.exit_code !== undefined && <Fig n={j.exit_code} label="exit code" tone={j.exit_code ? 'red' : undefined} />}
        </div>
      ) : (
        <>
          <div className="wb-figs">
            <Fig n={x.n + '/' + x.m} label={x.measure ? 'features measured' : 'findings built'} tone={j.status === 'done' ? 'mint' : undefined} />
            <Fig n={pct + '%'} label="progress" />
            <Fig n={x.clock} label={j.status === 'queued' ? 'waiting' : x.open ? 'elapsed' : 'took'} />
            {j.exit_code !== undefined && <Fig n={j.exit_code} label="exit code" tone={j.exit_code ? 'red' : undefined} />}
          </div>
          {x.m > 0 && <div className="wb-prog" role="progressbar" aria-valuemin={0} aria-valuemax={x.m} aria-valuenow={x.n} aria-label="Progress"><i style={{ width: pct + '%' }} /></div>}
        </>
      )}
      <div className="wb-inline">
        {x.open && <button ref={cancelRef} type="button" className="bt" disabled={busy} onClick={cancel} aria-label={'Cancel ' + (d?.name ?? (x.release ? 'release' : 'execute')) + ' job ' + j.id}>Cancel job</button>}
        <span className="wb-meta">queued {j.queued_at.slice(11, 19)}{j.started_at ? ' · started ' + j.started_at.slice(11, 19) : ''}{j.ended_at ? ' · ended ' + j.ended_at.slice(11, 19) : ''}{j.run_id ? ' · run ' + j.run_id : ''}{j.release ? ' · ' + j.release : ''}</span>
        {pr && <a className="wb-meta" href={pr} target="_blank" rel="noopener noreferrer">pull request</a>}
      </div>
      {j.error && <div className="wb-err">{j.error}</div>}
      <Sec head="Log" aside={live ? 'last lines' : 'simulated'}>
        {j.log_tail ? <LogText text={j.log_tail} />
          : <p className="none">{live ? 'No log lines yet.' : 'The simulated scan keeps no log. A live product shows the Claude Code run’s last lines here.'}</p>}
      </Sec>
    </>
  );
}

const Spans = ({ ss }: { ss: Span[] }) => <>{ss.map((x, i) => x.t === 'b' ? <b key={i}>{x.s}</b> : x.t === 'code' ? <code key={i}>{x.s}</code> : x.s)}</>;

/** The run's last lines as the markdown its reply is written in (lib/scan/log-md.ts): text only, never HTML or a link. */
function LogText({ text }: { text: string }) {
  const bs = useMemo(() => logBlocks(text), [text]);
  return (
    <div className="wb-log md" tabIndex={0} role="log" aria-label="Job log">
      {bs.map((b, i) => b.k === 'code' ? <pre key={i}>{b.text}</pre>
        : b.k === 'h' ? <p key={i} className={'h h' + b.level}><Spans ss={b.spans} /></p>
        : b.k === 'li' ? <p key={i} className={'li' + (b.ordered ? ' ol' : '')} style={b.depth ? { marginLeft: b.depth * 16 } : undefined} data-n={b.n || undefined}><Spans ss={b.spans} /></p>
        : <p key={i}><Spans ss={b.spans} /></p>)}
    </div>
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
            const st = astat(a), bf = a.blk && a.status === 'blocked' ? M.P.F[a.blk] : undefined;
            return (
              <li key={a.id}>
                <button type="button" onClick={() => E.flyToFeature(a.f)} onPointerEnter={() => E.setHl(a.f)} onPointerLeave={() => E.setHl(null)}>
                  <span className="mk"><Mark k={agentMark(st)} w={22} h={16} /></span>
                  <span className="tx"><small>{a.base} · {M.P.F[a.f]?.name ?? a.f} · {st}</small>{a.task}</span>
                  <span className="pc"><b>{Math.round(a.pct)}%</b><span className="bar"><i style={{ width: Math.round(a.pct) + '%' }} /></span></span>
                </button>
                {bf && (
                  <button type="button" className="blk" onClick={() => E.goToBlocker(bf.id)} onPointerEnter={() => E.setHl(bf.id)} onPointerLeave={() => E.setHl(null)}
                    title={sim.DOF[bf.id]?.length ? 'Open the question that holds it' : 'Go to ' + bf.name}>
                    Blocked by {bf.name}{sim.DOF[bf.id]?.length ? ' · open its question' : ''}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Sec>
    </>
  );
}

function Overview({ seat }: { seat: PreviewSeat }) {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ simV: s.simV, tgt: s.tgt }), shallowEqual);
  if (!sim.has) return <div className="wb-empty"><b>No swarm data</b>The swarm file did not load. Scans still run from the plan’s right-click menu.</div>;
  const tm = (t: number) => new Date(sim.at0 + t * 1000).toISOString().slice(11, 16);
  const log = sim.log.filter((e) => !(sim.speed > 60 && e.syn)).slice(0, 40);
  return (
    <>
      <Sec head={s.tgt.n ? 'On your selection' : 'Point at a place'} aside={s.tgt.n ? s.tgt.n + ' features' : 'steer'}>
        {seatHere(seat, null) ? (
          <div className="wb-steer">
            {s.tgt.n > 0 && <p>{s.tgt.label} · {s.tgt.n} features</p>}
            <PreviewBox />
          </div>
        ) : s.tgt.n ? (
          <div className="wb-steer">
            <p>{s.tgt.label} · {s.tgt.n} features</p>
            {sim.live ? (
              <div className="wb-inline"><LiveSteerButtons cls="bt" /></div>
            ) : (
              <div className="wb-inline">
                <button type="button" className="bt" onClick={() => E.preview('push')}>Put the swarm here</button>
                <button type="button" className="bt" onClick={() => E.preview('pause')}>Pause</button>
                <button type="button" className="bt" onClick={() => E.preview('resume')}>Resume</button>
              </div>
            )}
          </div>
        ) : <p>{sim.live ? 'Shift-click a wing, room or fixture, or shift-drag a box, then measure it, build what is approved there or stop the work on it.' : 'Shift-click a wing, room or fixture, or shift-drag a box, then pull agents, pause them or write an order for exactly that place.'}</p>}
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
