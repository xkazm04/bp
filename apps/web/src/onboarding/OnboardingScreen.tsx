'use client';
// The onboarding screen: a project's adopt job drawn live by the build-up (b-outline, "the outline becomes the building")
// over the whole window, then handed over to the blueprint. The build-up reads only the source's events; this shell owns
// the job around it: back to the projects, the project's name and the time it has run, cancel, run in background, the
// failure band with resume, and "Open blueprint" once the build-up's own ending has settled (never an automatic jump:
// in a demo the owner admires the finished sheet).
//
// Query: `?job=<id>` follows that adopt job (default: the latest); `?preset=demo|real` plays the product's existing plan
// as a preset instead (the demo fallback for a product already onboarded; no cancel); `?feed=<origin>` reads the events
// from another feed that serves `/events` (a tape replayed by scripts/buildup/replay-tape.ts: how demos replay a run).
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useTheme } from '@/components/ThemeToggle';
import { useProductName } from '@/lib/scan/projects';
import { PHASE_LABEL, type BuildupPlan, type BuildupSource, type BuildupVariantProps, type Phase } from '@/buildup/contract';
import { fetchBuildupPlan } from '@/buildup/plan';
import { presetSource, type PresetMode } from '@/buildup/preset';
import { liveSource, runClock, type LiveState } from '@/buildup/live';
import { cancelOnboarding, fetchOnboarding, isRunning, onboardingFeed, resumeOnboarding, type AdoptJob } from './api';
import { useReducedMotion } from './motion';
import styles from './onboarding.module.css';

type BuildupProps = BuildupVariantProps & { chrome?: ReactNode; onLive?: () => void };
const loading = () => <div className={styles.note}>Loading the build-up…</div>;
const Buildup: ComponentType<BuildupProps> = dynamic(() => import('@/buildup/b-outline'), { ssr: false, loading });

type Ended = { kind: 'done' } | { kind: 'failed'; phase: Phase | null; message: string };

