// Checks the lamp's tour (apps/vr/Source/bp/BpTour.cpp, its book BpTourBook.cpp; standalone-plan.md S6, wave T1) against
// its bundled voice (apps/vr/tools/tour-voice.ts -> apps/vr/Content/BpData/voice/tour/). Pins:
//   - the book: every core step and chapter step has a line, every line a clip, and no clip is an orphan; ids are unique and
//     none is an index; no line runs over BpTourBook::MaxWords words; the lines BpTour.cpp says by id exist;
//   - the chapters name console pages that exist (BpConsole.cpp's page registry, or the two pages SETTINGS opens), and the
//     owner's five (talk, morning, room, pc, text) are there;
//   - the cold start reads FBpStore (the first tour starts by itself only when Core was never written, or to resume At): a
//     control that fails if the rule goes back to "every launch";
//   - each clip is a 16-bit mono PCM WAV at 24 kHz (the live `say` route's rate: one voice, check:voice-link) that BpTour.cpp's
//     ReadWav accepts, 0.5 s to 8 s, and lines.json records today's text and the say route's effect chain (no extra stage);
//   - wave C1, the scan theatre's lines (BpTourBook.cpp's ScanLines -> voice/scan/): the same pins, every clip id
//     BpScanTheatre.cpp names is a line, the sample's result lines read their counts in words;
//   - the music bed (apps/vr/tools/music-bed.ts -> Content/BpData/music/bed.wav) is a 16-bit stereo PCM WAV, 120-150 s,
//     and bed.json agrees with it, records a quiet bed near its loudness target and a seam with no click.
// Run: node --import @bp/core/register scripts/check-vr-tour.ts. Exit 1 on any failure. Reads files only; no network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOUR_LINES, SCAN_LINES, SCAN_CLIPS, NARRATE_LINES, NARRATE_CLIPS } from '../apps/vr/tools/tour-voice.ts';
import { TOUR_LINK } from '../packages/core/src/server/companion/voice-link.server.ts';
import { MUSIC_CHANNELS, MUSIC_INDEX, MUSIC_LOUDNESS, MUSIC_RATE, MUSIC_WAV } from '../apps/vr/tools/music-bed.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'apps/vr/Source/bp');
const CLIPS = path.join(ROOT, 'apps/vr/Content/BpData/voice/tour');

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const tour = fs.readFileSync(path.join(SRC, 'BpTour.cpp'), 'utf8');
const book = fs.readFileSync(path.join(SRC, 'BpTourBook.cpp'), 'utf8');
const bookH = fs.readFileSync(path.join(SRC, 'BpTourBook.h'), 'utf8');
const consoleSrc = fs.readFileSync(path.join(SRC, 'BpConsole.cpp'), 'utf8');

