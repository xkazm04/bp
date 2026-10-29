// GET /api/companion/morning?since=<iso>: the Morning Watch deck across every registered live product (companion/morning.ts):
// `{ since, until, products: ProductSummary[], cards: MorningCard[], skipped }`. The window defaults to the last 16 hours.
// POST /api/companion/morning, body `{ product, proposal, verdict: approve | defer | hold }`, the human path only
// (`x-bp-human`, else 403: the agent's door can read the morning but never steer it): approve moves the finding to approved
// in the product's store (403 while BP_WRITES=off), defer takes it off the deck until tomorrow, hold keeps it marked; each is
// one row in the product's steering log (morning.server.ts). 200 + the row; 400 a bad body; 404 unknown; 409 already decided.
// Localhost only.
import { jsonOnly, localHost, localOnly } from '../../../../scan/local-only.ts';
import { VERDICTS, type Verdict } from '../../../../companion/morning.ts';
import { isHuman, notHuman } from '../door.server.ts';
import { morningDeck, steer } from '../morning.server.ts';

const NO_STORE = { 'cache-control': 'no-store' };

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  return Response.json(morningDeck(new URL(req.url).searchParams.get('since') ?? undefined), { headers: NO_STORE });
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  if (!isHuman(req)) return notHuman();
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; if (!b || typeof b !== 'object') throw new Error(); } catch { return Response.json({ error: 'body must be a JSON object' }, { status: 400 }); }
  if (typeof b.product !== 'string' || typeof b.proposal !== 'string' || !b.proposal || b.proposal.length > 200 || !VERDICTS.includes(b.verdict as Verdict)) {
    return Response.json({ error: `body must be { product, proposal, verdict: ${VERDICTS.join(' | ')} }` }, { status: 400 });
  }
  const r = await steer(b.product, b.proposal, b.verdict as Verdict);
  return 'error' in r ? Response.json({ error: r.error }, { status: r.status, headers: NO_STORE }) : Response.json(r.row, { headers: NO_STORE });
}
