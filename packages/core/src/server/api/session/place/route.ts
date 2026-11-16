// GET /api/session/place (behind the write guard, since a claim moves it): the place baton as it stands (`{ state: 'none' }` when there is none). With `?claim=1` and the
// `x-bp-device` header, the device claims an armed baton (armed -> claimed) and gets its place: 404 none, 410 expired,
// 409 another device holds it. POST /api/session/place, body `{ place }`: from the page (place.from 'web', with the
// x-bp-human token) it arms a baton for 120 s (409 while a device holds one, unless `takeBack: true`: the person takes the lead
// back from a device that never handed it back); from the claiming device (place.from 'vr',
// x-bp-device) it publishes the table's place (claimed|live -> live) and the companion stream carries it to every page
// (`event: place`). Localhost only (see baton.server.ts for the door).
// The state machine and the Place's shape: packages/core/src/session/place.ts.
import { jsonOnly, localOnly } from '../../../../scan/local-only.ts';
import { isHuman, notHuman, sortableId } from '../../companion/door.server.ts';
import { current, readPlace, step } from '../../../../session/place.ts';
import { deviceOf, noDevice, readBaton, writeBaton } from '../baton.server.ts';
import { publish } from '../../../companion/bus.server.ts';
import { moveFocus } from '../focus.server.ts';

const NO_STORE = { 'cache-control': 'no-store' };

export function GET(req: Request): Response {
  // the write guard, not the read one: `?claim=1` moves the baton (armed -> claimed)
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const now = Date.now();
  if (new URL(req.url).searchParams.get('claim') !== '1') return Response.json(current(readBaton(), now) ?? { state: 'none' }, { headers: NO_STORE });
  const device = deviceOf(req);
  if (!device) return noDevice();
  const r = step(readBaton(), { kind: 'claim', device }, now);
  if (r.error) return Response.json({ error: r.error, state: r.baton?.state ?? 'none' }, { status: r.status, headers: NO_STORE });
  writeBaton(r.baton);
  return Response.json(r.baton, { status: r.status, headers: NO_STORE });
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const place = readPlace(b?.place);
  if (typeof place === 'string') return Response.json({ error: place }, { status: 400 });
  const now = Date.now();
  let r;
  if (place.from === 'web') {
    if (!isHuman(req)) return notHuman();
    r = step(readBaton(), { kind: 'arm', place, id: sortableId('pb_'), takeBack: b.takeBack === true }, now);
  } else {
    const device = deviceOf(req);
    if (!device) return noDevice();
    r = step(readBaton(), { kind: 'publish', place, device }, now);
  }
  if (r.error) return Response.json({ error: r.error, state: r.baton?.state ?? 'none' }, { status: r.status, headers: NO_STORE });
  writeBaton(r.baton);
  // the table wrote the place: every open page hears it on the companion stream and follows
  if (r.baton && r.baton.state === 'live') {
    publish({ type: 'place', baton: r.baton });
    // and through the shared focus, as the device's own reader: every follower hears the table too (session/focus.ts)
    const p = r.baton.place, device = r.baton.device ?? 'vr';
    moveFocus({ kind: 'publish', reader: 'vr:' + device, surface: 'vr', label: 'VR table', place: { product: p.product, level: p.level, ...(p.target ? { target: p.target } : {}), ...(p.hash ? { hash: p.hash } : {}) } }, now);
  }
  return Response.json(r.baton, { status: r.status, headers: NO_STORE });
}
