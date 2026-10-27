// GET /api/products/[slug]/structure: `{ structure, events }` from the product's
// `.ai/lens-scan/app-structure.json` and optional `events.jsonl` ('' when absent), and `rev`, their fingerprint
// (the stream's `map` event carries the same string when the files change). 404 for an unknown
// slug or a missing structure file. The structure is passed through as the skill wrote it; the client
// `writes`: false while BP_WRITES=off (scan/writes.ts), so the UI hides the decide and triage controls.
// loads it with the standard's loader like the Kettle map. With no registered product named `kettle`, that slug
// answers the built-in sample from packages/core/data, read-only, in the same shape (rev = hash of the two files).
import fs from 'node:fs';
import path from 'node:path';
import { findProduct, kettleRead, kettleSample, storeDir, unknownProduct } from '@bp/core/server/products.server';
import { localHost } from '@bp/core/scan/local-only';
import { mapRev } from '@bp/core/server/store.server';
import { writesOn } from '@bp/core/scan/writes';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  const k = kettleSample(slug);
  if (k) return kettleStructure(k);
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
  return Response.json({ structure, events, rev, writes: writesOn() });
}

function kettleStructure(k: { structureFile: string; eventsFile: string }): Response {
  try {
    const { raw, events, rev } = kettleRead(k);
    return Response.json({ structure: JSON.parse(raw), events, rev });
  } catch (e) {
    return Response.json({ error: `kettle sample unreadable: ${(e as Error).message}` }, { status: 500 });
  }
}
