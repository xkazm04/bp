// GET /api/companion/morning?since=<iso>: the Morning Watch deck across every registered live product (companion/morning.ts):
// `{ since, until, products: ProductSummary[], cards: MorningCard[], skipped }`. The window defaults to the last 16 hours.
// `&opened=<iso>` (the reader's first read): what landed after it is news, appended at the end and counted in `news`.
// `view=agent` (morning.brief on the MCP door): the same cards and brief lines, compact (agentDeck), within the door's cap.
// `view=next[&product=<slug>][&limit=1..10]` (next.steps, G3): the top next actions ranked from the deck, the coverage gaps and
// the shipped items waiting for triage, each with its reason (companion/next-steps.ts); 400 for a bad limit or product.
// POST /api/companion/morning, body `{ product, proposal, verdict: approve | defer | hold | decline, shown? }`, a person only:
// bp's page (`x-bp-human`) or a paired headset with the decide scope (decider.server.ts; `shown` required from it), else
// 403 (the agent's door can read the morning but never steer it). The row records surface, device and shown, and so does
// $BP_HOME/companion/decisions.jsonl (docs/concepts/vr-light-table/table-link-v2.md 3.1). Approve moves the finding to approved
// in the product's store (403 while BP_WRITES=off), defer takes it off the deck until tomorrow, hold keeps it marked; each is
// one row in the product's steering log (morning.server.ts). 200 + the row; 400 a bad body; 404 unknown; 409 already decided.
// Localhost only.
import { jsonOnly, localHost, localOnly } from '../../../../scan/local-only.ts';
import { VERDICTS, agentDeck, type Verdict } from '../../../../companion/morning.ts';
import { deciderOf, marksOf, notPerson, recordDecision } from '../../../decider.server.ts';
import { morningDeck, nextStepsRead, steer } from '../morning.server.ts';
import { NEXT_STEPS_MAX } from '../../../../companion/next-steps.ts';

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(req: Request): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const q = new URL(req.url).searchParams;
  if (q.get('view') === 'next') {
    const raw = q.get('limit'), limit = raw === null ? undefined : Number(raw), product = q.get('product') ?? q.get('slug') ?? undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > NEXT_STEPS_MAX)) return Response.json({ error: `limit must be an integer 1..${NEXT_STEPS_MAX}` }, { status: 400 });
    if (product !== undefined && !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(product)) return Response.json({ error: 'product must be a product slug' }, { status: 400 });
    return Response.json(await nextStepsRead(product, limit), { headers: NO_STORE });
  }
  const deck = await morningDeck(q.get('since') ?? undefined, Date.now(), q.get('opened') ?? undefined);
  return Response.json(q.get('view') === 'agent' ? agentDeck(deck) : deck, { headers: NO_STORE });
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const who = deciderOf(req);
  if (!who) return notPerson();
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; if (!b || typeof b !== 'object') throw new Error(); } catch { return Response.json({ error: 'body must be a JSON object' }, { status: 400 }); }
  if (typeof b.product !== 'string' || typeof b.proposal !== 'string' || !b.proposal || b.proposal.length > 200 || !VERDICTS.includes(b.verdict as Verdict)) {
    return Response.json({ error: `body must be { product, proposal, verdict: ${VERDICTS.join(' | ')}, shown? }` }, { status: 400 });
  }
  const m = marksOf(who, b);
  if ('refuse' in m) return m.refuse;
  const r = await steer(b.product, b.proposal, b.verdict as Verdict, Date.now(), m.marks);
  if ('error' in r) return Response.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  recordDecision({ kind: 'morning', ...m.marks, product: b.product, target: b.proposal, verdict: b.verdict as string });
  return Response.json(r.row, { headers: NO_STORE });
}
