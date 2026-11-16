// PATCH /api/products/[slug]: rename or re-root a registered product, body `{ name?, root? }` (the slug is
// its identity and does not change). DELETE /api/products/[slug][?purge=store,companion]: unregister it, after cancelling its
// jobs and closing its store connections; with `purge`, also delete `<root>/.ai/lens-scan/` (store) and filter its records
// out of the companion's shared files (companion) - packages/core/src/server/purge.server.ts. 200 `{ slug, purged, kept }`.
// The repo itself is never touched. Both localhost only (403 otherwise); 404 for an unknown slug; 400 for a bad body, a
// root that is not a directory or an unknown purge word; 409 when the registry file cannot be parsed or a job would not end.
import { jsonOnly } from '@bp/core/scan/local-only';
import { localOnly, patchProduct, type RegistryResult } from '@bp/core/server/registry.server';
import { removeWithPurge } from '@bp/core/server/purge.server';

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
  try { return answer(await removeWithPurge(slug, new URL(req.url).searchParams.get('purge'))); }
  catch (e) { return Response.json({ error: `could not remove ${slug}: ${(e as Error).message}` }, { status: 500 }); }
}
