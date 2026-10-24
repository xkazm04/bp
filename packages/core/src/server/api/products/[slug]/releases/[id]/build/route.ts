// POST /api/products/[slug]/releases/[id]/build, body `{}`: cut release `id` with a release job (`/lens-scan release
// --id <id>`): cherry-pick, gates, re-measure, a PR. Body `{"dry":true}`: the Release tab's pre-flight - the same guards
// from local state, 200 `{ ready: true, gh: 'unchecked' }`, nothing queued, gh never spawned. Status codes: ../release-job.ts.
// Admission (guards, product, the id, JSON body, store): the route door (route-door.server.ts). Localhost only.
import { door } from '@bp/core/server/route-door.server';
import { snapshotOf } from '@bp/core/server/store.server';
import { isObj } from '@bp/core/scan/guards';
import { badReleaseId, releaseAnswer } from '../release-job';

const build = door('products/[slug]/releases/[id]/build', {
  POST: {
    // any JSON body starts the build as before; only `dry: true` asks for the pre-flight
    body: (raw) => ({ dry: isObj(raw) && raw.dry === true }),
    params: (p) => badReleaseId(p.id),
    store: 'required',
    live: ({ slug, product, params: { id }, body, read }) =>
      releaseAnswer(slug, product, id, read((f) => snapshotOf(f).releases.find((r) => r.id === id)), 'build', body.dry),
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  return build.POST(req, ctx);
}
