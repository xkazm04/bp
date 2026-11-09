// DELETE /api/companion/policies/[id]: revoke a grant. A person only: bp's page (the `x-bp-human` token) or a paired headset
// with the decide scope (decider.server.ts; revoking only narrows, so any grant). 403 otherwise. 200 `{ id }`; 404 for an
// unknown grant. Recorded in $BP_HOME/companion/decisions.jsonl as `policy-revoke` (table-link-v2.md 3.5). Localhost only.
import { localOnly } from '../../../../../scan/local-only.ts';
import { listPolicies, removePolicy } from '../../door.server.ts';
import { deciderOf, notPerson, recordDecision } from '../../../../decider.server.ts';

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const who = deciderOf(req);
  if (!who) return notPerson();
  const { id } = await ctx.params;
  const grant = listPolicies().find((p) => p.id === id);
  if (!grant || !removePolicy(id)) return Response.json({ error: `no policy ${id}` }, { status: 404 });
  recordDecision({ kind: 'policy-revoke', surface: who.surface, ...(who.device ? { device: who.device } : {}), product: grant.product, target: id, verdict: 'revoke' });
  return Response.json({ id });
}
