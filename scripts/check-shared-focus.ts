// Checks the shared focus (packages/core/src/session/focus.ts, served by packages/core/src/server/api/session/focus):
// any surface publishes, any other follows, nobody leads. The pure rules (an echo makes no new rev, a reader never applies
// its own write, following yourself is refused, a gone reader locks nobody out), then the handlers against real Requests
// with a throwaway BP_HOME: durability across a "restart", the `shared` stream event, and the two writers that go through
// the same record - the companion's focus.show and the place baton's table - while the baton's own rules keep working.
// Run: node --import @bp/core/register scripts/check-shared-focus.ts  (Node's type stripping). Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-shared-focus-'));
process.env.BP_HOME = HOME;

const { EMPTY_RECORD, FORGET_MS, HISTORY_MAX, LIVE_MS, MAX_READERS, focusStep, followingWords, readFocusPlace, toApply, viewOf } = await import('../packages/core/src/session/focus.ts');
const { GET, POST } = await import('../packages/core/src/server/api/session/focus/route.ts');
const { POST: FOCUS_SHOW } = await import('../packages/core/src/server/api/companion/focus/route.ts');
const { POST: PLACE, GET: PLACE_GET } = await import('../packages/core/src/server/api/session/place/route.ts');
const { humanToken } = await import('../packages/core/src/server/api/companion/door.server.ts');
const { writeBaton } = await import('../packages/core/src/server/api/session/baton.server.ts');
const { focusFile } = await import('../packages/core/src/server/api/session/focus.server.ts');
const { subscribe } = await import('../packages/core/src/server/companion/bus.server.ts');
type View = import('../packages/core/src/session/focus.ts').SharedView;

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const T0 = Date.parse('2026-10-30T07:00:00Z');
const room = (id: string, product = 'kettle') => ({ product, target: { kind: 'room' as const, id } });
const web = { reader: 'web-1', surface: 'web' as const, label: 'Web' }, vr = { reader: 'standin', surface: 'standin' as const, label: 'VR table (stand-in)' };

