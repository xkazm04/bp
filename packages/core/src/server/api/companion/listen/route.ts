// POST /api/companion/listen: the headset's push-to-talk utterance in, its words out (docs/concepts/vr-light-table/voice-link.md).
// Body: one WAV, `Content-Type: audio/wav`, 16-bit PCM mono at 16000 (preferred), 24000 or 48000 Hz, at most
// LISTEN_MAX_SECONDS (30 s) and LISTEN_MAX_BYTES (3,000,000 bytes), with a Content-Length; header `x-bp-speech-consent: cloud`.
// 200 `{ text, ms, heard: 'speech' | 'no-speech' | 'silence', language?, cost? }`: silence (peak under -45 dBFS) answers
// `{ text: '' }` without any upstream call; speech the engine found no words in answers `{ text: '' }` too, as `no-speech`.
// 400 `bad-wav` (+ `reason`), 403 `no-consent` / `speech-off` (BP_CLOUD_SPEECH=off on the PC) or a guard, 411 `no-length`,
// 413 `too-large` / `too-long`, 415 not audio/wav, 429 `busy` / `rate`, 502 `upstream` (+ the upstream `status`, 0: no
// answer), 503 `no-speech-key`. The audio is held in memory for the call only; neither it nor the text is logged or kept.
// Localhost only (the LAN door forwards the headset's call as a loopback one).
import { localOnly, wavOnly } from '../../../../scan/local-only.ts';
import { voiceKey } from '../../../companion/voice.server.ts';
import { deviceOf } from '../../session/baton.server.ts';
import {
  CONSENT_HEADER, CONSENT_VALUE, LISTEN_MAX_BYTES, LISTEN_MAX_SECONDS, SILENCE_PEAK_DBFS,
  cloudSpeechOff, fail, parseWav, peakDbfs, spendBudget, takeSlot, transcribe,
} from '../../../companion/voice-link.server.ts';

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notWav = wavOnly(req);
  if (notWav) return Response.json({ error: notWav }, { status: 415 });
  const t0 = Date.now();
  if (cloudSpeechOff()) return fail(403, 'speech-off');
  if (req.headers.get(CONSENT_HEADER) !== CONSENT_VALUE) return fail(403, 'no-consent', { need: `${CONSENT_HEADER}: ${CONSENT_VALUE}` });
  const declared = req.headers.get('content-length');
  if (declared === null || !/^\d+$/.test(declared)) return fail(411, 'no-length');
  if (Number(declared) > LISTEN_MAX_BYTES) return fail(413, 'too-large', { maxBytes: LISTEN_MAX_BYTES });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > LISTEN_MAX_BYTES) return fail(413, 'too-large', { maxBytes: LISTEN_MAX_BYTES });
  const wav = parseWav(buf);
  if ('bad' in wav) return fail(400, 'bad-wav', { reason: wav.bad });
  if (wav.seconds > LISTEN_MAX_SECONDS + 0.05) return fail(413, 'too-long', { maxSeconds: LISTEN_MAX_SECONDS });
  const headers = { 'cache-control': 'no-store' };
  if (!wav.samples.length || peakDbfs(wav.samples) < SILENCE_PEAK_DBFS) return Response.json({ text: '', ms: Date.now() - t0, heard: 'silence' }, { headers });
  const key = voiceKey();
  if (!key) return fail(503, 'no-speech-key');
  const slot = takeSlot('listen');
  if ('refuse' in slot) return slot.refuse;
  // the caller's daily budget of seconds heard: the paired device apps/server named, else this machine (S3 finding 4)
  const over = spendBudget(deviceOf(req) ?? 'local', 'listenSeconds', Math.ceil(wav.seconds));
  if (over) { slot.release(); return over.refuse; }
  try {
    const r = await transcribe(buf, key, req.signal);
    if (!r.ok) return fail(502, 'upstream', { status: r.status });
    return Response.json({ text: r.text, ms: Date.now() - t0, heard: r.text ? 'speech' : 'no-speech', ...(r.language ? { language: r.language } : {}), cost: r.cost }, { headers });
  } finally { slot.release(); }
}
