// GET /api/products/[slug]/waves: the product's waves (`{ waves: Wave[] }`, none when the file is missing or unreadable).
// POST /api/products/[slug]/waves, body `{ name, packages: [{ name, model, effort, ids }] }`: a draft wave of named packages
// (waves.ts checkWaveBody), its packages numbered pk-1... 201 `{ wave }`; 400 `{ error }` for a bad body; 409 `{ error, taken }`
// when a finding is in another draft wave; 429 at 50 waves; 404 for an unknown product or a missing store. Localhost only.
// Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim keeps the waves, in memory, under the same rules.
// Admission (guards, product, Kettle, JSON body, store): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { createWave, listWaves } from '@bp/core/server/waves.server';
import type { WaveBody } from '@bp/core/scan/waves';

const waves = door('products/[slug]/waves', {
  GET: { kettle: (k) => ({ waves: k.listWaves() }), live: ({ product: p }) => Response.json({ waves: listWaves(p.root) }) },
  POST: {
    body: true,
    store: 'required',
    kettle: (k, { body }) => ({ wave: k.createWave(body as WaveBody) }),
    kettleStatus: 201,
    live: ({ product: p, body }) => {
      try {
        const r = createWave(p.root, body);
        return r.ok ? Response.json({ wave: r.wave }, { status: 201 }) : Response.json({ error: r.error, ...(r.taken ? { taken: r.taken } : {}) }, { status: r.status });
      } catch (e) { return Response.json({ error: `waves could not be saved: ${(e as Error).message}` }, { status: 503 }); }
    },
  },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return waves.GET(req, ctx);
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return waves.POST(req, ctx);
}
