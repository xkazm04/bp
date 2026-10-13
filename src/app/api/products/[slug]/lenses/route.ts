// POST /api/products/[slug]/lenses, body `{ manifest: LensManifest }`: add a temporary lens to the product's map
// (`lenses[]` gains `{ id, version, source: 'project', enabled: true, temporary: true, created_at, manifest }`,
// spec 8.1). The manifest must pass checkTempManifest (a `tmp.` id, numeric metric fields, health, presentation,
// and a `scan` block with instructions). 201 + the entry; 400 `{ error }` saying what failed; 404 for an unknown
// product or a missing map; 409 when the id exists or the map does not parse (it is never overwritten). The
// stream's `map` event then carries the change to every client. Localhost only.
import { findProduct } from '@/lib/scan/products.server';
import { localOnly, jsonOnly } from '@/lib/scan/local-only';
import { checkTempManifest } from '@/lib/scan/manifest-check';
import { addTempLens } from '@/lib/scan/lens-write.server';
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
  const manifest = (body as { manifest?: unknown } | null)?.manifest;
  const bad = checkTempManifest(manifest);
  if (bad) return Response.json({ error: bad }, { status: 400 });
  const r = addTempLens(p, manifest as LensManifest);
  return r.ok ? Response.json(r.value, { status: 201 }) : Response.json({ error: r.error }, { status: r.status });
}
