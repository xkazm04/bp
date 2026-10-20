// PATCH /api/products/[slug]: rename or re-root a registered product, body `{ name?, root? }` (the slug is
// its identity and does not change). DELETE /api/products/[slug]: unregister it; the repo and its
// `.ai/lens-scan/` stay on disk untouched. Both localhost only (403 otherwise); 404 for an unknown slug;
// 400 for a bad body or a root that is not a directory; 409 when the registry file cannot be parsed.
import { jsonOnly } from '@bp/core/scan/local-only';
import { localOnly, patchProduct, removeProduct, type RegistryResult } from '@bp/core/server/registry.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const answer = <T,>(r: RegistryResult<T>): Response => (r.ok ? Response.json(r.value) : Response.json({ error: r.error }, { status: r.status }));
const failed = (e: unknown): Response => Response.json({ error: `could not write the registry: ${(e as Error).message}` }, { status: 500 });

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  try { return answer(patchProduct(slug, body)); } catch (e) { return failed(e); }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  try { return answer(removeProduct(slug)); } catch (e) { return failed(e); }
}