// ------------------------------------------------------------------------------------------------ the rules
let s = focusStep(EMPTY_RECORD, { kind: 'publish', ...web, place: room('scheduling') }, T0);
check('a first publish moves the shared place: 201, rev 1, the publisher leads', s.status === 201 && s.moved && s.record.rev === 1 && s.record.lead === 'web-1');
s = focusStep(s.record, { kind: 'follow', ...vr, of: '*' }, T0 + 100);
check('another reader follows whoever moves', s.status === 200 && !s.moved && s.record.readers.find((x) => x.id === 'standin')?.follows === '*');
let v = viewOf(s.record, T0 + 200);
check('the follower is told to go where the shared place is', toApply(v, 'standin', '*', 0)?.target?.id === 'scheduling');
check('...once: a rev it already applied is not applied again', toApply(v, 'standin', '*', v.rev) === null);
check('a reader never applies its own write', toApply(v, 'web-1', '*', 0) === null);
check('a reader that follows nobody applies nothing', toApply(v, 'standin', undefined, 0) === null);
const echo = focusStep(s.record, { kind: 'publish', ...vr, place: { ...room('scheduling'), hash: '#at=scheduling' } }, T0 + 900);
check('the follower reporting the place it flew to is an echo: 200, no new rev, the lead unchanged', echo.status === 200 && !echo.moved && echo.record.rev === 1 && echo.record.lead === 'web-1');
s = focusStep(echo.record, { kind: 'publish', ...vr, place: room('billing') }, T0 + 2000);
check('the follower moving somewhere new leads: leader-less, the newest place wins', s.status === 201 && s.moved && s.record.lead === 'standin' && s.record.rev === 2);
check('...and the web, if it follows too, would fly there', toApply(viewOf(s.record, T0 + 2100), 'web-1', '*', 1)?.target?.id === 'billing');
check('a reader following one named reader ignores the others', toApply(viewOf(s.record, T0 + 2100), 'phone', 'web-1', 0) === null);
check('following yourself is refused: 400', focusStep(s.record, { kind: 'follow', ...web, of: 'web-1' }, T0).status === 400);
check('following a reader nobody has seen: 404', focusStep(s.record, { kind: 'follow', ...web, of: 'nobody' }, T0).status === 404);
const un = focusStep(s.record, { kind: 'unfollow', reader: 'standin' }, T0 + 3000);
check('unfollow is one move of the reader alone', un.status === 200 && !un.record.readers.find((x) => x.id === 'standin')?.follows);
v = viewOf(s.record, T0 + 2000 + LIVE_MS + 1);
check('a reader unseen for LIVE_MS reads as gone, and holds nothing', v.readers.every((x) => !x.live) && focusStep(s.record, { kind: 'publish', ...web, place: room('stock') }, T0 + LIVE_MS * 2).status === 201);
const later = focusStep(s.record, { kind: 'hello', reader: 'phone', surface: 'phone', label: 'Phone' }, T0 + FORGET_MS + 5000);
check('a reader unseen for FORGET_MS is forgotten, except the one whose place is shared', !later.record.readers.some((x) => x.id === 'web-1') && later.record.readers.some((x) => x.id === 'standin'));
check('forgetting the lead keeps the shared place', viewOf(focusStep(s.record, { kind: 'forget', reader: 'standin' }, T0 + 4000).record, T0 + 4000).shared?.place.target?.id === 'billing');
const bay = (at: string) => ({ ...room('scheduling'), level: 'L3' as const, hash: '#at=' + at });
const b1 = focusStep(EMPTY_RECORD, { kind: 'publish', ...web, place: bay('scheduling.timetable') }, T0);
check('two bays of one room are two places (a bay has no kind; the level and the hash say it)', focusStep(b1.record, { kind: 'publish', ...web, place: bay('scheduling.classes') }, T0 + 1).moved);
check('...but a follower reporting the room it flew to, without a hash, is still an echo', !focusStep(b1.record, { kind: 'publish', ...vr, place: room('scheduling') }, T0 + 1).moved);
let crowd = focusStep(focusStep(EMPTY_RECORD, { kind: 'publish', ...vr, place: room('billing') }, T0).record, { kind: 'forget', reader: 'standin' }, T0 + 1).record;
for (let i = 0; i < MAX_READERS + 2; i++) crowd = focusStep(crowd, { kind: 'hello', reader: 'r' + i, surface: 'web', label: 'Web' }, T0 + 10 + i).record;
check('over the reader cap the lead is never the one dropped: the shared place survives', viewOf(crowd, T0 + 100).shared?.place.target?.id === 'billing' && crowd.readers.length <= MAX_READERS + 1);
check('"Following Web, just now"', followingWords(viewOf(focusStep(EMPTY_RECORD, { kind: 'publish', ...web, place: room('x') }, T0).record, T0), '*', T0 + 2000) === 'Following Web, just now');
check('"Following Web, 12 s ago"', followingWords(viewOf(focusStep(EMPTY_RECORD, { kind: 'publish', ...web, place: room('x') }, T0).record, T0), '*', T0 + 12000) === 'Following Web, 12 s ago');
check('readFocusPlace keeps ids and words only', JSON.stringify(readFocusPlace({ product: 'kettle', target: { kind: 'feature', id: 'f1' }, say: 'hi', selection: [1, 2] })) === '{"product":"kettle","target":{"kind":"feature","id":"f1"},"say":"hi"}');
for (const [why, bad] of [['a product that is no slug', { product: '../x' }], ['a target of an unknown kind', { product: 'kettle', target: { kind: 'selection', id: 'x' } }], ['a hash without #', { product: 'kettle', hash: 'at=x' }], ['a level past L4', { product: 'kettle', level: 'L7' }], ['not an object', 'kettle']] as const) {
  check('readFocusPlace refuses ' + why, typeof readFocusPlace(bad) === 'string');
}

// ------------------------------------------------------------------------------------------------ the handlers
const URL0 = 'http://127.0.0.1:3313/api/session/focus';
const req = (method: string, url: string, body?: unknown, h: Record<string, string> = {}) =>
  new Request(url, { method, headers: { host: '127.0.0.1:3313', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...h }, body: body !== undefined ? JSON.stringify(body) : undefined });
const heard: View[] = [];
const off = subscribe((e) => { if (e.type === 'shared') heard.push(e.shared); });

