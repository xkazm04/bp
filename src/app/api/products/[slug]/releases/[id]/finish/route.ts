// POST /api/products/[slug]/releases/[id]/finish, body `{}`: finish release `id` once its PR is merged, with a release
// job (`/lens-scan release --id <id> --finish`): tag, GitHub release, items released, packs closed. Status codes:
// ../release-job.ts. Localhost only.
import { localOnly, jsonOnly } from '@/lib/scan/local-only';
import { startRelease } from '../release-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  try { await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  return startRelease(req, params, 'finish');
}
