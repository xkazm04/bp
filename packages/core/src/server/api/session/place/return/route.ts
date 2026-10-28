// POST /api/session/place/return, body `{}`, header `x-bp-device`: the device that claimed the baton hands it back
// (claimed|live -> returned; the page leads again from the last place the table wrote). 409 when nothing is held, 403
// for another device. Localhost only (see ../../baton.server.ts for the door).
import { jsonOnly, localOnly } from '../../../../../scan/local-only.ts';
import { step } from '../../../../../session/place.ts';
import { deviceOf, noDevice, readBaton, writeBaton } from '../../baton.server.ts';

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  try { const b = (await req.json()) as unknown; if (!b || typeof b !== 'object') throw new Error(); } catch { return Response.json({ error: 'body must be a JSON object ({})' }, { status: 400 }); }
  const device = deviceOf(req);
  if (!device) return noDevice();
  const r = step(readBaton(), { kind: 'return', device }, Date.now());
  if (r.error) return Response.json({ error: r.error, state: r.baton?.state ?? 'none' }, { status: r.status, headers: { 'cache-control': 'no-store' } });
  writeBaton(r.baton);
  return Response.json(r.baton, { headers: { 'cache-control': 'no-store' } });
}
