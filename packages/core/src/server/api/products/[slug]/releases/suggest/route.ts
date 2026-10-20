// GET /api/products/[slug]/releases/suggest: the version a new release is suggested (lens-scan references/release.md,
// "Version suggestion"). 200 `{ version, from, reason }`: the latest `v*` tag in the product root (git tag --list 'v*'
// --sort=-v:refname), bumped minor when an accepted item with no release is a baseline-upgrade or says `capability: new`,
// else patch; with no tag, the manifest's version as it stands (package.json, Cargo.toml, tauri.conf.json at the root or
// src-tauri/app/desktop), else 0.1.0. A version the store already has a release for is passed over. 404 for an unknown
// product; 503 when the store cannot be read. Localhost only.
import { findProduct, storeFile } from '@bp/core/server/products.server';
import { localHost } from '@bp/core/scan/local-only';
import { unreleased } from '@bp/core/scan/compare';
import { suggestVersion } from '@bp/core/scan/release';
import { manifestVersion, versionTags } from '@bp/core/server/release.server';
import { snapshotOf } from '@bp/core/server/store.server';
import type { ScanSnapshot } from '@bp/core/scan/types';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  let scan: ScanSnapshot;
  try { scan = snapshotOf(storeFile(p)); } catch (e) { return Response.json({ error: `cannot read the scan store: ${(e as Error).message}` }, { status: 503 }); }
  const tags = await versionTags(p.root);
  return Response.json(suggestVersion(tags, tags.length ? undefined : manifestVersion(p.root), unreleased(scan), new Set(scan.releases.map((r) => r.version))));
}
