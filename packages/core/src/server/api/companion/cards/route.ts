// GET /api/companion/cards: the cards, newest first, at most 50 (a pending card older than 24 h reads `expired`).
// POST /api/companion/cards, body `{ tool, args }`: the agent's path for a GATED tool (apps/mcp/bp-mcp.mjs never calls a
// GATED tool's route). 201 + the pending Card; or, when a live policy grant covers the call, the tool runs now and 200 + the
// Card in `done` or `failed` with `decidedBy: 'policy'` and the grant's id. 400 for an unknown tool, an AUTO tool (it needs
// no card) or missing required args. No human token is asked here: filing a card only ever closes the gate further
// (door.server.ts). Localhost only.
import { jsonOnly, localHost, localOnly } from '../../../../scan/local-only.ts';
import { fileCard, listCards, originOf } from '../door.server.ts';
import { trail } from '../../../brief.server.ts';

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  return Response.json(listCards());
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let b: { tool?: unknown; args?: unknown };
  try { b = (await req.json()) as typeof b; } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const r = await fileCard(b?.tool, b?.args, originOf(req));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  trail(req, { kind: 'card', tool: r.card.tool, card: r.card.id, ...(r.card.product ? { product: r.card.product } : {}) });
  return Response.json(r.card, { status: r.card.state === 'pending' ? 201 : 200 });
}
