// The headset's voice link (docs/concepts/vr-light-table/voice-link.md): POST /api/companion/listen and /say, handlers
// called in process. It proves:
//   contract  listen refuses a non-WAV type (415), no consent (403 no-consent), BP_CLOUD_SPEECH=off (403 speech-off), no
//             Content-Length (411), a body over 3,000,000 bytes (413 too-large, declared or real), over 30 s (413
//             too-long), stereo / 8-bit / a stray rate (400 bad-wav); silence answers 200 `{ text: '' }` with no key
//             needed; say refuses non-JSON (415), empty text (400 bad-text), over 4000 characters (413)
//   key       with no key anywhere, a tone at listen and an uncached line at say answer 503 `no-speech-key`
//   voice     the say pipeline's effect, rate and level equal the tour clips' own record (lines.json), and VOICE is theirs
//   rate      one call in flight per route (429 busy), RATE_PER_MINUTE per rolling minute (429 rate)
//   live      (key and network) say returns a RIFF PCM 16-bit mono 24 kHz WAV at -14 LUFS (+-1); listen on it (resampled to
//             16 kHz, as the headset sends) returns the words, compared lower case without punctuation; the key appears in
//             no answer and no line this check prints
// The live part is SKIPped, saying why, with no ELEVEN_LABS_API_KEY or no network (check-all forgives that skip only
// then). It speaks a tour line, so the MP3 is usually cached already: a run costs one transcription (~2 credits).
// Run: node --import @bp/core/register scripts/check-voice-link.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { harness } from './lib/expect.ts';
import { VOICE } from '../packages/core/src/companion/voice.ts';
import { TOUR_LINES } from '../apps/vr/tools/tour-voice.ts';
import { voiceKey } from '../packages/core/src/server/companion/voice.server.ts';
import {
  DAILY_BUDGET, LISTEN_MAX_BYTES, RATE_PER_MINUTE, SAY_CACHE_MAX_BYTES, TOUR_LINK, parseWav, peakDbfs, resetRate, spendBudget, takeSlot, trimSayCache, wavOf,
} from '../packages/core/src/server/companion/voice-link.server.ts';
import { POST as listen } from '../packages/core/src/server/api/companion/listen/route.ts';
import { POST as say } from '../packages/core/src/server/api/companion/say/route.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { expect, skip, note, done } = harness('check-voice-link');
const key = voiceKey(); // never printed: only compared against what is printed
const said: string[] = [];
const say1 = (line: string) => { said.push(line); note(line); };

const H = { host: 'localhost:3010' };
const wavReq = (body: Buffer, h: Record<string, string> = {}) =>
  new Request('http://localhost:3010/api/companion/listen', { method: 'POST', body: new Uint8Array(body), headers: { ...H, 'content-type': 'audio/wav', 'content-length': String(body.length), 'x-bp-speech-consent': 'cloud', ...h } });
const sayReq = (body: string, type = 'application/json') =>
  new Request('http://localhost:3010/api/companion/say', { method: 'POST', body, headers: { ...H, 'content-type': type } });
const errOf = async (r: Response): Promise<string> => { try { return ((await r.clone().json()) as { error?: string }).error ?? ''; } catch { return ''; } };

const tone = (seconds: number, rate = 16000, amp = 8000) => Int16Array.from({ length: Math.round(seconds * rate) }, (_, i) => Math.round(amp * Math.sin((2 * Math.PI * 440 * i) / rate)));
const silence = (seconds: number, rate = 16000) => new Int16Array(Math.round(seconds * rate));

