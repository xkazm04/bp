// POST /api/products/[slug]/proposals/[id]/decline, body `{}`: a device declines a REPEAT (ROADMAP F8, owner 2026-10-30:
// "pinching decline should decline"). It is the Morning Watch's own Decline (morning.server.ts `steer`, verdict decline):
// taken only when the card brief says the same idea was declined before (advice withdraw), written through `decide` with
// the brief's note (`Repeats <id>, declined <day>: "..."`), and one row in the product's steering log. Any other card is
// 409, so a headset never declines freely: the plan keeps the free Decline with the owner's own note.
// A device call: `x-bp-device` names the caller (baton.server.ts `deviceOf`; the LAN door sets it from the paired token,
// scope `decide`, apps/server/src/lan-door.ts), 400 without it. No human token: the plan's own decide
// (`../route.ts`) takes none on loopback either, and the headset has no page to read one from.
// 200 + the steering row and the device; 400 no device, or a body that is not a JSON object; 404 unknown product or
// proposal; 409 not open, or not a repeat; 403 while BP_WRITES=off. Localhost only.
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
  const r = await steer(slug, id, 'decline');
  if ('error' in r) return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  console.log(`decline: ${slug}/${id} declined as a repeat from ${device}`);
  return Response.json({ ...r.row, device }, { headers: NO_STORE });
}
