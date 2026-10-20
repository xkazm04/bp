// GET /api/products/[slug]/waves: the product's waves (`{ waves: Wave[] }`, none when the file is missing or unreadable).
// POST /api/products/[slug]/waves, body `{ name, packages: [{ name, model, effort, ids }] }`: a draft wave of named packages
// (waves.ts checkWaveBody), its packages numbered pk-1... 201 `{ wave }`; 400 `{ error }` for a bad body; 409 `{ error, taken }`
// when a finding is in another draft wave; 429 at 50 waves; 404 for an unknown product or a missing store. Localhost only.
import { unknownProduct } from '@bp/core/server/products.server';
import { findProduct, hasStore } from '@bp/core/server/products.server';
import { localHost, localOnly, jsonOnly } from '@bp/core/scan/local-only';
import { createWave, listWaves } from '@bp/core/server/waves.server';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
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
  const p = findProduct(slug);
  if (!p) return unknownProduct(slug);
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  try {
    const r = createWave(p.root, body);
    return r.ok ? Response.json({ wave: r.wave }, { status: 201 }) : Response.json({ error: r.error, ...(r.taken ? { taken: r.taken } : {}) }, { status: r.status });
  } catch (e) { return Response.json({ error: `waves could not be saved: ${(e as Error).message}` }, { status: 503 }); }
}
