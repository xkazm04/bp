// Checks the crossing of "The Desk Becomes the Table" (apps/web/src/components/crossing): its clock is the design's (from
// FOCUSED on: claim +0.8, lift +1.0, fade +2.0, the lamp +2.7), every scene value stays in 0..1 and moves the way the
// design says (black only in the blackouts, passthrough before the fade, the studio after it, the sheet on the monitor
// before the lift and on the desk after it), the unpaired ending never claims or crosses, the track's time mapping is
// monotonic and invertible, the page follows only the table's writes for its own product, the overlay is a lazy chunk,
// and the comfort doctrine holds in the source: the view (the perspective and the desk) is never moved by the clock.
// Run: node --import @bp/core/register scripts/check-crossing.ts  (Node's type stripping). Exit 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { END, FOCUSED, STATES, sceneAt, stateAt, tOf, xOf } from '../apps/web/src/components/crossing/timeline.ts';
import { followHash, placeName } from '../apps/web/src/components/crossing/follow.ts';
import { nameOf } from '../apps/web/src/components/crossing/place.ts';
import type { Engine } from '../apps/web/src/engine/Engine.ts';
import type { PlaceBaton } from '../packages/core/src/session/place.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'apps/web/src/components/crossing');
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const at = (id: string) => STATES.find((s) => s.id === id)!.at;

// ------------------------------------------------------------------------------------------------ the clock
check('ten states, in time order, each shown inside itself', STATES.length === 10 && STATES.every((s, i) => (i === 0 || s.at > STATES[i - 1].at) && s.show >= s.at && s.show < (STATES[i + 1]?.at ?? END)));
check('the design clock from FOCUSED: passthrough 0.0, claim 0.8, lift 1.0, fade 2.0, the lamp 2.7',
  near(at('passthrough'), FOCUSED) && near(at('claimed'), FOCUSED + 0.8) && near(at('lift'), FOCUSED + 1.0) && near(at('fade'), FOCUSED + 2.0) && near(at('arrived'), FOCUSED + 2.7));
check('the blackout is 3-5 s (the person\'s, not the app\'s)', FOCUSED - at('blackout') >= 3 && FOCUSED - at('blackout') <= 5, String(FOCUSED - at('blackout')));
check('stateAt names the state each start time opens', STATES.every((s) => stateAt(s.at).id === s.id && stateAt(s.show).id === s.id));

// ------------------------------------------------------------------------------------------------ the scene
const KEYS = ['page', 'black', 'pass', 'studio', 'lift', 'table', 'rise', 'lamp', 'caption', 'peek', 'moved', 'crumb'] as const;
let inRange = true, bad = '';
for (const paired of [true, false]) for (let t = 0; t <= END; t += 0.02) {
  const sc = sceneAt(t, paired);
  for (const k of KEYS) if (!(sc[k] >= 0 && sc[k] <= 1)) { inRange = false; bad = `${k}=${sc[k]} at t=${t.toFixed(2)} paired=${paired}`; }
}
check('every scene value stays in 0..1, paired and unpaired', inRange, bad);
const S = (t: number) => sceneAt(t);
check('black only while the headset goes on (and comes off)', S(at('blackout') + 1).black > 0.99 && S(FOCUSED + 0.5).black === 0 && S(1).black === 0);
check('the first frame after the blackout is the room (passthrough), not the studio', S(FOCUSED + 0.4).pass > 0.99 && S(FOCUSED + 0.4).studio === 0);
check('the sheet sits on the monitor until the lift, and on the desk after it', S(FOCUSED + 0.9).lift === 0 && S(FOCUSED + 2.05).lift > 0.99);
check('the room fades to the studio from t 2.0 (no studio before it)', S(FOCUSED + 1.99).studio === 0 && S(at('arrived') + 0.5).studio > 0.99 && S(at('arrived') + 0.5).pass === 0);
check('the lamp speaks at t 2.7, not before', S(at('arrived') - 0.05).caption === 0 && S(at('arrived') + 0.4).caption > 0.99);
check('the baton: none, armed, claimed at t 0.8, live once the lift is done, returned after the headset comes off',
  S(0.5).baton === 'none' && S(at('armed') + 0.1).baton === 'armed' && S(FOCUSED + 0.9).baton === 'claimed' && S(FOCUSED + 2.1).baton === 'live' && S(at('return') + 0.1).baton === 'returned');
check('the page is back after the headset comes off, with the 10 s crumb', S(at('return') + 1).page === 1 && S(at('return') + 1).crumb > 0.99);
let unpaired = true;
for (let t = 0; t <= END; t += 0.05) { const u = sceneAt(t, false); if (u.pass !== 0 || u.caption !== 0 || u.moved !== 0 || (u.baton !== 'none' && u.baton !== 'armed')) unpaired = false; }
check('unpaired: no passthrough, no lift to the place, no named place, and the baton is never claimed', unpaired);

