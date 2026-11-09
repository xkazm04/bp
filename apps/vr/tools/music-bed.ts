// Renders the light table's background music bed into the VR build (owner, 2026-11-09: "create in elevenlabs background lofi
// hip hop track and put in background"). One instrumental track from ElevenLabs' music API (POST /v1/music), cut here into a
// seamless loop and levelled as a quiet bed under Glim's voice, written as a 16-bit PCM WAV the app reads the way BpTour.cpp
// reads a tour clip (FFileHelper::LoadFileToArray + ReadWav, staged by DefaultGame.ini's DirectoriesToAlwaysStageAsUFS=BpData).
//
//   node apps/vr/tools/music-bed.ts            (the cached original if there is one, else one generation: costs credits)
//   node apps/vr/tools/music-bed.ts --force    (a new generation even when one is cached: costs credits)
//   node apps/vr/tools/music-bed.ts --loop     (re-cut and re-level the cached original only: no key, no credits)
//
// The untouched original (MP3 as the API sent it) and the response's headers are kept under $BP_HOME/companion/music/
// (default <repo>/.bp, git-ignored), keyed by a hash of the request, so a re-run costs nothing.
//
// The loop: the track's steady body is found from its loudness envelope (any quiet intro and any fade-out are left out); the
// loop's end is the point in the last stretch whose onset pattern and level best match the loop's head, so the beat lines up;
// the CROSSFADE seconds after the end are blended into the head (sin^2/cos^2, sum of gains 1), so the last sample of the file
// runs straight on into its first. The seam is then measured on two copies back to back: the level in 100 ms windows across
// it and the sample step at the join, each against the same measure over the whole track.
//
// The level: one static gain to LOUDNESS.targetLufs (ffmpeg ebur128), lowered further if the sample peak would pass the
// ceiling. No limiter or compressor, so nothing stateful touches the seam.
//
// Writes apps/vr/Content/BpData/music/bed.wav and bed.json (the request, the generation date, the loop points, the measured
// loudness and seam). The key is read like the server reads it (voice.server.ts voiceKey: ELEVEN_LABS_API_KEY from the
// environment, else bp's .env) and is never printed. Exit 0 written, 1 failed, 2 refused.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MUSIC_DIR = path.resolve(HERE, '..', 'Content', 'BpData', 'music');
export const MUSIC_WAV = path.join(MUSIC_DIR, 'bed.wav');
export const MUSIC_INDEX = path.join(MUSIC_DIR, 'bed.json');
/** The bed's format: stereo (a 2D bed, not spatialized), 32 kHz (the genre's top end is rolled off well under 16 kHz, and it
 *  keeps the file near 17 MB against 23 MB at 44.1 kHz), 16-bit PCM (what ReadWav accepts). */
export const MUSIC_RATE = 32000;
export const MUSIC_CHANNELS = 2;
/** The bed's level: well under the voice (tour clips sit at -14 LUFS), and a sample-peak ceiling. */
export const MUSIC_LOUDNESS = { targetLufs: -24, ceilingDb: -6 };
/** Seconds of the end blended into the head. */
const CROSSFADE = 3;

/** The generation request, as sent. Names no artist, band, song, label or brand (Eleven Music terms, s. 2.1). */
export const MUSIC_REQUEST = {
  endpoint: 'https://api.elevenlabs.io/v1/music',
  output_format: 'mp3_44100_128',
  body: {
    model_id: 'music_v1',
    music_length_ms: 150000,
    force_instrumental: true,
    prompt: [
      'Mellow lo-fi hip hop instrumental for concentrating at a desk in the evening.',
      'Slow, dusty, laid-back drums with a soft swing around 75 BPM, warm electric piano chords with a gentle tremolo,',
      'a round soft bass, light vinyl crackle and tape hiss.',
      'Calm and steady from the first bar to the last: it starts straight on the groove, has no build-ups, drops or breaks,',
      'and ends on the groove with no fade-out. Original melody. No vocals, no speech, no samples of voices.',
    ].join(' '),
  },
};

type Pcm = Float32Array; // interleaved stereo at MUSIC_RATE

function ffmpegOk(): boolean { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; }

