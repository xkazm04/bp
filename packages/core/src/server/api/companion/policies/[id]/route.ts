// DELETE /api/companion/policies/[id]: revoke a grant. The HUMAN path (the `x-bp-human` token, 403 without it).
// 200 `{ id }`; 404 for an unknown grant. Localhost only.
import { localOnly } from '../../../../../scan/local-only.ts';
import { isHuman, notHuman, removePolicy } from '../../door.server.ts';

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  if (!isHuman(req)) return notHuman();
  const { id } = await ctx.params;
  return removePolicy(id) ? Response.json({ id }) : Response.json({ error: `no policy ${id}` }, { status: 404 });
}
