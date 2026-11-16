// GET /api/products/[slug]/releases/watch: the product's outcome watches (train/watch.ts, kept in
// <root>/.ai/lens-scan/work/bp-watch.json), after queueing what is due (watch.server.ts reconcileWatches): 200 `{ watches }`.
// POST, body `{ release: <id>, on: boolean }`: the owner turns release `id`'s watch on (frozen from the store, git's
// landings and the map's bounds) or off (it keeps its record). 200 `{ watch }`; 400 for a bad body; 404 for an unknown
// release, or no watch to turn off; 409 for a release not merged or tagged yet, or one with no item. Like the rest of the
// Release tab it stays on under BP_WRITES=off (scan/writes.ts). Localhost only; admission: the route door.
import { door } from '@bp/core/server/route-door.server';
import { reconcileWatches, setWatch } from '@bp/core/server/watch.server';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { isObj } from '@bp/core/scan/guards';

type WatchBody = { release: string; on: boolean };
const parse = (raw: unknown): WatchBody | Response =>
  isObj(raw) && typeof raw.release === 'string' && SAFE_ID.test(raw.release) && typeof raw.on === 'boolean' && Object.keys(raw).every((k) => k === 'release' || k === 'on')
    ? { release: raw.release, on: raw.on }
    : Response.json({ error: 'body must be { release: <release id>, on: true | false }' }, { status: 400 });

const watch = door('products/[slug]/releases/watch', {
  GET: {
    store: 'required',
    live: ({ slug, product: p }) => Response.json({ watches: reconcileWatches(slug, p.root) }),
  },
  POST: {
    body: parse,
    store: 'required',
    live: async ({ product: p, body }) => {
      const b = body as WatchBody, r = await setWatch(p, b.release, b.on);
      return r.ok ? Response.json({ watch: r.watch }) : Response.json({ error: r.error }, { status: r.status });
    },
  },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return watch.GET(req, ctx);
}
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return watch.POST(req, ctx);
}