// ------------------------------------------------------------------------------------------------ the track
let mono = true, inv = true;
for (let t = 0, last = -1; t <= END; t += 0.01) { const x = xOf(t); if (x < last - 1e-12) mono = false; last = x; if (Math.abs(tOf(x) - t) > 1e-6) inv = false; }
check('the track: monotonic in time, from 0 to 1, and tOf inverts xOf', mono && inv && near(xOf(0), 0) && near(xOf(END), 1));
check('the design\'s dense seconds (FOCUSED to the lamp settled, +3.4 s) get 40% of the track', xOf(FOCUSED + 3.4) - xOf(FOCUSED) >= 0.4 - 1e-9);

// ------------------------------------------------------------------------------------------------ the follow
const baton = (state: PlaceBaton['state'], from: 'web' | 'vr', product = 'kettle'): PlaceBaton =>
  ({ id: 'pb_x', state, place: { product, hash: '#at=scheduling', level: 'L2', from, at: '2026-10-28T09:00:00Z' }, armedAt: '2026-10-28T09:00:00Z', ttlMs: 120000 });
check('the page follows the table\'s live writes and its return', followHash(baton('live', 'vr'), 'kettle') === '#at=scheduling' && followHash(baton('returned', 'vr'), 'kettle') === '#at=scheduling');
check('the page does not follow its own arm, a claim, another product, or an expired baton',
  followHash(baton('armed', 'web'), 'kettle') === null && followHash(baton('claimed', 'web'), 'kettle') === null && followHash(baton('live', 'vr', 'pof'), 'kettle') === null && followHash(baton('expired', 'vr'), 'kettle') === null && followHash(baton('claimed', 'vr'), 'kettle') === null);

// ------------------------------------------------------------------------------------------------ one naming rule
// the lamp (placeOf -> nameOf) and the hand-back crumb (placeName, from a hash) name a place the same way
const room = { id: 'scheduling', name: 'Scheduling & Classes' }, bay = { id: 'scheduling.timetable', name: 'Timetable', room }, wing = { id: '0:OPS', def: { name: 'Studio operations' } };
const E = { M: { P: { name: 'Kettle', F: { 'sch-03': { name: 'Drag-and-drop timetable editor' } } }, L: { BAY: { [bay.id]: bay }, ROOM: { [room.id]: room }, WING: { [wing.id]: wing } } } } as unknown as Engine;
const n = (b: unknown, r: unknown, w: unknown) => nameOf(E, null, b as never, r as never, w as never);
check('a bay is named with its room, a room alone, a wing by name, nothing as the whole site',
  n(bay, room, wing) === 'Timetable · Scheduling & Classes' && n(null, room, wing) === 'Scheduling & Classes' && n(null, null, wing) === 'Studio operations' && n(null, null, null) === 'Kettle · the whole site');
check('the crumb names a hash the way the lamp names the place',
  placeName(E, '#at=scheduling.timetable') === n(bay, room, wing) && placeName(E, '#at=scheduling&lens=perf') === n(null, room, wing) && placeName(E, '#at=0:OPS') === n(null, null, wing)
  && placeName(E, '#open=sch-03') === 'Drag-and-drop timetable editor' && placeName(E, '#') === n(null, null, null));

// ------------------------------------------------------------------------------------------------ the source
const host = fs.readFileSync(path.join(DIR, 'CrossingHost.tsx'), 'utf8'), crossing = fs.readFileSync(path.join(DIR, 'Crossing.tsx'), 'utf8');
check('the overlay is a lazy chunk: the host imports it only with import()', /lazy\(\(\) => import\('\.\/Crossing'\)\)/.test(host) && !/from '\.\/Crossing'/.test(host));
check('the comfort doctrine: no clock-driven style on the view (the perspective container or the desk)', !/className="cx-desk"[^>]*style=/.test(crossing) && !/className="cx-persp"[^>]*style=\{\{[^}]*transform/.test(crossing));
const stream = fs.readFileSync(path.join(ROOT, 'apps/web/src/components/companion/stream.ts'), 'utf8'), place = fs.readFileSync(path.join(DIR, 'place.ts'), 'utf8');
const key = /const CONV_KEY = '([^']+)'/.exec(stream)?.[1];
check('the baton reads the desk\'s conversation under the key the lamp writes it', !!key && place.includes(`sessionStorage.getItem('${key}')`), String(key));
const css = fs.readFileSync(path.join(DIR, 'crossing.css'), 'utf8');
const sizes = [...css.matchAll(/font(?:-size)?:\s*(?:[\d.]+\s+)?(?:italic\s+)?(?:\d{3}\s+)?([\d.]+)px/g)].map((m) => +m[1]);
check('nothing readable in the overlay\'s CSS is under 12 px', sizes.length > 10 && sizes.every((n) => n >= 12), JSON.stringify(sizes.filter((n) => n < 12)));

console.log(`crossing: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