let res = await GET(req('GET', URL0));
check('GET before anything: rev 0, no shared place', res.status === 200 && ((await res.json()) as View).shared === null);
res = await POST(req('POST', URL0, { op: 'hello', ...web }));
check('hello: 200, and the stream hears a new reader', res.status === 200 && heard.length === 1 && heard[0].readers.some((x) => x.id === 'web-1' && x.live));
res = await POST(req('POST', URL0, { op: 'follow', ...vr, of: '*' }));
check('follow over the route: 200', res.status === 200);
heard.length = 0;
res = await POST(req('POST', URL0, { op: 'publish', ...web, place: { ...room('scheduling'), say: 'Overnight: 3 items built in Scheduling' } }));
check('publish: 201, moved, and the stream carries the place with who put it there', res.status === 201 && heard.length === 1 && heard[0].shared?.reader === 'web-1' && heard[0].shared.place.say === 'Overnight: 3 items built in Scheduling');
heard.length = 0;
res = await POST(req('POST', URL0, { op: 'publish', ...vr, place: room('scheduling') }));
check('an echo over the route: 200, nothing on the stream', res.status === 200 && heard.length === 0);
heard.length = 0;
res = await POST(req('POST', URL0, { op: 'publish', ...web, place: { ...room('scheduling'), say: 'A second card on the same room' } }));
check('the lead saying the same spot with a new line: no new rev, but the stream carries the line', res.status === 200 && heard.length === 1 && heard[0].shared?.place.say === 'A second card on the same room');
res = await POST(req('POST', URL0, { op: 'publish', ...web, place: room('scheduling', 'no-such-product') }));
check('a place in a product this server cannot open: 404 (it would strand every follower)', res.status === 404);
res = await POST(req('POST', URL0, { op: 'publish', ...web, place: { product: 'kettle', target: { kind: 'selection', id: 'x' } } }));
check('a bad place: 400', res.status === 400);
res = await POST(req('POST', URL0, { op: 'teleport', ...web }));
check('an unknown op: 400', res.status === 400);

