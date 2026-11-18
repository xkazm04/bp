// A take (quest-take.mjs's take.json) as the film's edit list for compose.mjs, on the picked cue (dry-run.md): the take is
// laid on the music with ONE offset so its ADD lands on the drop (23.4 s); the cue-locked driver spaced SCAN and APPROVE to
// the cue's other marks, and this reports how far they fell. Glim's clean clips go where the app played them, each with a
// two-line caption (ours on top, his words below). A web hook opens it, a title card closes it.
//
//   node apps/vr/tools/film/auto-edl.mjs --take <take dir> [--web <hook.mp4>] [--out <edl.json>] [--hook-text "<caption>"]
//
// Output default: apps/vr/Saved/demo/out/<take>.edl.json. Exit 0 written, 1 the take lacks a mark, 2 refused.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const VOICE = path.join(ROOT, 'apps', 'vr', 'Content', 'BpData', 'voice');
const CUE = { file: 'apps/vr/Saved/demo/cue/cue.wav', duration: 139.16, add: 23.4, scan: 68.6, approve: 113.8 };
const CARD_S = 7.0;
const VOICE_GAIN_DB = Number(process.argv.includes('--voice-db') ? process.argv[process.argv.indexOf('--voice-db') + 1] : -1.94);

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const takeDir = opt('--take');
if (!takeDir) { console.log('REFUSED: --take <dir> is needed'); process.exit(2); }
const take = JSON.parse(fs.readFileSync(path.join(path.resolve(takeDir), 'take.json'), 'utf8'));
const web = opt('--web');
const rel = (p) => path.relative(ROOT, path.resolve(p)).replace(/\\/g, '/');
const out = path.resolve(opt('--out', path.join(ROOT, 'apps', 'vr', 'Saved', 'demo', 'out', `${take.name}.edl.json`)));

// Glim's words, from each voice folder's lines.json ({ lines: { id: words } }) and the talk sample (replies).
const words = {};
for (const d of fs.readdirSync(VOICE)) {
  const f = path.join(VOICE, d, 'lines.json');
  if (fs.existsSync(f)) { try { Object.assign(words, JSON.parse(fs.readFileSync(f, 'utf8')).lines ?? {}); } catch { /* not an index */ } }
}
try { for (const l of JSON.parse(fs.readFileSync(path.join(VOICE, 'talk', 'sample.json'), 'utf8')).lines) words[`talk-${l.id}`] = l.reply; } catch { /* none */ }

// Our caption per act, keyed by the tour line that opens the act (dry-run.md's spine table).
const ACTS = {
  welcome: 'Put on the headset.',
  'add-project': 'Add a project.',
  drawing: 'Glim reads the code and draws it.',
  'look-wing': 'Wings are areas. Rooms are what they do.',
  'scan-first': 'Then a scan reads every room.',
  findings: 'What needs a person becomes a card.',
  standup: 'Decide by hand, one card at a time.',
  talk: 'Or just ask.',
  'hand-off': 'Tomorrow, it opens with what moved.',
};

const sentAt = (re) => take.sent.filter((s) => re.test(s.cmd)).map((s) => s.t);
const tAdd = sentAt(/console:add:tutorial/)[0];
if (tAdd === undefined) { console.log('FAIL: the take has no ADD (BpConsole.Tap console:add:tutorial) to anchor on'); process.exit(1); }
const off = CUE.add - tAdd;
const tScan = sentAt(/console:scan:this/).pop();
const tApprove = sentAt(/BpStandup.Act approve/)[0];

const seg = take.segments[0];
if (!seg) { console.log('FAIL: the take has no video'); process.exit(1); }
if (take.segments.length > 1) console.log(`note: ${take.segments.length} segments; only the first (${seg.duration.toFixed(1)} s) is used`);

