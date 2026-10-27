// Pins the time sliders' shared x <-> time mapping (timeline/scrub.ts) and that strip and panel both use it:
//   - dates map onto the history axis, and a one-week history (no span) puts everything at "now" for BOTH sliders;
//   - the hour zone, the snap to now and the forward-only hour are one rule, whatever the slider's width;
//   - a keyboard activation of the key plan never yields a point off the plan;
//   - neither slider keeps its own pointer logic (setPointerCapture / the old per-slider apply) and both end a drag on cancel.
// Run: node src/components/timeline/check-scrub.ts  (Node's type stripping; no build step). Exit 1 on any failure.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStripped } from '../../../../../scripts/lib/source.ts';
import { HOUR } from '@bp/core/model/constants';
import { HOUR_PAD, NOW_SNAP, histX, hourAt, hourX, inHour, keyPlanFrac, scrubAt, valueText, type ScrubGeom } from './scrub.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Source text with comments removed, so a rule described in a comment cannot stand in for the rule. The one shared
 *  stripper (scripts/lib/source.ts), as the other source-guard checks use it: the private copy this file carried had
 *  already drifted from it by one character (it did not spare a `//` after a backtick, so a template literal could be
 *  cut short mid-string). */
const read = (p: string) => readStripped(path.join(HERE, p));
let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const day = (d: string) => Date.parse(d + 'T00:00:00Z') / 864e5;
const geom = (weeks: string[], hour: boolean, W = 600): ScrubGeom => ({ h0: 4, h1: hour ? 300 : W - 4, o0: 314, o1: W - 4, hour, d0: day(weeks[0]), d1: day(weeks[weeks.length - 1]), weeks, dn: weeks.map(day), asOf: weeks[weeks.length - 1] });
const W3 = ['2026-04-06', '2026-04-13', '2026-04-20'];

// history axis
const g3 = geom(W3, true);
expect(histX(g3, day(W3[0])) === g3.h0 && histX(g3, day(W3[2])) === g3.h1, 'first/last week do not sit on h0/h1');
expect(Math.abs(histX(g3, day(W3[1])) - (g3.h0 + g3.h1) / 2) < 1e-9, 'the middle week is not mid-axis');
// one week of history: strip and panel geometry (different widths/zones) both answer "the right end", never h0
for (const hour of [false, true]) {
  for (const W of [300, 900]) {
    const g1 = geom(['2026-04-20'], hour, W);
    expect(histX(g1, g1.d0) === g1.h1, `one week, hour=${hour}, W=${W}: the date maps to ${histX(g1, g1.d0)}, not h1 ${g1.h1}`);
  }
}
// hour axis
expect(hourX(g3, 0) === g3.o0 && hourX(g3, HOUR) === g3.o1 && hourX(g3, HOUR * 5) === g3.o1 && hourX(g3, -5) === g3.o0, 'hourX is not clamped to the hour');
expect(Math.abs(hourAt(g3, hourX(g3, 1800)) - 1800) < 1e-6, 'hourAt does not invert hourX');
// zones: the same pad everywhere
expect(inHour(g3, g3.o0 - HOUR_PAD) && !inHour(g3, g3.o0 - HOUR_PAD - 1) && inHour(g3, g3.o1 + HOUR_PAD) && !inHour(g3, g3.o1 + HOUR_PAD + 1), 'hour zone is not o0-pad .. o1+pad');
expect(!inHour(geom(W3, false), 400), 'a slider without an hour has an hour zone');
// scrubAt
const hist = scrubAt(g3, g3.h0, null, 0);
expect(hist?.lock === 'h' && hist.date === W3[0], 'x at h0 is not the first week');
expect(scrubAt(g3, g3.h1 - NOW_SNAP + 0.5, null, 0)?.date === W3[2] && scrubAt(g3, g3.h1 - 140, null, 0)?.date === W3[1], 'snap to now / nearest week');
expect(scrubAt(g3, (g3.h1 + g3.o0) / 2 - 3, null, 0)?.date === W3[2], 'the gap between the axes does not mean now');
const fwd = scrubAt(g3, hourX(g3, 1800), null, 600);
expect(fwd?.lock === 'o' && !fwd.back && Math.abs((fwd.hourT ?? 0) - 1800) < 1e-6, 'forward hour scrub');
const bwd = scrubAt(g3, hourX(g3, 300), null, 600);
expect(bwd?.lock === 'o' && bwd.back === true && bwd.hourT === 600, 'backward hour scrub must clamp at the head and say so');
expect(scrubAt(g3, g3.h0, 'o', 600)?.lock === 'o' && scrubAt(g3, g3.h0, 'o', 600)?.date === undefined, 'an hour drag changed zone');
expect(scrubAt(g3, hourX(g3, 900), 'h', 0)?.date !== undefined, 'a history drag changed zone');
const one = geom(['2026-04-20'], false);
expect(scrubAt(one, 10, null, 0)?.date === '2026-04-20', 'one week: a scrub does not stay on the only week');
// announced value
expect(valueText(true, 1, '2026-04-20', 1, false).includes('one week of history') && !valueText(true, 3, '2026-04-20', 3, false).includes('one week'), 'valuetext: the one-week reason');
expect(valueText(false, 2, '2026-04-13', 3, true).includes('only moves forward'), 'valuetext: the hour is forward-only');
// key plan
const box = { left: 100, top: 50, width: 160, height: 70 };
expect(keyPlanFrac(0, 0, box, 0).join() === '0.5,0.5', 'keyboard activation (clientX/Y 0, detail 0) is not the centre');
expect(keyPlanFrac(0, 0, box, 1).join() === '0.5,0.5', 'a click outside the box is not the centre');
expect(keyPlanFrac(180, 85, box, 1).join() === '0.5,0.5' && keyPlanFrac(120, 60, box, 1)[0] === 0.125, 'a click inside the box keeps its point');
expect(keyPlanFrac(150, 90, { left: 0, top: 0, width: 0, height: 0 }, 1).join() === '0.5,0.5', 'a collapsed box is not the centre');

// both sliders use the shared handler and mapping
for (const [file, mine] of [['Strip.tsx', 'Strip.tsx'], ['../BaseBar.tsx', 'BaseBar.tsx']] as const) {
  const src = read(file);
  expect(src.includes('useTimeSlider(') && !src.includes('useScrub('), `${mine} does not take its scrub from useTimeSlider (or wires useScrub itself)`);
  expect(src.includes('histX(') && src.includes('hourX('), `${mine} does not use the shared axis mapping`);
  expect(!src.includes('setPointerCapture') && !src.includes('E.seek(') && !src.includes('dnum(asOf) - dnum(RD0)'), `${mine} restates the scrub logic`);
}
const sh = read('shared.ts'), hookAt = sh.indexOf('export function useTimeSlider(');
expect(hookAt >= 0 && (sh.slice(hookAt).match(/useScrub\(/g) ?? []).length === 1, 'shared.ts useTimeSlider does not wire useScrub exactly once');
for (const ev of ['onPointerUp', 'onPointerCancel', 'onLostPointerCapture']) expect(sh.includes(ev), `useScrub does not handle ${ev}`);

if (failures.length) {
  console.error(`check-scrub: ${failures.length} failure(s), ${held} held`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-scrub: ${held} expectations held (axis mapping incl. the one-week case, zones, forward-only hour, key plan fraction, shared handler)`);
