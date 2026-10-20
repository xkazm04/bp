// POST /api/products/[slug]/releases, body `{ version: string, ids?: string[] }`: a draft release of accepted items.
// It runs lens-scan's store.mjs `release-create --version <v> --by user:<gh login>` and then `release-add --ids` (default:
// every accepted item with no release; at most 200 ids), and answers 201 `{ release, added, skipped }` - `release` is
// store.mjs `release --id` (the row with its `items`), `skipped` what release-add left out (`{ id, status, reason? }`).
// 400 for a bad body; 404 for an unknown product or a missing store; 409 when no named item is accepted and free, or
// the version already has a release; 503 when lens-scan is not installed or the store stayed locked. Localhost only.
import { findProduct, hasStore, storeFile } from '@/lib/scan/products.server';
import { localOnly, jsonOnly } from '@/lib/scan/local-only';
import { SAFE_ID } from '@/lib/scan/jobs';
import { isVersion } from '@/lib/scan/release';
import { MAX_TRIAGE, storeCall, triageBy } from '@/lib/scan/release.server';
import { snapshotOf } from '@/lib/scan/store.server';
import { unreleased } from '@/lib/scan/compare';
import type { Proposal, Release } from '@/lib/scan/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Skipped = { id: string; status: string; reason?: string };
const code = (kind: 'bad' | 'refused' | 'error') => (kind === 'bad' ? 400 : kind === 'refused' ? 409 : 503);

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  let raw: unknown;
  try { raw = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const ids = o.ids;
  if (!isVersion(o.version) || Object.keys(o).some((k) => k !== 'version' && k !== 'ids')
    || (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > MAX_TRIAGE || ids.some((i) => typeof i !== 'string' || !SAFE_ID.test(i))))) {
    return Response.json({ error: `body must be { version: semver without the v, ids?: string[] (1..${MAX_TRIAGE}) }` }, { status: 400 });
  }
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  const file = storeFile(p), version = o.version;
  let free: Set<string>;
  try { free = new Set(unreleased(snapshotOf(file)).map((x) => x.id)); } catch (e) { return Response.json({ error: `cannot read the scan store: ${(e as Error).message}` }, { status: 503 }); }
  const want = ids === undefined ? [...free] : [...new Set(ids as string[])];
  if (!want.some((id) => free.has(id))) return Response.json({ error: 'no accepted item without a release to ship' + (ids === undefined ? '' : ' among these ids') }, { status: 409 });
  const made = await storeCall<Release>(file, ['release-create', '--version', version, '--by', await triageBy()]);
  if (!made.ok) return Response.json({ error: made.error }, { status: code(made.kind) });
  const add = await storeCall<{ release: string; added: string[]; skipped: Skipped[] }>(file, ['release-add', '--release', made.data.id, '--ids', want.join(',')]);
  if (!add.ok) return Response.json({ error: `${made.data.id} was created, but release-add failed: ${add.error}`, release: made.data }, { status: code(add.kind) });
  const rel = await storeCall<Release & { items: Proposal[] }>(file, ['release', '--id', made.data.id]);
  return Response.json({ release: rel.ok ? rel.data : { ...made.data, items: [] }, added: add.data.added, skipped: add.data.skipped }, { status: 201 });
}
