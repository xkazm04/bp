// Checks the place baton (packages/core/src/session/place.ts, served by packages/core/src/server/api/session/place): one
// record, two writers, never both at once. The page arms it (armed, 120 s), one device claims it, only that device writes
// while it is claimed or live, it returns, and an armed baton nobody claims expires with 410 rather than an error. The
// handlers run here against real Requests: the human token for the page's arm, the device header for the table's moves,
// the loopback guards, and the bodies a hostile or broken caller sends.
// Run: node --import @bp/core/register scripts/check-place-baton.ts  (Node's type stripping). Exit 1 on any failure.
import { BATON_TTL_MS, current, readPlace, step, type Place, type PlaceBaton } from '../packages/core/src/session/place.ts';
import { GET, POST } from '../packages/core/src/server/api/session/place/route.ts';
import { POST as RETURN } from '../packages/core/src/server/api/session/place/return/route.ts';
import { humanToken } from '../packages/core/src/server/api/companion/door.server.ts';
import { writeBaton } from '../packages/core/src/server/api/session/baton.server.ts';
import { subscribe } from '../packages/core/src/server/companion/bus.server.ts';
import type { CompanionEvent } from '../packages/core/src/companion/contract.ts';

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const web: Place = { product: 'kettle', hash: '#at=scheduling.appointments', level: 'L3', target: { kind: 'room', id: 'scheduling' }, from: 'web', at: '2026-10-28T09:00:00Z' };
const vr = (hash: string): Place => ({ ...web, hash, from: 'vr' });
const T0 = Date.parse('2026-10-28T09:00:00Z');

// ------------------------------------------------------------------------------------------------ the state machine
let r = step(null, { kind: 'arm', place: web, id: 'pb_1' }, T0);
check('the page arms a baton: 201, armed, 120 s', r.status === 201 && r.baton?.state === 'armed' && r.baton.ttlMs === BATON_TTL_MS, JSON.stringify(r));
const armed = r.baton as PlaceBaton;
check('a claim before anything is armed: 404', step(null, { kind: 'claim', device: 'quest' }, T0).status === 404);
r = step(armed, { kind: 'claim', device: 'quest' }, T0 + 4000);
check('one device claims it: armed -> claimed, the device kept', r.status === 200 && r.baton?.state === 'claimed' && r.baton.device === 'quest');
const claimed = r.baton as PlaceBaton;
check('a second device cannot claim it: 409', step(claimed, { kind: 'claim', device: 'other' }, T0 + 5000).status === 409);
check('the same device claiming again gets it back (a retried GET)', step(claimed, { kind: 'claim', device: 'quest' }, T0 + 5000).status === 200);
check('the page cannot arm over a claimed baton: 409 (one writer)', step(claimed, { kind: 'arm', place: web, id: 'pb_2' }, T0 + 5000).status === 409);
r = step(claimed, { kind: 'publish', place: vr('#at=scheduling.timetable'), device: 'quest' }, T0 + 6000);
check('the claiming device publishes the table place: live, newest place', r.status === 200 && r.baton?.state === 'live' && r.baton.place.hash === '#at=scheduling.timetable');
const live = r.baton as PlaceBaton;
check('another device cannot write a live baton: 403', step(live, { kind: 'publish', place: vr('#x'), device: 'other' }, T0 + 6000).status === 403);
check("the table's place must say from 'vr': 400", step(live, { kind: 'publish', place: web, device: 'quest' }, T0 + 6000).status === 400);
check('another device cannot return it: 403', step(live, { kind: 'return', device: 'other' }, T0 + 7000).status === 403);
r = step(live, { kind: 'return', device: 'quest' }, T0 + 7000);
check('the device returns it: returned, the last table place kept', r.status === 200 && r.baton?.state === 'returned' && r.baton.place.hash === '#at=scheduling.timetable');
check('after the return the page may arm again', step(r.baton, { kind: 'arm', place: web, id: 'pb_3' }, T0 + 8000).status === 201);
check('an armed baton nobody claims in 120 s reads expired', current(armed, T0 + BATON_TTL_MS + 1)?.state === 'expired' && current(armed, T0 + BATON_TTL_MS - 1)?.state === 'armed');
check('claiming an expired baton: 410, no error thrown', step(armed, { kind: 'claim', device: 'quest' }, T0 + BATON_TTL_MS + 1).status === 410);
check('a refused move leaves the baton as it was', step(live, { kind: 'arm', place: web, id: 'x' }, T0).baton === live);
const back = step(live, { kind: 'arm', place: web, id: 'pb_9', takeBack: true }, T0 + 9000);
check('the page takes the lead back from a device that never returned it: armed anew', back.status === 201 && back.baton?.state === 'armed' && !back.baton.device);
check('then the old device can no longer write: 409', step(back.baton, { kind: 'publish', place: vr('#x'), device: 'quest' }, T0 + 9100).status === 409);

