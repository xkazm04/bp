// Steering a live product: what the selection bar and the Agents overview offer on `?product=<slug>`. The sample's
// steers (push, pause, resume, an order) move the simulated swarm; on a live product they would move local state the
// next feed puts back, so they are refused there (`commitSample`) and not offered (`steerVerbs`). Instead three verbs
// move real work through the same calls the right-click menu and the ledger use (src/lib/scan/actions.ts):
//   - measure: one selection scan per scannable lens over the target's features (at most MAX_SELECTION);
//   - build:   ONE execute job over the proposals already approved in the target. dispatch() approves what it is
//              given, so only approved ids are ever passed: the Review queue stays the one place anything is approved;
//   - stop:    cancel the queued or running jobs whose features meet the target.
// Each is planned first (`planLive`: pure, from the map, the jobs and the scan) and shown under the usual
// "NOT ISSUED YET" preview; Commit runs it (`runLivePlan`). The swarm answers through the existing paths (the jobs
// become scan views, the store's rows reach applyFeed). Kept out of the `@/lib/model` barrel: it imports the scan
// client through actions.ts.
import { cancelJob, dispatch, refusalText, startSelectionScan, type ScanCtx } from '@/lib/scan/actions';
import { MAX_PROPOSALS, MAX_QUEUED, MAX_RUNNING, MAX_SELECTION, jobLabel, scannable, type ScanJob } from '@/lib/scan/jobs';
import type { Proposal } from '@/lib/scan/types';
import { baseId, type Product } from './product';
import type { Preview, SwarmSim } from './sim';

export type LiveVerb = 'measure' | 'build' | 'stop';
export type SampleVerb = 'push' | 'pause' | 'resume' | 'order';
export const LIVE_VERBS: readonly LiveVerb[] = ['measure', 'build', 'stop'];
export const SAMPLE_VERBS: readonly SampleVerb[] = ['push', 'pause', 'resume', 'order'];
export const LIVE_VERB_LABEL: Record<LiveVerb, string> = { measure: 'Measure here', build: 'Build what is approved here', stop: 'Stop work here' };
/** The steers a selection offers: a live product's real verbs, else the sample's. */
export function steerVerbs(live: boolean): readonly (LiveVerb | SampleVerb)[] { return live ? LIVE_VERBS : SAMPLE_VERBS; }

/** The toast when a sample steer is asked for on a live product. */
export const SAMPLE_REFUSED = { strong: 'Not on a live product:', text: 'pushing, pausing and orders steer the sample swarm. Here, measure, build or stop work on the selection.' };
/** Commit a sample steer, unless the sim is live: there it is refused (false) and sim.commit never runs. */
export function commitSample(sim: SwarmSim, p: Preview, who: string | null): boolean {
  if (sim.live) return false;
  sim.commit(p, who);
  return true;
}

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

/** The target's features as base slugs, once each, in map order (a `?scale` copy counts as its base feature). */
export function targetFeatures(P: Product, ids: Readonly<Record<string, 1>>): string[] {
  const want = new Set(Object.keys(ids).map(baseId));
  return P.base.features.filter((f) => want.has(f.id)).map((f) => f.id);
}
/** The facts for a plan over the target, from the model and the live product's jobs and scan. */
export function steerFacts(P: Product, tgt: { ids: Readonly<Record<string, 1>>; label: string }, jobs: readonly ScanJob[], proposals: readonly Proposal[]): SteerFacts {
  const lenses = P.lenses.map((d) => ({ id: d.id, name: d.name, ok: scannable({ id: d.id, manifest: d.manifest }, false) }));
  return { label: tgt.label || 'the selection', features: targetFeatures(P, tgt.ids), lenses, jobs, proposals };
}

const s = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);
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
    if (skip.length) lines.push(s(skip.length, 'lens', 'lenses') + ' cannot be measured and are left out: ' + skip.map((l) => l.name).join(', '));
    lines.push('Each scan shows on these features while it runs; its readings land on the tiles');
    const plan = { ...base, lines, scans: ok.map((l) => ({ lens: l.id, features: fs })) };
    return sl.now + sl.wait ? plan : { ...plan, off: `the scan queue is full (${MAX_QUEUED} waiting)` };
  }
  const byId = new Map(F.proposals.map((p) => [p.id, p]));
  if (verb === 'build') {
    const busy = new Set(F.jobs.filter((j) => j.kind === 'execute' && open(j)).flatMap((j) => j.proposals ?? []));
    const mine = F.proposals.filter((p) => here.has(p.feature)).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    const ready = mine.filter((p) => p.status === 'approved' && !busy.has(p.id));
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

/** Run a committed plan through the scan actions. Answers the toast: what started, or each refusal in words. */
export async function runLivePlan(ctx: ScanCtx, p: LivePlan, lensName: (id: string) => string = (id) => id): Promise<{ strong: string; text: string }> {
  if (p.verb === 'measure') {
    const rs = await Promise.allSettled(p.scans.map((x) => startSelectionScan(ctx, x.lens, x.features)));
    const bad = rs.map((r, i) => (r.status === 'rejected' ? lensName(p.scans[i].lens) + ': ' + refusalText(r.reason) : null)).filter((x): x is string => !!x);
    const n = rs.length - bad.length, nf = p.scans[0]?.features.length ?? 0;
    if (bad.length) return { strong: n ? 'Some scans did not start' : 'Scan not started', text: bad.join('; ') };
    return { strong: 'Measuring ' + s(n, 'lens', 'lenses'), text: p.label + ' · ' + s(nf, 'feature') };
  }
  if (p.verb === 'build') {
    try {
      const r = await dispatch(ctx, p.build);
      const n = r.job.proposals?.length ?? 0;
      return { strong: 'Building ' + s(n, 'approved proposal'), text: p.label + (r.skipped.length ? ' · ' + r.skipped.length + ' left out (no longer approved)' : '') };
    } catch (e) { return { strong: 'Build not started', text: refusalText(e) }; }
  }
  const rs = await Promise.allSettled(p.stop.map((id) => cancelJob(ctx, id)));
  const bad = rs.filter((r) => r.status === 'rejected').map((r) => refusalText((r as PromiseRejectedResult).reason));
  const n = rs.length - bad.length;
  if (bad.length) return { strong: n ? 'Some work did not stop' : 'Nothing stopped', text: bad.join('; ') };
  return { strong: 'Stopped ' + s(n, 'job'), text: p.label };
}
