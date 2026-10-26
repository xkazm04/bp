// POST /api/companion/focus, body `{ product, kind, id, say? }` (the focus.show tool): show the person a place. The target is
// always explicit (registry mcp-tools ambient-selection-is-not-an-argument: never "the current selection"). Builds a
// FocusCommand with a time-sortable id, publishes `{ type: 'focus' }` on the bus (GET /api/companion/stream) and answers
// 201 + the FocusCommand; 400 for a bad body; 404 for an unknown product (kettle, the built-in sample, is known).
// GET /api/companion/focus?since=<id>: the focus commands after `since`, newest first, at most 20 (all kept ones when
// `since` is unknown or absent): VR's BpLink polls this (docs/concepts/vr-light-table/companion-link.md). Localhost only.
import { jsonOnly, localHost, localOnly } from '../../../../scan/local-only.ts';
import { KETTLE_SLUG, findProduct } from '../../../products.server.ts';
import { focusSince, publish } from '../../../../companion/bus.server.ts';
import type { FocusCommand, FocusKind } from '../../../../companion/contract.ts';
import { sortableId } from '../door.server.ts';

const KINDS: FocusKind[] = ['feature', 'room', 'wing', 'decision', 'wave', 'release', 'ledger-row', 'lens'];

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  return Response.json(focusSince(new URL(req.url).searchParams.get('since') ?? undefined));
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  if (!b || typeof b !== 'object' || typeof b.product !== 'string' || !KINDS.includes(b.kind as FocusKind) || typeof b.id !== 'string' || !b.id || b.id.length > 200
    || (b.say !== undefined && (typeof b.say !== 'string' || b.say.length > 280))) {
    return Response.json({ error: `body must be { product, kind: ${KINDS.join(' | ')}, id (1..200), say? (<= 280) }` }, { status: 400 });
  }
  if (b.product !== KETTLE_SLUG && !findProduct(b.product)) return Response.json({ error: `unknown product ${b.product}` }, { status: 404 });
  const focus: FocusCommand = { id: sortableId('f_'), product: b.product, target: { kind: b.kind as FocusKind, id: b.id }, ...(typeof b.say === 'string' && b.say ? { say: b.say } : {}) };
  publish({ type: 'focus', focus });
  return Response.json(focus, { status: 201 });
}
