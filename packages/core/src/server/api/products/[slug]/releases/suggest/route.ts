// GET /api/products/[slug]/releases/suggest: the version a new release is suggested (lens-scan references/release.md,
// "Version suggestion"). 200 `{ version, from, reason }`: the latest `v*` tag in the product root (git tag --list 'v*'
// --sort=-v:refname), bumped minor when an accepted item with no release is a baseline-upgrade or says `capability: new`,
// else patch; with no tag, the manifest's version as it stands (package.json, Cargo.toml, tauri.conf.json at the root or
// src-tauri/app/desktop), else 0.1.0. A version the store already has a release for is passed over. `?ids=a,b` (the
// Release tab's chosen slice) bumps by those of the free accepted items only, so an unchosen new capability does not
// force minor; 400 for ids that are not 1..200 safe ids. 404 for an unknown product; 503 when the store cannot be read.
// Localhost only.
// Admission (guard, product, the 503): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { unreleased } from '@bp/core/scan/compare';
import { suggestVersion } from '@bp/core/scan/release';
import { MAX_TRIAGE, manifestVersion, versionTags } from '@bp/core/server/release.server';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { snapshotOf } from '@bp/core/server/store.server';

const suggest = door('products/[slug]/releases/suggest', {
  GET: {
    live: async ({ req, product: p, read }) => {
      const raw = new URL(req.url).searchParams.get('ids'), ids = raw === null ? null : raw.split(',');
      if (ids && (!ids.length || ids.length > MAX_TRIAGE || ids.some((i) => !SAFE_ID.test(i)))) return Response.json({ error: `ids must be 1..${MAX_TRIAGE} item ids, comma-separated` }, { status: 400 });
      const scan = read(snapshotOf), free = unreleased(scan), chosen = ids ? new Set(ids) : null;
      const tags = await versionTags(p.root);
      return Response.json(suggestVersion(tags, tags.length ? undefined : manifestVersion(p.root), chosen ? free.filter((x) => chosen.has(x.id)) : free, new Set(scan.releases.map((r) => r.version))));
    },
  },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return suggest.GET(req, ctx);
}
