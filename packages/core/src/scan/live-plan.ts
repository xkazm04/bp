// What a verb would do on a live product's selection, in words: the pure half of the selection bar's measure, build and
// stop (apps/web/src/lib/model/live-steer.ts runs a committed plan). Pure: from the target's features, the product's
// lenses, its jobs and proposals.
import { MAX_PROPOSALS, MAX_QUEUED, MAX_RUNNING, MAX_SELECTION, jobLabel, type ScanJob } from './jobs.ts';
import type { Proposal } from './types.ts';
import { admitForBuild, busyIds } from './admit.ts';

export type LiveVerb = 'measure' | 'build' | 'stop';
export const LIVE_VERB_LABEL: Record<LiveVerb, string> = { measure: 'Measure here', build: 'Build what is approved here', stop: 'Stop work here' };

export interface LiveLens { id: string; name: string; ok: boolean }
/** What a plan is computed from: the target's base feature slugs (map order), the product's lenses, its jobs and proposals. */
export interface SteerFacts { label: string; features: readonly string[]; lenses: readonly LiveLens[]; jobs: readonly ScanJob[]; proposals: readonly Proposal[] }
export interface LivePlan {
  verb: LiveVerb;
  label: string;
  title: string;
  lines: string[];
  /** Why it cannot run (the verb is shown unavailable; asking for it toasts this). */
  off?: string;
  /** measure: one selection scan per lens. */
  scans: { lens: string; features: string[] }[];
  /** build: the approved proposal ids the one execute job builds. */
  build: string[];
  /** stop: the job ids to cancel. */
  stop: string[];
}


export const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);
const s = plural;
const open = (j: ScanJob) => j.status === 'queued' || j.status === 'running';
/** Where new jobs go, given the jobs there are: how many start now, wait queued, or would be refused (the registry's limits). */
export function slots(jobs: readonly ScanJob[], n: number): { run: number; queued: number; now: number; wait: number; refused: number } {
  const run = jobs.filter((j) => j.status === 'running').length, queued = jobs.filter((j) => j.status === 'queued').length;
  const left = Math.max(0, queued - Math.max(0, MAX_RUNNING - run)); // the queued ones take free slots first
  const now = Math.min(n, Math.max(0, MAX_RUNNING - run - queued));
  const wait = Math.min(n - now, Math.max(0, MAX_QUEUED - left));
  return { run, queued, now, wait, refused: n - now - wait };
}
const slotLine = (sl: ReturnType<typeof slots>) => `${sl.now} start now, ${sl.wait} wait in the queue (${MAX_RUNNING} run at once; ${sl.run} running and ${sl.queued} queued already)`;

/** The features a job works on: a measure job's scope (every feature for `all`), an execute job's proposals' features. */
function jobFeatures(j: ScanJob, byId: ReadonlyMap<string, Proposal>): readonly string[] | 'all' {
  if (j.kind === 'measure') return j.scope?.kind === 'all' ? 'all' : j.scope?.features ?? [];
  if (j.kind === 'execute') return (j.proposals ?? []).map((id) => byId.get(id)?.feature).filter((f): f is string => !!f);
  return [];
}

