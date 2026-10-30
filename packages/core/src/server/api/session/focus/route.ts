// GET /api/session/focus: the shared focus as it stands (session/focus.ts SharedView: the shared place and who put it there,
// every reader with whether it is live and whom it follows). POST /api/session/focus, body
// `{ op, reader, surface, label, place?, of? }`, one move on the reader's own record:
//   hello    {}                  I am here (clients say it every 15 s while open; LIVE_MS without one reads as gone)
//   publish  { place }           I am looking here: 201 when the shared place moved, 200 when it was already there (an echo)
//   follow   { of: '*' | id }    take the shared place from whoever moves (or from one reader) from now on
//   unfollow {}                  stop following (one tap; it never needs anyone else's leave)
//   forget   {}                  I am closing
// Every visible change goes out on the companion stream as `event: shared` (focus.server.ts). Ids only, never a selection,
// so no human token: any loopback surface may publish where it is looking. Localhost only; a paired headset reaches it
// through the LAN door's `focus` scope, and a call carrying `x-bp-device` speaks as reader `vr:<device>` whatever its body says.
import { jsonOnly, localHost, localOnly } from '../../../../scan/local-only.ts';
import { SURFACES, isReaderId, readFocusPlace, viewOf, type FocusMove, type Surface } from '../../../../session/focus.ts';
import { moveFocus, readFocus } from '../focus.server.ts';
import { deviceOf } from '../baton.server.ts';
import { KETTLE_SLUG, findProduct } from '../../../products.server.ts';

const NO_STORE = { 'cache-control': 'no-store' };
const OPS = ['hello', 'publish', 'follow', 'unfollow', 'forget'] as const;

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  return Response.json(viewOf(readFocus(), Date.now()), { headers: NO_STORE });
}

/** The move a body asks for, or why it is not one. */
export function readMove(b: Record<string, unknown>): FocusMove | string {
  if (!OPS.includes(b.op as (typeof OPS)[number])) return `op must be one of ${OPS.join(', ')}`;
  if (!isReaderId(b.reader)) return 'reader must be an id (letters, digits, . _ : -, at most 80)';
  const op = b.op as (typeof OPS)[number], reader = b.reader;
  if (op === 'unfollow' || op === 'forget') return { kind: op, reader };
  if (!SURFACES.includes(b.surface as Surface)) return `surface must be one of ${SURFACES.join(', ')}`;
  if (typeof b.label !== 'string' || !b.label.trim() || b.label.length > 40) return 'label must be 1..40 characters';
  const who = { reader, surface: b.surface as Surface, label: b.label.trim() };
  if (op === 'hello') return { kind: 'hello', ...who };
  if (op === 'follow') return b.of === '*' || isReaderId(b.of) ? { kind: 'follow', ...who, of: b.of as string } : "of must be '*' or a reader id";
  const place = readFocusPlace(b.place);
  return typeof place === 'string' ? place : { kind: 'publish', ...who, place };
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error(); } catch { return Response.json({ error: 'body must be a JSON object' }, { status: 400 }); }
  // a device (a paired headset through the LAN door, which sets the header from its pairing) speaks only as its own reader
  const device = deviceOf(req);
  if (device) b = { ...b, reader: 'vr:' + device };
  const m = readMove(b);
  if (typeof m === 'string') return Response.json({ error: m }, { status: 400, headers: NO_STORE });
  // a place in a product this server cannot open would strand every follower on an empty page
  if (m.kind === 'publish' && m.place.product !== KETTLE_SLUG && !findProduct(m.place.product)) return Response.json({ error: `unknown product ${m.place.product}` }, { status: 404, headers: NO_STORE });
  const now = Date.now(), r = moveFocus(m, now);
  if (r.error) return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  return Response.json({ moved: r.moved, view: viewOf(r.record, now) }, { status: r.status, headers: NO_STORE });
}
