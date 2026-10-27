// GET /api/companion/brain: brainStats() plus the 20 newest live facts, `{ episodes, facts, spaces, lastSleep?, recent }`.
// POST /api/companion/brain, body `{ space, kind, text }`: the memory.note tool writing one fact. Its source is the newest
// episode of the calling conversation, named by the `x-bp-conversation` header (400 without it, 409 when that conversation
// has no episode yet); provenance and the space wall are writeFact's (400 with its reason). 201 `{ fact }`. Localhost only.
import { localHost, localOnly, jsonOnly } from '@bp/core/scan/local-only';
import { brainStats, latestEpisodeOf, recentFacts, writeFact, type FactKind } from '@bp/core/server/companion/brain/brain.server';

const CONVERSATION = /^[A-Za-z0-9_-]{1,128}$/;

export async function GET(req: Request): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  try { return Response.json({ ...brainStats(), recent: recentFacts(20) }); } catch (e) {
    return Response.json({ error: `brain could not be read: ${(e as Error)?.message ?? String(e)}` }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const b = (body ?? {}) as { space?: unknown; kind?: unknown; text?: unknown };
  const conv = req.headers.get('x-bp-conversation') ?? '';
  if (!CONVERSATION.test(conv)) return Response.json({ error: 'x-bp-conversation must name the calling conversation' }, { status: 400 });
  if (typeof b.space !== 'string' || typeof b.kind !== 'string' || typeof b.text !== 'string') return Response.json({ error: 'body must be { space, kind, text }' }, { status: 400 });
  const ep = latestEpisodeOf(conv);
  if (!ep) return Response.json({ error: `conversation ${conv} has no episode to cite yet` }, { status: 409 });
  const w = writeFact({ space: b.space, kind: b.kind as FactKind, text: b.text, sources: [ep.id] });
  if (!w.ok) return Response.json({ error: w.error }, { status: 400 });
  return Response.json({ fact: w.fact }, { status: 201 });
}
