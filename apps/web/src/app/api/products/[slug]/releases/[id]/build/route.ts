// POST /api/products/[slug]/releases/[id]/build, body `{}`: cut release `id` with a release job (`/lens-scan release
// --id <id>`): cherry-pick, gates, re-measure, a PR. Status codes: ../release-job.ts. Localhost only.
import { localOnly, jsonOnly } from '@bp/core/scan/local-only';
import { startRelease } from '../release-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  try { await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  return startRelease(req, params, 'build');
}
