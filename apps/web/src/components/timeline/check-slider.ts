// Pins the one time-slider contract (timeline/slider.ts + shared.ts useTimeSlider) that the strip's hairline (Strip.tsx)
// and the panel's revisions chart (BaseBar.tsx) both render from:
//   - the sim transport's status (short form on the strip, long form in the panel) and what the play button does;
//   - the inert rule, the slider ARIA and the still title, one model for both zones;
//   - one builder of the scrub geometry, and the Escape ladder declared per slider kind;
//   - neither component restates any of it inline; the hook composes the scrub, the hour text and the key map once.
// Run: node src/components/timeline/check-slider.ts  (Node's type stripping; no build step). Exit 1 on any failure.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readStripped } from '../../../../../scripts/lib/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readStripped(path.join(HERE, p));
type Mod = typeof import('./slider.ts');
type Scrub = typeof import('./scrub.ts');
const S: Mod | null = await import('./slider.ts').catch(() => null);
const { histX, valueText }: Scrub = await import('./scrub.ts');

const cases: [string, () => void][] = [];
const test = (name: string, fn: () => void) => cases.push([name, fn]);
const expect = (ok: boolean, what: string) => { if (!ok) throw new Error(what); };
const mod = (): Mod => { if (!S) throw new Error('timeline/slider.ts is missing'); return S; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const W3 = ['2026-04-06', '2026-04-13', '2026-04-20'];
/** The two sliders' zones, as each component lays them out (Strip.tsx Hairline, BaseBar.tsx Revisions). */
const stripZones = (W = 600) => { const L = 4, R = W - 4, hourW = Math.round((R - L) * 0.24), h1 = R - hourW - 14; return { h0: L, h1, o0: h1 + 14, o1: R }; };
const panelZones = (W = 640) => { const L = 76, avail = W - 6 - L, hist = Math.round(avail * 0.46), o0 = L + hist + 26; return { h0: L, h1: L + hist, o0, o1: o0 + Math.round(avail * 0.38) }; };

test('1. travelled: HISTORY on the strip, HISTORY · PAUSED in the panel, and the play button says it goes back to now', () => {
  const t = mod().transport({ has: true, live: false, now: false, playing: true, over: false, speed: 4 });
  const want = { state: 'history', short: 'HISTORY', long: 'HISTORY · PAUSED', tone: 'warn', play: { glyph: '▶', label: 'Back to now (Space)' } };
  expect(same(t, want), JSON.stringify(t));
});

test('2. at now: playing / ended / paused, and ended replays the hour', () => {
  const tr = mod().transport, base = { has: true, live: false, now: true, speed: 4 };
  const p = tr({ ...base, playing: true, over: false });
  expect(p.state === 'playing' && p.short === '● ×4' && p.long === '● LIVE · ×4' && p.tone === 'on' && p.play.glyph === '❚❚', 'playing: ' + JSON.stringify(p));
  const e = tr({ ...base, playing: false, over: true });
  expect(e.state === 'ended' && e.short === 'ENDED' && e.long === 'ENDED' && e.tone === '' && e.play.label === 'Replay the hour (Space)', 'ended: ' + JSON.stringify(e));
  const z = tr({ ...base, playing: false, over: false });
  expect(z.state === 'paused' && z.short === 'PAUSED' && z.long === 'PAUSED' && z.tone === '', 'paused: ' + JSON.stringify(z));
});

test('3. one week of history and no hour: inert, and it says why; with the hour ahead it is not', () => {
  const one = { weeks: ['2026-04-20'], asOf: '2026-04-20', t: '2026-04-20' };
  const m = mod().sliderModel({ ...one, hour: false });
  expect(m.still === true && m.aria['aria-disabled'] === true, 'one week, no hour: ' + JSON.stringify(m));
  expect(m.stillTitle === 'One week of history: nothing earlier to travel to yet', 'still title: ' + m.stillTitle);
  const h = mod().sliderModel({ ...one, hour: true });
  expect(h.still === false && h.stillTitle === undefined && !('aria-disabled' in h.aria), 'one week, hour: ' + JSON.stringify(h));
});

test('4. the slider ARIA, the same object for the strip and the panel', () => {
  const m = mod().sliderModel({ weeks: W3, asOf: W3[2], t: W3[1], hour: false });
  const want = { role: 'slider', tabIndex: 0, 'aria-valuemin': 1, 'aria-valuemax': 3, 'aria-valuenow': 2, 'aria-valuetext': 'Revision 2, 2026-04-13' };
  expect(same(m.aria, want), JSON.stringify(m.aria));
  expect(m.aria['aria-valuetext'] === valueText(false, 2, W3[1], 3, false), 'aria-valuetext is not the shared valueText');
  for (const z of [stripZones(), panelZones()]) {
    const g = mod().sliderGeom(W3, W3[2], false, z);
    expect(same(mod().sliderModel({ weeks: g.weeks, asOf: g.asOf, t: W3[1], hour: g.hour }).aria, want), 'zones change the ARIA');
  }
});

test('5. one builder of the scrub geometry for both zones', () => {
  for (const [name, z, hour] of [['strip', stripZones(), true], ['panel', panelZones(), true], ['strip no hour', stripZones(), false]] as const) {
    const g = mod().sliderGeom(W3, W3[2], hour, z);
    expect(histX(g, g.d1) === z.h1 && histX(g, g.d0) === z.h0 && g.dn.length === 3 && g.hour === hour && g.o0 === z.o0 && g.o1 === z.o1 && g.asOf === W3[2], name + ': ' + JSON.stringify(g));
  }
});

test('6. Escape is declared per slider kind', () => {
  const esc = mod().escapeAction;
  expect(esc('strip', { tl: true, now: false }) === 'collapse', 'strip, panel open');
  expect(esc('strip', { tl: false, now: false }) === 'back-to-now', 'strip, travelled');
  expect(esc('strip', { tl: false, now: true }) === 'blur', 'strip, at now');
  for (const s of [{ tl: true, now: true }, { tl: false, now: false }, { tl: false, now: true }]) expect(esc('panel', s) === 'collapse', 'panel ' + JSON.stringify(s));
});

test('7. source contract: both sliders render from useTimeSlider and restate none of it', () => {
  const bad: string[] = [];
  for (const f of ['Strip.tsx', '../BaseBar.tsx']) {
    const src = read(f), n = (src.match(/useTimeSlider\(/g) ?? []).length;
    if (n !== 1) bad.push(`${f}: ${n} useTimeSlider( calls`);
    for (const s of ['role="slider"', 'aria-valuenow', 'timeSliderKey(', 'useScrub(', 'useHourText(', 'weeks.length < 2', 'NW < 2', 'One week of history', 'HISTORY', '● LIVE']) if (src.includes(s)) bad.push(`${f} restates ${s}`);
  }
  const sh = read('shared.ts'), at = sh.indexOf('export function useTimeSlider(');
  if (at < 0) bad.push('shared.ts has no useTimeSlider');
  else {
    const body = sh.slice(at + 'export function useTimeSlider('.length);
    for (const c of ['timeSliderKey(', 'useScrub(', 'useHourText(']) { const n = body.split(c).length - 1; if (n !== 1) bad.push(`useTimeSlider calls ${c} ${n} times`); }
  }
  if (/weeks\.length < 2/.test(sh)) bad.push('shared.ts restates the inert rule');
  expect(bad.length === 0, bad.join('; '));
});

// GUARD (green before by design): the per-rule checks stay green with their source guards retargeted to the hook.
test('8. guard: check-keys, check-scrub, check-run and check-size stay green', () => {
  const red = ['check-keys.ts', 'check-scrub.ts', 'check-run.ts', 'check-size.ts'].filter((f) => spawnSync(process.execPath, [path.join(HERE, f)], { stdio: 'ignore' }).status !== 0);
  expect(red.length === 0, 'red: ' + red.join(', '));
});

let held = 0;
const failures: string[] = [];
for (const [name, fn] of cases) {
  try { fn(); held++; } catch (e) { failures.push(name + ': ' + (e as Error).message); }
}
if (failures.length) {
  console.error(`check-slider: ${failures.length} failure(s), ${held} of ${cases.length} cases held`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-slider: ${held} of ${cases.length} cases held (transport, inert rule, ARIA, one geometry, Escape ladder, source contract, sibling guards)`);
