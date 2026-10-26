// GET /api/companion/conversations: `ConversationInfo[]` `{ id, product?, title, updatedAt, turns }`, newest first, read from
// $BP_HOME/companion/conversations/<id>.json (packages/core/src/server/companion/runtime/store.server.ts); none yet is `[]`.
// Runtime state (locks, running turns) is per process: apps/server (:3100) is the canonical host; `next dev` has its own.
// The conversation files are shared by both.
import { localHost } from '@bp/core/scan/local-only';
import { listConversations } from '@bp/core/server/companion/runtime/turn.server';

export async function GET(req: Request): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  return Response.json(listConversations());
}
