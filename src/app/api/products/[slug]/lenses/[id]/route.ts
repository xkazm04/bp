// PATCH /api/products/[slug]/lenses/[id], body `{ enabled: boolean }`: retire (false) or restore (true) a
// temporary lens. DELETE: remove its entry from the map; its facets stay (spec 8.1). 200 + the entry (PATCH) or
// `{ id }` (DELETE); 403 when the lens is not temporary (the blueprint never changes a permanent lens); 404 for an
// unknown product, map or lens; 400 for a bad body; 409 when the map does not parse. Localhost only.
import { findProduct } from '@/lib/scan/products.server';
import { localOnly, jsonOnly } from '@/lib/scan/local-only';
import { deleteTempLens, setTempLensEnabled, type LensWrite } from '@/lib/scan/lens-write.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const answer = <T,>(r: LensWrite<T>): Response => (r.ok ? Response.json(r.value) : Response.json({ error: r.error }, { status: r.status }));

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug, id } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const o = body as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.enabled !== 'boolean' || Object.keys(o).length !== 1) return Response.json({ error: 'body must be { enabled: boolean }' }, { status: 400 });
  return answer(setTempLensEnabled(p, id, o.enabled));
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug, id } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  return answer(deleteTempLens(p, id));
}
