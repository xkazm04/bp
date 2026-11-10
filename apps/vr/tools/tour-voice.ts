// Renders the lamp's tour lines in Glim's voice into the VR build (docs/concepts/vr-light-table/standalone-plan.md S6, "Voice").
// The headset with no PC has no server to synthesize a line, so each step's spoken line is rendered ahead of time, with the
// voice the web lamp uses (packages/core/src/companion/voice.ts: VOICE, through the server's cached synthesize) and the
// page's robot effect (VOICE_FX) applied here by ffmpeg, then written as 16-bit mono WAV that BpTour.cpp plays at the lamp.
//
//   node apps/vr/tools/tour-voice.ts [--force]
//   node apps/vr/tools/tour-voice.ts --loudness    (re-level the WAVs already on disk: no key, no credits)
//
// Every clip is levelled to LOUDNESS (integrated loudness, peak ceiling), measured with ffmpeg's ebur128 and applied as one
// static gain plus a limiter, so the set is even and the headset's small speakers carry it (2026-11-08: the clips measured
// -20.6 to -22.5 LUFS, peak -6 dBFS, and the owner, wearing the headset, called the voice barely heard).
//
// Writes apps/vr/Content/BpData/voice/tour/<line id>.wav plus lines.json (the text of each clip, and the voice it was read
// with). The spoken lines carry no product names or counts, so one set serves every bundled product; the caption carries
// those. A clip whose line and voice are unchanged is kept unless --force. The key is read like the server reads it and is
// never printed; a synthesized line is cached under $BP_HOME/companion/voice/, so a re-run costs no credits.
// Exit 0 written, 1 a line failed, 2 refused.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VOICE, VOICE_FX } from '../../../packages/core/src/companion/voice.ts';
import { synthesize, voiceKey } from '../../../packages/core/src/server/companion/voice.server.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The tour's book (apps/vr/Source/bp/BpTourBook.cpp, wave T1): every line the lamp says on the tour and its chapters, written
 *  once there. The captions are those words in the build; the clips are rendered here from the same text, so they cannot drift. */
export const TOUR_BOOK_CPP = path.resolve(HERE, '..', 'Source', 'bp', 'BpTourBook.cpp');

/** The lines of BpTourBook.cpp's Lines() table: id -> words (each entry on one line as { TEXT("id"), TEXT("words") }). */
export function readTourBook(file = TOUR_BOOK_CPP): Record<string, string> {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('const TArray<FLine>& Lines()');
  const end = start >= 0 ? src.indexOf('return All;', start) : -1;
  const block = start >= 0 && end > start ? src.slice(start, end) : '';
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/\{\s*TEXT\("([^"]+)"\),\s*TEXT\("((?:[^"\\]|\\.)*)"\)\s*\}/g)) out[m[1]] = m[2].replace(/\\(.)/g, '$1');
  return out;
}

/** The ids are the book's line ids (a step's id, or a variant a step says: decide-noted, menu-open, standup-how, ...). */
export const TOUR_LINES: Record<string, string> = readTourBook();

const OUT = path.resolve(HERE, '..', 'Content', 'BpData', 'voice', 'tour');
/** 16 kHz (wave T1): the tour grew from 10 lines to 33, and at 24 kHz the clips added 5 MB to the bundle; speech keeps its
 *  band to 8 kHz here, and the set stays under the 3 MB the wave allowed. */
const RATE = 16000;
/** Glim's level at the source: integrated loudness in LUFS, and the sample peak's ceiling in dBFS. */
const LOUDNESS = { targetLufs: -14, ceilingDb: -1 };

/** Integrated loudness of a clip, from ffmpeg's ebur128 summary. Null when ffmpeg could not read it. */
function measureLufs(file: string): number | null {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(res.stderr ?? '');
  return m ? Number(m[1]) : null;
}

/** Re-level a WAV in place to LOUDNESS: one static gain, and a limiter (no auto-level) that only touches the peaks over the
 *  ceiling. Idempotent: the gain comes from the clip's measured loudness. */
function level(wav: string): { before: number; after: number } | null {
  const before = measureLufs(wav);
  if (before === null) return null;
  const gain = LOUDNESS.targetLufs - before;
  const limit = Math.pow(10, LOUDNESS.ceilingDb / 20).toFixed(4);
  const tmp = `${wav}.tmp.wav`;
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
    '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=${limit}:attack=5:release=50:level=disabled`,
    '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', tmp], { encoding: 'utf8' });
  if (ff.status !== 0) { fs.rmSync(tmp, { force: true }); return null; }
  fs.renameSync(tmp, wav);
  const after = measureLufs(wav);
  return after === null ? null : { before, after };
}