/** A verb's plan over the target: what it would start, build or stop, in words for the preview. Pure. */
export function planLive(verb: LiveVerb, F: SteerFacts): LivePlan {
  const base: LivePlan = { verb, label: F.label, title: LIVE_VERB_LABEL[verb] + ': ' + F.label, lines: [], scans: [], build: [], stop: [] };
  const here = new Set(F.features);
  if (!here.size) return { ...base, off: 'the selection holds no feature of this product' };
  if (verb === 'measure') {
    const ok = F.lenses.filter((l) => l.ok), skip = F.lenses.filter((l) => !l.ok);
    if (!ok.length) return { ...base, off: 'no lens of this product can be measured (none has a built-in method or a scan block)' };
    const fs = F.features.slice(0, MAX_SELECTION), sl = slots(F.jobs, ok.length);
    const lines = [
      s(ok.length, 'measure job') + ', one per lens (' + ok.map((l) => l.name).join(', ') + '), over ' + s(fs.length, 'feature')
        + (F.features.length > fs.length ? ` (the first ${MAX_SELECTION} of ${F.features.length})` : ''),
      slotLine(sl),
    ];
    if (sl.refused) lines.push(`${sl.refused} would be refused: the queue holds ${MAX_QUEUED}`);
    if (skip.length) lines.push(s(skip.length, 'lens', 'lenses') + (skip.length === 1 ? ' cannot be measured and is left out: ' : ' cannot be measured and are left out: ') + skip.map((l) => l.name).join(', '));
    lines.push('Each scan shows on these features while it runs; its readings land on the tiles');
    const plan = { ...base, lines, scans: ok.map((l) => ({ lens: l.id, features: fs })) };
    return sl.now + sl.wait ? plan : { ...plan, off: `the scan queue is full (${MAX_QUEUED} waiting)` };
  }
  const byId = new Map(F.proposals.map((p) => [p.id, p]));
  if (verb === 'build') {
    const busy = busyIds(F.jobs);
    const mine = F.proposals.filter((p) => here.has(p.feature)).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    // admit.ts's rule, restricted to what is approved already: this verb never approves (the Review queue does). The busy
    // test repeats what admit already said, in the words check-live-steer's self-proof seeds its defect into.
    const take = new Set(admitForBuild(mine.map((p) => p.id), (id) => byId.get(id)?.status, busy).take);
    const ready = mine.filter((p) => take.has(p.id) && p.status === 'approved' && !busy.has(p.id));
    const proposed = mine.filter((p) => p.status === 'proposed').length;
    const building = mine.filter((p) => p.status === 'executing' || (p.status === 'approved' && busy.has(p.id))).length;
    if (!ready.length) {
      return { ...base, off: proposed ? 'nothing here is approved yet: ' + s(proposed, 'proposal') + ' wait in the Review queue' : building ? 'everything approved here is already being built' : 'nothing here is approved' };
    }
    const ids = ready.slice(0, MAX_PROPOSALS).map((p) => p.id), sl = slots(F.jobs, 1);
    const lines = [`One build job over ${s(ids.length, 'approved proposal')} on ${s(new Set(ready.slice(0, ids.length).map((p) => p.feature)).size, 'feature')}`];
    if (ready.length > ids.length) lines.push(`${ready.length - ids.length} more approved wait for the next build (${MAX_PROPOSALS} per job)`);
    if (proposed) lines.push(s(proposed, 'proposal') + ' here ' + (proposed === 1 ? 'is' : 'are') + ' not approved and stay' + (proposed === 1 ? 's' : '') + ' as ' + (proposed === 1 ? 'it is' : 'they are') + ': approving happens in the Review queue');
    lines.push(sl.now ? 'It starts now' : sl.wait ? `It waits in the queue (${MAX_RUNNING} run at once; ${sl.run} running and ${sl.queued} queued already)` : `It would be refused: the queue holds ${MAX_QUEUED}`);
    const plan = { ...base, lines, build: ids };
    return sl.refused ? { ...plan, off: `the job queue is full (${MAX_QUEUED} waiting)` } : plan;
  }
  // stop
  const hits: ScanJob[] = [], wide: ScanJob[] = [];
  for (const j of F.jobs) {
    if (!open(j)) continue;
    const fs = jobFeatures(j, byId);
    if (fs === 'all' || fs.some((f) => here.has(f))) { hits.push(j); if (fs === 'all' || fs.some((f) => !here.has(f))) wide.push(j); }
  }
  if (!hits.length) return { ...base, off: 'no scan or build is queued or running here' };
  const run = hits.filter((j) => j.status === 'running').length;
  const lines = [`${run} running and ${hits.length - run} queued ${hits.length === 1 ? 'job is' : 'jobs are'} cancelled: ` + hits.map((j) => jobLabel(j)).join(', ')];
  if (wide.length) lines.push(`${wide.length} of them also cover${wide.length === 1 ? 's' : ''} places outside the selection and stop${wide.length === 1 ? 's' : ''} there too`);
  lines.push('What the store has already recorded stays');
  return { ...base, lines, stop: hits.map((j) => j.id) };
}
