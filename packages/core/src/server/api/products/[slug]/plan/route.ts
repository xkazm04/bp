// GET /api/products/[slug]/plan: the derived plan, `{ rev, lenses, wings, rooms, bays, tiles }` (packages/schema plan-1):
// the structure route's map laid out by core's layout, with every tile's health per enabled lens. Boxes are world units,
// ids and parent ids are strings, and `rev` is the structure route's. 404 for an unknown slug or a missing structure file,
// and the structure route's 409 / 500 for one that does not parse or cannot be read (map.server.ts, the shared reader).
// With no registered product named `kettle`, that slug answers the built-in sample, read-only, in the same shape.
// `?layout=islands` (the VR client's) answers the islands view: the same shape, wings and rooms spaced apart
// (plan-projection's WING_GAP, ROOM_GAP or a live product's LIVE_ROOM_GAP). No `layout`, or any other value, answers the layout's own boxes.
import { findProduct, kettleRead, kettleSample, unknownProduct } from '@bp/core/server/products.server';
import { localHost } from '@bp/core/scan/local-only';
import { readProductMap } from '@bp/core/server/map.server';
import { projectPlan } from '@bp/core/server/plan-projection';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  const opts = { islands: new URL(req.url).searchParams.get('layout') === 'islands' };
  const k = kettleSample(slug);
  if (k) {
    try {
      const { raw, events, rev } = kettleRead(k);
      return Response.json(projectPlan(JSON.parse(raw), events, rev, opts));
    } catch (e) {
      return Response.json({ error: `kettle sample unreadable: ${(e as Error).message}` }, { status: 500 });
    }
  }
  const p = findProduct(slug);
  if (!p) return unknownProduct(slug);
  const m = readProductMap(p);
  if (!m.ok) return Response.json({ error: m.error }, { status: m.status });
  try { return Response.json(projectPlan(m.doc, m.events, m.rev, opts)); } catch (e) {
    return Response.json({ error: `no plan for ${m.file}: ${(e as Error).message}` }, { status: 500 });
  }
}
