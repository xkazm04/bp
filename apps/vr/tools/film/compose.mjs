#!/usr/bin/env node
// Film composer: renders the whole demo film from one edit-decision list (EDL).
//
//   node apps/vr/tools/film/compose.mjs <edl.json> [--preview] [--out <file>] [--stills] [--dry] [--keep]
//
// Pipeline (three ffmpeg runs, all driven from the EDL):
//   1. audio premaster: music bed (gain, ducked under every voice line by a computed volume envelope, faded out)
//      + voice lines at their timeline positions -> premaster.wav
//   2. loudnorm pass 1 on the premaster (measure)
//   3. picture: the video track is a concat of segments (black gaps, clips, cards), each cut to an exact frame
//      count, then the caption band (drawbox) and the ASS captions/card text (subtitles filter), muxed with the
//      premaster through loudnorm pass 2 (linear) -> H.264 high / yuv420p / AAC 192k / +faststart.
// Then an .srt next to the output, and with --stills one PNG per caption / card / clip midpoint plus a contact sheet.
// See README.md beside this file for the EDL format.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const DEFAULT_OUT = path.join(REPO, 'apps/vr/Saved/demo/out/film.mp4');

// ---------- args ----------
const argv = process.argv.slice(2);
const opts = { preview: false, stills: false, dry: false, keep: false, out: null, edl: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--preview') opts.preview = true;
  else if (a === '--stills') opts.stills = true;
  else if (a === '--dry') opts.dry = true;
  else if (a === '--keep') opts.keep = true;
  else if (a === '--out') opts.out = argv[++i];
  else if (a === '-h' || a === '--help') usage(0);
  else if (a.startsWith('--')) die(`unknown option ${a}`);
  else if (!opts.edl) opts.edl = a;
  else die(`unexpected argument ${a}`);
}
if (!opts.edl) usage(1);

function usage(code) {
  console.log('usage: node apps/vr/tools/film/compose.mjs <edl.json> [--preview] [--out <file>] [--stills] [--dry] [--keep]');
  process.exit(code);
}
function die(msg) {
  console.error(`compose: ${msg}`);
  process.exit(1);
}

// ---------- helpers ----------
const edlPath = path.resolve(opts.edl);
if (!fs.existsSync(edlPath)) die(`EDL not found: ${edlPath}`);
let edl;
try {
  edl = JSON.parse(fs.readFileSync(edlPath, 'utf8'));
} catch (e) {
  die(`EDL is not valid JSON: ${e.message}`);
}

function resolvePath(p) {
  if (path.isAbsolute(p)) return p;
  const fromRepo = path.join(REPO, p);
  if (fs.existsSync(fromRepo)) return fromRepo;
  const fromEdl = path.join(path.dirname(edlPath), p);
  if (fs.existsSync(fromEdl)) return fromEdl;
  return fromRepo;
}
const fwd = (p) => p.replace(/\\/g, '/');
const fmtT = (s) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};
const probeCache = new Map();
function probe(file) {
  if (probeCache.has(file)) return probeCache.get(file);
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) die(`ffprobe failed on ${file}: ${r.stderr.trim()}`);
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const info = { duration: Number(j.format?.duration), width: v?.width, height: v?.height, hasVideo: !!v, hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio') };
  probeCache.set(file, info);
  return info;
}
const num = (v, d) => (v === undefined || v === null ? d : Number(v));

// ---------- validate ----------
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const out = edl.output || {};
const W = opts.preview ? 960 : num(out.width, 1920);
const H = opts.preview ? 540 : num(out.height, 1080);
const FPS = num(out.fps, 30);
const D = Number(edl.duration);
if (!(D > 0)) err('"duration" must be a positive number of seconds');
if (!(FPS > 0)) err('"output.fps" must be positive');
const TOTAL_FRAMES = Math.round(D * FPS);
const fr = (t) => Math.round(t * FPS);

const PRESETS = new Set(['quest-left-eye', 'quest-left-eye-wide', 'quest-left-eye-tall', 'web', 'fit', 'fill']);
const BG = edl.style?.splitBg || '#0b1a2e';
const isQuest = (p) => typeof p === 'string' && p.startsWith('quest-left-eye');
const music = edl.music || null;
if (music) {
  music.path = resolvePath(music.file || '');
  if (!music.file || !fs.existsSync(music.path)) err(`music: file not found: ${music.file}`);
  else if (probe(music.path).duration + 0.05 < D) warn(`music is ${probe(music.path).duration.toFixed(2)} s, shorter than the film (${D} s); the end is silent`);
}