// ------------------------------------------------------------------------------------------------ history (roadmap C2)
{
  // pure: the record keeps the last HISTORY_MAX shared places, the newest shared
  let r = EMPTY_RECORD;
  for (let i = 0; i < HISTORY_MAX + 2; i++) r = focusStep(r, { kind: 'publish', ...web, place: room('r' + i) }, T0 + i * 1000).record;
  const hv = viewOf(r, T0 + 20000);
  check(`history keeps the last ${HISTORY_MAX} shared places, oldest first, the newest shared`, hv.history?.length === HISTORY_MAX && hv.history[0].place.target?.id === 'r2' && hv.historyAt === HISTORY_MAX - 1 && hv.shared?.place.target?.id === 'r11');
  const echo = focusStep(r, { kind: 'publish', ...vr, place: room('r11') }, T0 + 21000);
  check('an echo adds nothing to the history', viewOf(echo.record, T0 + 21000).history?.length === HISTORY_MAX && echo.record.historyAt === HISTORY_MAX - 1 && !echo.moved);
  // over the route: back is a publish (exactly one rev), every follower is told to go back, and forward returns
  heard.length = 0;
  const before = ((await (await GET(req('GET', URL0))).json()) as View);
  res = await POST(req('POST', URL0, { op: 'publish', ...web, place: room('stock') }));
  res = await POST(req('POST', URL0, { op: 'publish', ...web, place: room('dispatch') }));
  const two = ((await res.json()) as { view: View }).view;
  heard.length = 0;
  res = await POST(req('POST', URL0, { op: 'back', ...vr }));
  const back1 = ((await res.json()) as { moved: boolean; view: View });
  check('back over the route: 201, exactly one rev, the stepping reader leads at the place before', res.status === 201 && back1.moved && back1.view.rev === two.rev + 1 && back1.view.shared?.place.target?.id === 'stock' && back1.view.shared.reader === 'standin' && heard.length === 1, JSON.stringify(back1.view.shared));
  check('...and a follower of whoever moves is told to go back there', toApply(back1.view, 'web-1', '*', two.rev)?.target?.id === 'stock');
  res = await POST(req('POST', URL0, { op: 'back', ...vr }));
  const back2 = ((await res.json()) as { view: View }).view;
  check('back twice: one rev more, the place before that, the history unchanged', res.status === 201 && back2.rev === two.rev + 2 && back2.shared?.place.target?.id === before.shared?.place.target?.id && back2.history?.length === two.history?.length);
  res = await POST(req('POST', URL0, { op: 'forward', ...vr }));
  const fwd = ((await res.json()) as { view: View }).view;
  check('forward once: one rev more, back at stock', res.status === 201 && fwd.rev === two.rev + 3 && fwd.shared?.place.target?.id === 'stock' && fwd.historyAt === (two.historyAt ?? 0) - 1);
  let e = focusStep({ rev: 1, readers: [], history: [{ place: room('a'), reader: 'x', label: 'X', at: new Date(T0).toISOString() }], historyAt: 0 }, { kind: 'back', ...web }, T0);
  check('back with nowhere to go: 409, nothing moves', e.status === 409 && !e.moved && e.record.rev === 1);
  e = focusStep(e.record, { kind: 'forward', ...web }, T0);
  check('forward at the end: 409', e.status === 409 && !e.moved);
}
res = await POST(req('POST', URL0, { op: 'hello', reader: 'a b', surface: 'web', label: 'x' }));
check('a reader that is no id: 400', res.status === 400);
res = await POST(new Request(URL0, { method: 'POST', headers: { host: '127.0.0.1:3313', 'content-type': 'text/plain' }, body: JSON.stringify({ op: 'hello', ...web }) }));
check('a body that is not application/json: 415', res.status === 415);
res = await POST(req('POST', URL0, { op: 'hello', ...web }, { origin: 'http://evil.example' }));
check('a write from a foreign origin: 403', res.status === 403);
res = await POST(req('POST', URL0, { op: 'publish', reader: 'web-1', surface: 'vr', label: 'Headset', place: room('dispatch') }, { 'x-bp-device': 'quest:p1' }));
check('a device (the LAN door sets x-bp-device) speaks only as its own reader, whatever its body says', res.status === 201 && ((await res.json()) as { view: View }).view.shared?.reader === 'vr:quest:p1');
res = await POST(req('POST', URL0, { op: 'publish', ...web, place: room('scheduling') }));
check('...and the page it tried to speak for is untouched (it leads again by its own publish)', res.status === 201);
check('the record is on disk under BP_HOME', fs.existsSync(focusFile()) && focusFile().startsWith(HOME));
const g = globalThis as unknown as { __bpSharedFocus?: unknown };
delete g.__bpSharedFocus; // a restart: the process forgets, the file remembers
res = await GET(req('GET', URL0));
const back = (await res.json()) as View;
check('durable: after a restart the shared place and whom each follows are still there', back.shared?.place.target?.id === 'scheduling' && back.readers.find((x) => x.id === 'standin')?.follows === '*', JSON.stringify(back));

// the companion's focus.show writes through the same record
heard.length = 0;
res = await FOCUS_SHOW(req('POST', 'http://127.0.0.1:3313/api/companion/focus', { product: 'kettle', kind: 'room', id: 'billing', say: 'Billing is where the failures are' }));
check("the lamp's focus.show moves the shared focus too, as Glim", res.status === 201 && heard.some((x) => x.shared?.reader === 'companion' && x.shared.label === 'Glim' && x.shared.place.target?.id === 'billing'));
heard.length = 0;
res = await FOCUS_SHOW(req('POST', 'http://127.0.0.1:3313/api/companion/focus', { product: 'kettle', kind: 'decision', id: 'd1' }));
check('a focus.show that is no place (a decision) leaves the shared focus alone', res.status === 201 && heard.length === 0);

