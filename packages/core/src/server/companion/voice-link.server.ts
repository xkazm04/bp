// The headset's voice link (docs/concepts/vr-light-table/voice-link.md): speech in (POST /api/companion/listen, a WAV
// to text) and speech out (POST /api/companion/say, text to a WAV), done on the PC because the headset build carries no
// speech engine. Both directions go to ElevenLabs with ELEVEN_LABS_API_KEY, read the way voice.server.ts reads it.
//
// `say` speaks in exactly the voice the tour clips use (apps/vr/tools/tour-voice.ts): VOICE through the shared, cached
// `synthesize` (so the MP3 cache is the same one), then the same ffmpeg robot chain (VOICE_FX), 24 kHz mono 16-bit, and the
// same loudness pass (one static gain to -14 LUFS, a limiter at -1 dBFS). The finished WAV is cached by a hash of the
// voice, the model, the effect, the level and the text under $BP_HOME/companion/voice-link/ (git-ignored: .bp/), so a
// repeated line costs nothing. scripts/check-voice-link.ts holds TOUR_LINK equal to the tour's own lines.json.
//
// `listen` keeps nothing: the WAV lives in memory for the call, is sent once to the transcription service, and is
// dropped; the transcript is answered and never written. Nothing here logs audio or text.
// Registry voice-io: on-device-vs-cloud (capture is sent to a cloud engine only behind the client's consent header and
// the PC's BP_CLOUD_SPEECH switch), stt-pipeline (silence, no speech and failure are three different answers),
// unattended-caller-attribution (a bounded rate per route, the voice named on the artifact), speech-ready-text (`speakable`).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { VOICE, VOICE_DESIGN, VOICE_FX, speakable } from '../../companion/voice.ts';
import { companionHome } from './home.server.ts';
import { synthesize, voiceKey } from './voice.server.ts';

if (typeof window !== 'undefined') throw new Error('voice-link.server.ts is server-only');

// ------------------------------------------------------------------------------------------------ the contract's numbers
/** The longest WAV `listen` reads, in bytes: 30 s of 48 kHz mono 16-bit (2,880,000) plus header room. Over it: 413. */
export const LISTEN_MAX_BYTES = 3_000_000;
/** The longest utterance `listen` transcribes, in seconds (push to talk has no silence rule, so this is its cap). */
export const LISTEN_MAX_SECONDS = 30;
/** The sample rates `listen` accepts (16 kHz preferred: a third of the upload of 48 kHz, and what the engine reads anyway). */
export const LISTEN_RATES = [16000, 24000, 48000] as const;
/** A capture whose loudest sample stays under this (dBFS) is silence: answered `{ text: '' }` without any upstream call. */
export const SILENCE_PEAK_DBFS = -45;
/** The most characters a `say` body may carry; the line spoken is `speakable(text)` (at most VOICE_MAX_CHARS, cut at a sentence end). */
export const SAY_MAX_BODY_CHARS = 4000;
/** The consent header the headset sends once its wearer has opted in to cloud transcription (on-device-vs-cloud). */
export const CONSENT_HEADER = 'x-bp-speech-consent';
export const CONSENT_VALUE = 'cloud';
/** Upstream calls per route per rolling minute, and one in flight per route (429 `busy` / `rate`). A cached `say` is free. */
export const RATE_PER_MINUTE = 20;

/** How the tour clips are rendered (tour-voice.ts writes the same block to apps/vr/Content/BpData/voice/tour/lines.json). */
export const TOUR_LINK = {
  fx: [
    `highpass=f=${VOICE_FX.highpassHz}`,
    `equalizer=f=${VOICE_FX.presence.hz}:t=q:w=${VOICE_FX.presence.q}:g=${VOICE_FX.presence.gainDb}`,
    `aecho=${VOICE_FX.echo.inGain}:${VOICE_FX.echo.outGain}:${VOICE_FX.echo.taps.map((t) => t.ms).join('|')}:${VOICE_FX.echo.taps.map((t) => t.gain).join('|')}`,
    `tremolo=f=${VOICE_FX.tremolo.hz}:d=${VOICE_FX.tremolo.depth}`,
  ].join(','),
  rate: 24000,
  loudness: { targetLufs: -14, ceilingDb: -1 },
} as const;

/** The voice named on every `say` answer (the artifact carries its attribution: unattended-caller-attribution). */
export const VOICE_NAME = `Glim (${VOICE_DESIGN.name}, a designed voice, not a likeness of a person)`;

const STT_API = 'https://api.elevenlabs.io/v1/speech-to-text';
export const STT_MODEL = 'scribe_v2';
const TIMEOUT_MS = 30000;

// ------------------------------------------------------------------------------------------------ errors
/** The closed set of error strings both routes answer with (`{ error, status? }`). */
export type LinkError =
  | 'no-speech-key' | 'speech-off' | 'no-consent' | 'no-ffmpeg' | 'upstream' | 'busy' | 'rate'
  | 'too-large' | 'too-long' | 'no-length' | 'bad-wav' | 'bad-text' | 'render-failed';
