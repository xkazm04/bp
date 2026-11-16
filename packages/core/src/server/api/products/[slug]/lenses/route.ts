// POST /api/products/[slug]/lenses, body `{ manifest: LensManifest, temporary?: boolean }`: add a lens to the product's
// map (spec 8.1). A permanent project lens (the default; a reverse-DNS id) becomes `{ id, version, source: 'project',
// enabled: true, created_at, manifest }`; a temporary one (`temporary: true`, or a `tmp.` id) carries `temporary: true`
// as well. The manifest must pass checkLensManifest in the matching mode, with `taken` = the looks of the map's other
// enabled lenses (the same glyph AND line is refused). 201 + the entry; 400 `{ error }` saying what failed; 404 for an
// unknown product or a missing map; 409 when the id exists (any source) or the map does not parse (it is never
// overwritten). The stream's `map` event then carries the change to every client. Localhost only.
// Admission (guards, product, JSON body and its shape): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { checkLensManifest } from '@bp/core/scan/manifest-check';
import { addLens } from '@bp/core/server/lens-write.server';
import type { LensManifest } from '@bp/core/standard/types';

type LensBody = { manifest: unknown; temporary: boolean; mode: 'temporary' | 'project' };

/** The lens to add and its mode, or the 400 for a `temporary` that is not a boolean. */
function parse(raw: unknown): LensBody | Response {
  const b = (raw ?? {}) as { manifest?: unknown; temporary?: unknown };
  if (b.temporary !== undefined && typeof b.temporary !== 'boolean') return Response.json({ error: 'temporary must be a boolean' }, { status: 400 });
  const id = (b.manifest as { id?: unknown } | null | undefined)?.id;
  const temporary = b.temporary === true || (typeof id === 'string' && id.startsWith('tmp.'));
  return { manifest: b.manifest, temporary, mode: temporary ? 'temporary' : 'project' };
}

const lenses = door('products/[slug]/lenses', {
  POST: {
    body: parse,
    live: ({ product: p, body: { manifest, temporary, mode } }) => {
      // the shape first (no map read for a bad body), then again with the map's looks inside the write
      const bad = checkLensManifest(manifest, { mode });
      if (bad) return Response.json({ error: bad }, { status: 400 });
      const r = addLens(p, manifest as LensManifest, temporary, (taken) => checkLensManifest(manifest, { mode, taken }));
      return r.ok ? Response.json(r.value, { status: 201 }) : Response.json({ error: r.error }, { status: r.status });
    },
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return lenses.POST(req, ctx);
}
