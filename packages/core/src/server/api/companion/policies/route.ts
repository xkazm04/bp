// GET /api/companion/policies: every grant, newest first (an expired one stays listed until deleted; compare expiresAt).
// POST /api/companion/policies, body `{ product: <slug> | '*', tools: string[], minTier?: 0..3, hours (0 < h <= 720), shown? }`:
// a person only, bp's page (the `x-bp-human` token) or a paired headset with the decide scope (decider.server.ts; `shown`
// required from it); 403 otherwise. A grant lets the companion run the GATED tools it names, on that product, until it
// expires; with minTier, only when every tiered finding the call names has tier >= minTier (that severe or milder). Tools
// are catalog names (dotted or wire), stored dotted; an AUTO tool and policy.propose are refused (no grant may grant).
// A grant from the table is bounded (VR_POLICY_BOUND: one product, four tools, minTier 1..3 required, hours <= 12): wider
// is 403 `{ error, bound }` (docs/concepts/vr-light-table/table-link-v2.md 3.4). 201 + the PolicyGrant with `grantedBy`
// (surface, device, shown) and `hours`; 400 for a bad body; 404 for an unknown product. Localhost only.
import { jsonOnly, localHost, localOnly } from '../../../../scan/local-only.ts';
import { KETTLE_SLUG, findProduct } from '../../../products.server.ts';
import { POLICY_MAX_HOURS, addPolicy, listPolicies } from '../door.server.ts';
import { isGated, toolOf } from '../tool-call.ts';
import { VR_POLICY_BOUND, deciderOf, marksOf, notPerson, recordDecision } from '../../../decider.server.ts';

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  return Response.json(listPolicies());
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const who = deciderOf(req);
  if (!who) return notPerson();
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const shape = `body must be { product: <slug> | '*', tools: string[] (GATED tools, not policy.propose), minTier?: 0..3, hours: 0 < h <= ${POLICY_MAX_HOURS}, shown? }`;
  if (!b || typeof b !== 'object' || typeof b.product !== 'string' || !Array.isArray(b.tools) || !b.tools.length || typeof b.hours !== 'number'
    || !(b.hours > 0 && b.hours <= POLICY_MAX_HOURS) || (b.minTier !== undefined && ![0, 1, 2, 3].includes(b.minTier as number))) {
    return Response.json({ error: shape }, { status: 400 });
  }
  const m = marksOf(who, b);
  if ('refuse' in m) return m.refuse;
  const tools = b.tools.map(toolOf);
  const bad = b.tools.filter((_, i) => !tools[i] || !isGated(tools[i]!) || tools[i]!.name === 'policy.propose');
  if (bad.length) return Response.json({ error: `${shape}; refused: ${bad.map(String).join(', ')}` }, { status: 400 });
  const names = [...new Set(tools.map((t) => t!.name))];
  if (who.surface === 'vr') {
    const wider = [
      b.product === '*' ? 'every product (*)' : '',
      ...names.filter((n) => !VR_POLICY_BOUND.tools.includes(n)).map((n) => `tool ${n}`),
      b.minTier === undefined ? 'no minTier (it would cover stop-ship findings)' : !VR_POLICY_BOUND.minTier.includes(b.minTier as number) ? `minTier ${String(b.minTier)} (stop-ship)` : '',
      (b.hours as number) > VR_POLICY_BOUND.maxHours ? `${String(b.hours)} hours` : '',
    ].filter(Boolean);
    if (wider.length) {
      return Response.json({ error: `a grant from the table is bounded (one product; tools ${VR_POLICY_BOUND.tools.join(', ')}; minTier 1..3; at most ${VR_POLICY_BOUND.maxHours} hours); refused: ${wider.join(', ')}`, bound: VR_POLICY_BOUND }, { status: 403 });
    }
  }
  if (b.product !== '*' && b.product !== KETTLE_SLUG && !findProduct(b.product)) return Response.json({ error: `unknown product ${b.product}` }, { status: 404 });
  const grant = addPolicy({ product: b.product, tools: names, ...(b.minTier !== undefined ? { minTier: b.minTier as 0 | 1 | 2 | 3 } : {}), hours: b.hours, grantedBy: m.marks });
  recordDecision({ kind: 'policy-grant', ...m.marks, product: b.product, target: grant.id, verdict: `grant ${names.join(',')}${grant.minTier !== undefined ? ` tier ${grant.minTier}+` : ''} until ${grant.expiresAt}` });
  return Response.json({ ...grant, hours: b.hours }, { status: 201 });
}
