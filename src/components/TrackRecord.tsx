'use client';
// A live answer's record beside the plan (the Callout slot): what was decided, the expected value, the branch reading,
// the product's current reading (evidence only after the release; an observation otherwise), the job, commit and
// release, and the one next verb, which opens the same NOT ISSUED YET preview as the selection's live verbs. Opened by
// a click on a track's glyph on its tile (Engine.trackAt); Esc or CLOSE closes it.
import { useMemo } from 'react';
import { TRACK_NEXT_LABEL, trackPlan } from '@/lib/model/live-steer';
import type { TrackStage } from '@/lib/scan/track';
import { useBp, useEngine, useLive } from './hooks';

/** A stage in words, for the record's kicker and the hover card. */
export const STAGE_WORDS: Record<TrackStage, string> = {
  saving: 'saving', approved: 'approved', declined: 'declined', building: 'building', failed: 'build failed', built: 'built on a branch',
  rework: 'sent back for rework', accepted: 'accepted', descoped: 'descoped', confirmed: 'confirmed', 'not-confirmed': 'not confirmed', unknown: 'unknown',
};

export function TrackRecord({ id }: { id: string }) {
  const E = useEngine(), M = E.M, live = useLive();
  useBp((s) => s.simV);
  const t = M.tracks?.T[id];
  const jobs = live?.product.jobs, proposals = live?.product.scan?.proposals;
  const plan = useMemo(() => (t ? trackPlan(M.P, t, jobs ?? [], proposals ?? []) : null), [M, t, jobs, proposals]);
  if (!t) return null;
  const f = M.P.F[t.feature];
  return (
    <>
      <button type="button" className="x" onClick={() => E.openTrack(null)}>CLOSE · ESC</button>
      <h4>{M.P.LENS[t.lens]?.name ?? t.lens} · {STAGE_WORDS[t.stage]}</h4>
      <div className="big">{t.title}</div>
      <div className="row"><span>Feature</span><b>{f?.name ?? t.feature}</b></div>
      {t.expected !== undefined && <div className="row"><span>Expected</span><b>{t.expected}{t.unit ? ' ' + t.unit : ''}</b></div>}
      {t.branch !== undefined && <div className="row"><span>On {t.branchName}</span><b>{t.branch}</b></div>}
      {t.current !== undefined && <div className="row"><span>{t.evidence ? 'Product, after the release' : 'Product now (observation)'}</span><b>{t.current}</b></div>}
      <div className="sub">RECORD</div>
      {t.lines.map((l) => <div key={l} style={{ color: 'var(--ink-2)', fontSize: 13 }}>{l}</div>)}
      {plan && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="bt go" aria-disabled={plan.off ? true : undefined} title={plan.off}
            onClick={() => { E.previewLive(plan); if (!plan.off) E.openTrack(null); }}>{TRACK_NEXT_LABEL[t.next!]}…</button>
          {plan.off && <div style={{ color: 'var(--ink-2)', fontSize: 13, marginTop: 4 }}>Not now: {plan.off}</div>}
        </div>
      )}
    </>
  );
}
