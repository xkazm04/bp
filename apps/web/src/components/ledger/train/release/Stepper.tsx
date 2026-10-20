// The Release tab's stepper: draft -> building -> pr-open -> merged -> tagged from the release row (releaseState.ts
// RELEASE_STATE), the current step marked (a spinner while a job runs), a failed release shown at the step it failed
// on; under it the release job's step and elapsed time from the jobs list. Before any release: the draft step, empty.
import { memo } from 'react';
import type { Release } from '@bp/core/scan/types';
import type { ScanJob } from '@bp/core/scan/jobs';
import { RELEASE_STATE, STEPS, STEP_WORD, elapsed, failedStep, isActive } from './releaseState';

export const Stepper = memo(function Stepper({ rel, last }: { rel?: Release; last?: ScanJob }) {
  const st = rel ? RELEASE_STATE[rel.status] : undefined, failed = st !== undefined && st.step < 0;
  const at = !rel || !st ? 0 : failed ? failedStep(last) : st.step, running = isActive(last);
  const cls = (i: number) => {
    if (!rel) return i === 0 ? 'now' : '';
    if (i < at || (i === at && rel.status === 'tagged')) return 'done';
    if (i > at) return '';
    return failed ? 'bad' : 'now' + (running ? ' run' : '');
  };
  return (
    <>
      <ol className="tr-rel-steps" data-role="tr-rel-steps" aria-label="Release status">
        {STEPS.map((s, i) => (
          <li key={s} className={cls(i)} aria-current={i === at ? 'step' : undefined}>
            {i + 1} · {s}<b>{failed && i === at ? 'Failed' : STEP_WORD[s]}</b>
          </li>
        ))}
      </ol>
      {last ? (
        <p className="tr-rel-job">
          Job {last.step ?? 'build'} · {last.status}{elapsed(last, Date.now()) ? ' · ' + elapsed(last, Date.now()) : ''}{last.run_id ? ' · run ' + last.run_id : ''}
        </p>
      ) : null}
    </>
  );
});
