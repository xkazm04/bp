// GET /api/products/[slug]/commits/[sha]: one item commit for the ledger's compare panel, as CommitDiff `{ sha, message,
// stat, files: [{ path, add, del }], patch, lines, truncated }` (src/lib/scan/release.server.ts commitDiff: three
// `git show`s in the product root; the patch cut at 2000 lines, `lines` the full count). `sha` is 7-40 hex characters
// and must be the `commit_sha` of a proposal in the product's store (or a prefix of it): the route shows item commits
// only, never an arbitrary object of the repo. 200 with `cache-control: private, max-age=3600` (a commit never
// changes); 400 for a bad or ambiguous sha; 404 for an unknown product, a missing store, a sha that is no item commit,
// or one the repo does not have; 503 when the store cannot be read or git does not run. Localhost only.
import { findProduct, hasStore, storeFile } from '@/lib/scan/products.server';
import { localHost } from '@/lib/scan/local-only';
import { close, openRead } from '@/lib/scan/store.server';
import { commitDiff } from '@/lib/scan/release.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SHA = /^[0-9a-f]{7,40}$/i;

/** The item commits of the store: every proposal's commit_sha, lower-cased. */
function itemCommits(file: string): string[] {
  const db = openRead(file);
  if (!db) return [];
  try {
    const rows = db.prepare('SELECT DISTINCT commit_sha FROM proposals WHERE commit_sha IS NOT NULL').all();
    return rows.map((r) => String(r.commit_sha).toLowerCase());
  } finally { close(db); }
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; sha: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug, sha } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  if (!SHA.test(sha)) return Response.json({ error: 'sha must be 7-40 hex characters' }, { status: 400 });
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  let shas: string[];
  try { shas = itemCommits(storeFile(p)); } catch (e) { return Response.json({ error: `cannot read the scan store: ${(e as Error).message}` }, { status: 503 }); }
  // the asked sha is a prefix of an item's commit, or (a store that kept a short sha) that commit is a prefix of it
  const want = sha.toLowerCase();
  const hits = [...new Set(shas.filter((s) => s.length >= 7 && (s.startsWith(want) || want.startsWith(s))))];
  if (!hits.length) return Response.json({ error: `${sha} is not an item commit of ${slug}` }, { status: 404 });
  if (hits.length > 1) return Response.json({ error: `${sha} is ambiguous: ${hits.length} item commits start with it` }, { status: 400 });
  const d = await commitDiff(p.root, hits[0].length >= want.length ? hits[0] : want);
  if (!d.ok) return Response.json({ error: d.error }, { status: d.kind === 'missing' ? 404 : 503 });
  return Response.json(d.data, { headers: { 'cache-control': 'private, max-age=3600' } });
}
