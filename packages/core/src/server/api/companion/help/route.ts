// GET /api/companion/help?q=<words>&limit=3 (the help.find tool, G1 2026-11-11): how to use the VR table, from the help corpus
// packages/core/src/companion/help.ts (written from the app's own docs). Answers `{ entries: [{ id, title, text, show? }],
// total }`, the best matches first; no `q` answers every entry. `show` is a focus target (`{ kind: 'page', id }`) the
// companion may pass to focus.show. Read-only, loopback Host only.
import { localHost } from '../../../../scan/local-only.ts';
import { HELP, findHelp } from '../../../../companion/help.ts';

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const u = new URL(req.url);
  const q = (u.searchParams.get('q') ?? '').slice(0, 200);
  const n = Number(u.searchParams.get('limit') ?? 3);
  const entries = findHelp(q, Number.isFinite(n) ? n : 3);
  return Response.json({ entries, total: HELP.length }, { headers: { 'cache-control': 'no-store' } });
}
