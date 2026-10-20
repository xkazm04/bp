// GET /api/products/[slug]/structure: `{ structure, events }` from the product's
// `.ai/lens-scan/app-structure.json` and optional `events.jsonl` ('' when absent), and `rev`, their fingerprint
// (the stream's `map` event carries the same string when the files change). 404 for an unknown
// slug or a missing structure file. The structure is passed through as the skill wrote it; the client
// loads it with the standard's loader like the Kettle map.
import fs from 'node:fs';
import path from 'node:path';
import { findProduct, storeDir } from '@bp/core/server/products.server';
import { localHost } from '@bp/core/scan/local-only';
import { mapRev } from '@bp/core/server/store.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  const dir = storeDir(p), file = path.join(dir, 'app-structure.json');
  const rev = mapRev(dir); // before the read: a write in between shows up as a newer rev
  let structure: unknown;
  try { structure = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
    return Response.json({ error: missing ? `no structure at ${file}` : `unreadable structure at ${file}: ${(e as Error).message}` }, { status: missing ? 404 : 500 });
  }
  let events = '';
  try { events = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8'); } catch { /* no events log */ }
  return Response.json({ structure, events, rev });
}