function fxChain(): string {
  const f = VOICE_FX;
  const taps = f.echo.taps;
  return [
    `highpass=f=${f.highpassHz}`,
    `equalizer=f=${f.presence.hz}:t=q:w=${f.presence.q}:g=${f.presence.gainDb}`,
    `aecho=${f.echo.inGain}:${f.echo.outGain}:${taps.map((t) => t.ms).join('|')}:${taps.map((t) => t.gain).join('|')}`,
    `tremolo=f=${f.tremolo.hz}:d=${f.tremolo.depth}`,
    // The synthesizer's lead-in and tail of silence go (a line starts when the step does; 0.15 s of tail is kept).
    'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-55dB,areverse,silenceremove=start_periods=1:start_silence=0.15:start_threshold=-55dB,areverse',
  ].join(',');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const onlyLevel = process.argv.includes('--loudness');
  if (!onlyLevel && !voiceKey()) { console.log('REFUSED: no ELEVEN_LABS_API_KEY in the environment or bp\'s .env'); process.exit(2); }
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) { console.log('REFUSED: ffmpeg is not on PATH'); process.exit(2); }
  const force = process.argv.includes('--force');
  fs.mkdirSync(OUT, { recursive: true });
  const indexFile = path.join(OUT, 'lines.json');
  const before = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { lines: {} };
  const voice = { voiceId: VOICE.voiceId, modelId: VOICE.modelId, seed: VOICE.seed, settings: VOICE.settings, fx: fxChain(), rate: RATE, loudness: LOUDNESS };
  if (onlyLevel) {
    let bad = 0;
    for (const step of Object.keys(TOUR_LINES)) {
      const wav = path.join(OUT, `${step}.wav`);
      const leveled = fs.existsSync(wav) ? level(wav) : null;
      if (!leveled) { bad++; console.log(`FAIL  ${step}: no clip or ffmpeg failed`); continue; }
      console.log(`level ${step}: ${leveled.before.toFixed(1)} -> ${leveled.after.toFixed(1)} LUFS`);
    }
    fs.writeFileSync(indexFile, JSON.stringify({ voice, lines: TOUR_LINES }, null, 2) + '\n');
    process.exit(bad ? 1 : 0);
  }
  const sameVoice = JSON.stringify(before.voice) === JSON.stringify(voice);
  let failed = 0, chars = 0;
  // A clip no line uses any more goes (the bundle carries only what the tour says).
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.wav') && !(f.slice(0, -4) in TOUR_LINES)) { fs.rmSync(path.join(OUT, f)); console.log(`gone  ${f} (no line uses it)`); }
  }
  for (const [step, text] of Object.entries(TOUR_LINES)) {
    const wav = path.join(OUT, `${step}.wav`);
    if (!force && sameVoice && before.lines?.[step] === text && fs.existsSync(wav)) { console.log(`kept  ${step}`); continue; }
    const res = await synthesize(text);
    if (!res.ok) { failed++; console.log(`FAIL  ${step}: ${res.error}`); continue; }
    if (!res.cached) chars += text.length;
    const mp3 = path.join(OUT, `${step}.tmp.mp3`);
    fs.writeFileSync(mp3, res.audio);
    const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp3, '-af', fxChain(), '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', wav], { encoding: 'utf8' });
    fs.rmSync(mp3, { force: true });
    if (ff.status !== 0) { failed++; console.log(`FAIL  ${step}: ffmpeg ${ff.stderr.slice(0, 200)}`); continue; }
    if (!level(wav)) { failed++; console.log(`FAIL  ${step}: could not level the clip`); continue; }
    console.log(`ok    ${step} (${res.cached ? 'cached' : 'synthesized'}) -> ${(fs.statSync(wav).size / 1024).toFixed(0)} KB`);
  }
  fs.writeFileSync(indexFile, JSON.stringify({ voice, lines: TOUR_LINES }, null, 2) + '\n');
  console.log(`characters synthesized (not from the cache): ${chars}`);
  process.exit(failed ? 1 : 0);
}
