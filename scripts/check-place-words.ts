// check:place-words - what a place says (apps/web/src/engine/place-words.ts) and when the plan says it.
//
// 1. placeWords / placeSentence on the Kettle sample (with the code-free manifest lens com.kettle.cost enabled): three
//    places under General (a room, a wing, a bay), one under a built-in lens (security) and one under com.kettle.cost.
//    The sentences are pinned literally: the sample map is fixed (check:data) and these are what a screen reader hears.
// 2. The hover card builds its place summary from placeWords (it does not restate it); the region and the canvas name.
// 3. The spoken plan, on an Engine mounted on the Node stand-in browser (scripts/lib/engine-dom.ts): ArrowRight twice
//    changes the live region's text (store `said`) exactly twice, each only after the camera rests; N steps the trouble
//    route through every troubled feature once in walk order, Shift+N goes back, Enter opens the arrival and Esc
//    returns with the route position kept, and a feature that turns bad mid-route is announced as "1 new" without
//    entering the frozen route.
// Run: node scripts/check-place-words.ts   Exit 1 when any expectation fails.
// Control: BP_ENGINE_MUTATE='[["Engine.ts","find","replace"]]' rewrites source as it loads (see check-engine-harness).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { installEngineDom } from './lib/engine-dom.ts';
import { readStripped } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_ENGINE_MUTATE || '[]') } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const eq = (got: unknown, want: unknown, what: string) => expect(got === want, what + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want));

const dom = installEngineDom();
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const { buildModel } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/sample.ts')).href);
const { Engine } = await imp('engine/Engine.ts');
const { placeWords, placeSentence } = await imp('engine/place-words.ts');
const { getVariant } = await imp('variants/registry.ts');

const M = buildModel(1, () => dom.now(), '+com.kettle.cost');
const E = new Engine({ canvas: dom.canvas, ui: dom.ui, root: dom.root, model: M, expression: getVariant('subtle').expression, intro: false });
if (M.sim.playing) E.togglePlay();
dom.settle();
// Camera flights run on motion's own clock, not this fake one (check-engine-harness lands them by hand too). Stand in a
// flight that keeps the camera `flying` for 500 ms of fake time and then lands it, so the rest rule is really exercised.
{
  const cam = E.cam, land = cam.flyTo.bind(cam); let t = 0;
  cam.flyTo = (to: Any) => { clearTimeout(t); cam.stopFly(); cam.flying = true; t = setTimeout(() => { cam.flying = false; land(to, 0); }, 500) as unknown as number; };
}
const room = (name: string) => M.L.rooms.find((r: Any) => r.name === name);
const say = (type: string, id: string | undefined, view: string) => { const w = id ? placeWords(E, type, id, view, M.P.asOf, 7) : null; return w ? placeSentence(w) : null; };

// ---------------------------------------------------------------- 1. the sentences
expect(M.P.lenses.some((l: Any) => l.id === 'com.kettle.cost'), 'the sample enables com.kettle.cost with +com.kettle.cost');
eq(say('room', room('Booking & Attendance')?.id, 'general'),
  'Room Booking & Attendance · wing B · 10 features · 7 live · 2 building · 1 on paper · 3 in trouble: Waitlist with auto-promote, Operations: 2 incidents in 30 days',
  'General, a room: its name and wing, the stage parts, how many are in trouble and the first one\'s reason');
eq(say('wing', M.L.wings.find((w: Any) => w.def.letter === 'A')?.id, 'general'),
  'Wing A Foundations · 32 features · 18 live · 10 building · 4 on paper · 2 in trouble: CI pipeline, Security: 2 open findings',
  'General, a wing');
eq(say('bay', M.L.bays.find((b: Any) => b.name === 'Infrastructure')?.id, 'general'),
  'Bay Infrastructure · room Platform & Operations · 7 features · 5 live · 1 building · 1 on paper',
  'General, a bay with nothing in trouble has no trouble clause');
eq(say('room', room('Platform & Operations')?.id, 'security'),
  'Room Platform & Operations · wing A · 22 features · in trouble · 1 bad · 5 to watch · 1 payment · 1 in trouble under Security: CI pipeline, 2 open findings',
  'a built-in lens (security): the lens\'s own place parts, and the trouble under that lens');
eq(say('room', room('Platform & Operations')?.id, 'com.kettle.cost'),
  'Room Platform & Operations · wing A · 22 features · good · $2,460 monthly cost (13 of 22)',
  'the code-free manifest lens com.kettle.cost speaks its manifest aggregate');
{
  const past = placeWords(E, 'room', room('Booking & Attendance').id, 'security', M.P.weeks[0], 7);
  expect(!!past && past.bad === 0 && past.first === null && String(past.parts[1]).endsWith('live'), 'on a past date a place says its stage counts and no trouble (health is not recorded for that date)');
}

// ---------------------------------------------------------------- 2. the hover card reads placeWords
{
  const src = readStripped(path.join(SRC, 'components/Overlays.tsx'));
  const body = src.slice(src.indexOf('function HoverBody('), src.indexOf('export function PlaceVoice('));
  expect(body.includes('placeWords(E, h.type, h.id'), 'HoverBody builds its place summary with placeWords');
  expect(!body.includes('countsOf(') && !body.includes('healthOf('), 'HoverBody does not restate the place summary (no countsOf / healthOf of its own)');
  expect(/role="status" aria-live="polite"/.test(src.slice(src.indexOf('export function PlaceVoice('))), 'PlaceVoice is a polite status region');
  const app = readStripped(path.join(SRC, 'components/BlueprintApp.tsx'));
  expect(app.includes('aria-label="Product floor plan" aria-describedby="bp-said bp-keys"'), 'the canvas has a short name and is described by the live region and the key list');
}

