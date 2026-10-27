// Whether a live product's scan is alive: the ONE verdict every status surface renders (the header pill, the phone
// pill, the timeline strip and clock, the plan's scan outlines, the Agents rail figure), with the words it is said in.
// Before this the threshold, the "last sign of life" rule and the ladder were copied per surface and drifted (5 min in
// the pill, 10 in the plan, none in the strip and the phone). Pure: no clock of its own, `now` is passed in.
// Checked by scripts/check-scan-liveness.ts (npm run check:scan-liveness).
import type { Run, ScanSnapshot } from './types.ts';
import { latestRun } from './derive.ts';
import { isJobNote, type JobStatus, type ScanJob } from './jobs.ts';

/**
 * How long a `running` run (or job) may go without a sign of life before it reads stalled. Scans bump the run row per
 * phase and write an activity row per reading or feature; one LLM batch can stay quiet for minutes, so the cutoff is
 * generous on purpose (a slow feature is not a dead one), and a hard kill leaves `running` for ever, so one is needed.
 */
export const SILENT_MS = 10 * 60 * 1000;

/** The stream's state, as the web client's LiveProduct holds it. */
export type StreamState = 'loading' | 'live' | 'offline' | 'missing' | 'error';
/** The scan's state as a run alone says it, the stream aside. */
export type RunLiveness = 'no-run' | 'live' | 'stalled' | 'finished' | 'failed' | 'aborted';
export type LivenessState = 'none' | 'connecting' | 'no-store' | 'offline' | 'store-error' | RunLiveness;
export interface Liveness {
  state: LivenessState;
  /** What the latest run says, whatever the stream does (offline keeps the last-known run). */
  runState: RunLiveness;
  run: Run | null;
  phase?: string;
  /** Since the run's last sign of life (running), else 0. */
  silentMs: number;
  /** When an ended run ended (ended_at, else its last update), and how long ago. */
  endedAt?: number;
  ageMs?: number;
  error?: string;
}

/** "3 min ago", "2 h ago", "4 d ago". */
export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
}

/** The newest sign of life of run `runId`: `since` (its row's update, or a job's start) or its newest activity row, whichever is later. NaN only when neither parses. */
export function lastSignOfLife(scan: Pick<ScanSnapshot, 'activity'> | undefined, runId: string | undefined, since: number): number {
  let last = since;
  if (scan && runId) for (const a of scan.activity) if (a.run_id === runId) { const t = Date.parse(a.at); if (t > last || !Number.isFinite(last)) last = t; }
  return last;
}

/** A job's newest sign of life: its run's (by run_id, else the run whose note names the job) newest activity row, else its start. */
export function jobSignOfLife(j: ScanJob, scan: Pick<ScanSnapshot, 'runs' | 'activity'> | undefined): number {
  const run = scan && (scan.runs.find((r) => r.id === j.run_id) ?? scan.runs.find((r) => isJobNote(r.note, j.id)));
  return lastSignOfLife(scan, run?.id, Date.parse(j.started_at ?? j.queued_at));
}

/** A job's status at `now`, with a running one silent for SILENT_MS as `stale` (not known to have failed). */
export function jobLiveness(j: ScanJob, scan: Pick<ScanSnapshot, 'runs' | 'activity'> | undefined, now: number): JobStatus | 'stale' {
  if (j.status !== 'running') return j.status;
  const seen = jobSignOfLife(j, scan);
  return Number.isFinite(seen) && seen + SILENT_MS <= now ? 'stale' : 'running';
}

/** Running scans that are alive and not the run `ownRun` already standing on the plan as agents (the Agents figure). */
export function runningScans(jobs: readonly ScanJob[], scan: Pick<ScanSnapshot, 'runs' | 'activity'> | undefined, now: number, ownRun: string | null): number {
  let n = 0;
  for (const j of jobs) if (jobLiveness(j, scan, now) === 'running' && (!ownRun || j.run_id !== ownRun)) n++;
  return n;
}

export interface LivenessInput { status?: StreamState | null; scan?: ScanSnapshot; structure?: unknown; error?: string }

