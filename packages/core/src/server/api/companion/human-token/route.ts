// GET /api/companion/human-token: `{ token }`, the per-process secret a HUMAN path carries in `x-bp-human` (approving or
// declining a card, granting or revoking a policy). Answered only when `Sec-Fetch-Site: same-origin` and
// `Sec-Fetch-Mode: cors` say bp's own page fetched it; 403 otherwise. The MCP process, a script and the VR client send
// neither, and no page on another origin can make a browser send them. It is loopback-only, so it guards against the agent,
// not against a program already on this machine (door.server.ts). `cache-control: no-store`.
import { localHost } from '../../../../scan/local-only.ts';
import { fromOwnPage, humanToken } from '../door.server.ts';

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  if (!fromOwnPage(req)) return Response.json({ error: "only bp's own page may read the human token" }, { status: 403 });
  return Response.json({ token: humanToken() }, { headers: { 'cache-control': 'no-store' } });
}