// ---- The book ----
const lineIds = Object.keys(TOUR_LINES);
check('the book has its lines', lineIds.length >= 12, `${lineIds.length}`);
const coreBlock = /const TArray<const TCHAR\*>& Core\(\)[\s\S]*?=\s*\{([\s\S]*?)\};/.exec(book);
const core = coreBlock ? [...coreBlock[1].matchAll(/TEXT\("([^"]+)"\)/g)].map((m) => m[1]) : [];
check('the core tour has its steps (ten or fewer, welcome first, hand-off last)', core.length >= 6 && core.length <= 10 && core[0] === 'welcome' && core[core.length - 1] === 'hand-off', core.join(', '));
const chapterBlock = /const TArray<FChapter>& Chapters\(\)[\s\S]*?return All;/.exec(book)?.[0] ?? '';
const chapters = [...chapterBlock.matchAll(/\{\s*TEXT\("([^"]+)"\),\s*TEXT\("([^"]+)"\),\s*TEXT\("([^"]+)"\),\s*TEXT\("[^"]*"\),\s*(\d+),\s*\{([^}]*)\}\s*\}/g)]
  .map((m) => ({ id: m[1], title: m[2], page: m[3], seconds: Number(m[4]), steps: [...m[5].matchAll(/TEXT\("([^"]+)"\)/g)].map((x) => x[1]) }));
check('the book has its chapters', chapters.length >= 5, `${chapters.length}`);
for (const c of chapters) {
  check(`chapter ${c.id} has two to four steps`, c.steps.length >= 2 && c.steps.length <= 4, `${c.steps.length}`);
  check(`chapter ${c.id} runs 20 to 30 s`, c.seconds >= 20 && c.seconds <= 30, `${c.seconds}`);
}
const stepIds = [...core, ...chapters.flatMap((c) => c.steps)];
const isIndex = (id: string) => /^\d+$/.test(id) || /^(step|chapter|line|s|c)[-_]?\d+$/i.test(id);
const unique = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
check('step ids are unique', unique(stepIds).length === 0, unique(stepIds).join(', '));
check('chapter ids are unique', unique(chapters.map((c) => c.id)).length === 0);
check('line ids are unique', unique([...book.matchAll(/\{\s*TEXT\("([^"]+)"\),\s*TEXT\("[^"]*"\)\s*\}/g)].map((m) => m[1])).length === 0);
for (const id of [...stepIds, ...chapters.map((c) => c.id), ...lineIds]) check(`${id} is a minted name, not an index`, !isIndex(id) && /^[a-z][a-z-]*[a-z]$/.test(id));
for (const s of stepIds) check(`step ${s} has a line`, typeof TOUR_LINES[s] === 'string' && TOUR_LINES[s].length > 0);
// The variants BpTour.cpp says by id (a degraded step, the beat after MENU) are lines too, and every line is said.
const said = new Set([...tour.matchAll(/(?:LineId|TourLineId) = TEXT\("([^"]+)"\)/g)].map((m) => m[1]));
for (const s of said) check(`BpTour.cpp says ${s}, a line of the book`, s in TOUR_LINES);
check('the lamp says "shown" when it does a step', /SpeakTour\(TEXT\("shown"\)\)/.test(tour));
for (const s of lineIds) check(`line ${s} is said by a step or BpTour.cpp`, stepIds.includes(s) || said.has(s) || s === 'shown');
const maxWords = Number(/constexpr int32 MaxWords = (\d+);/.exec(bookH)?.[1] ?? 0);
check('the book sets a word limit', maxWords > 0 && maxWords <= 14, `${maxWords}`);
for (const [s, text] of Object.entries(TOUR_LINES)) check(`line ${s} is ${maxWords} words or fewer`, text.split(/\s+/).filter(Boolean).length <= maxWords, `${text.split(/\s+/).length}: ${text}`);
check('the book has a content version', /constexpr int32 Version = \d+;/.test(bookH));

// ---- The chapters and the console's pages ----
const registry = /static const TArray<FBpConsolePage>& Registry\(\)[\s\S]*?return Pages;/.exec(consoleSrc)?.[0] ?? '';
const registryKeys = [...registry.matchAll(/\{\s*TEXT\("([a-z]+)"\),\s*TEXT\("/g)].map((m) => m[1]);
const findBlock = /static const FBpConsolePage\* Find\(const FString& Key\)[\s\S]*?return Registry\(\)/.exec(consoleSrc)?.[0] ?? '';
const specialKeys = [...findBlock.matchAll(/static const FBpConsolePage \w+ = \{\s*TEXT\("([a-z]+)"\)/g)].map((m) => m[1]);
check('BpConsole.cpp has its page registry', registryKeys.length >= 8, registryKeys.join(', '));
check('the TOUR page is in the registry (a MENU tile)', registryKeys.includes('tour'));
for (const c of chapters) check(`chapter ${c.id} names a console page that exists (${c.page})`, registryKeys.includes(c.page) || specialKeys.includes(c.page));
for (const owner of ['talk', 'morning', 'room', 'pc', 'text']) check(`the owner's chapter ${owner} exists`, chapters.some((c) => c.id === owner));
check('the TOUR page orders the chapters by the registry', /MenuOrder\(A\.Page\) < MenuOrder\(B\.Page\)/.test(consoleSrc));

// ---- The cold start reads the store ----
const cold = /FString ABpTable::TourColdStart\(\)[\s\S]*?\r?\n\}/.exec(tour)?.[0] ?? '';
check('the cold start reads Core from FBpStore', /FBpStore::GetString\(GTourSection, TEXT\("Core"\)/.test(cold));
check('a written Core stops the cold start', /if \(!Core\.IsEmpty\(\)\)[\s\S]{0,240}return FString\(\);/.test(cold));
check('the cold start resumes At of this version', /TEXT\("At"\)/.test(cold) && /BpTourBook::Version/.test(cold));
check('the tick starts the first tour only through the cold-start rule', /const FString From = TourColdStart\(\);\s*if \(!From\.IsEmpty\(\)\) StartTour\(From\);/.test(tour)
  && !/bCold\s*=\s*!bTourPlayed/.test(tour));
check('progress is written as each core step begins', /SetString\(GTourSection, TEXT\("At"\)/.test(tour));
check('done and dismissed are both recorded', /TEXT\("done"\) : TEXT\("dismissed"\)/.test(tour));
check('the store section is the brief\'s', /\/Script\/bp\.BpTour/.test(tour));

// ---- The clips ----
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
for (const s of lineIds) {
  const file = path.join(CLIPS, `${s}.wav`);
  if (!fs.existsSync(file)) { check(`clip ${s}.wav exists`, false, 'run node apps/vr/tools/tour-voice.ts'); continue; }
  const w = wav(file);
  check(`clip ${s}.wav is PCM`, !!w);
  if (!w) continue;
  check(`clip ${s}.wav is 16-bit mono`, w.bits === 16 && w.channels === 1, `${w.bits}-bit, ${w.channels} ch`);
  check(`clip ${s}.wav is 0.5-8 s`, w.seconds >= 0.5 && w.seconds <= 8, `${w.seconds.toFixed(2)} s`);
  check(`clip ${s}.wav is at the say route's rate`, w.rate === TOUR_LINK.rate, `${w.rate} Hz`);
}
for (const f of fs.readdirSync(CLIPS).filter((f) => f.endsWith('.wav'))) check(`clip ${f} has a line (no orphan)`, f.slice(0, -4) in TOUR_LINES);
const index = path.join(CLIPS, 'lines.json');
const recordedIndex = fs.existsSync(index) ? JSON.parse(fs.readFileSync(index, 'utf8')) : {};
const recorded = recordedIndex.lines ?? {};
for (const [s, text] of Object.entries(TOUR_LINES)) check(`${s}.wav was read from today's line`, recorded[s] === text, 're-run node apps/vr/tools/tour-voice.ts');
check('the clips were levelled to the loudness target', recordedIndex.voice?.loudness?.targetLufs === -14 && recordedIndex.voice?.loudness?.ceilingDb === -1);
check('the clips were rendered through the say route\'s chain, nothing more', recordedIndex.voice?.fx === TOUR_LINK.fx && recordedIndex.voice?.rate === TOUR_LINK.rate, `${recordedIndex.voice?.fx} @ ${recordedIndex.voice?.rate}`);

// ---- The scan theatre's lines (wave C1) ----
const theatre = fs.readFileSync(path.join(SRC, 'BpScanTheatre.cpp'), 'utf8');
const scanIds = Object.keys(SCAN_LINES);
check('the scan book has its lines', scanIds.length >= 6, `${scanIds.length}`);
for (const id of ['scan-start-everything', 'scan-start-wing', 'scan-start-room', 'scan-start-place', 'scan-done', 'scan-stopped']) {
  check(`the scan book has ${id}`, id in SCAN_LINES);
  check(`BpScanTheatre.cpp names ${id}`, theatre.includes(`"${id}"`));
}
check('BpScanTheatre.cpp builds the result clip id from the counts', /scan-done-%s-%s/.test(theatre));
check('scan ids are not also tour ids', scanIds.every((id) => !(id in TOUR_LINES)));
const words = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
for (const [id, text] of Object.entries(SCAN_LINES)) {
  check(`scan line ${id} is a minted name`, /^[a-z][a-z-]*[a-z]$/.test(id));
  const m = /^scan-done-([a-z]+)-([a-z]+)$/.exec(id);
  if (!m) continue;
  const rooms = words.indexOf(m[1]), found = words.indexOf(m[2]);
  const say = (n: number) => words[n][0].toUpperCase() + words[n].slice(1);
  const want = `Done. ${say(rooms)} ${rooms === 1 ? 'room' : 'rooms'} read, ${found === 0 ? 'nothing new' : `${words[found]} new ${found === 1 ? 'finding' : 'findings'}`}.`;
  check(`scan line ${id} says its counts`, rooms > 0 && found >= 0 && text === want, `${text} (want ${want})`);
}
if (!fs.existsSync(SCAN_CLIPS)) check('voice/scan exists', false, 'run node apps/vr/tools/tour-voice.ts --scan');
else {
  for (const id of scanIds) {
    const file = path.join(SCAN_CLIPS, `${id}.wav`);
    if (!fs.existsSync(file)) { check(`scan clip ${id}.wav exists`, false, 'run node apps/vr/tools/tour-voice.ts --scan'); continue; }
    const w = wav(file);
    check(`scan clip ${id}.wav is 16-bit mono at the say route's rate, 0.5-8 s`, !!w && w.bits === 16 && w.channels === 1 && w.rate === TOUR_LINK.rate && w.seconds >= 0.5 && w.seconds <= 8,
      w ? `${w.bits}-bit ${w.channels} ch ${w.rate} Hz ${w.seconds.toFixed(2)} s` : 'not PCM');
  }
  for (const f of fs.readdirSync(SCAN_CLIPS).filter((f) => f.endsWith('.wav'))) check(`scan clip ${f} has a line (no orphan)`, f.slice(0, -4) in SCAN_LINES);
  const scanIndexFile = path.join(SCAN_CLIPS, 'lines.json');
  const scanIndex = fs.existsSync(scanIndexFile) ? JSON.parse(fs.readFileSync(scanIndexFile, 'utf8')) : {};
  for (const [id, text] of Object.entries(SCAN_LINES)) check(`${id}.wav was read from today's line`, scanIndex.lines?.[id] === text, 're-run node apps/vr/tools/tour-voice.ts --scan');
  check('the scan clips share the tour clips\' voice record', JSON.stringify(scanIndex.voice) === JSON.stringify(recordedIndex.voice));
}

// ---- Every step narrated (wave N3-W3: BpTourBook.cpp's NarrateLines -> voice/narrate/, played by BpNarrate.cpp) ----
{
  const narrateSrc = fs.readFileSync(path.join(SRC, 'BpNarrate.cpp'), 'utf8');
  const allSrc = fs.readdirSync(SRC).filter((f) => f.endsWith('.cpp')).map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  const ids = Object.keys(NARRATE_LINES);
  check('the narration book has its lines', ids.length >= 40, `${ids.length}`);
  for (const [id, text] of Object.entries(NARRATE_LINES)) {
    check(`narration line ${id} is a minted name`, /^[a-z][a-z-]*[a-z]$/.test(id));
    check(`narration line ${id} is ${maxWords} words or fewer`, text.split(/\s+/).filter(Boolean).length <= maxWords, text);
    check(`narration id ${id} is no tour or scan id`, !(id in TOUR_LINES) && !(id in SCAN_LINES));
  }
  // Each kind of step the brief names has its lines: the sample's five wings and thirteen rooms (from the bundle's plan), the
  // console's pages, each stand-up sheet kind and answer, the deck, your room, the legend, a chapter's end.
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/vr/Content/BpData/kettle/plan.json'), 'utf8'));
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const w of plan.wings) check(`the sample's wing ${w.name} has its line`, `enter-wing-${slug(w.name)}` in NARRATE_LINES);
  for (const r of plan.rooms) check(`the sample's room ${r.name} has its line`, `enter-room-${slug(r.id)}` in NARRATE_LINES);
  const morning = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/vr/Content/BpData/kettle/morning.json'), 'utf8'));
  for (const c of morning.cards.filter((c: { kind: string }) => c.kind === 'decision')) check(`the sample's decision on ${c.place.target.id} has its line`, `su-decide-${c.place.target.id}` in NARRATE_LINES);
  for (const id of ['enter-wing-other', 'enter-room-other', 'back-wing', 'back-plan', 'inside-room', 'outside-room', 'deck-next', 'deck-end', 'deck-answer-approved', 'deck-answer-noted', 'deck-answer-declined',
    'page-home', 'page-rooms', 'page-scan', 'page-settings', 'page-tour', 'su-open', 'su-built', 'su-outcome-built', 'su-outcome-failed', 'su-decide-other', 'su-close',
    'su-answer-approved', 'su-answer-later', 'su-answer-held', 'su-answer-declined', 'your-room-on', 'your-room-off', 'legend-first', 'chapter-done', 'tour-stopped']) {
    check(`the narration book has ${id}`, id in NARRATE_LINES);
  }
  // Every fixed id is named by the code that says it (the built ids: enter-wing-, enter-room-, page-, su-decide-, su-outcome-).
  const built = /^(enter-wing-|enter-room-|page-|su-decide-|su-outcome-)/;
  for (const id of ids) if (!built.test(id)) check(`narration line ${id} is said by the code`, allSrc.includes(`"${id}"`));
  check('BpNarrate.cpp plays from voice/narrate', narrateSrc.includes('BpData/voice/narrate'));
  check('bp.Narration is saved through FBpStore', /\{ TEXT\("bp\.Narration"\), AudioSection/.test(fs.readFileSync(path.join(SRC, 'BpAudio.cpp'), 'utf8')));
  if (!fs.existsSync(NARRATE_CLIPS)) check('voice/narrate exists', false, 'run node apps/vr/tools/tour-voice.ts --narrate');
  else {
    for (const id of ids) {
      const file = path.join(NARRATE_CLIPS, `${id}.wav`);
      if (!fs.existsSync(file)) { check(`narration clip ${id}.wav exists`, false, 'run node apps/vr/tools/tour-voice.ts --narrate'); continue; }
      const w = wav(file);
      check(`narration clip ${id}.wav is 16-bit mono at the say route's rate, 0.5-8 s`, !!w && w.bits === 16 && w.channels === 1 && w.rate === TOUR_LINK.rate && w.seconds >= 0.5 && w.seconds <= 8,
        w ? `${w.bits}-bit ${w.channels} ch ${w.rate} Hz ${w.seconds.toFixed(2)} s` : 'not PCM');
    }
    for (const f of fs.readdirSync(NARRATE_CLIPS).filter((f) => f.endsWith('.wav'))) check(`narration clip ${f} has a line (no orphan)`, f.slice(0, -4) in NARRATE_LINES);
    const idxFile = path.join(NARRATE_CLIPS, 'lines.json');
    const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : {};
    for (const [id, text] of Object.entries(NARRATE_LINES)) check(`${id}.wav was read from today's line`, idx.lines?.[id] === text, 're-run node apps/vr/tools/tour-voice.ts --narrate');
    check('the narration clips share the tour clips\' voice record (levelled, the say route\'s chain)', JSON.stringify(idx.voice) === JSON.stringify(recordedIndex.voice));
  }
}

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