const fmtElapsed = (s: number) => {
  s = Math.max(0, Math.round(s)); // rounded as the build-up's own clock is, so the two agree
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

interface Query { job: string | null; preset: PresetMode | null; feed: string | null; speed: number }
function readQuery(): Query {
  const q = new URLSearchParams(location.search);
  const p = q.get('preset');
  return {
    job: q.get('job'),
    preset: p === 'demo' || p === 'real' ? p : null,
    feed: q.get('feed'),
    speed: Math.max(0.25, Math.min(8, Number(q.get('speed') ?? '1') || 1)),
  };
}

export function OnboardingScreen({ slug }: { slug: string }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const registryName = useProductName(slug, slug);
  const [q, setQ] = useState<Query | null>(null);
  useEffect(() => { setQ(readQuery()); }, []);

  // the job: asked of the server unless a preset or an outside feed is playing
  const [job, setJob] = useState<AdoptJob | null | undefined>(undefined);
  const asks = !!q && !q.preset && !q.feed;
  useEffect(() => {
    if (!asks) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => fetchOnboarding(slug, ac.signal).then((j) => {
      if (ac.signal.aborted) return;
      setJob((cur) => (q?.job && j && j.id !== q.job ? cur ?? null : j));
      if (isRunning(j)) timer = setTimeout(ask, 15000);
    }, () => { if (!ac.signal.aborted) timer = setTimeout(ask, 15000); });
    void ask();
    return () => { ac.abort(); clearTimeout(timer); };
  }, [asks, slug, q?.job]);

  // the source: a preset of the existing plan, or the job's live events
  const [plan, setPlan] = useState<BuildupPlan | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  useEffect(() => {
    if (!q?.preset) return;
    const ac = new AbortController();
    fetchBuildupPlan(slug, ac.signal).then(setPlan, (e: Error) => { if (!ac.signal.aborted) setPlanErr(e.message); });
    return () => ac.abort();
  }, [q?.preset, slug]);
  const [conn, setConn] = useState<LiveState>('connecting');
  const source: BuildupSource | null = useMemo(() => {
    if (!q) return null;
    if (q.preset) return plan ? presetSource(plan, q.preset, q.speed) : null;
    return liveSource(q.feed ?? onboardingFeed(slug), { query: q.job ? 'job=' + encodeURIComponent(q.job) : undefined, onState: setConn });
  }, [q, plan, slug]);

  // what the shell follows itself: the run's name, its clock, and how it ended
  const [name, setName] = useState<string | null>(null);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [settled, setSettled] = useState(false);
  const clock = useRef(runClock());
  useEffect(() => {
    if (!source) return;
    clock.current = runClock();
    setEnded(null); setSettled(false); setElapsed(0);
    const off = source.subscribe((e, past) => {
      clock.current.see(e, !!past, performance.now());
      if (e.type === 'begin') { setName(e.project.name || null); setEnded(null); setSettled(false); }
      else if (e.type === 'done') setEnded({ kind: 'done' });
      else if (e.type === 'failed') setEnded({ kind: 'failed', phase: e.phase, message: e.message });
    });
    // the build-up subscribes in its own effect; start on the next tick so `begin` is never missed
    const t = setTimeout(() => source.start(), 0);
    const tick = setInterval(() => setElapsed(clock.current.now(performance.now())), 250);
    return () => { off(); clearTimeout(t); clearInterval(tick); source.dispose(); };
  }, [source]);

  // the hand-over: once the build-up's ending has settled, a moment later (none under reduced motion); a run that
  // ended while the build-up was elsewhere still gets it
  const [handover, setHandover] = useState(false);
  const onLive = useCallback(() => setSettled(true), []);
  useEffect(() => {
    if (ended?.kind !== 'done') { setHandover(false); return; }
    const t = setTimeout(() => setHandover(true), settled ? (reduced ? 0 : 1000) : 12000);
    return () => clearTimeout(t);
  }, [ended, settled, reduced]);

  // a job the server reports failed or cancelled without a `failed` event in its feed (the process died)
  type Failed = Extract<Ended, { kind: 'failed' }>;
  const failure: Failed | null = ended ? (ended.kind === 'failed' ? ended : null) : job && (job.status === 'failed' || job.status === 'cancelled')
    ? { kind: 'failed', phase: job.adopt_phase ?? null, message: job.status === 'cancelled' ? 'Cancelled.' : job.error || 'The job stopped.' }
    : null;
  const jobId = q?.job ?? job?.id ?? null;
  const preset = !!q?.preset;
  const running = !preset && !failure && ended?.kind !== 'done' && (job === undefined || isRunning(job));

  // follow another job (resume): the URL names it, the source follows it
  const follow = (id: string) => {
    const u = new URL(location.href);
    u.searchParams.set('job', id);
    history.replaceState(null, '', u.pathname + u.search);
    setJob(undefined); setEnded(null); setName(null);
    setQ(readQuery());
  };

  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const resume = async () => {
    setBusy(true); setActErr(null);
    try { follow((await resumeOnboarding(slug)).id); } catch (e) { setActErr((e as Error).message); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!jobId) return;
    setBusy(true); setActErr(null);
    try { await cancelOnboarding(slug, jobId); location.assign('/projects'); } catch (e) { setActErr((e as Error).message); setBusy(false); setConfirming(false); }
  };

  const shown = name || registryName;
  const status = preset ? `Replay of the existing plan · ${q?.preset === 'real' ? 'real-run shape' : 'demo pace'}`
    : failure ? 'Stopped' : ended?.kind === 'done' ? 'Done' : conn === 'retrying' ? 'Connection lost · reconnecting…' : null;

  const chrome = (
    <div className={styles.chrome}>
      <Link href="/projects" prefetch={false} className={styles.back} title="Back to projects">‹ Projects</Link>
      <span className={styles.kicker}>Onboarding</span>
      <h1 className={styles.name} title={shown}>{shown}</h1>
      <span className={styles.time} title="Time this onboarding has run">{fmtElapsed(elapsed)}</span>
      {status && <span className={styles.status} data-tone={failure ? 'bad' : conn === 'retrying' && !preset ? 'warn' : undefined}>{status}</span>}
      <span className={styles.grow} />
      {running && !confirming && <Link href="/projects" prefetch={false} className={styles.act} title="The job keeps running; its row on the projects page shows it">Run in background</Link>}
      {running && jobId && !confirming && <button type="button" className={styles.act} onClick={() => setConfirming(true)} disabled={busy}>Cancel</button>}
      {running && jobId && confirming && (
        <span className={styles.confirm} role="group" aria-label="Confirm cancel">
          <span>Cancel onboarding? What it wrote so far stays.</span>
          <button type="button" className={styles.act} data-tone="bad" onClick={() => void cancel()} disabled={busy}>Yes, cancel</button>
          <button type="button" className={styles.act} onClick={() => setConfirming(false)} disabled={busy}>Keep going</button>
        </span>
      )}
    </div>
  );

  let body: ReactNode;
  if (!q) body = <div className={styles.note}>Opening…</div>;
  else if (planErr) body = <Empty slug={slug} head={`No plan to replay for ${shown}`} line={planErr} />;
  else if (asks && job === null && !q.job) body = <Empty slug={slug} head={`${shown} has no onboarding yet`} line="Start one from the projects page, or replay the existing plan." demo />;
  else if (source) body = <Buildup key={(q.job ?? '') + (q.preset ?? '') + (q.feed ?? '')} source={source} reducedMotion={reduced} theme={theme} chrome={chrome} onLive={onLive} />;
  else body = <div className={styles.note}>Reading {shown}…</div>;

  return (
    <div className={styles.screen}>
      {body}
      {failure && source && (
        <div className={styles.band} role="alert" data-tone="bad">
          <div className={styles.bandText}>
            <b>{failure.phase ? `Onboarding stopped at ${PHASE_LABEL[failure.phase].toLowerCase()}` : 'Onboarding stopped'}</b>
            <span>{failure.message}</span>
            <span className={styles.muted}>What it drew so far is kept. Resume runs only the steps that are missing.</span>
            {actErr && <span className={styles.err}>{actErr}</span>}
          </div>
          {!preset && <button type="button" className={styles.primary} onClick={() => void resume()} disabled={busy}>{busy ? 'Resuming…' : 'Resume'}</button>}
          <Link href="/projects" prefetch={false} className={styles.act}>Back to projects</Link>
        </div>
      )}
      {!failure && actErr && <div className={styles.band} role="alert" data-tone="bad"><div className={styles.bandText}><span className={styles.err}>{actErr}</span></div></div>}
      {handover && !failure && (
        <div className={styles.band} data-motion={reduced ? 'none' : undefined} role="status">
          <div className={styles.bandText}>
            <b>{shown} is in bp</b>
            <span className={styles.muted}>The plan stays here to explore. The blueprint carries its lenses, scans and history.</span>
          </div>
          <a href={'/?product=' + encodeURIComponent(slug)} className={styles.primary}>Open blueprint</a>
        </div>
      )}
    </div>
  );
}

function Empty({ slug, head, line, demo }: { slug: string; head: string; line: string; demo?: boolean }) {
  return (
    <div className={styles.empty}>
      <h1>{head}</h1>
      <p>{line}</p>
      <div className={styles.emptyActs}>
        <Link href="/projects" prefetch={false} className={styles.primary}>Back to projects</Link>
        {demo && <a href={'/projects/' + encodeURIComponent(slug) + '/onboarding?preset=demo'} className={styles.act}>Replay the plan</a>}
      </div>
    </div>
  );
}
