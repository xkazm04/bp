// DELETE /api/products/[slug]/focuses/[id]: forget a saved focus. 200 `{ id }`; 400 for an id that is none; 404 when it is not
// there or the product is unknown. Localhost only.
// Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim's list, in memory, under the same rules.
// Admission (guards, product, id, Kettle): the route door (route-door.server.ts).
import { door, type Params } from '@bp/core/server/route-door.server';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { removeFocus } from '@bp/core/server/focuses.server';

const focusId = ({ id }: Params): Response | null => (SAFE_ID.test(id ?? '') ? null : Response.json({ error: 'bad focus id' }, { status: 400 }));

const focus = door('products/[slug]/focuses/[id]', {
  DELETE: {
    params: focusId,
    kettle: (k, { params }) => k.deleteFocus(params.id),
    live: ({ product: p, params }) => {
      try {
        return removeFocus(p.root, params.id) ? Response.json({ id: params.id }) : Response.json({ error: `no focus ${params.id}` }, { status: 404 });
      } catch (e) { return Response.json({ error: `focuses could not be saved: ${(e as Error).message}` }, { status: 503 }); }
    },
  },
});

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  return focus.DELETE(req, ctx);
}
