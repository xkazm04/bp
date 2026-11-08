// GET /api/products/[slug]/focuses: the product's saved focuses (`{ focuses: SavedFocus[] }`, newest first; none when the file is
// missing or unreadable).
// POST /api/products/[slug]/focuses, body `{ lens, note }`: keep a focus for reuse (scan/focus.ts). 201 `{ focus }`, or 200 `{ focus }`
// with the row it already is for the same lens and note; 400 `{ error: 'bad-focus' }` for a note that is not one or for lens
// `all`, `{ error: 'unknown-lens' }` for a lens that is no lens id; at 50 the oldest goes. Localhost only. Beside the map rather
// than in the store, so a product with no scan yet can keep one.
// Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim keeps them, in memory, under the same rules.
// Admission (guards, product, Kettle, JSON body): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { isObj } from '@bp/core/scan/guards';
import { listFocuses, saveFocus } from '@bp/core/server/focuses.server';

const focuses = door('products/[slug]/focuses', {
  GET: { kettle: (k) => ({ focuses: k.listFocuses() }), live: ({ product: p }) => Response.json({ focuses: listFocuses(p.root) }) },
  POST: {
    body: true,
    kettle: (k, { body }) => {
      const b = isObj(body) ? body : {}, before = k.listFocuses();
      const focus = k.saveFocus(b.lens as string, b.note as string);
      return Response.json({ focus }, { status: before.some((f) => f.id === focus.id) ? 200 : 201 });
    },
    live: ({ product: p, body }) => {
      const b = isObj(body) ? body : {};
      try {
        const r = saveFocus(p.root, b.lens, b.note);
        return r.ok ? Response.json({ focus: r.focus }, { status: r.created ? 201 : 200 }) : Response.json({ error: r.error }, { status: r.status });
      } catch (e) { return Response.json({ error: `focuses could not be saved: ${(e as Error).message}` }, { status: 503 }); }
    },
  },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return focuses.GET(req, ctx);
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return focuses.POST(req, ctx);
}