/** The verdict at `now`. No status (Kettle, no live product) is `none`. */
export function scanLiveness(p: (LivenessInput & { now?: number }) | null | undefined, nowArg?: number): Liveness {
  const now = nowArg ?? p?.now ?? 0, run = p?.status ? latestRun(p.scan) : null;
  let runState: RunLiveness = 'no-run', silentMs = 0, endedAt: number | undefined, ageMs: number | undefined;
  if (run && run.status === 'running') {
    silentMs = Math.max(0, now - lastSignOfLife(p?.scan, run.id, Date.parse(run.updated_at) || 0));
    runState = silentMs >= SILENT_MS ? 'stalled' : 'live';
  } else if (run) {
    runState = run.status === 'failed' ? 'failed' : run.status === 'aborted' ? 'aborted' : 'finished';
    endedAt = Date.parse(run.ended_at ?? run.updated_at);
    ageMs = now - endedAt;
  }
  const v: Liveness = { state: runState, runState, run, phase: run?.phase, silentMs, endedAt, ageMs };
  const st = p?.status;
  if (!st) v.state = 'none';
  else if (st === 'error' && p?.structure) { v.state = 'store-error'; v.error = p.error; }
  else if (st === 'offline') v.state = 'offline';
  else if (st === 'missing') v.state = 'no-store';
  else if (st === 'loading' && !run) v.state = 'connecting';
  return v;
}

export interface LivenessWords {
  /** The pill class: on (alive), off (bad), idle (nothing to say yet), '' (a good end). */
  cls: 'on' | 'off' | 'idle' | '';
  /** What shows; may carry a relative age that moves with the clock. */
  text: string;
  /** What a live region announces: the state only, so a screen reader is not told the clock every minute. */
  say: string;
  title: string;
}

/** The verdict in words: `full` for the header pill, `short` for the phone's compact pill. */
export function livenessWords(v: Liveness, form: 'full' | 'short' = 'full'): LivenessWords {
  const short = form === 'short', r = v.run;
  switch (v.state) {
    case 'none': return { cls: '', text: '', say: '', title: '' };
    case 'connecting': return { cls: 'idle', text: 'Connecting', say: 'Connecting', title: 'Opening the scan stream' };
    case 'store-error': return { cls: 'off', text: short ? 'Scan error' : 'Scan store error', say: 'Scan store error', title: v.error ?? 'The scan store cannot be read' };
    case 'offline': return { cls: 'off', text: 'Offline', say: 'Offline', title: 'The scan stream dropped; reconnecting (backoff up to 10 s)' };
    case 'no-store': case 'no-run': {
      const t = v.state === 'no-store' ? 'No scan store' : 'No scan yet';
      return { cls: 'idle', text: t, say: t, title: 'Every feature reads unmeasured until /lens-scan writes a run' };
    }
    case 'stalled': return {
      cls: 'off', text: short ? 'Stalled' : 'Stalled · last update ' + ago(v.silentMs), say: 'Scan stalled',
      title: 'Run ' + r!.id + ' still says running (phase ' + r!.phase + ') but nothing was written for ' + ago(v.silentMs).replace(' ago', '') + ': the scan was probably stopped',
    };
    case 'live': return {
      cls: 'on', text: short ? 'Live scan' : 'Live · ' + v.phase, say: short ? 'Live scan' : 'Live · ' + v.phase,
      title: 'Run ' + r!.id + ' is running: phase ' + r!.phase + ', lenses ' + (Array.isArray(r!.lenses) ? r!.lenses.join(', ') : ''),
    };
    default: {
      const bad = v.state === 'failed' || v.state === 'aborted';
      return {
        cls: bad ? 'off' : '', text: 'Last scan ' + (bad ? r!.status + ' ' : '') + ago(v.ageMs ?? 0),
        say: 'Last scan ' + (bad ? r!.status : 'finished'), title: 'Run ' + r!.id + ' ' + r!.status + (r!.note ? ': ' + r!.note : ''),
      };
    }
  }
}

/** The timeline's form (strip and panel clock): `base` is the run's state alone, `label` adds the reconnecting marker. */
export function scanStatus(v: Liveness): { label: string; base: string; tone: 'on' | 'warn' | '' } {
  const off = v.state === 'offline', r = v.run;
  const base = v.runState === 'no-run' ? (off ? 'OFFLINE' : 'NO RUN')
    : v.runState === 'live' ? '● LIVE' + (r!.phase ? ' · ' + r!.phase.toUpperCase() : '')
    : v.runState === 'stalled' ? 'STALLED' : String(r!.status || '').toUpperCase();
  const label = off && v.runState !== 'no-run' ? base + ' · RECONNECTING' : base;
  return { label, base, tone: off || v.runState === 'stalled' ? 'warn' : v.runState === 'live' ? 'on' : '' };
}
