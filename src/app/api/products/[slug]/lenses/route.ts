// POST /api/products/[slug]/lenses, body `{ manifest: LensManifest, temporary?: boolean }`: add a lens to the product's
// map (spec 8.1). A permanent project lens (the default; a reverse-DNS id) becomes `{ id, version, source: 'project',
// enabled: true, created_at, manifest }`; a temporary one (`temporary: true`, or a `tmp.` id) carries `temporary: true`
// as well. The manifest must pass checkLensManifest in the matching mode, with `taken` = the looks of the map's other
// enabled lenses (the same glyph AND line is refused). 201 + the entry; 400 `{ error }` saying what failed; 404 for an
// unknown product or a missing map; 409 when the id exists (any source) or the map does not parse (it is never
// overwritten). The stream's `map` event then carries the change to every client. Localhost only.
import { findProduct } from '@/lib/scan/products.server';
import { localOnly, jsonOnly } from '@/lib/scan/local-only';
import { checkLensManifest } from '@/lib/scan/manifest-check';
import { addLens } from '@/lib/scan/lens-write.server';
import type { LensManifest } from '@/lib/standard/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const b = (body ?? {}) as { manifest?: unknown; temporary?: unknown };
  if (b.temporary !== undefined && typeof b.temporary !== 'boolean') return Response.json({ error: 'temporary must be a boolean' }, { status: 400 });
  const id = (b.manifest as { id?: unknown } | null | undefined)?.id;
  const temporary = b.temporary === true || (typeof id === 'string' && id.startsWith('tmp.'));
  const mode = temporary ? 'temporary' : 'project';
  // the shape first (no map read for a bad body), then again with the map's looks inside the write
  const bad = checkLensManifest(b.manifest, { mode });
  if (bad) return Response.json({ error: bad }, { status: 400 });
  const r = addLens(p, b.manifest as LensManifest, temporary, (taken) => checkLensManifest(b.manifest, { mode, taken }));
  return r.ok ? Response.json(r.value, { status: 201 }) : Response.json({ error: r.error }, { status: r.status });
}
