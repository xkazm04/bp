// What yesterday's approvals became, server half (roadmap E; the pure join and its rules are companion/outcomes.ts). Read only:
// nothing here writes a store, a log or a journal. Per product it reads
//   - the person's approvals: $BP_HOME/companion/decisions.jsonl rows of kind `morning` for this product (decider.server.ts,
//     appended, `at` an event time, `surface` web or vr) and the product's own steering log (morning.server.ts readSteer:
//     the same verdicts, kept before decisions.jsonl existed, a row without `surface` being the page's). A card answer
//     (kind `card`) records the card's id, not a proposal, so it is not an approval here;
//   - its waves (bp-waves.json, waves.server.ts listWaves, which never writes);
//   - its execute jobs from the job journal (<root>/.ai/lens-scan/work/bp-jobs/journal.jsonl, the last line per job): the
//     journal and not the in-memory jobs list, because apps/web and apps/server keep separate registries and both append
//     here. A queued or running line older than JOB_STALE_MS is a process a restart lost (jobs.server.ts reconcileJobs fails
//     it on its next read), never "building";
//   - the failure record of each failed item straight from its store (lens-scan's `failure <id>: {stage, reason, evidence}`
//     error activity, else the pre-1.14 `<id> ...` error line), since the snapshot carries only the latest 200 activity rows.
import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { readDecisions } from './decider.server.ts';
import { listWaves } from './waves.server.ts';
import { journalFile } from './jobs.server.ts';
import { close, openRead } from './store.server.ts';
import { storeFile } from './products.server.ts';
import { joinOutcomes, type Approval, type BuildTrail, type Outcome } from '../companion/outcomes.ts';
import type { ProductEntry, ScanSnapshot } from '../scan/types.ts';

if (typeof window !== 'undefined') throw new Error('outcomes.server.ts is server-only');

/** A job line the journal last saw queued or running, older than this, is not building (jobs.server.ts ORPHAN_MAX_MS). */
export const JOB_STALE_MS = 12 * 3600e3;
const FAILURE_PREFIX = 'failure ';

type JobLine = { at?: string; slug?: string; job?: { id?: string; kind?: string; status?: string; proposals?: unknown; wave?: string } };
/** The product's execute jobs at their last journalled state. */
export function journalJobs(root: string, slug: string, now: number): BuildTrail['jobs'] {
  let text = '';
  try { text = fs.readFileSync(journalFile(root), 'utf8'); } catch { return []; }
  const last = new Map<string, { at: string; job: NonNullable<JobLine['job']> }>();
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try {
      const x = JSON.parse(l) as JobLine;
      if (x?.slug === slug && typeof x.job?.id === 'string' && typeof x.job.status === 'string') last.set(x.job.id, { at: x.at ?? '', job: x.job });
    } catch { /* a torn last line */ }
  }
  return [...last.values()].map(({ at, job }) => {
    const live = job.status === 'queued' || job.status === 'running', t = Date.parse(at);
    const status = live && !(Number.isFinite(t) && now - t <= JOB_STALE_MS) ? 'stale' : job.status!;
    return { id: job.id!, status, ...(job.kind ? { kind: job.kind } : {}), ...(Array.isArray(job.proposals) ? { proposals: job.proposals.filter((p): p is string => typeof p === 'string') } : {}), ...(job.wave ? { wave: job.wave } : {}) };
  });
}

/** Each failed id's failure record from the store itself (store.mjs failureOf, read side). An unreadable store: none. */
export function failuresOf(file: string, ids: readonly string[], fallback: ScanSnapshot['activity'] = []): Map<string, { stage?: string; reason: string }> {
  const out = new Map<string, { stage?: string; reason: string }>();
  if (!ids.length) return out;
  const parse = (id: string, text: string): { stage?: string; reason: string } | undefined => {
    if (text.startsWith(`${FAILURE_PREFIX}${id}: `)) {
      try { const r = JSON.parse(text.slice(FAILURE_PREFIX.length + id.length + 2)) as { stage?: unknown; reason?: unknown }; if (typeof r.reason === 'string') return { ...(typeof r.stage === 'string' ? { stage: r.stage } : {}), reason: r.reason }; } catch { /* hand-written: legacy below */ }
    }
    if (text.startsWith(id + ' ') || text.startsWith(id + ':')) return { reason: text };
    return undefined;
  };
  let db: DatabaseSync | null = null;
  try {
    db = fs.existsSync(file) ? openRead(file) : null;
    for (const id of ids) {
      let f: { stage?: string; reason: string } | undefined;
      if (db) {
        const rec = db.prepare("SELECT text FROM activity WHERE kind = 'error' AND text LIKE ? ORDER BY at DESC, id DESC LIMIT 1").get(`${FAILURE_PREFIX}${id}: %`) as { text: string } | undefined;
        f = rec ? parse(id, rec.text) : undefined;
        if (!f) {
          const old = db.prepare("SELECT text FROM activity WHERE kind = 'error' AND (text LIKE ? OR text LIKE ?) ORDER BY at DESC, id DESC LIMIT 1").get(`${id} %`, `${id}:%`) as { text: string } | undefined;
          f = old ? parse(id, old.text) : undefined;
        }
      } else {
        // no store file (the Kettle sample's in-memory scan): the snapshot's own error activity, newest first
        for (const a of [...fallback].filter((x) => x.kind === 'error').sort((p, q) => (p.at < q.at ? 1 : -1))) { f = parse(id, a.text); if (f) break; }
      }
      if (f) out.set(id, f);
    }
  } catch { /* a locked or broken store: no reasons, the card still says failed */ } finally { close(db); }
  return out;
}

/** The person's approvals and other verdicts on this product, from both logs. `steerRows`: the product's steering log as
 *  morning.server.ts already read it. */
export function approvalsOf(slug: string, steerRows: readonly (Approval & { surface?: string })[]): Approval[] {
  const fromLog = readDecisions().filter((r) => r.kind === 'morning' && r.product === slug && typeof r.target === 'string')
    .map((r): Approval => ({ at: r.at, product: slug, proposal: r.target, verdict: r.verdict, surface: r.surface }));
  return [...fromLog, ...steerRows.filter((r) => r.product === slug).map((r): Approval => ({ at: r.at, product: slug, proposal: r.proposal, verdict: r.verdict, ...(r.surface ? { surface: r.surface } : {}) }))];
}

/** The join for one product: what its approvals before `since` (and at most a week old) became. */
export function outcomesFor(p: ProductEntry, scan: ScanSnapshot, steerRows: readonly (Approval & { surface?: string })[], since: string, now: number, where?: ReadonlyMap<string, { room: string }>): Outcome[] {
  const approvals = approvalsOf(p.slug, steerRows);
  if (!approvals.some((a) => a.verdict === 'approve')) return [];
  const failed = scan.proposals.filter((x) => x.status === 'failed' && approvals.some((a) => a.proposal === x.id)).map((x) => x.id);
  const trail: BuildTrail = { waves: listWaves(p.root), jobs: journalJobs(p.root, p.slug, now), failures: failuresOf(storeFile(p), failed, scan.activity) };
  return joinOutcomes(p.slug, scan.proposals, scan.shots, approvals, trail, since, now, where);
}
