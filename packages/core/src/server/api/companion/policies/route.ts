// GET /api/companion/policies: every grant, newest first (an expired one stays listed until deleted; compare expiresAt).
// POST /api/companion/policies, body `{ product: <slug> | '*', tools: string[], maxTier?: 0..3, hours (0 < h <= 720) }`:
// the HUMAN path (the `x-bp-human` token, 403 without it). A grant lets the companion run the GATED tools it names, on that
// product, until it expires; with maxTier, only when every tiered finding the call names has tier <= maxTier. Tools are
// catalog names (dotted or wire), stored dotted; an AUTO tool and policy.propose are refused (no grant may grant).
// 201 + the PolicyGrant; 400 for a bad body; 404 for an unknown product. Localhost only.
import { jsonOnly, localHost, localOnly } from '../../../../scan/local-only.ts';
import { KETTLE_SLUG, findProduct } from '../../../products.server.ts';
import { POLICY_MAX_HOURS, addPolicy, isHuman, listPolicies, notHuman } from '../door.server.ts';
import { isGated, toolOf } from '../tool-call.ts';

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
  if (!isHuman(req)) return notHuman();
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const shape = `body must be { product: <slug> | '*', tools: string[] (GATED tools, not policy.propose), maxTier?: 0..3, hours: 0 < h <= ${POLICY_MAX_HOURS} }`;
  if (!b || typeof b !== 'object' || typeof b.product !== 'string' || !Array.isArray(b.tools) || !b.tools.length || typeof b.hours !== 'number'
    || !(b.hours > 0 && b.hours <= POLICY_MAX_HOURS) || (b.maxTier !== undefined && ![0, 1, 2, 3].includes(b.maxTier as number))) {
    return Response.json({ error: shape }, { status: 400 });
  }
  const tools = b.tools.map(toolOf);
  const bad = b.tools.filter((_, i) => !tools[i] || !isGated(tools[i]!) || tools[i]!.name === 'policy.propose');
  if (bad.length) return Response.json({ error: `${shape}; refused: ${bad.map(String).join(', ')}` }, { status: 400 });
  if (b.product !== '*' && b.product !== KETTLE_SLUG && !findProduct(b.product)) return Response.json({ error: `unknown product ${b.product}` }, { status: 404 });
  const grant = addPolicy({ product: b.product, tools: [...new Set(tools.map((t) => t!.name))], ...(b.maxTier !== undefined ? { maxTier: b.maxTier as 0 | 1 | 2 | 3 } : {}), hours: b.hours });
  return Response.json(grant, { status: 201 });
}
