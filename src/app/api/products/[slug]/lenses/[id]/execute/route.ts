// POST /api/products/[slug]/lenses/[id]/execute, body `{}`: execute a lens's backlog. Its `proposed` findings are
// approved through the store's decision write (decided_by 'blueprint'), its `approved` ones are taken as they are,
// and execute jobs of at most 50 (MAX_PROPOSALS) are queued over them (`/lens-scan execute --proposals ...`).
// 202 `{ jobs, approved, skipped }`; 409 `{ error, skipped }` when nothing could go; 400 for an unknown or disabled
// lens; 404 for an unknown product or a missing store; 429 when the queue is full. Localhost only.
// S0 STUB: WP4 implements it (and its Kettle sim parity in scan-sim.ts).
import { localOnly, jsonOnly } from '@/lib/scan/local-only';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  await params;
  try { await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  return Response.json({ error: 'not implemented' }, { status: 501 });
}
