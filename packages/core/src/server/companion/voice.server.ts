// Glim's voice on the server: ElevenLabs text-to-speech behind bp's own route, so the API key never reaches the page.
// Every line is cached by a hash of the voice settings and its text under $BP_HOME/companion/voice/, so a line Glim says
// often (a greeting, a gate warning) is synthesized once and then sounds exactly the same every time.
// The key is ELEVEN_LABS_API_KEY from the environment, else from the repo root's .env (git-ignored), read per call so a
// key added while bp runs is picked up.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { VOICE } from '../../companion/voice.ts';
import { companionHome, repoRoot } from './home.server.ts';

if (typeof window !== 'undefined') throw new Error('voice.server.ts is server-only');

const KEY_NAME = 'ELEVEN_LABS_API_KEY';
const API = 'https://api.elevenlabs.io/v1/text-to-speech';
const TIMEOUT_MS = 30000;

export function voiceKey(): string | null {
  const env = process.env[KEY_NAME]?.trim();
  if (env) return env;
  try {
    const m = new RegExp(`^\\s*${KEY_NAME}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(fs.readFileSync(path.join(repoRoot(), '.env'), 'utf8'));
    return m?.[1].trim() || null;
  } catch { return null; }
}

/** Why the voice cannot speak, in one sentence the page shows; null: it can. */
export const voiceUnavailable = (): string | null => (voiceKey() ? null : `no voice configured: set ${KEY_NAME} in bp's .env`);

const cacheFile = (text: string): string => {
  const h = crypto.createHash('sha256').update(JSON.stringify([VOICE, text])).digest('hex').slice(0, 32);
  return path.join(companionHome(), 'voice', h + '.mp3');
};

export type VoiceResult = { ok: true; audio: Buffer; cached: boolean } | { ok: false; status: number; error: string };

/** The line as MP3: from the cache, else synthesized and cached. A failed synthesis is never cached. */
export async function synthesize(text: string, signal?: AbortSignal): Promise<VoiceResult> {
  const file = cacheFile(text);
  try { return { ok: true, audio: fs.readFileSync(file), cached: true }; } catch { /* not cached yet */ }
  const key = voiceKey();
  if (!key) return { ok: false, status: 503, error: voiceUnavailable()! };
  let res: Response;
  try {
    res = await fetch(`${API}/${VOICE.voiceId}?output_format=${VOICE.format}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: VOICE.modelId, voice_settings: VOICE.settings, seed: VOICE.seed, apply_text_normalization: 'on' }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, status: 502, error: `the voice service did not answer: ${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}` };
  }
  if (!res.ok) {
    const why = (await res.text().catch(() => '')).slice(0, 200);
    return { ok: false, status: 502, error: `the voice service refused the line (${res.status})${why ? ': ' + why : ''}` };
  }
  const audio = Buffer.from(await res.arrayBuffer());
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, audio); } catch { /* speaking matters more than caching */ }
  return { ok: true, audio, cached: false };
}
