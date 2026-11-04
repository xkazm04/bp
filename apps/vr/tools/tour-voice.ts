// Renders the lamp's tour lines in Glim's voice into the VR build (docs/concepts/vr-light-table/standalone-plan.md S6, "Voice").
// The headset with no PC has no server to synthesize a line, so each step's spoken line is rendered ahead of time, with the
// voice the web lamp uses (packages/core/src/companion/voice.ts: VOICE, through the server's cached synthesize) and the
// page's robot effect (VOICE_FX) applied here by ffmpeg, then written as 16-bit mono WAV that BpTour.cpp plays at the lamp.
//
//   node apps/vr/tools/tour-voice.ts [--force]
//
// Writes apps/vr/Content/BpData/voice/tour/<step>.wav plus lines.json (the text of each clip, and the voice it was read
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

/** The step ids are BpTour.cpp's StepName()s, plus "shown" (said when the lamp does a step for the person). */
export const TOUR_LINES: Record<string, string> = {
  welcome: 'Welcome to the light table. Every block on this paper is a part of the code.',
  'lift-wing': 'Pinch a wing, and pull it toward you.',
  'lift-room': 'Now pinch the glowing room, and pull it up.',
  'step-in': 'Pull it once more, to step inside.',
  ask: 'Hold a feature, to ask me about it.',
  decide: 'Each screen on the deck is one decision. Tap approve, or decline.',
  'step-out': 'Push away, to step back out.',
  'hand-off': "That's the morning round. The table is yours.",
  shown: 'Like this.',
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'Content', 'BpData', 'voice', 'tour');
const RATE = 24000;

function fxChain(): string {
  const f = VOICE_FX;
  const taps = f.echo.taps;
  return [
    `highpass=f=${f.highpassHz}`,
    `equalizer=f=${f.presence.hz}:t=q:w=${f.presence.q}:g=${f.presence.gainDb}`,
    `aecho=${f.echo.inGain}:${f.echo.outGain}:${taps.map((t) => t.ms).join('|')}:${taps.map((t) => t.gain).join('|')}`,
    `tremolo=f=${f.tremolo.hz}:d=${f.tremolo.depth}`,
  ].join(',');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!voiceKey()) { console.log('REFUSED: no ELEVEN_LABS_API_KEY in the environment or bp\'s .env'); process.exit(2); }
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) { console.log('REFUSED: ffmpeg is not on PATH'); process.exit(2); }
  const force = process.argv.includes('--force');
  fs.mkdirSync(OUT, { recursive: true });
  const indexFile = path.join(OUT, 'lines.json');
  const before = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { lines: {} };
  const voice = { voiceId: VOICE.voiceId, modelId: VOICE.modelId, seed: VOICE.seed, settings: VOICE.settings, fx: fxChain(), rate: RATE };
  const sameVoice = JSON.stringify(before.voice) === JSON.stringify(voice);
  let failed = 0;
  for (const [step, text] of Object.entries(TOUR_LINES)) {
    const wav = path.join(OUT, `${step}.wav`);
    if (!force && sameVoice && before.lines?.[step] === text && fs.existsSync(wav)) { console.log(`kept  ${step}`); continue; }
    const res = await synthesize(text);
    if (!res.ok) { failed++; console.log(`FAIL  ${step}: ${res.error}`); continue; }
    const mp3 = path.join(OUT, `${step}.tmp.mp3`);
    fs.writeFileSync(mp3, res.audio);
    const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp3, '-af', fxChain(), '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', wav], { encoding: 'utf8' });
    fs.rmSync(mp3, { force: true });
    if (ff.status !== 0) { failed++; console.log(`FAIL  ${step}: ffmpeg ${ff.stderr.slice(0, 200)}`); continue; }
    console.log(`ok    ${step} (${res.cached ? 'cached' : 'synthesized'}) -> ${(fs.statSync(wav).size / 1024).toFixed(0)} KB`);
  }
  fs.writeFileSync(indexFile, JSON.stringify({ voice, lines: TOUR_LINES }, null, 2) + '\n');
  process.exit(failed ? 1 : 0);
}