// ------------------------------------------------------------------------------------------------ contract
{
  const ok = wavOf(tone(0.5), 16000);
  const p = parseWav(ok);
  expect(!('bad' in p) && p.rate === 16000 && p.samples.length === 8000, 'parseWav reads a 16 kHz mono 16-bit fixture');
  expect(Math.abs(peakDbfs((p as { samples: Int16Array }).samples) - 20 * Math.log10(8000 / 32768)) < 0.1, 'peakDbfs of the tone');

  let r = await listen(new Request('http://localhost:3010/api/companion/listen', { method: 'POST', body: new Uint8Array(ok), headers: { ...H, 'content-type': 'application/octet-stream', 'content-length': String(ok.length) } }));
  expect(r.status === 415, 'listen: a non-WAV type is 415', r.status);
  r = await listen(wavReq(ok, { 'x-bp-speech-consent': '' }));
  expect(r.status === 403 && (await errOf(r)) === 'no-consent', 'listen: no consent header is 403 no-consent', r.status);
  process.env.BP_CLOUD_SPEECH = 'off';
  r = await listen(wavReq(ok));
  expect(r.status === 403 && (await errOf(r)) === 'speech-off', 'listen: BP_CLOUD_SPEECH=off is 403 speech-off', r.status);
  delete process.env.BP_CLOUD_SPEECH;
  r = await listen(new Request('http://localhost:3010/api/companion/listen', { method: 'POST', body: new Uint8Array(ok), headers: { ...H, 'content-type': 'audio/wav', 'x-bp-speech-consent': 'cloud' } }));
  expect(r.status === 411 && (await errOf(r)) === 'no-length', 'listen: no Content-Length is 411', r.status);
  const big = Buffer.alloc(LISTEN_MAX_BYTES + 1);
  r = await listen(wavReq(big));
  expect(r.status === 413 && (await errOf(r)) === 'too-large', 'listen: a body over the cap is 413 too-large', r.status);
  r = await listen(wavReq(ok, { 'content-length': String(LISTEN_MAX_BYTES + 1) }));
  expect(r.status === 413, 'listen: a declared length over the cap is 413 before the body is read', r.status);
  r = await listen(wavReq(wavOf(tone(31), 16000)));
  expect(r.status === 413 && (await errOf(r)) === 'too-long', 'listen: 31 s at 16 kHz (under the byte cap) is 413 too-long', r.status);
  const stereo = Buffer.from(ok); stereo.writeUInt16LE(2, 22);
  const eight = Buffer.from(ok); eight.writeUInt16LE(8, 34);
  const odd = Buffer.from(ok); odd.writeUInt32LE(11025, 24);
  for (const [what, b] of [['stereo', stereo], ['8-bit', eight], ['11025 Hz', odd], ['not RIFF', Buffer.from('hello world, this is not a wav file at all, honestly')]] as const) {
    r = await listen(wavReq(b));
    expect(r.status === 400 && (await errOf(r)) === 'bad-wav', `listen: ${what} is 400 bad-wav`, r.status);
  }
  for (const rate of [16000, 48000]) {
    r = await listen(wavReq(wavOf(silence(1.5, rate), rate)));
    const j = (await r.json()) as { text?: string; heard?: string; ms?: number };
    expect(r.status === 200 && j.text === '' && j.heard === 'silence' && typeof j.ms === 'number', `listen: ${rate} Hz silence is 200 { text: '' } with no upstream call`, j);
  }
  r = await say(sayReq('{"text":"hi"}', 'text/plain'));
  expect(r.status === 415, 'say: a non-JSON type is 415', r.status);
  r = await say(sayReq(JSON.stringify({ text: '   ' })));
  expect(r.status === 400 && (await errOf(r)) === 'bad-text', 'say: empty text is 400 bad-text', r.status);
  r = await say(sayReq(JSON.stringify({ text: 'a'.repeat(4001) })));
  expect(r.status === 413 && (await errOf(r)) === 'too-large', 'say: over 4000 characters is 413', r.status);
  r = await say(sayReq('{not json'));
  expect(r.status === 400, 'say: a body that is not JSON is 400', r.status);
}

