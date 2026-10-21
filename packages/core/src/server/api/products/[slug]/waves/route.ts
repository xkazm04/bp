// GET /api/products/[slug]/waves: the product's waves (`{ waves: Wave[] }`, none when the file is missing or unreadable).
// POST /api/products/[slug]/waves, body `{ name, packages: [{ name, model, effort, ids }] }`: a draft wave of named packages
// (waves.ts checkWaveBody), its packages numbered pk-1... 201 `{ wave }`; 400 `{ error }` for a bad body; 409 `{ error, taken }`
// when a finding is in another draft wave; 429 at 50 waves; 404 for an unknown product or a missing store. Localhost only.
// Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim keeps the waves, in memory, under the same rules.
import { unknownProduct } from '@bp/core/server/products.server';
import { findProduct, hasStore } from '@bp/core/server/products.server';
import { localHost, localOnly, jsonOnly } from '@bp/core/scan/local-only';
import { createWave, listWaves } from '@bp/core/server/waves.server';
import type { WaveBody } from '@bp/core/scan/waves';
import { kettleSim, simAnswer } from '@bp/core/server/kettle-sim.server';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  const k = kettleSim(slug);
  if (k) return simAnswer(() => ({ waves: k.listWaves() }));
  const p = findProduct(slug);
  if (!p) return unknownProduct(slug);
  return Response.json({ waves: listWaves(p.root) });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug } = await params;
  const k = kettleSim(slug), p = findProduct(slug);
  if (!p && !k) return unknownProduct(slug);
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  if (k) return simAnswer(() => ({ wave: k.createWave(body as WaveBody) }), 201);
  if (!p) return unknownProduct(slug);
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  try {
    const r = createWave(p.root, body);
    return r.ok ? Response.json({ wave: r.wave }, { status: 201 }) : Response.json({ error: r.error, ...(r.taken ? { taken: r.taken } : {}) }, { status: r.status });
  } catch (e) { return Response.json({ error: `waves could not be saved: ${(e as Error).message}` }, { status: 503 }); }
}
