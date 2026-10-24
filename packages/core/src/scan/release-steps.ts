// The release lifecycle's one step table: where a build or a finish may start, where each lands, and what a cut abandoned
// mid-build becomes. The build and finish routes (release-job.ts), the job runner (jobs.server.ts settleRelease and
// failBuilding), the Kettle sim (train-sim.ts) and the Release tab's action table (releaseState.ts, pinned against this by
// scripts/check-release-steps.ts) all read it. The moves themselves are lens-scan store.mjs's (release-update, a
// compare-and-set: draft -> building -> pr-open -> merged -> tagged, any state but tagged -> failed); this module only
// says which of them a step starts from and ends on. Pure and import-free besides types, so Node checks load it as-is.
import type { ReleaseStep } from './jobs.ts';
import type { ReleaseStatus } from './types.ts';

/** The statuses a step may start from: a build cuts a draft or retries a failed cut; a finish tags an open or merged PR. */
export const STEP_FROM: Readonly<Record<ReleaseStep, readonly ReleaseStatus[]>> = { build: ['draft', 'failed'], finish: ['pr-open', 'merged'] };
/** The statuses a step has got to when its job ends done: a cut leaves the release pr-open (or later), a finish tagged. */
export const STEP_LANDS: Readonly<Record<ReleaseStep, readonly ReleaseStatus[]>> = { build: ['pr-open', 'merged', 'tagged'], finish: ['tagged'] };
/** A release job that ends without `done` while its row is still here leaves a row no step starts from: it is abandoned... */
export const ABANDONED_FROM: ReleaseStatus = 'building';
/** ...to this, so a build may start again. */
export const ABANDONED_TO: ReleaseStatus = 'failed';

export const canStart = (step: ReleaseStep, status: string): boolean => (STEP_FROM[step] as readonly string[]).includes(status);
export const reached = (step: ReleaseStep, status: string): boolean => (STEP_LANDS[step] as readonly string[]).includes(status);
export const abandonable = (status: string | undefined): boolean => status === ABANDONED_FROM;

/** The 409 a step answers for a release in no state for it (the route and the sim say the same words). */
export const startRefusal = (id: string, status: string, step: ReleaseStep): string => `${id} is ${status}; ${step} starts from ${STEP_FROM[step].join(' or ')}`;