const clips = (edl.clips || []).map((c, i) => ({ ...c, kind: 'clip', idx: i, label: `clips[${i}]${c.name ? ` "${c.name}"` : ''}` }));
for (const c of clips) {
  if (typeof c.src !== 'string') { err(`${c.label}: "src" missing`); continue; }
  c.path = resolvePath(c.src);
  if (!fs.existsSync(c.path)) { err(`${c.label}: source not found: ${c.src}`); continue; }
  const p = probe(c.path);
  if (!p.hasVideo) { err(`${c.label}: source has no video stream: ${c.src}`); continue; }
  c.speed = num(c.speed, 1);
  c.in = num(c.in, 0);
  c.out = num(c.out, p.duration);
  c.preset = c.preset || 'fit';
  if (!PRESETS.has(c.preset)) err(`${c.label}: unknown preset "${c.preset}" (use ${[...PRESETS].join(', ')})`);
  if (!(c.speed > 0)) err(`${c.label}: speed must be > 0`);
  if (!(c.at >= 0)) err(`${c.label}: "at" must be >= 0`);
  if (!(c.out > c.in)) err(`${c.label}: out (${c.out}) must be after in (${c.in})`);
  if (c.in < 0) err(`${c.label}: in must be >= 0`);
  if (c.out > p.duration + 0.05) err(`${c.label}: out ${c.out} s is beyond the source's duration ${p.duration.toFixed(3)} s (${c.src})`);
  c.end = c.at + (c.out - c.in) / c.speed;
  c.src_w = p.width;
  c.src_h = p.height;
  if (isQuest(c.preset) && p.width / p.height < 1.5) warn(`${c.label}: preset ${c.preset} but source is ${p.width}x${p.height}, not side-by-side`);
}
const cards = (edl.cards || []).map((c, i) => ({ ...c, kind: 'card', idx: i, label: `cards[${i}]` }));
for (const c of cards) {
  if (!(c.at >= 0) || !(c.dur > 0)) err(`${c.label}: needs "at" >= 0 and "dur" > 0`);
  if (!Array.isArray(c.lines) || c.lines.length === 0) err(`${c.label}: "lines" must be a non-empty array of strings`);
  c.end = c.at + c.dur;
}
// splits: two sources side by side on the blueprint background
const TRANSITIONS = new Set(['left', 'right', 'fade', 'cut']);
const splits = (edl.splits || []).map((c, i) => ({ ...c, kind: 'split', idx: i, label: `splits[${i}]${c.name ? ` "${c.name}"` : ''}` }));
for (const sp of splits) {
  if (!(sp.at >= 0) || !(sp.dur > 0)) err(`${sp.label}: needs "at" >= 0 and "dur" > 0`);
  sp.end = sp.at + sp.dur;
  sp.transitionIn = sp.transitionIn || 'left';
  sp.transitionOut = sp.transitionOut || 'right';
  sp.transitionInS = sp.transitionIn === 'cut' ? 0 : num(sp.transitionInS, 0.6);
  sp.transitionOutS = sp.transitionOut === 'cut' ? 0 : num(sp.transitionOutS, 0.6);
  for (const k of ['transitionIn', 'transitionOut']) if (!TRANSITIONS.has(sp[k])) err(`${sp.label}: ${k} must be one of ${[...TRANSITIONS].join(', ')}`);
  if (sp.transitionInS + sp.transitionOutS > sp.dur) err(`${sp.label}: transitionInS + transitionOutS is longer than dur ${sp.dur}`);
  if (sp.labels !== undefined && !Array.isArray(sp.labels)) err(`${sp.label}: "labels" must be an array of two strings`);
  for (const side of ['left', 'right']) {
    const c = sp[side];
    const lab = `${sp.label}.${side}`;
    if (!c || typeof c.src !== 'string') { err(`${lab}: needs {src, in?, speed?, preset?}`); continue; }
    c.path = resolvePath(c.src);
    if (!fs.existsSync(c.path)) { err(`${lab}: source not found: ${c.src}`); continue; }
    const p = probe(c.path);
    if (!p.hasVideo) { err(`${lab}: source has no video stream`); continue; }
    c.speed = num(c.speed, 1);
    c.in = num(c.in, 0);
    c.preset = c.preset || (side === 'right' ? 'quest-left-eye-tall' : 'web');
    c.src_w = p.width; c.src_h = p.height;
    if (!PRESETS.has(c.preset)) err(`${lab}: unknown preset "${c.preset}"`);
    if (!(c.speed > 0)) err(`${lab}: speed must be > 0`);
    if (c.in < 0 || c.in >= p.duration) err(`${lab}: in ${c.in} s is outside the source (${p.duration.toFixed(3)} s)`);
    const need = c.in + sp.dur * c.speed;
    if (!c.loop && need > p.duration + 0.05) warn(`${lab}: source ends at ${p.duration.toFixed(2)} s but the split needs it to ${need.toFixed(2)} s; it holds the last frame (set "loop": true to loop)`);
  }
}
// the picture track: clips, cards and splits must not overlap
const track = [...clips, ...cards, ...splits].filter((s) => Number.isFinite(s.end)).sort((a, b) => a.at - b.at);
for (let i = 0; i < track.length; i++) {
  const s = track[i];
  if (s.end > D + 1e-6) err(`${s.label}: ends at ${s.end.toFixed(3)} s, beyond the film's duration ${D} s`);
  if (i > 0 && s.at < track[i - 1].end - 1e-6) err(`${s.label} (at ${s.at}) overlaps ${track[i - 1].label} (ends ${track[i - 1].end.toFixed(3)})`);
}

