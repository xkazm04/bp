// GET /api/companion/trail?product=<slug>: the agent trail as sessions in words (packages/core/src/companion/trail.ts) - what agents on
// the MCP door read in the decision brief and what they filed next, newest first, at most 3, each while its newest row is
// under 6 hours old; `product` keeps that product's rows only. Read from the trail file (brief.server.ts), not the bus: the agent's server (apps/server) and the
// person's page (apps/web) may be two processes sharing one BP_HOME. 200 `{ sessions }`. Localhost only.
import { localHost } from '../../../../scan/local-only.ts';
import { trailSessions } from '../../../../companion/trail.ts';
import { readTrail } from '../../../brief.server.ts';

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const product = new URL(req.url).searchParams.get('product') ?? undefined;
  return Response.json({ sessions: trailSessions(readTrail(), Date.now(), 3, product || undefined) });
}
