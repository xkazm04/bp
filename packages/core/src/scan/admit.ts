// Which findings a build may take: the one admission rule /dispatch, a lens execute, a wave dispatch, the Kettle scan sim,
// the selection bar's Build plan (live-plan.ts) and the findings ledger all read. Pure and import-free besides jobs.ts, so
// Node checks load it as-is (scripts/check-build-admit.ts runs one fixture through every caller).
//   a `proposed` finding is approved, then taken; an `approved` one is taken as it is;
//   one a queued or running execute job already builds is skipped 'in-job';
//   an id that may not reach a command line (SAFE_ID) is skipped 'unsafe-id';
//   anything else is skipped with its status ('unknown' for an id the store lacks).
// Each id is judged once, in input order. The callers keep their own I/O (the store's decision write live, setProp in the
// sim) and their own refusal texts; only the decision lives here. buildChunks is the one cut into execute jobs of at most
// MAX_PROPOSALS.
import { MAX_PROPOSALS, SAFE_ID, type ScanJob } from './jobs.ts';

export interface Skip { id: string; status: string }
/** `approve`: the proposed ids to approve (each also in `take`); `take`: every id to build, input order; `skipped`: the rest. */
export interface Admitted { approve: string[]; take: string[]; skipped: Skip[] }

/** What /dispatch and the sim's dispatch answer (409) when nothing they were given can be built. */
export const NOTHING_TO_BUILD = 'none of these proposals can be built (only proposed or approved ones that no job is building can)';

/** Whether a job holds its findings: a queued or running execute job. */
export function holdsBuild(j: Pick<ScanJob, 'kind' | 'status'>): boolean {
  return j.kind === 'execute' && (j.status === 'queued' || j.status === 'running');
}

/** The proposal ids the queued or running execute jobs build. */
export function busyIds(jobs: Iterable<Pick<ScanJob, 'kind' | 'status' | 'proposals'>>): Set<string> {
  const out = new Set<string>();
  for (const j of jobs) if (holdsBuild(j)) for (const id of j.proposals ?? []) out.add(id);
  return out;
}

/** Whether a finding in `status` can go to a build: proposed or approved, and no job is building it. */
export function canBuild(status: string | undefined, busy: boolean): boolean {
  return (status === 'proposed' || status === 'approved') && !busy;
}

/** The admission rule over `ids` (see the header); `statusOf` answers a finding's status, undefined for one the store lacks. */
export function admitForBuild(ids: Iterable<string>, statusOf: (id: string) => string | undefined, busy?: ReadonlySet<string>): Admitted {
  const approve: string[] = [], take: string[] = [], skipped: Skip[] = [];
  for (const id of new Set(ids)) {
    const s = statusOf(id);
    if (s !== 'proposed' && s !== 'approved') { skipped.push({ id, status: s ?? 'unknown' }); continue; }
    if (busy?.has(id)) { skipped.push({ id, status: 'in-job' }); continue; }
    if (!SAFE_ID.test(id)) { skipped.push({ id, status: 'unsafe-id' }); continue; }
    if (s === 'proposed') approve.push(id);
    take.push(id);
  }
  return { approve, take, skipped };
}

/** `ids` cut into execute jobs of at most `size` (MAX_PROPOSALS), in order. */
export function buildChunks<T>(ids: readonly T[], size: number = MAX_PROPOSALS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
