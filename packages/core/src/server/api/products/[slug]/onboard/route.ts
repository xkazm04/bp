// POST /api/products/[slug]/onboard, body `{ resume?: boolean, model?: string }`: onboard a registered product, i.e. queue an
// `adopt` job that runs the adopt-bp skill headless in its root (server/jobs.server.ts enqueueAdopt; its build-up events
// are GET .../onboarding/events). 202 `{ job }`; 400 `{ error }` for unknown keys, a resume that is no boolean or a model off
// the allow-list (WAVE_MODELS); 404 for an unknown product (Kettle 405); 409 while an adopt job of the product is queued or
// running; 429 when 16 jobs are queued. Localhost only, JSON only. Admission: the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { enqueueAdopt } from '@bp/core/server/jobs.server';
import { isObj } from '@bp/core/scan/guards';

type Body = { resume?: boolean; model?: string };

const parse = (x: unknown): Body | Response => {
  if (x === null || x === undefined) return {};
  if (!isObj(x) || Object.keys(x).some((k) => k !== 'resume' && k !== 'model')) return Response.json({ error: 'body must be { resume?, model? }' }, { status: 400 });
  if (x.resume !== undefined && typeof x.resume !== 'boolean') return Response.json({ error: 'resume must be a boolean' }, { status: 400 });
  if (x.model !== undefined && typeof x.model !== 'string') return Response.json({ error: 'model must be a string' }, { status: 400 });
  return { ...(x.resume !== undefined ? { resume: x.resume as boolean } : {}), ...(x.model !== undefined ? { model: x.model as string } : {}) };
};

const onboard = door('products/[slug]/onboard', {
  POST: {
    body: parse,
    live: ({ slug, product: p, body }) => {
      const r = enqueueAdopt(slug, p.root, { ...body, name: p.name });
      return r.ok ? Response.json({ job: r.job }, { status: 202 }) : Response.json({ error: r.error }, { status: r.status });
    },
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return onboard.POST(req, ctx);
}