export const fail = (status: number, error: LinkError, extra: Record<string, unknown> = {}): Response =>
  Response.json({ error, ...extra }, { status, headers: { 'cache-control': 'no-store' } });

/** The PC's one-step revocation of cloud transcription: BP_CLOUD_SPEECH=off refuses every `listen` (403 `speech-off`). */
export const cloudSpeechOff = (env: Record<string, string | undefined> = process.env): boolean => /^(off|0|false|no)$/i.test(env.BP_CLOUD_SPEECH?.trim() ?? '');

// ------------------------------------------------------------------------------------------------ rate
const g = globalThis as unknown as { __bpVoiceLinkRate?: Record<string, { at: number[]; busy: boolean }> };
/** Take a slot for one upstream call on `route`: null and a release function, or the refusal. */
export function takeSlot(route: 'listen' | 'say', now = Date.now()): { release: () => void } | { refuse: Response } {
  const all = (g.__bpVoiceLinkRate ??= {}), s = (all[route] ??= { at: [], busy: false });
  if (s.busy) return { refuse: fail(429, 'busy') };
  s.at = s.at.filter((t) => now - t < 60000);
  if (s.at.length >= RATE_PER_MINUTE) return { refuse: fail(429, 'rate', { retryAfterS: Math.ceil((60000 - (now - s.at[0])) / 1000) }) };
  s.at.push(now);
  s.busy = true;
  return { release: () => { s.busy = false; } };
}
/** Tests only: forget every slot. */
export const resetRate = (): void => { g.__bpVoiceLinkRate = {}; };

// ------------------------------------------------------------------------------------------------ WAV in
export interface Wav { rate: number; channels: number; bits: number; samples: Int16Array; seconds: number }
/** A RIFF/WAVE of 16-bit PCM, mono, at one of LISTEN_RATES; else the reason it is not. */
export function parseWav(buf: Buffer): Wav | { bad: string } {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return { bad: 'not a RIFF/WAVE file' };
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  for (let at = 12; at + 8 <= buf.length;) {
    const id = buf.toString('ascii', at, at + 4), size = buf.readUInt32LE(at + 4), body = at + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= buf.length) {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
      if (fmt.format === 0xfffe && size >= 40 && body + 26 <= buf.length) fmt.format = buf.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE: the sub-format
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size)); // a streamed writer may leave the size at 0xFFFFFFFF
      break;
    }
    at = body + size + (size & 1);
  }
  if (!fmt) return { bad: 'no fmt chunk' };
  if (!data) return { bad: 'no data chunk' };
  if (fmt.format !== 1 || fmt.bits !== 16) return { bad: `must be 16-bit PCM (format ${fmt.format}, ${fmt.bits} bits)` };
  if (fmt.channels !== 1) return { bad: `must be mono (${fmt.channels} channels)` };
  if (!(LISTEN_RATES as readonly number[]).includes(fmt.rate)) return { bad: `sample rate must be one of ${LISTEN_RATES.join(', ')} (${fmt.rate})` };
  const n = data.length >> 1, samples = new Int16Array(n);
  for (let i = 0; i < n; i++) samples[i] = data.readInt16LE(i * 2);
  return { rate: fmt.rate, channels: 1, bits: 16, samples, seconds: n / fmt.rate };
}

/** The loudest sample, in dBFS (-Infinity for digital silence or no samples). */
export function peakDbfs(s: Int16Array): number {
  let p = 0;
  for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > p) p = a; }
  return p ? 20 * Math.log10(p / 32768) : -Infinity;
}

/** A WAV header + data for mono 16-bit PCM (the check's fixtures, and nothing on the request path). */
export function wavOf(samples: Int16Array, rate: number): Buffer {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(samples[i], 44 + i * 2);
  return b;
}

// ------------------------------------------------------------------------------------------------ speech to text
/** Strip the engine's audio-event tags ("(silence)", "[music]") and collapse whitespace: what is left is what was said. */
export const spokenText = (raw: string): string => raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

/** What the upstream reported a call cost: ElevenLabs' `character-cost` (credits) and `fiat-cost-before-overages` (USD). */
export interface Cost { credits?: number; usd?: number }
const costOf = (h: Headers): Cost => {
  const c = Number(h.get('character-cost')), u = Number(h.get('fiat-cost-before-overages'));
  return { ...(Number.isFinite(c) && h.has('character-cost') ? { credits: c } : {}), ...(Number.isFinite(u) && h.has('fiat-cost-before-overages') ? { usd: u } : {}) };
};

