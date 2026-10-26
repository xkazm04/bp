// DELETE /api/companion/turns/[id]: cancel a running companion turn. Its CLI's process tree is killed and its stream ends with
// `{ type: 'end', outcome: 'interrupted' }`; the conversation's lock is released. **200** `{ id }`; **404** when no turn runs
// under that id (finished, never started, or run by another process).
// Runtime state (locks, running turns) is per process: apps/server (:3100) is the canonical host; `next dev` has its own.
import { localOnly } from '@bp/core/scan/local-only';
import { cancelTurn } from '@bp/core/companion/runtime/turn.server';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { id } = await params;
  if (!cancelTurn(id)) return Response.json({ error: `no running turn ${id}` }, { status: 404 });
  return Response.json({ id });
}
