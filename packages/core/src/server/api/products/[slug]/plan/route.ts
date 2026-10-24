// GET /api/products/[slug]/plan: the derived plan, `{ rev, lenses, wings, rooms, bays, tiles }` (packages/schema plan-1):
// the structure route's map laid out by core's layout, with every tile's health per enabled lens. Boxes are world units,
// ids and parent ids are strings, and `rev` is the structure route's. 404 for an unknown slug or a missing structure file.
// With no registered product named `kettle`, that slug answers the built-in sample, read-only, in the same shape.
// `?layout=islands` (the VR client's) answers the islands view: the same shape, wings and rooms spaced apart
// (plan-projection's WING_GAP, ROOM_GAP). No `layout`, or any other value, answers the layout's own boxes.
import fs from 'node:fs';
import path from 'node:path';
import { findProduct, kettleRead, kettleSample, storeDir, unknownProduct } from '@bp/core/server/products.server';
import { localHost } from '@bp/core/scan/local-only';
import { mapRev } from '@bp/core/server/store.server';
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
  const dir = storeDir(p), file = path.join(dir, 'app-structure.json');
  const rev = mapRev(dir); // before the read: a write in between shows up as a newer rev
  let structure: unknown;
  try { structure = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
    return Response.json({ error: missing ? `no structure at ${file}` : `unreadable structure at ${file}: ${(e as Error).message}` }, { status: missing ? 404 : 500 });
  }
  let events = '';
  try { events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'); } catch { /* no events log */ }
  try { return Response.json(projectPlan(structure, events, rev, opts)); } catch (e) {
    return Response.json({ error: `no plan for ${file}: ${(e as Error).message}` }, { status: 500 });
  }
}