export type SttResult = { ok: true; text: string; language?: string; cost: Cost } | { ok: false; status: number };
/** One transcription: the WAV as uploaded, ElevenLabs Scribe, audio events off. `status` 0: the service did not answer. */
export async function transcribe(wav: Buffer, key: string, signal?: AbortSignal): Promise<SttResult> {
  const fd = new FormData();
  fd.append('model_id', STT_MODEL);
  fd.append('tag_audio_events', 'false');
  fd.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'utterance.wav');
  let res: Response;
  try {
    res = await fetch(STT_API, {
      method: 'POST', headers: { 'xi-api-key': key }, body: fd,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch { return { ok: false, status: 0 }; }
  if (!res.ok) { await res.body?.cancel().catch(() => {}); return { ok: false, status: res.status }; }
  let j: { text?: unknown; language_code?: unknown };
  try { j = (await res.json()) as typeof j; } catch { return { ok: false, status: res.status }; }
  return { ok: true, text: spokenText(typeof j.text === 'string' ? j.text : ''), ...(typeof j.language_code === 'string' ? { language: j.language_code } : {}), cost: costOf(res.headers) };
}

// ------------------------------------------------------------------------------------------------ text to speech
const linkDir = (): string => path.join(companionHome(), 'voice-link');
/** The cache file of a spoken line: a hash of the voice (id, model, settings, seed), the effect, the level and the text. */
export const sayCacheFile = (spoken: string): string =>
  path.join(linkDir(), crypto.createHash('sha256').update(JSON.stringify([VOICE, TOUR_LINK, spoken])).digest('hex').slice(0, 32) + '.wav');

const run = (args: string[], signal?: AbortSignal): Promise<{ code: number; stderr: string }> => new Promise((resolve) => {
  execFile('ffmpeg', ['-hide_banner', ...args], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...(signal ? { signal } : {}) }, (err, _out, stderr) =>
    resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : -1) : 0, stderr: String(stderr ?? '') }));
});
const gf = globalThis as unknown as { __bpFfmpeg?: boolean };
/** ffmpeg answers `-version` (asked once per process). */
export async function hasFfmpeg(): Promise<boolean> {
  if (gf.__bpFfmpeg === undefined) gf.__bpFfmpeg = (await run(['-version'])).code === 0;
  return gf.__bpFfmpeg;
}

export type SayResult =
  | { ok: true; wav: Buffer; cached: boolean; spoken: string; cut: boolean; cost: Cost }
  | { ok: false; status: number; error: LinkError; upstream?: number };

/** The line as the tour's WAV: from the cache, else synthesized (shared MP3 cache), effected, levelled and cached. */
export async function sayWav(text: string, signal?: AbortSignal): Promise<SayResult> {
  const spoken = speakable(text), cut = spoken !== text.replace(/\s+/g, ' ').trim();
  if (!spoken) return { ok: false, status: 400, error: 'bad-text' };
  const file = sayCacheFile(spoken);
  try { return { ok: true, wav: fs.readFileSync(file), cached: true, spoken, cut, cost: {} }; } catch { /* not cached yet */ }
  if (!voiceKey()) return { ok: false, status: 503, error: 'no-speech-key' };
  if (!(await hasFfmpeg())) return { ok: false, status: 503, error: 'no-ffmpeg' };
  const slot = takeSlot('say');
  if ('refuse' in slot) { const b = (await slot.refuse.json()) as { error: LinkError }; return { ok: false, status: 429, error: b.error }; }
  try {
    const mp3 = await synthesize(spoken, signal);
    if (!mp3.ok) {
      if (mp3.status === 503) return { ok: false, status: 503, error: 'no-speech-key' };
      const up = /\((\d{3})\)/.exec(mp3.error);
      return { ok: false, status: 502, error: 'upstream', upstream: up ? Number(up[1]) : 0 };
    }
    const dir = path.join(linkDir(), 'tmp'), stem = path.join(dir, crypto.randomBytes(8).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    const src = stem + '.mp3', fx = stem + '.fx.wav', out = stem + '.wav';
    try {
      fs.writeFileSync(src, mp3.audio);
      // the tour's two passes, unchanged: the robot chain at 24 kHz mono 16-bit, then one static gain + a limiter to the target
      if ((await run(['-loglevel', 'error', '-y', '-i', src, '-af', TOUR_LINK.fx, '-ac', '1', '-ar', String(TOUR_LINK.rate), '-c:a', 'pcm_s16le', fx], signal)).code !== 0) return { ok: false, status: 500, error: 'render-failed' };
      const m = /I:\s+(-?[\d.]+) LUFS/.exec((await run(['-nostats', '-i', fx, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], signal)).stderr);
      if (!m) return { ok: false, status: 500, error: 'render-failed' };
      const gain = TOUR_LINK.loudness.targetLufs - Number(m[1]), limit = Math.pow(10, TOUR_LINK.loudness.ceilingDb / 20).toFixed(4);
      if ((await run(['-loglevel', 'error', '-y', '-i', fx, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=${limit}:attack=5:release=50:level=disabled`,
        '-ac', '1', '-ar', String(TOUR_LINK.rate), '-c:a', 'pcm_s16le', out], signal)).code !== 0) return { ok: false, status: 500, error: 'render-failed' };
      const wav = fs.readFileSync(out);
      try { fs.renameSync(out, file); } catch { /* speaking matters more than caching */ }
      return { ok: true, wav, cached: false, spoken, cut, cost: mp3.cost ?? {} };
    } finally {
      for (const f of [src, fx, out]) fs.rmSync(f, { force: true });
    }
  } finally { slot.release(); }
}
