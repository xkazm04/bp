// Pins the live build-up feed's catch-up and its clock (apps/web/src/buildup/live.ts), the half of the onboarding screen
// that decides whether a reconnect re-runs a 15-minute build-up from the start.
//
//   1. A first connection's opening burst (the server replays every event since `begin`) reaches listeners marked `past`;
//      what arrives after a pause is live.
//   2. A reconnect that resends the same history delivers none of it again (no second `begin`, the build-up is not
//      reset); only the events past what was already delivered arrive.
//   3. A late subscriber gets everything since `begin`, marked `past`.
//   4. runClock follows the feed's pace (8x tape: 8 run ms per wall ms), never steps back, and stops at `done`.
// Run: node scripts/check-buildup-live.ts   (Node's type stripping; live.ts has no runtime imports)
// Control: BP_BUILDUP_LIVE_SEED=reset makes a reconnect forget what it delivered, so assertion 2 is seen red.
import type { BuildupEvent } from '../apps/web/src/buildup/contract.ts';

const SEED = process.env.BP_BUILDUP_LIVE_SEED ?? '';
let fails = 0, held = 0;
const expect = (ok: boolean, msg: string) => { if (ok) held++; else { fails++; console.log('FAIL ' + msg); } };

// a fake EventSource and wall clock the test drives by hand
let wall = 0;
(globalThis as { performance: { now(): number } }).performance = { now: () => wall };
const sources: FakeES[] = [];
class FakeES {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) { this.url = url; sources.push(this); }
  close() { this.readyState = FakeES.CLOSED; }
  open() { this.onopen?.(); }
  send(e: BuildupEvent) { this.onmessage?.({ data: JSON.stringify(e) }); }
}
(globalThis as unknown as { EventSource: typeof FakeES }).EventSource = FakeES;

const { liveSource, runClock } = await import('../apps/web/src/buildup/live.ts');

const ev: BuildupEvent[] = [
  { type: 'begin', at: 0, project: { slug: 'p', name: 'P' }, extent: null },
  { type: 'phase', at: 10, phase: 'check', state: 'start', detail: null },
  { type: 'phase', at: 900, phase: 'check', state: 'done', detail: null },
  { type: 'phase', at: 950, phase: 'context-map', state: 'start', detail: null },
  { type: 'phase', at: 8000, phase: 'context-map', state: 'done', detail: null },
];

const src = liveSource('/api/products/p/onboarding', { query: 'job=j1' });
const got: { type: string; at: number; past: boolean }[] = [];
src.subscribe((e, past) => got.push({ type: e.type, at: e.at, past: !!past }));
src.start();
const es1 = sources.at(-1)!;
expect(es1.url === '/api/products/p/onboarding/events?job=j1', 'the events URL is the feed + /events + the job query: ' + es1.url);

// 1. a page opened mid-run: three events in one burst, then one live after a pause
es1.open();
es1.send(ev[0]); wall += 1; es1.send(ev[1]); wall += 1; es1.send(ev[2]);
wall += 2000; es1.send(ev[3]);
expect(got.length === 4 && got.slice(0, 3).every((g) => g.past) && !got[3].past, '1. the opening burst is past, the next event live: ' + JSON.stringify(got.map((g) => g.past)));

// 2. the connection drops and comes back: the server resends 0..3 and then 4
if (SEED === 'reset') (src as { replay(): void }).replay(); // the control: a reconnect that starts over
got.length = 0;
const es2 = SEED === 'reset' ? sources.at(-1)! : es1;
wall += 5000; es2.open();
for (const e of ev.slice(0, 4)) { es2.send(e); wall += 1; }
es2.send(ev[4]);
expect(got.length === 1 && got[0].at === 8000, '2. a reconnect delivers only what is new: ' + JSON.stringify(got));
expect(!got.some((g) => g.type === 'begin'), '2. a reconnect does not reset the build-up (no second begin)');

// 3. a late subscriber
const late: boolean[] = [];
src.subscribe((_e, past) => late.push(!!past));
expect(late.length === 5 && late.every(Boolean), '3. a late subscriber gets everything since begin, marked past: ' + late.length);
src.dispose();

// 4. the run clock
const c = runClock();
wall = 1000;
c.see(ev[0], false, wall);
let last = 0, back = false;
for (let i = 1; i <= 40; i++) {
  wall = 1000 + i * 250;
  const at = i * 250 * 8;
  if (i % 5 === 0) c.see({ type: 'activity', at, verb: 'read', path: 'a', area: null }, false, wall);
  const n = c.now(wall + 120);
  if (n < last) back = true;
  last = n;
}
expect(Math.abs(c.rate - 8) < 0.05, '4. the clock measures an 8x feed as 8x: ' + c.rate.toFixed(2));
expect(!back, '4. the clock never steps back');
c.see({ type: 'done', at: 79000, }, false, wall + 200);
const atDone = c.now(wall + 300), later = c.now(wall + 60000);
expect(c.ended && atDone === later && atDone >= 79, '4. the clock stops at done, not before it: ' + atDone + ' / ' + later);

console.log(fails ? `check-buildup-live: ${fails} failed, ${held} held` : `check-buildup-live: ${held} expectations held`);
process.exit(fails ? 1 : 0);
