// GET /api/products/[slug]/releases/landed: what already landed on the product's base branch, read from git on each ask
// (release.server.ts landings: `git rev-parse <base_ref>`, the rest cached by that sha) and never written to the store.
// 200 `{ state: 'known', ref, head, items: { <proposal id>: { sha, at, by: 'trailer' | 'patch-id' } } }`, or
// `{ state: 'unknown', why }` when the root has no git or git cannot read the base: never "nothing landed". 404 for an
// unknown product; 503 when the store cannot be read. Localhost only.
// Admission (guard, product, the 503): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { landings } from '@bp/core/server/release.server';
import { snapshotOf } from '@bp/core/server/store.server';

const landed = door('products/[slug]/releases/landed', {
  GET: {
    live: async ({ product: p, read }) => Response.json(await landings(p.root, read(snapshotOf))),
  },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return landed.GET(req, ctx);
}
