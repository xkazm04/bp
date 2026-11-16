// POST /api/products/[slug]/proposals/[id]/approve, body `{}`: a device approves the decision its card targets (owner
// 2026-10-31, D12: "Pinching approve in VR should approve the target decisions"; supersedes S4's "Approve writes nothing").
// It is the Morning Watch's own Approve (morning.server.ts `steer`, verdict approve): proposed -> approved through `decide`,
// signed like every bp decision (`triageBy`), note `Morning Watch`, and one row in the product's steering log. It queues no
// job: building what is approved stays a plan verb (Build, a wave's Dispatch), as after the web deck's Approve.
// A device call, as the repeat's decline (`../decline/route.ts`): `x-bp-device` names the caller (baton.server.ts
// `deviceOf`; the LAN door sets it from the paired token, scope `decide`, apps/server/src/lan-door.ts), 400 without it.
// 200 + the steering row and the device; 400 no device, or a body that is not a JSON object; 404 unknown product or
// proposal; 409 not open (already approved, declined, or decided first); 403 while BP_WRITES=off. Localhost only.
import { jsonOnly, localOnly } from '@bp/core/scan/local-only';
import { deviceOf, noDevice } from '@bp/core/server/api/session/baton.server';
import { steer } from '@bp/core/server/api/companion/morning.server';

const NO_STORE = { 'cache-control': 'no-store' };

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let b: unknown;
  try { b = await req.json(); } catch { return Response.json({ error: 'body must be a JSON object ({})' }, { status: 400 }); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return Response.json({ error: 'body must be a JSON object ({})' }, { status: 400 });
  const device = deviceOf(req);
  if (!device) return noDevice();
  const { slug, id } = await params;
  const r = await steer(slug, id, 'approve');
  if ('error' in r) return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  console.log(`approve: ${slug}/${id} approved from ${device}`);
  return Response.json({ ...r.row, device }, { headers: NO_STORE });
}
