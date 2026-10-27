// POST /api/products/[slug]/waves/[wave]/dispatch, body `{ packages?: string[] }` (default: every package): build a wave's
// findings, one execute job per package (and per 50 findings) run with the package's own `--model` and `--effort`. Per package
// the `proposed` findings are approved (decided_by `user:<gh login>`, triageBy) and the `approved` ones taken, unless a queued or running
// execute job already builds them (skipped as `in-job`); the first job makes the wave `dispatched`, later calls append
// ("Dispatch remaining"). 202 `{ wave, jobs, approved, skipped }`; 409 `{ error, skipped }` when none could go; 400 for a bad
// body or package; 404 for an unknown product, wave or missing store; 429 `{ error, wave, jobs, approved, skipped }` when the
// queue cap stopped it (the jobs queued so far are recorded in the wave, the approvals stand); 503 when the store stayed locked; 403 while BP_WRITES=off.
// Localhost only. Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim dispatches it, with the same answers.
// Admission (guards, product, wave id, Kettle, JSON body, store): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { dispatchWave } from '@bp/core/server/waves.server';
import { triageBy } from '@bp/core/server/release.server';

/** The package ids asked for (undefined = every package), or the 400. */
function packagesOf(body: unknown): string[] | undefined | Response {
  const names = (body as { packages?: unknown } | null)?.packages;
  if (names !== undefined && (!Array.isArray(names) || !names.length || names.some((n) => typeof n !== 'string' || !SAFE_ID.test(n)))) {
    return Response.json({ error: 'packages must be a list of package ids' }, { status: 400 });
  }
  return names as string[] | undefined;
}

const dispatch = door('products/[slug]/waves/[wave]/dispatch', {
  POST: {
    params: ({ wave }) => (SAFE_ID.test(wave ?? '') ? null : Response.json({ error: 'bad wave id' }, { status: 400 })),
    body: packagesOf,
    store: 'required',
    writes: true,
    kettle: (k, { params, body }) => k.dispatchWave(params.wave, body as string[] | undefined),
    kettleStatus: 202,
    live: async ({ slug, product: p, params, body }) => {
      try {
        const r = dispatchWave(slug, p, params.wave, body as string[] | undefined, await triageBy());
        return Response.json(r.body, { status: r.status });
      } catch (e) { return Response.json({ error: `dispatch failed: ${(e as Error).message}` }, { status: 503 }); }
    },
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string; wave: string }> }): Promise<Response> {
  return dispatch.POST(req, ctx);
}