// ------------------------------------------------------------------------------------------------ readPlace
check('readPlace keeps a good place', typeof readPlace(web) === 'object');
for (const [why, bad] of [
  ['no product', { ...web, product: undefined }], ['a product that is no slug', { ...web, product: '../x' }], ['a hash without #', { ...web, hash: 'at=x' }],
  ['a long hash', { ...web, hash: '#' + 'a'.repeat(400) }], ['a level past L4', { ...web, level: 'L5' }], ['a target of an unknown kind', { ...web, target: { kind: 'selection', id: 'x' } }],
  ['a from that is neither', { ...web, from: 'mcp' }], ['not an object', 'kettle'],
] as const) check('readPlace refuses ' + why, typeof readPlace(bad) === 'string');

// ------------------------------------------------------------------------------------------------ the handlers
const URL0 = 'http://127.0.0.1:3010/api/session/place';
const req = (method: string, url: string, body?: unknown, h: Record<string, string> = {}) =>
  new Request(url, { method, headers: { host: '127.0.0.1:3010', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...h }, body: body !== undefined ? JSON.stringify(body) : undefined });
const human = { 'x-bp-human': humanToken() };
const run = async () => {
  writeBaton(null);
  // the companion stream carries the place baton when the table writes it or hands it back (the page follows it)
  const heard: CompanionEvent[] = [];
  const off = subscribe((e) => { if (e.type === 'place') heard.push(e); });
  let res = await GET(req('GET', URL0));
  check('GET with nothing armed: 200 { state: none }', res.status === 200 && (await res.json()).state === 'none');
  res = await POST(req('POST', URL0, { place: web }));
  check("the page's arm without the human token: 403", res.status === 403);
  res = await POST(req('POST', URL0, { place: web }, human));
  check("the page's arm with the token: 201 armed", res.status === 201 && (await res.json()).state === 'armed');
  res = await POST(req('POST', URL0, { place: { ...web, level: 'L9' } }, human));
  check('a bad place: 400', res.status === 400);
  res = await POST(new Request(URL0, { method: 'POST', headers: { host: '127.0.0.1:3010', 'content-type': 'text/plain', ...human }, body: JSON.stringify({ place: web }) }));
  check('a body that is not application/json: 415', res.status === 415);
  res = await POST(req('POST', URL0, { place: web }, { ...human, origin: 'http://evil.example' }));
  check('a write from a foreign origin: 403', res.status === 403);
  res = await GET(req('GET', URL0 + '?claim=1'));
  check('a claim without the device header: 400', res.status === 400);
  res = await GET(req('GET', URL0 + '?claim=1', undefined, { host: 'evil.example' , 'x-bp-device': 'quest' }));
  check('a claim through a foreign Host (rebinding): 403', res.status === 403);
  res = await GET(req('GET', URL0 + '?claim=1', undefined, { 'x-bp-device': 'quest' }));
  const c = await res.json();
  check('the device claims: 200 claimed, the place it carries', res.status === 200 && c.state === 'claimed' && c.place.hash === web.hash, JSON.stringify(c));
  res = await POST(req('POST', URL0, { place: vr('#at=scheduling.timetable') }, { 'x-bp-device': 'quest' }));
  check('the device publishes: 200 live', res.status === 200 && (await res.json()).state === 'live');
  res = await POST(req('POST', URL0, { place: web }, human));
  check('the page cannot arm while the table leads: 409', res.status === 409);
  res = await RETURN(req('POST', URL0 + '/return', {}, { 'x-bp-device': 'other' }));
  check('another device cannot return it: 403', res.status === 403);
  res = await RETURN(req('POST', URL0 + '/return', {}, { 'x-bp-device': 'quest' }));
  const back = await res.json();
  check('the device returns it: 200 returned, the table place kept', res.status === 200 && back.state === 'returned' && back.place.hash === '#at=scheduling.timetable');
  const states = heard.map((e) => (e.type === 'place' ? e.baton.state + ' ' + e.baton.place.hash : ''));
  check('the stream heard the table write and the return, and nothing the page did itself', JSON.stringify(states) === JSON.stringify(['live #at=scheduling.timetable', 'returned #at=scheduling.timetable']), JSON.stringify(states));
  off();
  writeBaton(null);
};
await run();

// ------------------------------------------------------------------------------------------------ one companion process
// With BP_COMPANION_URL set, the web app hands the companion to apps/server; the baton must go with it, or the page arms a
// baton the headset never sees and publishes on a bus no page hears (apps/web/next.config.ts).
process.env.BP_COMPANION_URL = 'http://127.0.0.1:3100';
const cfg = (await import('../apps/web/next.config.ts')).default as { rewrites?: () => Promise<unknown> };
const rw = (await cfg.rewrites?.()) as { beforeFiles?: { source: string; destination: string }[] } | undefined;
const pairs = (rw?.beforeFiles ?? []).map((r) => r.source + ' -> ' + r.destination);
check('with one companion process, /api/session goes to it with /api/companion', pairs.includes('/api/session/:path* -> http://127.0.0.1:3100/api/session/:path*') && pairs.includes('/api/companion/:path* -> http://127.0.0.1:3100/api/companion/:path*'), JSON.stringify(pairs));
delete process.env.BP_COMPANION_URL;
console.log(`place baton: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