const voice = (edl.voice || []).map((v, i) => ({ ...v, idx: i, label: `voice[${i}]` }));
for (const v of voice) {
  v.path = resolvePath(v.file || '');
  if (!v.file || !fs.existsSync(v.path)) { err(`${v.label}: file not found: ${v.file}`); continue; }
  v.dur = probe(v.path).duration;
  v.gainDb = num(v.gainDb, 0) + num(edl.voiceGainDb, 0);
  if (!(v.at >= 0)) err(`${v.label}: "at" must be >= 0`);
  v.end = v.at + v.dur;
  if (v.end > D + 0.01) err(`${v.label}: ends at ${v.end.toFixed(3)} s, beyond the film's duration ${D} s`);
}
const vs = voice.filter((v) => Number.isFinite(v.end)).sort((a, b) => a.at - b.at);
for (let i = 1; i < vs.length; i++) if (vs[i].at < vs[i - 1].end) warn(`${vs[i].label} starts at ${vs[i].at} s while ${vs[i - 1].label} is still speaking (until ${vs[i - 1].end.toFixed(2)} s)`);

const captions = (edl.captions || []).map((c, i) => ({ ...c, idx: i, label: `captions[${i}]` }));
for (const c of captions) {
  if (!(c.to > c.from) || c.from < 0) err(`${c.label}: needs 0 <= from < to`);
  if (c.to > D + 1e-6) err(`${c.label}: ends at ${c.to} s, beyond the film's duration ${D} s`);
  if (!c.top && !c.bottom) err(`${c.label}: needs "top" and/or "bottom"`);
}
const cs = [...captions].sort((a, b) => a.from - b.from);
for (let i = 1; i < cs.length; i++) if (cs[i].from < cs[i - 1].to) warn(`${cs[i].label} overlaps ${cs[i - 1].label}; they will stack`);

