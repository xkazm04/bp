// POST /api/products/[slug]/releases/[id]/finish, body `{}`: finish release `id` once its PR is merged, with a release
// job (`/lens-scan release --id <id> --finish`): tag, GitHub release, items released, packs closed. Status codes:
// ../release-job.ts. Localhost only.
// Admission (guards, product, JSON body and its shape, the id, store): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { snapshotOf } from '@bp/core/server/store.server';
import { badReleaseId, releaseAnswer } from '../release-job';

const finish = door('products/[slug]/releases/[id]/finish', {
  POST: {
    body: true,
    params: (p) => badReleaseId(p.id),
    store: 'required',
    live: ({ slug, product, params: { id }, read }) =>
      releaseAnswer(slug, product, id, read((f) => snapshotOf(f).releases.find((r) => r.id === id)), 'finish', false),
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  return finish.POST(req, ctx);
}
