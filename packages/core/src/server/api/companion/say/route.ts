// POST /api/companion/say: a line in, Glim's voice out, as the tour clips sound (docs/concepts/vr-light-table/voice-link.md).
// Body `{ text }`, JSON, 1..SAY_MAX_BODY_CHARS (4000) characters; the line spoken is `speakable(text)`: markdown, code and
// links reduced to words, cut at a sentence end to at most VOICE_MAX_CHARS (320).
// 200 `audio/wav`: RIFF, PCM 16-bit, mono, 24000 Hz, levelled to -14 LUFS with a -1 dBFS ceiling (the tour clips' level),
// headers `x-bp-voice` (the voice spoken in), `x-bp-voice-cache: hit | miss`, `x-bp-say-cut: 0 | 1`, `x-bp-say-ms`, and on a
// miss `x-bp-voice-cost` (credits, as the upstream reported them). Cached by voice, model, effect, level and text under
// $BP_HOME/companion/voice-link/, so a repeated line costs nothing.
// 400 `bad-text` or a bad body, 403 a guard, 413 `too-large` (over 4000 characters), 415 not JSON, 429 `busy` / `rate`,
// 500 `render-failed` (ffmpeg), 502 `upstream` (+ the upstream `status`), 503 `no-speech-key` / `no-ffmpeg`.
// The text is never logged. Localhost only (the LAN door forwards the headset's call as a loopback one).
import { jsonOnly, localOnly } from '../../../../scan/local-only.ts';
import { deviceOf } from '../../session/baton.server.ts';
import { SAY_MAX_BODY_CHARS, VOICE_NAME, fail, sayWav } from '../../../companion/voice-link.server.ts';

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const t0 = Date.now();
  let b: { text?: unknown };
  try { b = (await req.json()) as typeof b; } catch { return fail(400, 'bad-text', { reason: 'body must be JSON' }); }
  if (typeof b?.text !== 'string' || !b.text.trim()) return fail(400, 'bad-text', { reason: 'text must be a non-empty string' });
  if (b.text.length > SAY_MAX_BODY_CHARS) return fail(413, 'too-large', { maxChars: SAY_MAX_BODY_CHARS });
  // the caller whose daily budget a fresh line spends: the paired device apps/server named, else this machine (S3 finding 4)
  const r = await sayWav(b.text, req.signal, deviceOf(req) ?? 'local');
  if (!r.ok && 'budget' in r) return r.budget;
  if (!r.ok) return fail(r.status, r.error, r.upstream !== undefined ? { status: r.upstream } : {});
  return new Response(new Uint8Array(r.wav), {
    headers: {
      'content-type': 'audio/wav', 'cache-control': 'no-store', 'x-bp-voice': VOICE_NAME, 'x-bp-voice-cache': r.cached ? 'hit' : 'miss',
      'x-bp-say-cut': r.cut ? '1' : '0', 'x-bp-say-ms': String(Date.now() - t0),
      ...(r.cost.credits !== undefined ? { 'x-bp-voice-cost': String(r.cost.credits) } : {}),
    },
  });
}
