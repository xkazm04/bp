// POST /api/products/[slug]/releases/[id]/tag, body `{}`: tag release `id` over items that already landed on the default
// branch, with a release job (`/lens-scan release --id <id> --landed`, lens-scan 1.15.0): it checks every item landed on
// origin/<default>, runs the gates on its HEAD, writes the notes, tags v<version> there, publishes the GitHub release and
// moves the row building -> tagged (the items released, settled packs closed); nothing is cherry-picked. Body
// `{"dry":true}`: the Release tab's pre-flight, as the build route's. Status codes: ../release-job.ts (from draft or failed).
// Admission (guards, product, the id, JSON body, store): the route door (route-door.server.ts). Localhost only.
import { door } from '@bp/core/server/route-door.server';
import { snapshotOf } from '@bp/core/server/store.server';
import { isObj } from '@bp/core/scan/guards';
import { badReleaseId, releaseAnswer } from '../release-job';

const tag = door('products/[slug]/releases/[id]/tag', {
  POST: {
    body: (raw) => ({ dry: isObj(raw) && raw.dry === true }),
    params: (p) => badReleaseId(p.id),
    store: 'required',
    live: ({ slug, product, params: { id }, body, read }) =>
      releaseAnswer(slug, product, id, read((f) => snapshotOf(f).releases.find((r) => r.id === id)), 'tag', body.dry),
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  return tag.POST(req, ctx);
}