// The take's picture starts just before Glim's welcome; the hook fills the cue's opening before it.
// The studio lights when PROJECTS opens (the add-project step); before it the take is dark (and earlier still, the engine's
// splash), so the picture starts there and Glim's welcome plays over the hook's end.
const welcome = take.voice.find((v) => v.clip === 'welcome');
const addStep = take.events.find((e) => /^BpTour: step add-project/.test(e.text));
const takeStart = Math.max(-off, addStep ? addStep.t + 0.3 : (welcome ? welcome.t + 4.5 : tAdd - 6));
const hookEnd = +(takeStart + off).toFixed(3);
const handOff = take.voice.find((v) => v.clip === 'hand-off');
const cardAt = +Math.min(CUE.duration - CARD_S, Math.max(hookEnd + 1, handOff ? handOff.t + off + handOff.dur + 0.8 : CUE.duration - CARD_S)).toFixed(3);
const clipOut = Math.min(seg.duration, cardAt - off);

const clips = [];
// The hook: the web fly-in ends where the take begins; when it is shorter than the slot, --web-still (the plan at rest)
// fills the start.
if (web && hookEnd > 0.5) {
  const durOf = (f) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim()); } catch { return 0; } };
  const webDur = durOf(path.resolve(web));
  const still = opt('--web-still');
  const lead = Math.max(0, hookEnd - webDur);
  if (lead > 0.05 && still) clips.push({ name: 'hook-still', at: 0, src: rel(still), in: 0, out: +Math.min(lead, durOf(path.resolve(still))).toFixed(3), preset: 'web', fadeInS: 0.5 });
  const fly = Math.min(webDur, hookEnd);
  const flyAt = still && lead > 0.05 ? +Math.min(lead, durOf(path.resolve(still))).toFixed(3) : +(hookEnd - fly).toFixed(3);
  clips.push({ name: 'hook', at: flyAt, src: rel(web), in: +(webDur - (hookEnd - flyAt)).toFixed(3) < 0 ? 0 : +(webDur - (hookEnd - flyAt)).toFixed(3), out: +webDur.toFixed(3), preset: 'web', ...(flyAt === 0 ? { fadeInS: 0.5 } : {}) });
}
clips.push({ name: 'take', at: hookEnd, src: seg.file, in: +takeStart.toFixed(3), out: +clipOut.toFixed(3), preset: 'quest-left-eye', ...(web ? {} : { fadeInS: 0.6 }), fadeOutS: 0.6 });

// v3 (the owner, 2026-11-18): an intro layer says what this is, the web shows a new project that needs onboarding, then the
// web and the headset onboard it side by side (both press ADD on the drop), and the headset takes the frame.
//   --intro <12 s mp4> --web-onboard <mp4> [--web-action 6.0] [--web-new <mp4>] [--split-end 45]
const splits = [];
const intro = opt('--intro');
if (intro) {
  const durOf = (f) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.resolve(f)], { encoding: 'utf8' }).trim()); } catch { return 0; } };
  const webOn = opt('--web-onboard');
  if (!webOn) { console.log('REFUSED: --intro needs --web-onboard'); process.exit(2); }
  const webAct = Number(opt('--web-action', '6.0'));
  const webNew = opt('--web-new');
  clips.length = 0;
  const introEnd = +Math.min(durOf(intro), hookEnd - 2).toFixed(3);
  clips.push({ name: 'intro', at: 0, src: rel(intro), in: 0, out: introEnd, preset: 'web', fadeInS: 0.6 });
  // The web's own clock: its ADD at webAct lands on the cue's drop too.
  const webIn = (filmT) => +(webAct - (CUE.add - filmT)).toFixed(3);
  if (webNew) clips.push({ name: 'web-new', at: introEnd, src: rel(webNew), in: 0, out: +Math.min(durOf(webNew), hookEnd - introEnd).toFixed(3), preset: 'web' });
  else clips.push({ name: 'web-new', at: introEnd, src: rel(webOn), in: Math.max(0, webIn(introEnd)), out: +(Math.max(0, webIn(introEnd)) + hookEnd - introEnd).toFixed(3), preset: 'web' });
  const splitEnd = Number(opt('--split-end', '45'));
  splits.push({
    name: 'onboard', at: hookEnd, dur: +(splitEnd - hookEnd).toFixed(3),
    left: { src: rel(webOn), in: Math.max(0, webIn(hookEnd)), preset: 'web' },
    right: { src: seg.file, in: +takeStart.toFixed(3), preset: 'quest-left-eye-tall' },
    labels: ['On the web', 'In the headset'],
    transitionIn: 'left', transitionInS: 0.6, transitionOut: 'right', transitionOutS: 0.6,
  });
  clips.push({ name: 'take', at: splitEnd, src: seg.file, in: +(splitEnd - off).toFixed(3), out: +clipOut.toFixed(3), preset: 'quest-left-eye', fadeOutS: 0.6 });
  Object.assign(ACTS, {
    welcome: 'A new project, waiting to be drawn.',
    'add-project': 'Add it on the web, or in the headset.',
    drawing: 'Both draw it, side by side.',
  });
}

