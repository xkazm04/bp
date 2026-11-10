// POST /api/companion/cards/[id], body `{ decision: 'approve' | 'decline', shown? }` (CardAnswer plus shown): a person only,
// bp's page (the `x-bp-human` token, door.server.ts says what that does and does not prove) or a paired headset with the
// decide scope (decider.server.ts; `shown` required from it); 403 otherwise. From the table, a card whose tool sets the
// owner's standing permissions (rule.propose, policy.propose) is refused 403 and stays pending, and so is an APPROVE from
// the table of any card outside VR_POLICY_BOUND (its tool one of the bound's four, one product, every finding it names tier
// 1+; decider.server.ts outsideTableBound): "Answer this one at your PC: ...". Approve runs the card's tool
// once against this server and answers the Card in `done` or `failed` with the result; decline runs nothing. Every row the
// answer writes carries surface, device and shown, and so does $BP_HOME/companion/decisions.jsonl
// (docs/concepts/vr-light-table/table-link-v2.md 3.2). 409 + `{ error, card }` when the card is no longer pending (answered,
// run or expired): a second answer never runs anything. 404 for an unknown card, 400 for a bad body. Localhost only.
import { jsonOnly, localOnly } from '../../../../../scan/local-only.ts';
import { answerCard, getCard, originOf } from '../../door.server.ts';
import { PAGE_ONLY_CARD_TOOLS, deciderOf, marksOf, notPerson, outsideTableBound, outsideTableWords, recordDecision } from '../../../../decider.server.ts';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const who = deciderOf(req);
  if (!who) return notPerson();
  let b: { decision?: unknown } & Record<string, unknown>;
  try { b = (await req.json()) as typeof b; } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  if (!b || typeof b !== 'object' || (b.decision !== 'approve' && b.decision !== 'decline')) return Response.json({ error: "body must be { decision: 'approve' | 'decline', shown? }" }, { status: 400 });
  const m = marksOf(who, b);
  if ('refuse' in m) return m.refuse;
  const { id } = await ctx.params;
  const c = getCard(id);
  if (who.surface === 'vr' && c && PAGE_ONLY_CARD_TOOLS.includes(c.tool)) {
    return Response.json({ error: `${c.tool} sets the owner's standing permissions: answer it on bp's page` }, { status: 403 });
  }
  // an approve from the table runs without the page's token: it must fit what a grant from the table could cover
  // (VR_POLICY_BOUND, S3 finding 1). A decline from the table is always allowed: declining runs nothing.
  if (who.surface === 'vr' && c && c.state === 'pending' && b.decision === 'approve') {
    const why = outsideTableBound(c.tool, (c.args ?? {}) as Record<string, unknown>);
    if (why) return Response.json({ error: outsideTableWords(why) }, { status: 403 });
  }
  const r = await answerCard(id, b.decision, originOf(req), m.marks);
  if (!r.ok) return Response.json({ error: r.error, ...(r.card ? { card: r.card } : {}) }, { status: r.status });
  recordDecision({ kind: 'card', ...m.marks, ...(r.card.product ? { product: r.card.product } : {}), target: id, verdict: b.decision });
  return Response.json(r.card);
}
