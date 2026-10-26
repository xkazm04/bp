// POST /api/companion/cards/[id], body `{ decision: 'approve' | 'decline' }` (CardAnswer): the HUMAN path, so it needs the
// `x-bp-human` token (door.server.ts says what that does and does not prove); 403 without it. Approve runs the card's tool
// once against this server and answers the Card in `done` or `failed` with the result; decline runs nothing. 409 + `{ error,
// card }` when the card is no longer pending (answered, run or expired): a second answer never runs anything. 404 for an
// unknown card, 400 for a bad body. Localhost only.
import { jsonOnly, localOnly } from '../../../../../scan/local-only.ts';
import { answerCard, isHuman, notHuman, originOf } from '../../door.server.ts';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  if (!isHuman(req)) return notHuman();
  let b: { decision?: unknown };
  try { b = (await req.json()) as typeof b; } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  if (b?.decision !== 'approve' && b?.decision !== 'decline') return Response.json({ error: "body must be { decision: 'approve' | 'decline' }" }, { status: 400 });
  const { id } = await ctx.params;
  const r = await answerCard(id, b.decision, originOf(req));
  return r.ok ? Response.json(r.card) : Response.json({ error: r.error, ...(r.card ? { card: r.card } : {}) }, { status: r.status });
}
