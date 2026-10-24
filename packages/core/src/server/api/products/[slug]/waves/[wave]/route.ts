// PATCH /api/products/[slug]/waves/[wave], body `{ name?, packages? }`: change a draft wave (the packages replace the old ones and
// are numbered pk-1... again). 200 `{ wave }`; 400 `{ error }` for a bad body or wave id; 404 for an unknown product, wave or
// missing store; 409 `{ error }` when the wave was dispatched, `{ error, taken }` when a finding is in another draft wave.
// DELETE /api/products/[slug]/waves/[wave]: delete a draft wave. 200 `{ id }`; 404; 409 when it was dispatched. Localhost only.
// Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim's waves, in memory, under the same rules.
// Admission (guards, product, wave id, Kettle, JSON body, store): the route door (route-door.server.ts).
import { door, type Params } from '@bp/core/server/route-door.server';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { patchWave, removeWave } from '@bp/core/server/waves.server';
import type { WaveBody } from '@bp/core/scan/waves';

const waveId = ({ wave }: Params): Response | null => (SAFE_ID.test(wave ?? '') ? null : Response.json({ error: 'bad wave id' }, { status: 400 }));

const wave = door('products/[slug]/waves/[wave]', {
  PATCH: {
    params: waveId,
    body: true,
    store: 'required',
    kettle: (k, { params, body }) => ({ wave: k.updateWave(params.wave, body as Partial<WaveBody>) }),
    live: ({ product: p, params, body }) => {
      try {
        const r = patchWave(p.root, params.wave, body);
        return r.ok ? Response.json({ wave: r.wave }) : Response.json({ error: r.error, ...(r.taken ? { taken: r.taken } : {}) }, { status: r.status });
      } catch (e) { return Response.json({ error: `waves could not be saved: ${(e as Error).message}` }, { status: 503 }); }
    },
  },
  DELETE: {
    params: waveId,
    store: 'required',
    kettle: (k, { params }) => k.deleteWave(params.wave),
    live: ({ product: p, params }) => {
      try {
        const r = removeWave(p.root, params.wave);
        return r.ok ? Response.json({ id: params.wave }) : Response.json({ error: r.error }, { status: r.status });
      } catch (e) { return Response.json({ error: `waves could not be saved: ${(e as Error).message}` }, { status: 503 }); }
    },
  },
});

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; wave: string }> }): Promise<Response> {
  return wave.PATCH(req, ctx);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string; wave: string }> }): Promise<Response> {
  return wave.DELETE(req, ctx);
}