for (const w of warnings) console.warn(`compose: warning: ${w}`);
if (errors.length) {
  console.error(`compose: the EDL has ${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// ---------- paths ----------
const outPath = path.resolve(opts.out || (opts.preview ? DEFAULT_OUT.replace(/\.mp4$/, '.preview.mp4') : DEFAULT_OUT));
const outDir = path.dirname(outPath);
const base = path.basename(outPath, path.extname(outPath));
const work = path.join(outDir, `.${base}.work`);
fs.mkdirSync(work, { recursive: true });

// ---------- ASS (captions + card text) ----------
const style = Object.assign({ font: 'Segoe UI', topSize: 58, bottomSize: 46, cardSize: 92, cardSubSize: 48, bottomColour: '#FFC98A', band: 0.55 }, edl.style || {});
const assColour = (hex, alpha = 0) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase();
};
const assT = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), sec = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};
const assEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N');
// layout in a fixed 1920x1080 space; libass scales it to the render size
const BAND_H = 0.205; // of the frame height
const assLines = [
  '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  `Style: Top,${style.font},${style.topSize},&H00FFFFFF,&H00FFFFFF,&H80000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,120,120,${Math.round(1080 * BAND_H) - style.topSize - 34},1`,
  `Style: Glim,${style.font},${style.bottomSize},${assColour(style.bottomColour)},&H00FFFFFF,&H80000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,120,120,36,1`,
  `Style: Card,${style.font},${style.cardSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,5,120,120,0,1`,
  `Style: CardSub,${style.font},${style.cardSubSize},&H00C8C8C8,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,0,0,5,120,120,0,1`,
  '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
];
for (const c of captions) {
  if (c.top) assLines.push(`Dialogue: 1,${assT(c.from)},${assT(c.to)},Top,,0,0,0,,${assEsc(c.top)}`);
  if (c.bottom) assLines.push(`Dialogue: 1,${assT(c.from)},${assT(c.to)},Glim,,0,0,0,,${assEsc(c.bottom)}`);
}
for (const c of cards) {
  const fadeMs = Math.round(num(c.textFadeS, 0.4) * 1000);
  const n = c.lines.length;
  c.lines.forEach((line, k) => {
    // first line large, the rest smaller, stacked around the centre
    const isMain = k === 0;
    const y = n === 1 ? 540 : isMain ? 500 : 500 + 100 + (k - 1) * 66;
    assLines.push(`Dialogue: 2,${assT(c.at)},${assT(c.end)},${isMain ? 'Card' : 'CardSub'},,0,0,0,,{\\pos(960,${Math.round(y)})\\fad(${fadeMs},${fadeMs})}${assEsc(line)}`);
  });
}
const assFile = path.join(work, 'captions.ass');
fs.writeFileSync(assFile, '\ufeff' + assLines.join('\r\n') + '\r\n', 'utf8');

// ---------- SRT ----------
const srtT = (s) => assT(s).replace(/^(\d):/, '0$1:').replace('.', ',') + '0';
const srt = cs.map((c, i) => `${i + 1}\r\n${srtT(c.from)} --> ${srtT(c.to)}\r\n${[c.top, c.bottom].filter(Boolean).join('\r\n')}\r\n`).join('\r\n');
const srtPath = path.join(outDir, `${base}.srt`);

// ---------- audio graph ----------
const aIn = [];
const aF = [];
let ai = 0;
const mixLabels = [];
if (music) {
  aIn.push('-i', music.path);
  const fadeOut = num(music.fadeOutS, 2);
  const duck = num(music.duckDb, 8);
  const att = num(music.duckAttackS, 0.25), rel = num(music.duckReleaseS, 0.5);
  // ramp per voice window, 0..1; the bed is lowered by duck dB times the max ramp
  const ramps = vs.map((v) => `clip((t-${(v.at - att).toFixed(3)})/${att},0,1)*clip((${(v.end + rel).toFixed(3)}-t)/${rel},0,1)`);
  const env = ramps.length ? ramps.reduce((acc, r) => (acc ? `max(${acc},${r})` : r), '') : '0';
  aF.push(`[${ai}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${D},asetpts=PTS-STARTPTS,` +
    `volume=${num(music.gainDb, -20)}dB,volume='pow(10,-${duck}*(${env})/20)':eval=frame,` +
    (num(music.fadeInS, 0) > 0 ? `afade=t=in:d=${num(music.fadeInS, 0)},` : '') + `afade=t=out:st=${Math.max(0, D - fadeOut)}:d=${fadeOut}[mus]`);
  mixLabels.push('[mus]');
  ai++;
}
for (const v of vs) {
  aIn.push('-i', v.path);
  const ms = Math.round(v.at * 1000);
  aF.push(`[${ai}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${v.gainDb}dB,adelay=${ms}:all=1[v${ai}]`);
  mixLabels.push(`[v${ai}]`);
  ai++;
}
let aGraph;
if (mixLabels.length === 0) aGraph = `anullsrc=r=48000:cl=stereo,atrim=0:${D}[aout]`;
else aGraph = aF.join(';\n') + `;\n${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0:duration=longest,apad,atrim=0:${D},asetpts=PTS-STARTPTS[aout]`;
const premaster = path.join(work, 'premaster.wav');
const aGraphFile = path.join(work, 'audio.graph');
fs.writeFileSync(aGraphFile, aGraph);
const audioCmd = ['-hide_banner', '-y', ...aIn, '-/filter_complex', aGraphFile, '-map', '[aout]', '-c:a', 'pcm_f32le', '-ar', '48000', premaster];

// ---------- video graph ----------
const vIn = [];
const vF = [];
const segs = [];
let vi = 0;
let cursorF = 0;
let needLabelFont = false;
const gap = (n) => {
  if (n <= 0) return;
  const l = `g${segs.length}`;
  vF.push(`color=c=black:s=${W}x${H}:r=${FPS},format=yuv420p,trim=end_frame=${n},setpts=PTS-STARTPTS[${l}]`);
  segs.push(`[${l}]`);
};
// the source region a preset takes (null = the whole frame)
function cropRect(c) {
  if (isQuest(c.preset)) {
    const eyeW = Math.floor(c.src_w / 2);
    const regionH = c.preset === 'quest-left-eye' ? (eyeW * 9) / 16 : ((c.preset === 'quest-left-eye-wide' ? 1200 : 1600) * eyeW) / 1832;
    let cw = eyeW, ch = Math.round(regionH);
    if (ch > c.src_h) ch = c.src_h;
    let x = Math.floor((eyeW - cw) / 2), y = Math.floor((c.src_h - ch) / 2) + num(c.cropYOffset, 0);
    if (c.crop) ({ x = x, y = y, w: cw = cw, h: ch = ch } = c.crop);
    y = Math.max(0, Math.min(c.src_h - ch, y));
    cw -= cw % 2; ch -= ch % 2;
    return { cw, ch, x, y };
  }
  if (c.crop) return { cw: c.crop.w, ch: c.crop.h, x: c.crop.x ?? 0, y: c.crop.y ?? 0 };
  return null;
}
const aspectOf = (c) => { const r = cropRect(c); return r ? r.cw / r.ch : c.src_w / c.src_h; };
const hex = (col) => col.replace('#', '0x');
// crop + scale into a bw x bh box; anything that is not the box's shape is fitted and padded (navy for the headset presets)
function geometry(c, bw = W, bh = H, padCol = isQuest(c.preset) ? BG : 'black') {
  const r = cropRect(c);
  const pre = r ? `crop=${r.cw}:${r.ch}:${r.x}:${r.y},` : '';
  if (c.preset === 'fill') return `${pre}scale=${bw}:${bh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${bw}:${bh},setsar=1`;
  return `${pre}scale=${bw}:${bh}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${bw}:${bh}:(ow-iw)/2:(oh-ih)/2:${hex(padCol)},setsar=1`;
}
const even = (x) => Math.max(2, 2 * Math.round(x / 2));
// split layout in output pixels: both panels the same height, labels above, the caption band kept clear
function splitLayout(sp) {
  const k = W / 1920;
  const margin = 48 * k, gutter = 32 * k, top = 36 * k, labelH = 44 * k;
  const bottom = Math.max(170 * k, BAND_H * H + 8 * k);
  const aL = num(sp.left.aspect, aspectOf(sp.left)), aR = num(sp.right.aspect, aspectOf(sp.right));
  const availW = W - 2 * margin - gutter, availH = H - bottom - top - labelH;
  const h = even(Math.min(availH, availW / (aL + aR)));
  const wL = even(h * aL), wR = even(h * aR);
  const x0 = Math.round((W - (wL + gutter + wR)) / 2);
  const y = Math.round(top + labelH + (availH - h) / 2);
  return { k, h, L: { x: x0, y, w: wL, h }, R: { x: Math.round(x0 + wL + gutter), y, w: wR, h } };
}
for (const s of track) {
  const a = fr(s.at), b = Math.min(TOTAL_FRAMES, fr(s.end));
  gap(a - cursorF);
  const n = b - Math.max(a, cursorF);
  if (n <= 0) continue;
  const l = `s${segs.length}`;
  const segDur = n / FPS;
  const fadeIn = num(s.fadeInS, 0), fadeOut = num(s.fadeOutS, 0);
  const fades = (fadeIn > 0 ? `,fade=t=in:st=0:d=${fadeIn}` : '') + (fadeOut > 0 ? `,fade=t=out:st=${Math.max(0, segDur - fadeOut).toFixed(3)}:d=${fadeOut}` : '');
  if (s.kind === 'clip') {
    vIn.push('-ss', s.in.toFixed(3), '-t', (s.out - s.in).toFixed(3), '-i', s.path);
    vF.push(`[${vi}:v]setpts=(PTS-STARTPTS)/${s.speed},fps=${FPS},${geometry(s)},format=yuv420p,` +
      `tpad=stop_mode=clone:stop_duration=2,trim=end_frame=${n},setpts=PTS-STARTPTS${fades}[${l}]`);
    vi++;
  } else if (s.kind === 'split') {
    const Lay = splitLayout(s);
    const k = Lay.k;
    const sideLabels = [];
    for (const [side, P] of [['left', Lay.L], ['right', Lay.R]]) {
      const c = s[side];
      if (c.loop) vIn.push('-stream_loop', '-1');
      vIn.push('-ss', c.in.toFixed(3), '-t', (s.dur * c.speed + 0.5).toFixed(3), '-i', c.path);
      const sl = `${l}${side[0]}`;
      vF.push(`[${vi}:v]setpts=(PTS-STARTPTS)/${c.speed},fps=${FPS},${geometry(c, P.w, P.h, BG)},format=yuv420p,` +
        `tpad=stop_mode=clone:stop_duration=${Math.ceil(s.dur + 2)},trim=end_frame=${n},setpts=PTS-STARTPTS[${sl}]`);
      sideLabels.push(`[${sl}]`);
      vi++;
    }
    const lw = Math.max(1, Math.round(2 * k));
    const frame = (P) => `drawbox=x=${P.x - lw}:y=${P.y - lw}:w=${P.w + 2 * lw}:h=${P.h + 2 * lw}:color=0xcfe8ff@0.85:t=${lw}`;
    const labels = s.labels || ['On the web', 'In the headset'];
    const texts = [];
    [Lay.L, Lay.R].forEach((P, j) => {
      if (!labels[j]) return;
      const tf = `${l}_label${j}.txt`;
      fs.writeFileSync(path.join(work, tf), String(labels[j]).toUpperCase().split('').join('\u2009'), 'utf8');
      texts.push(`drawtext=fontfile=label.ttf:textfile=${tf}:fontsize=${Math.round(24 * k)}:fontcolor=0x9fe8ff:x=${P.x}:y=${P.y - Math.round(12 * k)}-th`);
    });
    let chain = `color=c=${hex(BG)}:s=${W}x${H}:r=${FPS},format=yuv420p,trim=end_frame=${n},setpts=PTS-STARTPTS,` +
      `drawgrid=w=${Math.round(40 * k)}:h=${Math.round(40 * k)}:t=1:c=0x6fa8dc@0.10[${l}bg];` +
      `[${l}bg]${sideLabels[0]}overlay=${Lay.L.x}:${Lay.L.y}:shortest=1[${l}o1];[${l}o1]${sideLabels[1]}overlay=${Lay.R.x}:${Lay.R.y}:shortest=1,` +
      [frame(Lay.L), frame(Lay.R), ...texts].join(',');
    // the camera: a zoom from one panel (filling the frame) out to the layout, and back into a panel at the end
    const fi = Math.round(s.transitionInS * FPS), fo = Math.round(s.transitionOutS * FPS);
    const fillRect = (P) => { const rw = P.w / P.h >= W / H ? P.w : (P.h * W) / H; return { rw, cx: P.x + P.w / 2, cy: P.y + P.h / 2 }; };
    const ease = (u) => `(${u})*(${u})*(3-2*(${u}))`;
    const terms = [];
    if ((s.transitionIn === 'left' || s.transitionIn === 'right') && fi > 0) terms.push({ r: fillRect(s.transitionIn === 'left' ? Lay.L : Lay.R), e: `(1-${ease(`clip(on/${fi},0,1)`)})` });
    if ((s.transitionOut === 'left' || s.transitionOut === 'right') && fo > 0) terms.push({ r: fillRect(s.transitionOut === 'left' ? Lay.L : Lay.R), e: ease(`clip((on-${n - 1 - fo})/${fo},0,1)`) });
    if (terms.length) {
      const lerp = (base, key) => base + terms.map((t) => `+(${(t.r[key] - base).toFixed(2)})*${t.e}`).join('');
      const rw = `(${lerp(W, 'rw')})`, cx = `(${lerp(W / 2, 'cx')})`, cy = `(${lerp(H / 2, 'cy')})`;
      chain += `,zoompan=z='${W}/${rw}':x='clip(${cx}-iw/zoom/2,0,iw-iw/zoom)':y='clip(${cy}-ih/zoom/2,0,ih-ih/zoom)':d=1:s=${W}x${H}:fps=${FPS},setsar=1`;
    }
    if (s.transitionIn === 'fade' && fi > 0) chain += `,fade=t=in:st=0:d=${s.transitionInS}`;
    if (s.transitionOut === 'fade' && fo > 0) chain += `,fade=t=out:st=${Math.max(0, segDur - s.transitionOutS).toFixed(3)}:d=${s.transitionOutS}`;
    vF.push(`${chain},format=yuv420p,trim=end_frame=${n},setpts=PTS-STARTPTS${fades}[${l}]`);
    needLabelFont = true;
  } else {
    const col = (s.colour || s.color || 'black').replace('#', '0x');
    vF.push(`color=c=${col}:s=${W}x${H}:r=${FPS},format=yuv420p,trim=end_frame=${n},setpts=PTS-STARTPTS${fades}[${l}]`);
  }
  segs.push(`[${l}]`);
  cursorF = Math.max(a, cursorF) + n;
}
gap(TOTAL_FRAMES - cursorF);
if (needLabelFont) {
  const want = path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', style.labelFontFile || 'segoeuib.ttf');
  if (!fs.existsSync(want)) die(`label font not found: ${want} (set style.labelFontFile)`);
  fs.copyFileSync(want, path.join(work, 'label.ttf'));
}

const bandEnable = captions.length ? captions.map((c) => `between(t,${c.from},${c.to})`).join('+') : '0';
const fontsdir = fwd(path.join(process.env.WINDIR || 'C:/Windows', 'Fonts')).replace(/:/g, '\\:');
vF.push(`${segs.join('')}concat=n=${segs.length}:v=1:a=0,` +
  (captions.length ? `drawbox=x=0:y=ih*${1 - BAND_H}:w=iw:h=ih*${BAND_H}:color=black@${style.band}:t=fill:enable='${bandEnable}',` : '') +
  `subtitles=filename=captions.ass:fontsdir='${fontsdir}',format=yuv420p[vout]`);
const vGraphFile = path.join(work, 'video.graph');
fs.writeFileSync(vGraphFile, vF.join(';\n'));

const enc = opts.preview
  ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-profile:v', 'high', '-pix_fmt', 'yuv420p']
  : ['-c:v', 'libx264', '-preset', out.x264Preset || 'medium', '-crf', String(num(out.crf, 18)), '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
const LUFS = num(edl.loudness?.lufs, -14), TP = num(edl.loudness?.truePeakDb, -1), LRA = num(edl.loudness?.lra, 20);
const ln = (extra) => `loudnorm=I=${LUFS}:TP=${TP}:LRA=${LRA}${extra}`;
const measureCmd = ['-hide_banner', '-nostats', '-i', premaster, '-af', ln(':print_format=json'), '-f', 'null', '-'];
const videoCmd = (af) => ['-hide_banner', '-y', ...vIn, '-i', premaster, '-/filter_complex', vGraphFile, '-map', '[vout]', '-map', `${vi}:a`,
  '-af', af, '-ar', '48000', ...enc, '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-t', String(D), '-movflags', '+faststart', outPath];

const show = (args) => 'ffmpeg ' + args.map((x) => (/[\s'"|;&()<>*]/.test(x) ? `"${x}"` : x)).join(' ');

console.log(`compose: ${fmtT(D)} film, ${W}x${H}@${FPS}, ${clips.length} clip(s), ${splits.length} split(s), ${cards.length} card(s), ${vs.length} voice line(s), ${captions.length} caption(s)`);
console.log(`compose: work dir ${work}`);
if (opts.dry) {
  console.log('\n# 1. audio premaster (graph in audio.graph)\n' + show(audioCmd));
  console.log('\n# 2. loudness measure\n' + show(measureCmd));
  console.log('\n# 3. picture + mux (cwd = work dir; graph in video.graph; loudnorm takes the measured values)\n' + show(videoCmd(ln(':measured_I=<I>:measured_TP=<TP>:measured_LRA=<LRA>:measured_thresh=<thresh>:offset=<offset>:linear=true'))));
  console.log('\n# audio.graph\n' + aGraph + '\n\n# video.graph\n' + vF.join(';\n'));
  process.exit(0);
}

function run(args, label, capture = false) {
  const t0 = Date.now();
  process.stdout.write(`compose: ${label}... `);
  const r = spawnSync('ffmpeg', ['-loglevel', capture ? 'info' : 'error', ...args], { cwd: work, encoding: 'utf8', stdio: capture ? 'pipe' : ['ignore', 'inherit', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.log('FAILED');
    console.error((r.stderr || '').split('\n').slice(-30).join('\n'));
    console.error(`compose: command was:\n${show(args)}`);
    process.exit(1);
  }
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return r.stderr || '';
}

const t0 = Date.now();
run(audioCmd, 'audio premaster');
const m = run(measureCmd, 'loudness measure', true);
const js = m.slice(m.lastIndexOf('{'), m.lastIndexOf('}') + 1);
let meas;
try { meas = JSON.parse(js); } catch { die('could not parse loudnorm measurement'); }
const finite = (x) => Number.isFinite(Number(x));
const af = finite(meas.input_i) && Number(meas.input_i) > -70
  ? ln(`:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true`) + ',aresample=48000'
  : 'anull';
console.log(`compose: premaster ${meas.input_i} LUFS, TP ${meas.input_tp} dBTP -> target ${LUFS} LUFS, ${TP} dBTP`);
run(videoCmd(af), `picture + mux -> ${outPath}`);
fs.writeFileSync(srtPath, '\ufeff' + srt, 'utf8');
console.log(`compose: wrote ${srtPath}`);

// ---------- stills ----------
if (opts.stills) {
  const sdir = path.join(outDir, `${base}.stills`);
  fs.rmSync(sdir, { recursive: true, force: true });
  fs.mkdirSync(sdir, { recursive: true });
  const marks = [];
  for (const c of captions) marks.push({ t: (c.from + c.to) / 2, what: `caption ${c.idx}: ${c.top || c.bottom}` });
  for (const c of cards) marks.push({ t: c.at + c.dur / 2, what: `card ${c.idx}: ${c.lines[0]}` });
  for (const c of clips) marks.push({ t: (c.at + c.end) / 2, what: `clip ${c.idx}${c.name ? ` ${c.name}` : ''}` });
  for (const c of splits) {
    marks.push({ t: c.at + c.dur / 2, what: `split ${c.idx}` });
    if (c.transitionInS > 0) marks.push({ t: c.at + c.transitionInS / 2, what: `split ${c.idx} transition in (mid)` });
    if (c.transitionOutS > 0) marks.push({ t: c.end - c.transitionOutS / 2, what: `split ${c.idx} transition out (mid)` });
  }
  for (const s of edl.stills || []) marks.push({ t: Number(s.t ?? s), what: s.what || 'extra' });
  marks.sort((a, b) => a.t - b.t);
  const uniq = marks.filter((mk, i) => i === 0 || Math.abs(mk.t - marks[i - 1].t) > 0.25);
  const index = [];
  uniq.forEach((mk, i) => {
    const name = `still_${String(i + 1).padStart(3, '0')}.png`;
    run(['-hide_banner', '-y', '-ss', mk.t.toFixed(3), '-i', outPath, '-frames:v', '1', path.join(sdir, name)], `still ${name} @ ${fmtT(mk.t)}`);
    index.push(`${name}\t${fmtT(mk.t)}\t${mk.what}`);
  });
  fs.writeFileSync(path.join(sdir, 'index.tsv'), index.join('\n') + '\n');
  const cols = 4, rows = Math.ceil(uniq.length / cols);
  run(['-hide_banner', '-y', '-i', path.join(sdir, 'still_%03d.png'), '-vf', `scale=480:-2,pad=iw+8:ih+8:4:4:0x202020,tile=${cols}x${rows}:color=0x202020`, '-frames:v', '1', path.join(sdir, 'contact.png')], 'contact sheet');
  console.log(`compose: stills in ${sdir} (index.tsv, contact.png)`);
}
if (!opts.keep) fs.rmSync(work, { recursive: true, force: true });
console.log(`compose: done in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${outPath}`);