function decode(file: string): Pcm {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', String(MUSIC_CHANNELS), '-ar', String(MUSIC_RATE), '-'], { maxBuffer: 512 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`ffmpeg could not decode ${file}: ${res.stderr?.toString().slice(0, 200)}`);
  const b = res.stdout as Buffer;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

/** ffmpeg's ebur128 over raw stereo float: integrated loudness (LUFS) and true peak (dBTP). */
function loudness(pcm: Pcm): { lufs: number; truePeakDb: number } | null {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'f32le', '-ac', String(MUSIC_CHANNELS), '-ar', String(MUSIC_RATE), '-i', '-',
    '-af', 'ebur128=framelog=quiet:peak=true', '-f', 'null', '-'], { input: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const err = res.stderr?.toString() ?? '';
  const i = /I:\s+(-?[\d.]+) LUFS/.exec(err), p = /True peak:\s+Peak:\s+(-?[\d.inf]+) dBFS/.exec(err);
  return i ? { lufs: Number(i[1]), truePeakDb: p ? Number(p[1]) : NaN } : null;
}

const frames = (pcm: Pcm) => pcm.length / MUSIC_CHANNELS;
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** RMS per hop (mono sum), the loudness envelope. */
function envelope(pcm: Pcm, hop: number): Float64Array {
  const n = Math.floor(frames(pcm) / hop), env = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let f = k * hop; f < (k + 1) * hop; f++) { const m = (pcm[2 * f] + pcm[2 * f + 1]) * 0.5; s += m * m; }
    env[k] = Math.sqrt(s / hop);
  }
  return env;
}

