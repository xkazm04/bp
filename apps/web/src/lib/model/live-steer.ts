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
import { scannable, type ScanJob } from '@bp/core/scan/jobs';
import { LIVE_VERB_LABEL, planLive, plural as s, slots, type LivePlan, type LiveVerb, type SteerFacts } from '@bp/core/scan/live-plan';
export { LIVE_VERB_LABEL, planLive, slots, type LiveLens, type LivePlan, type LiveVerb, type SteerFacts } from '@bp/core/scan/live-plan';
import type { Track, TrackNext } from '@bp/core/scan/track';
import type { Proposal } from '@bp/core/scan/types';
import { baseId, type Product } from '@bp/core/model/product';
import type { Preview, SwarmSim } from '@bp/core/model/sim';

export type SampleVerb = 'push' | 'pause' | 'resume' | 'order';
export const LIVE_VERBS: readonly LiveVerb[] = ['measure', 'build', 'stop'];
export const SAMPLE_VERBS: readonly SampleVerb[] = ['push', 'pause', 'resume', 'order'];
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

/** The words for a track's one next verb (src/lib/scan/track.ts `next`). */
export const TRACK_NEXT_LABEL: Record<TrackNext, string> = { build: 'Build what is approved here', measure: 'Measure here to confirm', stop: 'Stop work here' };
/** A track's next verb as a plan over its own tile, through the same preview as the selection's verbs; measuring to confirm
 *  reads only the track's lens. Null when the track offers no verb. */
export function trackPlan(P: Product, t: Pick<Track, 'feature' | 'lens' | 'next'>, jobs: readonly ScanJob[], proposals: readonly Proposal[]): LivePlan | null {
  if (!t.next) return null;
  const F0 = steerFacts(P, { ids: { [t.feature]: 1 }, label: P.base.features.find((f) => f.id === t.feature)?.name ?? t.feature }, jobs, proposals);
  const F = t.next === 'measure' ? { ...F0, lenses: F0.lenses.filter((l) => l.id === t.lens) } : F0;
  const p = planLive(t.next, F);
  return { ...p, title: TRACK_NEXT_LABEL[t.next] + ': ' + F.label };
}
