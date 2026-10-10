// Pins the time sliders' keyboard map (timeline/keys.ts) and that both sliders use it:
//   - every key the map claims does its one thing, on the hairline and on the revisions chart alike;
//   - every key Engine.onKey binds that the map does not own passes through untouched (the list is read from
//     src/engine/Engine.ts, not restated here, so a new engine shortcut is checked the day it lands);
//   - modifier chords and the hour-seek keys without an hour ahead are not claimed;
//   - neither slider restates the map inline (the copy that drifted is how one slider lost a key before).
// Run: node src/components/timeline/check-keys.ts  (Node's type stripping; no build step). Exit 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOUR } from '../../lib/model/constants.ts';
import { timeSliderKey, type KeyLike, type TimeSliderEngine } from './keys.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Source text with comments removed, so a rule described in a comment cannot stand in for the rule. */
const read = (p: string) => fs.readFileSync(path.join(HERE, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const WEEKS = ['2026-04-06', '2026-04-13', '2026-04-20'], AS_OF = '2026-04-20';
function rig(simT = 600) {
  const calls: string[] = [];
  const E: TimeSliderEngine = {
    stepWeek: (d) => { calls.push('stepWeek ' + d); },
    setTime: (d) => { calls.push('setTime ' + d); },
    setTimeline: (on) => { calls.push('setTimeline ' + (on ?? 'toggle')); },
    seek: (t) => { calls.push('seek ' + t); },
    M: { sim: { t: simT }, P: { weeks: WEEKS, asOf: AS_OF } },
  };
  return { E, calls, escape: () => { calls.push('escape'); } };
}
const key = (k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });
const run = (e: KeyLike, hour: boolean, simT?: number) => { const r = rig(simT); const own = timeSliderKey(e, r.E, hour, r.escape); return { own, calls: r.calls.join('; ') }; };
const label = (e: KeyLike) => (e.shiftKey ? 'Shift+' : '') + (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.metaKey ? 'Meta+' : '') + JSON.stringify(e.key);

// ---------------------------------------------------------------- the keys the slider owns
const OWNED: [KeyLike, string][] = [
  [key('ArrowLeft'), 'stepWeek -1'], [key('ArrowDown'), 'stepWeek -1'],
  [key('ArrowRight'), 'stepWeek 1'], [key('ArrowUp'), 'stepWeek 1'],
  [key('Home'), 'setTime ' + WEEKS[0]], [key('End'), 'setTime ' + AS_OF],
  [key('t'), 'setTimeline toggle'], [key('T', { shiftKey: true }), 'setTimeline toggle'],
  [key('Escape'), 'escape'], [key('Enter'), ''],
];
for (const hour of [true, false]) {
  for (const [e, want] of OWNED) {
    const r = run(e, hour);
    expect(r.own && r.calls === want, `${label(e)} (hour ${hour}): claimed ${r.own}, did '${r.calls}', want claimed and '${want}'`);
  }
}

// ---------------------------------------------------------------- the hour-seek keys
for (const e of [key('PageUp'), key('ArrowRight', { shiftKey: true })]) {
  const on = run(e, true);
  expect(on.own && on.calls === 'seek 900', `${label(e)} with the hour ahead: claimed ${on.own}, did '${on.calls}', want 'seek 900'`);
  const end = run(e, true, HOUR - 100);
  expect(end.calls === 'seek ' + HOUR, `${label(e)} near the hour's end: did '${end.calls}', want the seek clamped to ${HOUR}`);
}
const pgNoHour = run(key('PageUp'), false);
expect(!pgNoHour.own && pgNoHour.calls === '', `PageUp without an hour ahead: claimed ${pgNoHour.own}, did '${pgNoHour.calls}', want it passed through`);
const shNoHour = run(key('ArrowRight', { shiftKey: true }), false);
expect(shNoHour.own && shNoHour.calls === 'stepWeek 1', `Shift+ArrowRight without an hour ahead: did '${shNoHour.calls}', want a week step`);

// ---------------------------------------------------------------- modifier chords are never the slider's
for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
  for (const k of ['ArrowLeft', 'Home', 't', 'Escape', 'PageUp']) {
    const e = key(k, mods), r = run(e, true);
    expect(!r.own && r.calls === '', `${label(e)}: claimed ${r.own}, did '${r.calls}', want it passed through`);
  }
}

// ---------------------------------------------------------------- every other engine shortcut passes through
const engine = fs.readFileSync(path.join(HERE, '../../engine/Engine.ts'), 'utf8');
const onKey = /private onKey\(e: KeyboardEvent\) \{([\s\S]*?)\r?\n {2}\}\r?\n/.exec(engine)?.[1] ?? '';
const engineKeys = new Set([...onKey.matchAll(/k === '((?:\\.|[^'\\])+)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1')));
for (const m of onKey.matchAll(/\/\^\[(\d)-(\d)\]\$\//g)) for (let d = +m[1]; d <= +m[2]; d++) engineKeys.add(String(d));
expect(engineKeys.size >= 20, `read ${engineKeys.size} keys from Engine.onKey; the reader no longer matches the handler`);
const owned = new Set(OWNED.map(([e]) => e.key).concat(['PageUp']));
let passed = 0;
for (const k of engineKeys) {
  if (owned.has(k)) continue;
  const r = run(key(k), true);
  expect(!r.own && r.calls === '', `engine key ${JSON.stringify(k)}: the slider claimed it (${r.calls || 'no call'}); it belongs to Engine.onKey`);
  passed++;
}

// ---------------------------------------------------------------- both sliders use the map, neither restates it
for (const [file, n] of [['Strip.tsx', 1], ['../BaseBar.tsx', 1]] as const) {
  const src = read(file);
  const uses = (src.match(/timeSliderKey\(/g) ?? []).length;
  expect(uses === n, `${file}: ${uses} timeSliderKey( call(s), want ${n}`);
  for (const inline of ['E.stepWeek(', "'ArrowLeft'", 'hourSeekKey(']) expect(!src.includes(inline), `${file} restates the slider key map (${inline})`);
}

if (failures.length) {
  console.error(`check-keys: ${failures.length} failure(s), ${held} held`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-keys: ${held} expectations held (${engineKeys.size} engine keys read, ${passed} pass through the map)`);