// Voice and captions: every clip Glim played inside the take's span, never two at once (a later one waits its turn).
const voice = [];
const captions = [];
if (hookEnd > 1 && !intro) captions.push({ from: 0.6, to: +(hookEnd - 0.3).toFixed(3), top: opt('--hook-text', 'A software product is thousands of files and a list of tickets.'), bottom: '' });
let act = '';
let busyUntil = 0;
for (const v of take.voice) {
  let at = v.t + off;
  if (at < 0.5 || at + v.dur > cardAt) continue;
  if (!v.file) { console.log(`note: no clean clip for ${v.clip}; skipped`); continue; }
  if (v.clip === 'shown') continue;
  at = Math.max(at, busyUntil + 0.15);
  if (ACTS[v.clip]) act = v.clip;
  // Glim 20 % quieter in the film than his clips (the owner, 2026-11-18: "too high"): -1.94 dB.
  voice.push({ at: +at.toFixed(3), file: v.file, gainDb: VOICE_GAIN_DB, _clip: v.clip });
  busyUntil = at + v.dur;
  const said = words[v.line ?? v.clip] ?? words[v.clip] ?? '';
  captions.push({ from: +at.toFixed(3), to: +(at + v.dur + 0.6).toFixed(3), top: act ? ACTS[act] : '', bottom: said });
}
// Captions never overlap: each ends where the next begins.
for (let i = 0; i + 1 < captions.length; i++) captions[i].to = +Math.min(captions[i].to, captions[i + 1].from - 0.05).toFixed(3);

const sync = {
  add: { cue: CUE.add, take: +(tAdd + off).toFixed(3) },
  scan: { cue: CUE.scan, take: tScan === undefined ? null : +(tScan + off).toFixed(3) },
  approve: { cue: CUE.approve, take: tApprove === undefined ? null : +(tApprove + off).toFixed(3) },
};
const edl = {
  _note: `Generated by auto-edl.mjs from ${rel(takeDir)} (offset ${off.toFixed(3)} s: take t + offset = film t). Sync: ${Object.entries(sync).map(([k, s]) => `${k} ${s.take ?? '-'} vs ${s.cue}`).join(', ')}.`,
  output: { width: 1920, height: 1080, fps: 30, crf: 18, x264Preset: 'medium' },
  duration: CUE.duration,
  music: { file: CUE.file, gainDb: -20, duckDb: 8, duckAttackS: 0.25, duckReleaseS: 0.5, fadeOutS: 2 },
  loudness: { lufs: -14, truePeakDb: -1 },
  clips,
  ...(splits.length ? { splits } : {}),
  cards: [{ at: cardAt, dur: +(CUE.duration - cardAt).toFixed(3), lines: ["Developer's Blueprint", 'Productivity · hands only'] }],
  voice: voice.map(({ _clip, ...v }) => v),
  captions,
  stills: [
    { t: CUE.add + 0.5, what: 'ADD on the drop' },
    { t: CUE.scan + 0.5, what: 'SCAN as the beat returns' },
    { t: CUE.approve + 0.5, what: 'APPROVE on the final peak' },
  ],
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(edl, null, 2) + '\n');
const err = (s) => (s.take === null ? 'missing' : `${(s.take - s.cue >= 0 ? '+' : '')}${(s.take - s.cue).toFixed(2)} s`);
console.log(`wrote ${out}`);
console.log(`offset ${off.toFixed(2)} s; hook 0-${hookEnd.toFixed(1)}; take ${takeStart.toFixed(1)}-${clipOut.toFixed(1)} s of ${seg.duration.toFixed(1)}; card ${cardAt.toFixed(1)}-${CUE.duration}`);
console.log(`sync: ADD ${err(sync.add)}, SCAN ${err(sync.scan)}, APPROVE ${err(sync.approve)}; ${voice.length} voice lines, ${captions.length} captions`);
