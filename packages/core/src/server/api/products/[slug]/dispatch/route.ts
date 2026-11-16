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
// `dry: true` (the build forecast the ledger's Dispatch label reads): the same gate, admission and refusals (400, 403, 409,
// 503) and NOTHING written - no decision, no job, no held-log line (gateBuild `{ log: false }`), no gh call for the signer;
// 200 `{ dry: true, approve, take, skipped, jobs, held?, note? }` (`approve` = what the real call would approve, `take` = what
// it would build), or 429 with that body when the queue has no room (the real call's 429 comes after its approvals).
// Admission (guards, product, JSON body and its shape, BP_WRITES, Kettle's sim, store): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { storeFile } from '@bp/core/server/products.server';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { MAX_PROPOSALS, busyProposals, enqueueExecute } from '@bp/core/server/jobs.server';
import { NOTHING_TO_BUILD, buildChunks } from '@bp/core/scan/admit';
import { triageBy } from '@bp/core/server/release.server';
import { queueFull, queueRoom, takeForBuild } from '@bp/core/server/waves.server';
import { gateBuild, refusedBy } from '@bp/core/server/rules.server';

/** The proposal ids and the dry flag, or `null` for a body that is not `{ ids, dry? }` with 1..MAX_PROPOSALS safe ids. */
function parse(raw: unknown): { ids: string[]; dry: boolean } | null {
  const { ids, dry } = (raw ?? {}) as { ids?: unknown; dry?: unknown };
  if (dry !== undefined && typeof dry !== 'boolean') return null;
  return !Array.isArray(ids) || !ids.length || ids.length > MAX_PROPOSALS || ids.some((i) => typeof i !== 'string' || !SAFE_ID.test(i)) ? null : { ids: ids as string[], dry: dry === true };
}

const dispatch = door('products/[slug]/dispatch', {
  POST: {
    body: (raw) => parse(raw) ?? Response.json({ error: `body must be { ids: string[], dry?: boolean } with 1..${MAX_PROPOSALS} proposal ids` }, { status: 400 }),
    writes: true,
    kettle: (sim, { body }) => (body.dry ? Response.json(sim.forecastDispatch(body.ids)) : sim.dispatch(body.ids)),
    kettleStatus: 202,
    store: 'required',
    live: async ({ slug, product: p, body: { ids, dry } }) => {
      const file = storeFile(p);
      // the owner's standing orders (rules.server.ts): what an order holds is left out, and cited; all of it held = 403
      let g: ReturnType<typeof gateBuild>;
      try { g = gateBuild(p, 'dispatch', ids, undefined, undefined, { log: !dry }); } catch (e) { return Response.json({ error: `dispatch failed: ${(e as Error).message}` }, { status: 503 }); }
      const held = new Set(g.held.map((h) => h.id));
      if (g.refused) return refusedBy(g);
      const { approved, go, skipped, error } = takeForBuild(file, ids.filter((x: string) => !held.has(x)), busyProposals(slug), dry ? undefined : await triageBy(), dry);
      skipped.push(...g.held.map((h) => ({ id: h.id, status: 'held:' + h.order.id })));
      if (error) return Response.json({ error: `dispatch failed: ${error}`, approved, skipped }, { status: 503 });
      if (!go.length) return Response.json({ error: NOTHING_TO_BUILD, skipped }, { status: 409 });
      const cited = g.words ? { held: g.held, note: g.words } : {};
      if (dry) {
        const forecast = { dry: true, approve: approved, take: go, skipped, jobs: buildChunks(go).length, ...cited };
        return queueRoom(slug) < forecast.jobs ? Response.json({ error: queueFull(slug), ...forecast }, { status: 429 }) : Response.json(forecast);
      }
      const r = enqueueExecute(slug, p.root, go);
      return r.ok ? Response.json({ job: r.job, approved, skipped, ...cited }, { status: 202 }) : Response.json({ error: r.error, approved, skipped }, { status: r.status });
    },
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return dispatch.POST(req, ctx);
}
