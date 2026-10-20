// PATCH /api/products/[slug]/waves/[wave], body `{ name?, packages? }`: change a draft wave (the packages replace the old ones and
// are numbered pk-1... again). 200 `{ wave }`; 400 `{ error }` for a bad body or wave id; 404 for an unknown product, wave or
// missing store; 409 `{ error }` when the wave was dispatched, `{ error, taken }` when a finding is in another draft wave.
// DELETE /api/products/[slug]/waves/[wave]: delete a draft wave. 200 `{ id }`; 404; 409 when it was dispatched. Localhost only.
import { findProduct, hasStore } from '@/lib/scan/products.server';
import { localOnly, jsonOnly } from '@/lib/scan/local-only';
import { SAFE_ID } from '@/lib/scan/jobs';
import { patchWave, removeWave } from '@/lib/scan/waves.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string; wave: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug, wave } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  if (!SAFE_ID.test(wave)) return Response.json({ error: 'bad wave id' }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  try {
    const r = patchWave(p.root, wave, body);
    return r.ok ? Response.json({ wave: r.wave }) : Response.json({ error: r.error, ...(r.taken ? { taken: r.taken } : {}) }, { status: r.status });
  } catch (e) { return Response.json({ error: `waves could not be saved: ${(e as Error).message}` }, { status: 503 }); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string; wave: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug, wave } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  if (!SAFE_ID.test(wave)) return Response.json({ error: 'bad wave id' }, { status: 400 });
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  try {
    const r = removeWave(p.root, wave);
    return r.ok ? Response.json({ id: wave }) : Response.json({ error: r.error }, { status: r.status });
  } catch (e) { return Response.json({ error: `waves could not be saved: ${(e as Error).message}` }, { status: 503 }); }
}