// ------------------------------------------------------------------------------------------------ key
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-voice-link-')), cwd = process.cwd(), env = process.env.ELEVEN_LABS_API_KEY, bh = process.env.BP_HOME;
  delete process.env.ELEVEN_LABS_API_KEY; process.env.BP_HOME = home; process.chdir(home); // no .env here, an empty cache
  try {
    let r = await listen(wavReq(wavOf(tone(1), 16000)));
    expect(r.status === 503 && (await errOf(r)) === 'no-speech-key', 'listen: no key is 503 no-speech-key', r.status);
    r = await say(sayReq(JSON.stringify({ text: 'A line nobody cached.' })));
    expect(r.status === 503 && (await errOf(r)) === 'no-speech-key', 'say: no key is 503 no-speech-key', r.status);
  } finally {
    process.chdir(cwd); if (env !== undefined) process.env.ELEVEN_LABS_API_KEY = env; if (bh !== undefined) process.env.BP_HOME = bh; else delete process.env.BP_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------------------------------ budget and cache (S3 finding 4)
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-voice-budget-')), env = process.env.ELEVEN_LABS_API_KEY, bh = process.env.BP_HOME;
  process.env.BP_HOME = home;
  try {
    const day = Date.parse('2026-11-10T12:00:00Z');
    expect(DAILY_BUDGET.sayChars === 30_000 && DAILY_BUDGET.listenSeconds === 1_800, 'budget: 30,000 characters spoken and 1,800 seconds heard a day per caller');
    expect(spendBudget('quest3s:aaaa0001', 'sayChars', 29_990, day) === null, 'budget: a device spends up to its daily characters');
    const over = spendBudget('quest3s:aaaa0001', 'sayChars', 11, day);
    const ob = over ? (await over.refuse.json()) as { error: string; words: string; limit: number; used: number; retryAfterS: number } : null;
    expect(!!over && over.refuse.status === 429 && ob?.error === 'budget' && /voice budget/.test(ob.words) && ob.limit === 30_000 && ob.used === 29_990 && ob.retryAfterS === 12 * 3600 && over.refuse.headers.get('retry-after') === String(12 * 3600),
      'budget: past it, 429 budget with words, the limit, what was used and the seconds to midnight UTC', ob);
    expect(spendBudget('quest3s:aaaa0001', 'sayChars', 10, day) === null, 'budget: a refused call spent nothing (the last 10 still fit)');
    expect(spendBudget('quest3s:bbbb0002', 'sayChars', 1000, day) === null, 'budget: another device has its own');
    expect(spendBudget('quest3s:aaaa0001', 'sayChars', 1000, day + 86_400_000) === null, 'budget: a new UTC day renews it');
    // listen through the route: a device past its seconds is refused before any upstream call (a fake key: never sent)
    process.env.ELEVEN_LABS_API_KEY = 'not-a-key-the-check-never-sends';
    spendBudget('quest3s:cccc0003', 'listenSeconds', 1_800);
    resetRate();
    const r = await listen(wavReq(wavOf(tone(1), 16000), { 'x-bp-device': 'quest3s:cccc0003' }));
    expect(r.status === 429 && (await errOf(r)) === 'budget', 'budget: listen from a device past its seconds is 429 budget, before the upstream', r.status);
    // the cache folder is capped: the least recently spoken lines go first
    const dir = path.join(home, 'companion', 'voice-link');
    fs.mkdirSync(dir, { recursive: true });
    const names = [0, 1, 2, 3].map((i) => path.join(dir, `${String(i).repeat(32)}.wav`));
    names.forEach((f, i) => { fs.writeFileSync(f, Buffer.alloc(1000)); const t = new Date(Date.parse('2026-11-01T00:00:00Z') + i * 60_000); fs.utimesSync(f, t, t); });
    fs.writeFileSync(path.join(dir, 'budget.json.keep'), 'x');
    const gone = trimSayCache(2500);
    expect(gone === 2 && !fs.existsSync(names[0]) && !fs.existsSync(names[1]) && fs.existsSync(names[2]) && fs.existsSync(names[3]) && fs.existsSync(path.join(dir, 'budget.json.keep')),
      'cache: over its cap, the oldest WAVs are deleted first until it fits; nothing else in the folder is touched', gone);
    expect(SAY_CACHE_MAX_BYTES === 256 * 1024 * 1024, 'cache: the cap is 256 MiB');
  } finally {
    if (env !== undefined) process.env.ELEVEN_LABS_API_KEY = env; else delete process.env.ELEVEN_LABS_API_KEY;
    if (bh !== undefined) process.env.BP_HOME = bh; else delete process.env.BP_HOME;
    resetRate();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------------------------------ voice
{
  const lines = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/vr/Content/BpData/voice/tour/lines.json'), 'utf8')) as { voice: Record<string, unknown> };
  const v = lines.voice;
  expect(v.fx === TOUR_LINK.fx, 'voice: the effect chain is the tour clips\' own', { tour: v.fx, link: TOUR_LINK.fx });
  expect(v.rate === TOUR_LINK.rate, 'voice: the rate is the tour clips\' own', { tour: v.rate, link: TOUR_LINK.rate });
  expect(JSON.stringify(v.loudness) === JSON.stringify(TOUR_LINK.loudness), 'voice: the level is the tour clips\' own', { tour: v.loudness, link: TOUR_LINK.loudness });
  expect(v.voiceId === VOICE.voiceId && v.modelId === VOICE.modelId && v.seed === VOICE.seed && JSON.stringify(v.settings) === JSON.stringify(VOICE.settings), 'voice: voice id, model, seed and settings are the tour clips\'');
}

// ------------------------------------------------------------------------------------------------ rate
{
  resetRate();
  const a = takeSlot('listen', 1000);
  const b = takeSlot('listen', 1001);
  expect('release' in a && 'refuse' in b && b.refuse.status === 429 && (await errOf(b.refuse)) === 'busy', 'rate: a second call in flight is 429 busy');
  if ('release' in a) a.release();
  for (let i = 1; i < RATE_PER_MINUTE; i++) { const s = takeSlot('listen', 1000 + i); if ('release' in s) s.release(); }
  const c = takeSlot('listen', 2000);
  expect('refuse' in c && (await errOf(c.refuse)) === 'rate', `rate: call ${RATE_PER_MINUTE + 1} inside a minute is 429 rate`);
  const d = takeSlot('listen', 62000);
  expect('release' in d, 'rate: a minute later it is free again');
  if ('release' in d) d.release();
  const e = takeSlot('say', 2000);
  expect('release' in e, 'rate: the routes count apart');
  if ('release' in e) e.release();
  resetRate();
}

// ------------------------------------------------------------------------------------------------ live
const online = key ? await Promise.race([dns.lookup('api.elevenlabs.io').then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), 4000))]) : false;
const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
if (!key) skip('live: no ELEVEN_LABS_API_KEY in the environment or bp\'s .env (say/listen against ElevenLabs not run)');
else if (!online) skip('live: api.elevenlabs.io does not resolve (no network; say/listen against ElevenLabs not run)');
else if (!ffmpeg) skip('live: ffmpeg is not on PATH (say cannot render)');
else {
  // The tour's welcome line as its book has it today (BpTourBook.cpp; wave T1 changed the words), so the clip compared is its own.
  const LINE = TOUR_LINES.welcome;
  const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  let t0 = Date.now();
  const r = await say(sayReq(JSON.stringify({ text: LINE })));
  const sayMs = Date.now() - t0;
  const wav = Buffer.from(await r.arrayBuffer());
  const p = parseWavAny(wav);
  expect(r.status === 200 && r.headers.get('content-type') === 'audio/wav', 'live say: 200 audio/wav', r.status);
  expect(p && p.format === 1 && p.channels === 1 && p.bits === 16 && p.rate === 24000, 'live say: RIFF PCM 16-bit mono 24000 Hz', p);
  // the same line through the same pipeline is the tour's own clip, byte for byte (same voice, effect and level)
  const tourClip = path.join(ROOT, 'apps/vr/Content/BpData/voice/tour/welcome.wav');
  if (fs.existsSync(tourClip)) expect(wav.equals(fs.readFileSync(tourClip)), 'live say: the tour line comes back byte-identical to the tour clip welcome.wav', { bytes: wav.length });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-voice-link-live-'));
  try {
    const f24 = path.join(tmp, 'say.wav'), f16 = path.join(tmp, 'say16.wav');
    fs.writeFileSync(f24, wav);
    const m = /I:\s+(-?[\d.]+) LUFS/.exec(spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f24, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }).stderr ?? '');
    expect(m && Math.abs(Number(m[1]) - TOUR_LINK.loudness.targetLufs) <= 1, 'live say: levelled to -14 LUFS (+-1), as the tour clips', m?.[1]);
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', f24, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', f16]);
    t0 = Date.now();
    const l = await listen(wavReq(fs.readFileSync(f16)));
    const listenMs = Date.now() - t0;
    const j = (await l.json()) as { text?: string; heard?: string; cost?: unknown };
    expect(l.status === 200 && loose(j.text ?? '') === loose(LINE), 'live listen: the said line comes back as its words', { status: l.status, text: j.text });
    expect(j.heard === 'speech', 'live listen: heard is speech', j.heard);
    say1(`live: say ${sayMs} ms (${r.headers.get('x-bp-voice-cache')}), listen ${listenMs} ms, cost ${JSON.stringify(j.cost)}`);
    const shown = [JSON.stringify(j), ...r.headers.values(), ...l.headers.values(), ...said].join('\n');
    expect(!!key && !shown.includes(key), 'live: the key appears in no answer and no printed line');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function parseWavAny(b: Buffer): { format: number; channels: number; rate: number; bits: number } | null {
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE' || b.toString('ascii', 12, 16) !== 'fmt ') return null;
  return { format: b.readUInt16LE(20), channels: b.readUInt16LE(22), rate: b.readUInt32LE(24), bits: b.readUInt16LE(34) };
}

done();
