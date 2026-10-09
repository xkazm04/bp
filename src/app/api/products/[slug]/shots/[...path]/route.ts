// GET /api/products/[slug]/shots/[...path]: a screenshot (or recording) from the product's store, by
// its path under `<store>/shots`. A Shot row's `path` is relative to the store dir
// (`shots/<feature>/<run>-<size>-<theme>.png`); its leading `shots/` may be kept or dropped in the URL.
// Anything that would resolve outside `<store>/shots` is refused with 403: `..`, `.`, empty, absolute or
// drive segments, separators smuggled in an encoded segment (`..%2F..`), NUL, and symlinks pointing out.
import fs from 'node:fs';
import path from 'node:path';
import { findProduct, storeDir } from '@/lib/scan/products.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.webm': 'video/webm' };
const BAD_SEGMENT = /[\\/:\u0000]/;

const forbidden = () => Response.json({ error: 'path outside the shots directory' }, { status: 403 });

/** The file under `root` that `segs` names, or null when it would leave `root` (checked again after symlinks). */
function within(root: string, segs: string[]): string | null {
  const full = path.resolve(root, ...segs), rel = path.relative(root, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; path: string[] }> }): Promise<Response> {
  const { slug, path: segs } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  if (!segs?.length || segs.some((s) => !s || s === '.' || s === '..' || BAD_SEGMENT.test(s) || path.isAbsolute(s))) return forbidden();
  const root = path.join(storeDir(p), 'shots');
  // A full Shot.path (`shots/...`) is accepted too: try it as given, then without the leading `shots`.
  const tries = [segs]; if (segs[0] === 'shots' && segs.length > 1) tries.push(segs.slice(1));
  let file: string | null = null;
  for (const t of tries) {
    const f = within(root, t);
    if (!f) return forbidden();
    if (fs.existsSync(f)) { file = f; break; }
  }
  if (!file) return Response.json({ error: 'no such shot' }, { status: 404 });
  // Symlinks: the real file must still sit under the real shots directory.
  let real: string;
  try { real = fs.realpathSync(file); const rel = path.relative(fs.realpathSync(root), real); if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return forbidden(); }
  catch { return Response.json({ error: 'no such shot' }, { status: 404 }); }
  const type = TYPES[path.extname(real).toLowerCase()];
  if (!type) return Response.json({ error: 'not an image or video' }, { status: 415 });
  let st: fs.Stats;
  try { st = fs.statSync(real); } catch { return Response.json({ error: 'no such shot' }, { status: 404 }); }
  if (!st.isFile()) return Response.json({ error: 'no such shot' }, { status: 404 });
  const bytes = fs.readFileSync(real);
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': type, 'content-length': String(bytes.length), 'cache-control': 'private, max-age=60' } });
}
