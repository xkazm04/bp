// GET /api/products/[slug]/waves: the product's waves (`{ waves: Wave[] }`, none when the file is missing or unreadable).
// POST /api/products/[slug]/waves, body `{ name, packages: [{ name, model, effort, ids }] }`: a draft wave of named packages
// (waves.ts checkWaveBody), its packages numbered pk-1... 201 `{ wave }`; 400 `{ error }` for a bad body; 409 `{ error, taken }`
// when a finding is in another draft wave; 429 at 50 waves; 404 for an unknown product or a missing store. Localhost only.
// Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim keeps the waves, in memory, under the same rules.
// Admission (guards, product, Kettle, JSON body, store): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { createWave, listWaves } from '@bp/core/server/waves.server';
import type { WaveBody } from '@bp/core/scan/waves';
import { gateBuild, refusedBy, type Gated } from '@bp/core/server/rules.server';

/** The body with what the owner's standing orders hold left out of each package (an emptied package is dropped), and
 *  the held items with the orders that hold them; a body that is not a list of packages passes as it is (createWave refuses it). */
function governed(p: Parameters<typeof gateBuild>[0], body: unknown): { body: unknown; held: Gated['held']; words: string; refused?: Gated } {
  const pk = (body as { packages?: unknown } | null)?.packages;
  if (!Array.isArray(pk) || pk.some((k) => !k || typeof k !== 'object' || !Array.isArray((k as { ids?: unknown }).ids))) return { body, held: [], words: '' };
  const held: Gated['held'] = [], words: string[] = [];
  const kept = (pk as { ids: string[]; model?: string; effort?: string }[]).map((k) => {
    const g = gateBuild(p, 'wave.compose', k.ids.filter((x) => typeof x === 'string'), k.model, k.effort);
    if (!g.held.length) return k;
    held.push(...g.held); words.push(g.words);
    const out = new Set(g.held.map((h) => h.id)), ids = k.ids.filter((x) => !out.has(x));
    return ids.length ? { ...k, ids } : null;
  }).filter((k) => k !== null);
  const all = { held, words: words.join('. ') };
  if (held.length && !kept.length) return { body, ...all, refused: { held, refused: held[0].order, words: all.words } };
  return { body: { ...(body as object), packages: kept }, ...all };
}

const waves = door('products/[slug]/waves', {
  GET: { kettle: (k) => ({ waves: k.listWaves() }), live: ({ product: p }) => Response.json({ waves: listWaves(p.root) }) },
  POST: {
    body: true,
    store: 'required',
    kettle: (k, { body }) => ({ wave: k.createWave(body as WaveBody) }),
    kettleStatus: 201,
    live: ({ product: p, body }) => {
      try {
        const gv = governed(p, body);
        if (gv.refused) return refusedBy(gv.refused);
        const r = createWave(p.root, gv.body), note = gv.held.length ? { held: gv.held, note: gv.words } : {};
        return r.ok ? Response.json({ wave: r.wave, ...note }, { status: 201 }) : Response.json({ error: r.error, ...(r.taken ? { taken: r.taken } : {}) }, { status: r.status });
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
