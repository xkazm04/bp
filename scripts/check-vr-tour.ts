// Checks the lamp's tour (apps/vr/Source/bp/BpTour.cpp, standalone-plan.md S6) against its bundled voice
// (apps/vr/tools/tour-voice.ts -> apps/vr/Content/BpData/voice/tour/). Pins:
//   - every step BpTour.cpp names (StepName) and the "shown" line has a spoken line in TOUR_LINES, and no line is orphaned;
//   - each line has its clip, and the clip is a 16-bit PCM WAV that BpTour.cpp's ReadWav accepts (fmt before data, mono),
//     between 0.5 s and 8 s long;
//   - lines.json records the same text as TOUR_LINES, so a changed line cannot ride an old clip (re-run tour-voice.ts);
//   - the music bed (apps/vr/tools/music-bed.ts -> Content/BpData/music/bed.wav) is a 16-bit stereo PCM WAV, 120-150 s,
//     and bed.json agrees with it, records a quiet bed near its loudness target and a seam with no click.
// Run: node --import @bp/core/register scripts/check-vr-tour.ts. Exit 1 on any failure. Reads files only; no network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOUR_LINES } from '../apps/vr/tools/tour-voice.ts';
import { MUSIC_CHANNELS, MUSIC_INDEX, MUSIC_LOUDNESS, MUSIC_RATE, MUSIC_WAV } from '../apps/vr/tools/music-bed.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CPP = path.join(ROOT, 'apps/vr/Source/bp/BpTour.cpp');
const CLIPS = path.join(ROOT, 'apps/vr/Content/BpData/voice/tour');

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

// The step names, from StepName's table in the C++ (the one place the ids are written).
const src = fs.readFileSync(CPP, 'utf8');
const table = /static const TCHAR\* Names\[\] = \{([^}]*)\}/.exec(src);
check('BpTour.cpp has the StepName table', !!table);
const steps = table ? [...table[1].matchAll(/TEXT\("([^"]+)"\)/g)].map((m) => m[1]) : [];
// nine since night two W2b: the first five minutes end on the stand-up's first decision (standup), then the hand-off
check('the tour has its nine steps', steps.length === 9, `${steps.length}: ${steps.join(', ')}`);
check('the lamp says "shown" when it does a step', /SpeakTour\(TEXT\("shown"\)\)/.test(src));
const wanted = [...steps, 'shown'];
for (const s of wanted) check(`a spoken line for ${s}`, typeof TOUR_LINES[s] === 'string' && TOUR_LINES[s].length > 0);
for (const s of Object.keys(TOUR_LINES)) check(`${s} is a step BpTour.cpp plays`, wanted.includes(s));

function wav(file: string): { rate: number; channels: number; bits: number; seconds: number } | null {
  const b = fs.readFileSync(file);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt: { rate: number; channels: number; bits: number; format: number } | null = null;
  for (let at = 12; at + 8 <= b.length;) {
    const id = b.toString('ascii', at, at + 4), size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(at + 8), channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
    else if (id === 'data') return fmt && fmt.format === 1 ? { ...fmt, seconds: Math.min(size, b.length - at - 8) / (fmt.rate * fmt.channels * (fmt.bits / 8)) } : null;
    at += 8 + size + (size & 1);
  }
  return null;
}
for (const s of wanted) {
  const file = path.join(CLIPS, `${s}.wav`);
  if (!fs.existsSync(file)) { check(`clip ${s}.wav exists`, false, 'run node apps/vr/tools/tour-voice.ts'); continue; }
  const w = wav(file);
  check(`clip ${s}.wav is PCM`, !!w);
  if (!w) continue;
  check(`clip ${s}.wav is 16-bit mono`, w.bits === 16 && w.channels === 1, `${w.bits}-bit, ${w.channels} ch`);
  check(`clip ${s}.wav is 0.5-8 s`, w.seconds >= 0.5 && w.seconds <= 8, `${w.seconds.toFixed(2)} s`);
}
const index = path.join(CLIPS, 'lines.json');
const recorded = fs.existsSync(index) ? JSON.parse(fs.readFileSync(index, 'utf8')).lines ?? {} : {};
for (const [s, text] of Object.entries(TOUR_LINES)) check(`${s}.wav was read from today's line`, recorded[s] === text, 're-run node apps/vr/tools/tour-voice.ts');

// The background music bed (apps/vr/tools/music-bed.ts -> Content/BpData/music/bed.wav): the same WAV route, stereo at
// MUSIC_RATE, 120-150 s, and bed.json agrees with the file and records a quiet bed and a measured seam.
if (!fs.existsSync(MUSIC_WAV)) check('music bed.wav exists', false, 'run node apps/vr/tools/music-bed.ts');
else {
  const w = wav(MUSIC_WAV);
  check('music bed.wav is PCM', !!w);
  if (w) {
    check('music bed.wav is 16-bit stereo', w.bits === 16 && w.channels === MUSIC_CHANNELS, `${w.bits}-bit, ${w.channels} ch`);
    check('music bed.wav is at its rate', w.rate === MUSIC_RATE, `${w.rate} Hz`);
    check('music bed.wav is 120-150 s', w.seconds >= 120 && w.seconds <= 150, `${w.seconds.toFixed(2)} s`);
    const idx = fs.existsSync(MUSIC_INDEX) ? JSON.parse(fs.readFileSync(MUSIC_INDEX, 'utf8')) : null;
    check('music bed.json exists', !!idx, 're-run node apps/vr/tools/music-bed.ts --loop');
    if (idx) {
      check('bed.json matches the file', Math.abs(idx.seconds - w.seconds) < 0.01 && idx.format?.rate === w.rate && idx.format?.channels === w.channels);
      check('the bed sits near its loudness', Math.abs(idx.loudness?.integratedLufs - MUSIC_LOUDNESS.targetLufs) <= 1 && idx.loudness?.samplePeakDb <= MUSIC_LOUDNESS.ceilingDb + 0.1,
        `${idx.loudness?.integratedLufs} LUFS, peak ${idx.loudness?.samplePeakDb} dBFS`);
      check('the bed\'s seam has no click', typeof idx.seam?.stepAtJoin === 'number' && idx.seam.stepAtJoin <= idx.seam.stepP999, `step ${idx.seam?.stepAtJoin}, track p99.9 ${idx.seam?.stepP999}`);
      check('the bed was generated with no vocals', idx.generation?.force_instrumental === true);
    }
  }
}

console.log(`check:vr-tour ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