// the baton keeps its own rules, and the table's writes reach every follower through the shared focus
writeBaton(null);
const place = { product: 'kettle', hash: '#at=stock', level: 'L2', target: { kind: 'room', id: 'stock' }, from: 'web', at: '2026-10-30T07:00:00Z' };
res = await PLACE(req('POST', 'http://127.0.0.1:3313/api/session/place', { place }, { 'x-bp-human': humanToken() }));
check('the page still arms the baton: 201', res.status === 201);
res = await PLACE_GET(req('GET', 'http://127.0.0.1:3313/api/session/place?claim=1', undefined, { 'x-bp-device': 'quest' }));
check('the device still claims it: 200', res.status === 200);
heard.length = 0;
res = await PLACE(req('POST', 'http://127.0.0.1:3313/api/session/place', { place: { ...place, hash: '#at=dispatch', target: { kind: 'room', id: 'dispatch' }, from: 'vr' } }, { 'x-bp-device': 'quest' }));
check("the table's write goes live on the baton AND moves the shared focus as 'VR table'", res.status === 200 && heard.some((x) => x.shared?.reader === 'vr:quest' && x.shared.label === 'VR table' && x.shared.place.target?.id === 'dispatch'));
res = await PLACE(req('POST', 'http://127.0.0.1:3313/api/session/place', { place: { ...place, from: 'vr' } }, { 'x-bp-device': 'other' }));
check('another device still cannot write the baton: 403, and the shared focus does not move', res.status === 403 && heard.every((x) => x.shared?.place.target?.id !== 'stock'));
// the wire: real payloads conform to packages/schema/schema/shared-focus-1.schema.json (the contract a port reads)
{
  const { wire } = await import('./lib/wire-schema.ts');
  const asView = await wire('shared-focus-1', 'sharedView'), asAnswer = await wire('shared-focus-1', 'focusAnswer'), asPost = await wire('shared-focus-1', 'focusPost');
  const view = (await (await GET(req('GET', URL0))).json()) as View;
  const body = { op: 'publish', ...web, place: { ...room('billing'), level: 'L2', hash: '#at=billing', say: 'Billing\nthe brief line' } };
  const ans = await (await POST(req('POST', URL0, body))).json();
  const fails = [asView(view), asAnswer(ans), asPost(body), asView(viewOf(EMPTY_RECORD, T0))].filter(Boolean);
  check('wire: GET, a POST answer, its body and an empty view conform to shared-focus-1', !fails.length && view.readers.length > 0, fails.join(' | '));
  check('wire control: a view without rev, a place with a foreign kind, an unknown op are refused',
    !!asView({ ...view, rev: undefined }) && !!asAnswer({ moved: true, view: { ...view, shared: { ...view.shared, place: { product: 'kettle', target: { kind: 'decision', id: 'x' } } } } }) && !!asPost({ ...body, op: 'shout' }));
  // the golden (packages/schema/golden/shared-focus.json, what a port reproduces): current, and every view in it is wire
  const { FOCUS_GOLDEN, focusGolden } = await import('./focus-golden.ts');
  const now = focusGolden(), committed = fs.existsSync(FOCUS_GOLDEN) ? fs.readFileSync(FOCUS_GOLDEN, 'utf8').replace(/\r\n/g, '\n') : '';
  check('golden: packages/schema/golden/shared-focus.json is what focus.ts computes now (node scripts/focus-golden.ts --write)', committed === now);
  const gd = JSON.parse(now) as { focusStep: { name: string; view: View; moved: boolean }[]; sameSpot: unknown[]; toApply: unknown[]; followingWords: unknown[]; readFocusPlace: unknown[] };
  const badViews = gd.focusStep.map((x) => asView(x.view)).filter(Boolean);
  const live = (name: string) => gd.focusStep.find((x) => x.name.startsWith(name))?.view.readers.find((r) => r.id === 'web-1')?.live;
  check('golden: web is listed live 44 s after it was last seen and gone at 45 s and 46 s (LIVE_MS is 45 s: a 40 s or a 50 s timeout fails)',
    LIVE_MS === 45_000 && live('the table says hello 44 s') === true && live('...45 s') === false && live('...46 s') === false);
  check('golden: it covers every rule (22 moves with back and forward and the 44 / 45 / 46 s presence probes, 11 pairs, 8 applies, 6 chips, 12 bodies) and each view in it is shared-focus-1',
    gd.focusStep.length === 22 && gd.sameSpot.length === 11 && gd.toApply.length === 8 && gd.followingWords.length === 6 && gd.readFocusPlace.length === 12 && gd.focusStep.filter((x) => x.moved).length === 7 && !badViews.length, badViews.join(' | '));
}
off();
fs.rmSync(HOME, { recursive: true, force: true });
console.log(`${failed ? 'FAILED' : 'ok'}: ${passed} passed, ${failed} failed (shared focus)`);
process.exit(failed ? 1 : 0);