function corr(a: Float64Array, ai: number, b: Float64Array, bi: number, n: number): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[ai + i]; mb += b[bi + i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[ai + i] - ma, y = b[bi + i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

const median = (xs: ArrayLike<number>) => { const s = Array.from(xs).sort((p, q) => p - q); return s[Math.floor(s.length / 2)] ?? 0; };
const percentile = (xs: number[], q: number) => { const s = [...xs].sort((p, r) => p - r); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };

export type LoopCut = { headS: number; endS: number; continuationS: number; periodS: number | null; periodCorr: number; crossfadeS: number;score: number; onsetCorr: number; levelDiffDb: number; sourceS: number };

/** Find the loop [head, end) in the source and blend end..end+CROSSFADE into the head. */
function cutLoop(src: Pcm): { loop: Pcm; cut: LoopCut } {
  const HOP = MUSIC_RATE / 100; // 10 ms
  const env = envelope(src, HOP);
  const n = env.length;
  // The onset pattern: the rise of the log envelope, which lines up drum hits.
  const log = env.map((e) => db(e));
  const onset = new Float64Array(n);
  for (let k = 1; k < n; k++) onset[k] = Math.max(0, log[k] - log[k - 1]);
  // Where the music plays: the 1 s moving level within 12 dB of the middle half's median (quiet sections stay in; the
  // silence or ring-out after the last bar does not).
  const W1 = 100;
  const moving = new Float64Array(n);
  for (let k = 0; k < n; k++) { let s = 0, c = 0; for (let j = Math.max(0, k - W1 / 2); j < Math.min(n, k + W1 / 2); j++) { s += env[j] * env[j]; c++; } moving[k] = db(Math.sqrt(s / c)); }
  const body = median(moving.slice(Math.floor(n / 4), Math.floor((3 * n) / 4)));
  let first = 0; while (first < n && moving[first] < body - 12) first++;
  let last = n - 1; while (last > 0 && moving[last] < body - 12) last--;
  const X = CROSSFADE * 100, MATCH = 600; // compare 6 s windows
  const sum = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) sum[k + 1] = sum[k] + moving[k];
  const level = (k: number) => (sum[k + MATCH] - sum[k]) / MATCH;
  const match = (a: number, b: number) => {
    const oc = corr(onset, a, onset, b, MATCH), ec = corr(env, a, env, b, MATCH), dd = Math.abs(level(a) - level(b));
    return { s: oc + 0.5 * ec - dd / 6, oc, dd };
  };
  // The track's repeat: the lag (20-100 s) at which it best matches itself, a section form played twice. What follows the
  // loop's last bar can then be taken from one repeat earlier when the track ends right after it.
  let period = 0, periodCorr = 0;
  for (let lag = 2000; lag <= 10000 && last - first - lag >= 2000; lag++) {
    const len = last - first - lag;
    const c = corr(env, first, env, first + lag, len) + corr(onset, first, onset, first + lag, len);
    if (c / 2 > periodCorr) { periodCorr = c / 2; period = lag; }
  }
  const usePeriod = periodCorr >= 0.5;
  // The loop [h, e), and where its continuation (the CROSSFADE blended into the head) is taken: c = e (the music after the
  // end) or c = e - period (the same bars one repeat earlier). Score: how well the head matches the continuation, plus how
  // well the bars before e match the bars before c (1.5, perfect, when c = e). Coarse grid, then a 10 ms refinement.
  type Pick = { h: number; e: number; c: number; score: number; oc: number; dd: number };
  const consider = (h: number, e: number, best: Pick | null): Pick | null => {
    for (const c of usePeriod ? [e, e - period] : [e]) {
      if (c + MATCH > last || c - MATCH < 0 || h + MATCH > last) continue;
      const head = match(h, c);
      const cont = c === e ? 1.5 : match(e - MATCH, c - MATCH).s;
      const score = head.s + cont;
      if (!best || score > best.score) best = { h, e, c, score, oc: head.oc, dd: head.dd };
    }
    return best;
  };
  let best: Pick | null = null;
  for (const minLen of [12000, 10000, 9000]) {
    for (let h = first; h <= first + 1200; h += 10) for (let e = h + minLen; e <= last; e += 5) best = consider(h, e, best);
    if (best) break;
  }
  if (!best) throw new Error(`the track has no stretch long enough to loop (music ${(first / 100).toFixed(1)}-${(last / 100).toFixed(1)} s)`);
  const coarse: Pick = best;
  for (let h = Math.max(first, coarse.h - 10); h <= coarse.h + 10; h++) for (let e = coarse.e - 5; e <= Math.min(last, coarse.e + 5); e++) best = consider(h, e, best);
  const pick = best!;
  const h0 = pick.h * HOP, e0 = pick.e * HOP, c0 = pick.c * HOP, xf = X * HOP, len = e0 - h0;
  const loop = new Float32Array(len * MUSIC_CHANNELS);
  for (let f = 0; f < len; f++) {
    for (let c = 0; c < MUSIC_CHANNELS; c++) {
      const head = src[(h0 + f) * MUSIC_CHANNELS + c];
      if (f < xf) {
        const t = Math.sin((Math.PI / 2) * (f / xf)) ** 2; // the head fades in, the end's continuation fades out
        loop[f * MUSIC_CHANNELS + c] = head * t + src[(c0 + f) * MUSIC_CHANNELS + c] * (1 - t);
      } else if (c0 !== e0 && f >= len - xf) {
        // Continued from a repeat earlier: the loop's last bars hand over to the bars just before c, so its last sample
        // runs straight into the continuation the head starts with.
        const t = Math.sin((Math.PI / 2) * ((f - (len - xf)) / xf)) ** 2;
        loop[f * MUSIC_CHANNELS + c] = head * (1 - t) + src[(c0 - len + f) * MUSIC_CHANNELS + c] * t;
      } else loop[f * MUSIC_CHANNELS + c] = head;
    }
  }
  return { loop, cut: { headS: h0 / MUSIC_RATE, endS: e0 / MUSIC_RATE, continuationS: c0 / MUSIC_RATE, periodS: usePeriod ? period / 100 : null, periodCorr: +periodCorr.toFixed(3),
    crossfadeS: CROSSFADE, score: +pick.score.toFixed(3), onsetCorr: +pick.oc.toFixed(3), levelDiffDb: +pick.dd.toFixed(2), sourceS: +(frames(src) / MUSIC_RATE).toFixed(2) } };
}

export type Seam = { stepAtJoin: number; stepP999: number; levelJumpDb: number; levelJumpMedianDb: number; levelJumpMaxDb: number; levelNearSeamDb: [number, number]; crossfadeDb: [number, number, number] };

/** The seam on two copies back to back: the sample step at the join against the track's 99.9th percentile step (a click
 *  would stand out); the largest change between 100 ms windows within 10 s of the join against the same measure in every
 *  other 20 s of the track (median and maximum); the level 10 s either side; and the crossfade's level against its
 *  neighbours (a dip or bump there would be heard as a breath in the bed). */
function measureSeam(loop: Pcm): Seam {
  const n = frames(loop), C = MUSIC_CHANNELS;
  const steps: number[] = [];
  for (let f = 1; f < n; f += 1) for (let c = 0; c < C; c++) steps.push(Math.abs(loop[f * C + c] - loop[(f - 1) * C + c]));
  let stepAtJoin = 0;
  for (let c = 0; c < C; c++) stepAtJoin = Math.max(stepAtJoin, Math.abs(loop[c] - loop[(n - 1) * C + c]));
  const twice = new Float32Array(loop.length * 2); twice.set(loop); twice.set(loop, loop.length);
  const W = MUSIC_RATE / 10;
  const env = Array.from(envelope(twice, W), (e) => db(e));
  const jumps = env.slice(1).map((v, i) => Math.abs(v - env[i]));
  const seamAt = Math.floor(n / W);
  const near = jumps.slice(seamAt - 100, seamAt + 100);
  const before = env.slice(seamAt - 100, seamAt), after = env.slice(seamAt, seamAt + 100);
  const rms = (xs: number[]) => db(Math.sqrt(xs.reduce((s, v) => s + Math.pow(10, v / 10), 0) / xs.length));
  // The same "largest 100 ms change in 20 s" for every other 20 s stretch of the track (10 s apart), for comparison.
  const others: number[] = [];
  for (let at = 0; at + 200 <= jumps.length; at += 100) if (at + 200 <= seamAt - 100 || at >= seamAt + 100) others.push(Math.max(...jumps.slice(at, at + 200)));
  // The crossfade (the loop's first CROSSFADE seconds) against the 3 s on either side of it.
  const xf = CROSSFADE * 10;
  const window = (a: number, b: number) => +rms(env.slice(a, b)).toFixed(2);
  return { stepAtJoin: +stepAtJoin.toFixed(4), stepP999: +percentile(steps, 0.999).toFixed(4), levelJumpDb: +Math.max(...near).toFixed(2),
    levelJumpMedianDb: +percentile(others, 0.5).toFixed(2), levelJumpMaxDb: +Math.max(...others).toFixed(2), levelNearSeamDb: [+rms(before).toFixed(2), +rms(after).toFixed(2)],
    crossfadeDb: [window(seamAt - 30, seamAt), window(seamAt, seamAt + xf), window(seamAt + xf, seamAt + xf + 30)] };
}

function writeWav(file: string, pcm: Pcm): void {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(MUSIC_CHANNELS, 22);
  h.writeUInt32LE(MUSIC_RATE, 24); h.writeUInt32LE(MUSIC_RATE * MUSIC_CHANNELS * 2, 28); h.writeUInt16LE(MUSIC_CHANNELS * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, Buffer.concat([h, data]));
  fs.renameSync(tmp, file);
}

/** Generate the track, or return the cached original. The key never leaves this function. */
async function original(force: boolean, offline: boolean): Promise<{ mp3: string; meta: Record<string, unknown> } | { refused: string }> {
  const { companionHome } = await import('../../../packages/core/src/server/companion/home.server.ts');
  const hash = crypto.createHash('sha256').update(JSON.stringify(MUSIC_REQUEST)).digest('hex').slice(0, 32);
  const dir = path.join(companionHome(), 'music');
  const mp3 = path.join(dir, `${hash}.mp3`), metaFile = path.join(dir, `${hash}.json`);
  if (!force && fs.existsSync(mp3) && fs.existsSync(metaFile)) return { mp3, meta: JSON.parse(fs.readFileSync(metaFile, 'utf8')) };
  if (offline) return { refused: `no cached original at ${mp3}: run without --loop to generate one` };
  const { voiceKey } = await import('../../../packages/core/src/server/companion/voice.server.ts');
  const key = voiceKey();
  if (!key) return { refused: "no ELEVEN_LABS_API_KEY in the environment or bp's .env" };
  const scrub = (s: string) => s.split(key).join('[key]');
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${MUSIC_REQUEST.endpoint}?output_format=${MUSIC_REQUEST.output_format}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(MUSIC_REQUEST.body),
      signal: AbortSignal.timeout(600000),
    });
  } catch (e) { return { refused: scrub(`the music service did not answer: ${(e as Error).message}`) }; }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { if (!/cookie|authorization|api-key/i.test(k)) headers[k] = scrub(v); });
  if (!res.ok) return { refused: scrub(`the music service refused (${res.status} ${res.statusText}): ${(await res.text().catch(() => '')).slice(0, 600)}`) };
  const audio = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mp3, audio);
  const meta = { generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), bytes: audio.length,
    sha256: crypto.createHash('sha256').update(audio).digest('hex'), request: MUSIC_REQUEST, responseHeaders: headers };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
  return { mp3, meta };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!ffmpegOk()) { console.log('REFUSED: ffmpeg is not on PATH'); process.exit(2); }
  const got = await original(process.argv.includes('--force'), process.argv.includes('--loop'));
  if ('refused' in got) { console.log(`REFUSED: ${got.refused}`); process.exit(2); }
  try {
    const src = decode(got.mp3);
    const { loop, cut } = cutLoop(src);
    const raw = loudness(loop);
    if (!raw) throw new Error('ffmpeg could not measure the loop');
    let peak = 0; for (let i = 0; i < loop.length; i++) peak = Math.max(peak, Math.abs(loop[i]));
    const gainDb = Math.min(MUSIC_LOUDNESS.targetLufs - raw.lufs, MUSIC_LOUDNESS.ceilingDb - db(peak));
    const g = Math.pow(10, gainDb / 20);
    for (let i = 0; i < loop.length; i++) loop[i] *= g;
    const seam = measureSeam(loop);
    const after = loudness(loop)!;
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
    writeWav(MUSIC_WAV, loop);
    // The written file, measured again as ffmpeg reads it.
    const ff = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', MUSIC_WAV, '-af', 'ebur128=framelog=quiet:peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
    const fileLufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(ff.stderr ?? '')?.[1]);
    const seconds = frames(loop) / MUSIC_RATE;
    const index = {
      file: 'bed.wav', format: { codec: 'pcm_s16le', rate: MUSIC_RATE, channels: MUSIC_CHANNELS }, seconds: +seconds.toFixed(3), frames: frames(loop),
      loop: { startFrame: 0, endFrame: frames(loop), note: 'the whole file is the loop: play it end to end and queue it again', cutFromSource: cut },
      loudness: { targetLufs: MUSIC_LOUDNESS.targetLufs, ceilingDb: MUSIC_LOUDNESS.ceilingDb, sourceLufs: raw.lufs, gainDb: +gainDb.toFixed(2),
        integratedLufs: fileLufs, truePeakDbtp: after.truePeakDb, samplePeakDb: +(db(peak) + gainDb).toFixed(2) },
      seam,
      generation: { by: 'ElevenLabs music API', endpoint: MUSIC_REQUEST.endpoint, outputFormat: MUSIC_REQUEST.output_format, ...MUSIC_REQUEST.body,
        generatedAt: got.meta.generatedAt, songId: (got.meta.responseHeaders as Record<string, string> | undefined)?.['song-id'] ?? null, originalSha256: got.meta.sha256 },
      tool: 'apps/vr/tools/music-bed.ts',
    };
    fs.writeFileSync(MUSIC_INDEX, JSON.stringify(index, null, 2) + '\n');
    console.log(`ok    bed.wav ${seconds.toFixed(2)} s, ${(fs.statSync(MUSIC_WAV).size / 1048576).toFixed(1)} MB, ${fileLufs} LUFS, true peak ${after.truePeakDb} dBTP`);
    console.log(`loop  source ${cut.headS.toFixed(2)}-${cut.endS.toFixed(2)} s of ${cut.sourceS} s, continuation from ${cut.continuationS.toFixed(2)} s (repeat ${cut.periodS ?? 'none'} s, corr ${cut.periodCorr}), crossfade ${cut.crossfadeS} s, onset corr ${cut.onsetCorr}, level diff ${cut.levelDiffDb} dB`);
    console.log(`seam  step ${seam.stepAtJoin} (track p99.9 ${seam.stepP999}); 100 ms level jump ${seam.levelJumpDb} dB near the seam (other 20 s stretches: median ${seam.levelJumpMedianDb}, max ${seam.levelJumpMaxDb}); 10 s before/after ${seam.levelNearSeamDb.join(' / ')} dB; 3 s before / crossfade / 3 s after ${seam.crossfadeDb.join(' / ')} dB`);
    process.exit(0);
  } catch (e) { console.log(`FAIL  ${(e as Error).message}`); process.exit(1); }
}