// ---------------------------------------------------------------- 3. the spoken plan
const said = () => E.S.said as string;
let changes = 0, last = said();
const off = E.store.subscribe(() => { if (E.S.said !== last) { changes++; last = E.S.said; } });
/** Run frames in 20 ms steps for `ms`; true when `said` changed while the camera was moving. */
function run(ms: number) { let early = false; for (let t = 0; t < ms; t += 20) { const b = said(); const moving = E.cam.moving; dom.flush(20); if (said() !== b && moving && E.cam.moving) early = true; } return early; }
{
  run(1500); changes = 0;
  dom.key('ArrowRight'); const early1 = run(200);
  expect(changes === 0, 'nothing is said while the walk flies or before the 600 ms rest (' + changes + ' changes)');
  const early1b = run(2500); const one = said();
  dom.key('ArrowRight'); const early2 = run(2700);
  expect(!early1 && !early1b && !early2, 'the region never changes while the camera is moving');
  expect(changes === 2, 'ArrowRight twice changes the live region exactly twice (' + changes + ')');
  expect(one.startsWith('Room ') && said().startsWith('Room ') && one !== said(), 'each walk says its room: "' + one.slice(0, 60) + '…" then "' + said().slice(0, 60) + '…"');
  expect(M.L.walk.some((r: Any) => said().startsWith('Room ' + r.name + ' · wing ')), 'the sentence names the room the walk reached');
}
{
  // the trouble route under General: every troubled feature once, in walk order
  const rank = new Map<string, number>(); for (const R of M.L.walk) for (const B of R.bays) for (const T of B.tiles) if (!rank.has(T.id)) rank.set(T.id, rank.size);
  const want: string[] = M.P.features.filter((f: Any) => f.trouble.length && rank.has(f.id)).map((f: Any) => f.id).sort((a: string, b: string) => rank.get(a)! - rank.get(b)!);
  const seen: string[] = [], words: string[] = [];
  for (let i = 0; i < want.length; i++) { dom.key('n'); run(1800); seen.push(E.routeAt); words.push(said()); }
  expect(want.length > 3, 'the sample has features in trouble to route (' + want.length + ')');
  eq(seen.join(','), want.join(','), 'N visits every troubled feature exactly once, in walk order');
  expect(words.every((w, i) => w.startsWith((i + 1) + ' of ' + want.length + ' · ')), 'each arrival says its position: "' + words[0] + '"');
  const f0 = M.P.F[want[0]], t0 = f0.trouble[0];
  expect(words[0].includes(M.L.TILE[f0.id].room.name + ' › ' + f0.name + ' · ' + M.P.LENS[t0.lens].name + ' ' + t0.h + ': ' + t0.why), 'an arrival says room › feature · Lens health: reason');
  dom.key('N', { shift: true }); run(1800);
  eq(E.routeAt, want[want.length - 2], 'Shift+N steps back one');
  dom.key('Enter'); run(100);
  eq(E.S.open, want[want.length - 2], 'Enter opens the route\'s feature');
  dom.key('Escape'); run(100);
  expect(E.S.open === null && E.routeAt === want[want.length - 2], 'Esc closes the page and the route keeps its position');
  dom.key('n'); run(1800);
  eq(E.routeAt, want[want.length - 1], 'N after the page continues from the kept position');
  // a feature that turns bad mid-route: counted as new, the route order unchanged
  const route = (E as Any).route.ids.join(',');
  const g = M.P.features.find((f: Any) => !f.trouble.length && rank.has(f.id) && f.lens.security);
  g.trouble = [{ lens: 'security', h: 'bad', why: 'seeded by the check' }]; M.sim.healthV++; E.dirty(); dom.flush();
  dom.key('N', { shift: true }); run(1800);
  expect(said().includes(' · 1 new · '), 'a feature that went bad mid-route is announced as "1 new": "' + said().slice(0, 40) + '…"');
  eq((E as Any).route.ids.join(','), route, 'the frozen route did not reshuffle');
  for (let i = 0; i < 2; i++) { dom.key('n'); run(1800); } // to the last, then past it
  expect((E as Any).route.ids.includes(g.id) && said().startsWith('1 of ' + (want.length + 1) + ' · '), 'past the end the route is captured afresh and includes the new member: "' + said().slice(0, 30) + '…"');
  g.trouble = []; M.sim.healthV++;
}
{
  // a lens view routes only that lens's trouble
  E.setView('security'); run(1800);
  const sec = M.P.features.filter((f: Any) => f.trouble.some((t: Any) => t.lens === 'security')).length;
  dom.key('n'); run(1800);
  expect(sec > 0 && said().startsWith('1 of ' + sec + ' · ') && said().includes(' · Security '), 'under Security, N routes the ' + sec + ' features in trouble under Security: "' + said().slice(0, 70) + '…"');
  E.setView('com.kettle.cost'); run(1800);
  const cost = M.P.features.filter((f: Any) => f.trouble.some((t: Any) => t.lens === 'com.kettle.cost')).length;
  dom.key('n'); run(1800);
  const name = M.P.LENS['com.kettle.cost'].name;
  expect(cost ? said().startsWith('1 of ' + cost + ' · ') : said() === 'No feature is in trouble under ' + name + ' now', 'under com.kettle.cost, N routes its trouble or says there is none: "' + said().slice(0, 70) + '"');
}
off(); E.destroy();

for (const f of failures) console.log('FAIL  ' + f);
console.log((failures.length ? 'FAILED' : 'ok') + ' - place words: ' + held + ' expectations held' + (failures.length ? ', ' + failures.length + ' failed' : ''));
process.exit(failures.length ? 1 : 0);
