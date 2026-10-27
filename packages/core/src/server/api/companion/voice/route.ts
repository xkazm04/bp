// GET /api/companion/voice: `{ available: true }`, or `{ available: false, reason }` in one sentence (no key configured).
// POST /api/companion/voice, body `{ text }` (1..VOICE_MAX_CHARS, already `speakable`): the line in Glim's voice as
// `audio/mpeg`, `x-bp-voice-cache: hit | miss`. **503** no key, **502** the voice service failed, **400** a bad body.
// bp's own page only (`Sec-Fetch-Site: same-origin`, 403 otherwise): each miss costs ElevenLabs credits, so the agent
// and scripts cannot make it speak. Localhost only (door.server.ts).
import { jsonOnly, localHost, localOnly } from '../../../../scan/local-only.ts';
import { VOICE_MAX_CHARS } from '../../../../companion/voice.ts';
import { synthesize, voiceUnavailable } from '../../../companion/voice.server.ts';
import { fromOwnPage } from '../door.server.ts';

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const reason = voiceUnavailable();
  return Response.json(reason ? { available: false, reason } : { available: true }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  if (!fromOwnPage(req)) return Response.json({ error: "only bp's own page may make Glim speak" }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let b: { text?: unknown };
  try { b = (await req.json()) as typeof b; } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const text = typeof b?.text === 'string' ? b.text.trim() : '';
  if (!text || text.length > VOICE_MAX_CHARS) return Response.json({ error: `text must be 1..${VOICE_MAX_CHARS} characters` }, { status: 400 });
  const r = await synthesize(text, req.signal);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return new Response(new Uint8Array(r.audio), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'x-bp-voice-cache': r.cached ? 'hit' : 'miss' } });
}
