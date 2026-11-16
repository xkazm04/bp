// POST /api/products/[slug]/releases, body `{ version: string, ids?: string[] }`: a draft release of accepted items.
// It runs lens-scan's store.mjs `release-create --version <v> --by user:<gh login>` and then `release-add --ids` (default:
// every accepted item with no release, sent in calls of at most 200 ids), and answers 201 `{ release, added, skipped }` - `release` is
// store.mjs `release --id` (the row with its `items`), `skipped` what release-add left out (`{ id, status, reason? }`).
// 400 for a bad body; 404 for an unknown product or a missing store; 409 when no named item is accepted and free, or
// the version already has a release; 503 when lens-scan is not installed or the store stayed locked. Localhost only.
// Admission (guards, product, JSON body and its shape, store; an unreadable store answers 503): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { storeFile } from '@bp/core/server/products.server';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { isVersion } from '@bp/core/scan/release';
import { MAX_TRIAGE, storeCall, triageBy } from '@bp/core/server/release.server';
import { snapshotOf } from '@bp/core/server/store.server';
import { unreleased } from '@bp/core/scan/compare';
import type { Proposal, Release } from '@bp/core/scan/types';

type Skipped = { id: string; status: string; reason?: string };
type ReleaseBody = { version: string; ids?: string[] };
const code = (kind: 'bad' | 'refused' | 'error') => (kind === 'bad' ? 400 : kind === 'refused' ? 409 : 503);

/** `{ version, ids? }`, or `null` for any other body. */
function parse(raw: unknown): ReleaseBody | null {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const ids = o.ids;
  if (!isVersion(o.version) || Object.keys(o).some((k) => k !== 'version' && k !== 'ids')
    || (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > MAX_TRIAGE || ids.some((i) => typeof i !== 'string' || !SAFE_ID.test(i))))) return null;
  return { version: o.version, ...(ids === undefined ? {} : { ids: ids as string[] }) };
}

const releases = door('products/[slug]/releases', {
  POST: {
    body: (raw) => parse(raw) ?? Response.json({ error: `body must be { version: semver without the v, ids?: string[] (1..${MAX_TRIAGE}) }` }, { status: 400 }),
    store: 'required',
    live: async ({ product: p, body, read }) => {
      const { version, ids } = body as ReleaseBody;
      const file = storeFile(p);
      const free = new Set(read((f) => unreleased(snapshotOf(f)).map((x) => x.id)));
      const want = ids === undefined ? [...free] : [...new Set(ids)];
      if (!want.some((id) => free.has(id))) return Response.json({ error: 'no accepted item without a release to ship' + (ids === undefined ? '' : ' among these ids') }, { status: 409 });
      const made = await storeCall<Release>(file, ['release-create', '--version', version, '--by', await triageBy()]);
      if (!made.ok) return Response.json({ error: made.error }, { status: code(made.kind) });
      // At most MAX_TRIAGE ids go to store.mjs in one call (they travel as one argv entry): the default path, which takes every free
      // item, goes in chunks and merges what the calls answer, the way lenses/[id]/execute chunks its enqueues.
      const added: string[] = [], skipped: Skipped[] = [];
      for (let i = 0; i < want.length; i += MAX_TRIAGE) {
        const add = await storeCall<{ release: string; added: string[]; skipped: Skipped[] }>(file, ['release-add', '--release', made.data.id, '--ids', want.slice(i, i + MAX_TRIAGE).join(',')]);
        if (!add.ok) return Response.json({ error: `${made.data.id} was created, but release-add failed${i ? ` after ${added.length} added` : ''}: ${add.error}`, release: made.data }, { status: code(add.kind) });
        added.push(...add.data.added); skipped.push(...add.data.skipped);
      }
      const rel = await storeCall<Release & { items: Proposal[] }>(file, ['release', '--id', made.data.id]);
      return Response.json({ release: rel.ok ? rel.data : { ...made.data, items: [] }, added, skipped }, { status: 201 });
    },
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return releases.POST(req, ctx);
}
