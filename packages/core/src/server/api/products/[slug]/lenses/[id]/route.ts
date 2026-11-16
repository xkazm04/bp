// PATCH /api/products/[slug]/lenses/[id], body `{ enabled: boolean }`: retire (false) or restore (true) a project
// lens, temporary or permanent. DELETE: remove its entry from the map; its facets stay (spec 8.1). 200 + the entry
// (PATCH) or `{ id }` (DELETE); 403 for a built-in lens (`source: 'builtin'`: the blueprint never changes one); 404
// for an unknown product, map or lens; 400 for a bad body; 409 when the map does not parse. Localhost only.
// Admission (guards, product, JSON body and its shape): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { deleteLens, setLensEnabled, type LensWrite } from '@bp/core/server/lens-write.server';

const answer = <T,>(r: LensWrite<T>): Response => (r.ok ? Response.json(r.value) : Response.json({ error: r.error }, { status: r.status }));

/** `enabled`, or the 400 for any body but `{ enabled: boolean }`. */
function parse(raw: unknown): boolean | Response {
  const o = raw as Record<string, unknown> | null;
  return !o || typeof o !== 'object' || typeof o.enabled !== 'boolean' || Object.keys(o).length !== 1
    ? Response.json({ error: 'body must be { enabled: boolean }' }, { status: 400 }) : o.enabled;
}

const lens = door('products/[slug]/lenses/[id]', {
  PATCH: {
    body: parse,
    live: ({ product: p, params: { id }, body: enabled }) => answer(setLensEnabled(p, id, enabled)),
  },
  DELETE: {
    live: ({ product: p, params: { id } }) => answer(deleteLens(p, id)),
  },
});

export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  return lens.PATCH(req, ctx);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  return lens.DELETE(req, ctx);
}
