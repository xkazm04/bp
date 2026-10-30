// POST /api/products/[slug]/dispatch, body `{ ids: string[] }` (1..50 proposal ids): build findings. Each
// `proposed` one is approved through the store's decision write (decided_by `user:<gh login>`, triageBy), an `approved` one is
// taken as it is, anything else is skipped with its status ('unknown' for an id the store lacks; 'in-job' for one a
// queued or running execute job already builds, so a finding is never queued twice). Then ONE execute job runs over
// all that were approved or taken (`/lens-scan execute --proposals ...`). The approve-and-take step is
// waves.server.ts takeForBuild over scan/admit.ts, shared with the wave dispatch and the lens execute. 202
// `{ job, approved, skipped }` (`approved` = the ids this call approved; `job.proposals` = every id it builds);
// 409 `{ error, skipped }` when none could go; 400 for a bad body; 404 for an unknown product or a missing store;
// 429 when 16 jobs are queued (the approvals stand); 503 when the store stayed locked; 403 while BP_WRITES=off. Localhost only.
// Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim approves and queues, with the same answers.
// Admission (guards, product, JSON body and its shape, BP_WRITES, Kettle's sim, store): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { storeFile } from '@bp/core/server/products.server';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { MAX_PROPOSALS, busyProposals, enqueueExecute } from '@bp/core/server/jobs.server';
import { NOTHING_TO_BUILD } from '@bp/core/scan/admit';
import { triageBy } from '@bp/core/server/release.server';
import { takeForBuild } from '@bp/core/server/waves.server';

/** The proposal ids, or `null` for a body that is not `{ ids }` with 1..MAX_PROPOSALS safe ids. */
function parse(raw: unknown): string[] | null {
  const ids = (raw as { ids?: unknown } | null)?.ids;
  return !Array.isArray(ids) || !ids.length || ids.length > MAX_PROPOSALS || ids.some((i) => typeof i !== 'string' || !SAFE_ID.test(i)) ? null : ids as string[];
}

const dispatch = door('products/[slug]/dispatch', {
  POST: {
    body: (raw) => parse(raw) ?? Response.json({ error: `body must be { ids: string[] } with 1..${MAX_PROPOSALS} proposal ids` }, { status: 400 }),
    writes: true,
    kettle: (sim, { body }) => sim.dispatch(body),
    kettleStatus: 202,
    store: 'required',
    live: async ({ slug, product: p, body: ids }) => {
      const file = storeFile(p);
      const { approved, go, skipped, error } = takeForBuild(file, ids, busyProposals(slug), await triageBy());
      if (error) return Response.json({ error: `dispatch failed: ${error}`, approved, skipped }, { status: 503 });
      if (!go.length) return Response.json({ error: NOTHING_TO_BUILD, skipped }, { status: 409 });
      const r = enqueueExecute(slug, p.root, go);
      return r.ok ? Response.json({ job: r.job, approved, skipped }, { status: 202 }) : Response.json({ error: r.error, approved, skipped }, { status: r.status });
    },
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return dispatch.POST(req, ctx);
}
