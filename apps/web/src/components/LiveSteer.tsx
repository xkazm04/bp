'use client';
// A live product's steer buttons for the selection (the selection bar and the Agents overview): Measure here, Build what
// is approved here, Stop work here (src/lib/model/live-steer.ts). Each is planned from the map, the stream's jobs and the
// scan; one that cannot run stays visible, marked unavailable, and says why (its title, and a toast when pressed). Pressed,
// it shows its plan under NOT ISSUED YET; Commit runs it. Rendered only while a live product has a selection, so the
// scan deltas it reads re-render nothing else.
import { useMemo } from 'react';
import { LIVE_VERBS, LIVE_VERB_LABEL, planLive, steerFacts } from '@/lib/model/live-steer';
import { shallowEqual, useBp, useEngine, useLive } from './hooks';

export function LiveSteerButtons({ cls }: { cls: string }) {
  const E = useEngine(), live = useLive();
  const tgt = useBp((s) => s.tgt, shallowEqual);
  const jobs = live?.product.jobs, proposals = live?.product.scan?.proposals;
  const plans = useMemo(() => {
    const F = steerFacts(E.M.P, tgt, jobs ?? [], proposals ?? []);
    return LIVE_VERBS.map((v) => planLive(v, F));
  }, [E, tgt, jobs, proposals]);
  if (!live) return null;
  return (
    <>
      {plans.map((p) => (
        <button key={p.verb} type="button" className={cls} aria-disabled={p.off ? true : undefined}
          title={p.off ? LIVE_VERB_LABEL[p.verb] + ': ' + p.off : undefined} onClick={() => E.previewLive(p)}>
          {LIVE_VERB_LABEL[p.verb]}…
        </button>
      ))}
    </>
  );
}
