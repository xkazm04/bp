#!/usr/bin/env node
// The plan's islands view (packages/core/src/server/plan-projection.ts, GET .../plan?layout=islands, the VR client's ask),
// on the Kettle sample, through projectPlan itself (no server; scripts/check-bplink.mjs validates the live answers):
//   default   projectPlan with no opts, `{}` or `{ islands: false }` answers one plan, and its every box is the layout's own
//             (model/layout's layoutProduct, the web canvas's boxes), wings edge to edge: the answer before islands existed
//   islands   the same plan but for boxes: wing i moves right by i * WING_GAP, room j of its wing down by j * ROOM_GAP,
//             bays and tiles with their room, and a wing grows by its rooms' gaps. Then no two wings overlap or touch (the
//             gap is at least WING_GAP), no two rooms of one wing touch, and every box contains its children
//   live      the same map under another slug, as a live product lays out: wing = domain, room = capability, bay = the
//             room's features of one kind (BAY_KINDS order), tile = feature, and the islands geometry still holds
// Control (every run): the geometry rule refuses the default plan (its wings touch) and three broken copies of the islands
// plan, so a rule that accepts everything cannot pass.
// Run: node scripts/check-plan-islands.mjs   Exit 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'packages/core/data');
register(pathToFileURL(path.join(ROOT, 'packages/core/register-hooks.mjs')).href);
const core = (rel) => import(pathToFileURL(path.join(ROOT, 'packages/core/src', rel)).href);
const { projectPlan, WING_GAP, ROOM_GAP } = await core('server/plan-projection.ts');
const { layoutProduct, BAY_KINDS, BAY_KIND_NAME } = await core('model/layout.ts');
const { buildProduct } = await core('model/product.ts');
const { loadStructure } = await core('standard/load.ts');

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

const EPS = 1e-6;
const LEVELS = ['wings', 'rooms', 'bays', 'tiles'];
const within = (a, b) => a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;
/** The clear space between two boxes: the larger of the horizontal and vertical gaps (<= 0 when they overlap or touch). */
const gap = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));

/** What breaks the islands geometry ([] when it holds): wing pairs closer than WING_GAP, rooms of one wing that touch, and
 *  any box outside its parent's. */
export function islandProblems(plan) {
  const out = [], byId = (list) => new Map(list.map((n) => [n.id, n]));
  const W = byId(plan.wings), R = byId(plan.rooms), B = byId(plan.bays);
  plan.wings.forEach((a, i) => plan.wings.slice(i + 1).forEach((b) => {
    if (gap(a.box, b.box) < WING_GAP - EPS) out.push(`wings ${a.id} and ${b.id} are ${gap(a.box, b.box)} apart`);
  }));
  plan.rooms.forEach((a, i) => plan.rooms.slice(i + 1).forEach((b) => {
    if (a.parentId === b.parentId && gap(a.box, b.box) <= EPS) out.push(`rooms ${a.id} and ${b.id} touch (${gap(a.box, b.box)})`);
  }));
  for (const [kids, parents, level] of [[plan.rooms, W, 'wing'], [plan.bays, R, 'room'], [plan.tiles, B, 'bay']]) {
    for (const n of kids) if (!parents.has(n.parentId) || !within(n.box, parents.get(n.parentId).box)) out.push(`${n.id} lies outside its ${level} ${n.parentId}`);
  }
  return out;
}

const raw = JSON.parse(fs.readFileSync(path.join(DATA, 'kettle.app-structure.json'), 'utf8'));
const events = fs.readFileSync(path.join(DATA, 'kettle.events.jsonl'), 'utf8');
const plain = projectPlan(raw, events, 'rev');
const isl = projectPlan(raw, events, 'rev', { islands: true });
const json = (v) => JSON.stringify(v);

// ---- default: one answer, the layout's own boxes
check('default: no opts, {} and { islands: false } answer the same plan',
  json(projectPlan(raw, events, 'rev', {})) === json(plain) && json(projectPlan(raw, events, 'rev', { islands: false })) === json(plain));
const L = layoutProduct(buildProduct(loadStructure(raw, events), 1));
const off = LEVELS.flatMap((lv) => {
  const own = new Map(L[lv].map((n) => [n.id, json({ x: n.x, y: n.y, w: n.w, h: n.h })]));
  return plain[lv].filter((n) => own.get(n.id) !== json(n.box)).map((n) => `${lv} ${n.id}`);
});
check(`default: every box is layoutProduct's, the web canvas's (${LEVELS.map((lv) => `${plain[lv].length} ${lv}`).join(', ')})`,
  off.length === 0 && LEVELS.every((lv) => plain[lv].length === L[lv].length && plain[lv].length > 0), off.slice(0, 3).join(' | '));
const seams = plain.wings.slice(1).map((w, i) => w.box.x - (plain.wings[i].box.x + plain.wings[i].box.w));
check('default: wings sit edge to edge, as before the islands view', seams.every((s) => s === 0), `seams ${seams}`);

// ---- islands: the same plan, shifted boxes
const noBoxes = (p) => JSON.stringify(p, (k, v) => (k === 'box' ? undefined : v));
check('islands: the same plan as the default but for its boxes (ids, names, order, parents, health)', noBoxes(isl) === noBoxes(plain));
const P = Object.fromEntries(LEVELS.map((lv) => [lv, new Map(plain[lv].map((n) => [n.id, n]))]));
const roomOf = (lv, n) => (lv === 'rooms' ? n : lv === 'bays' ? P.rooms.get(n.parentId) : P.rooms.get(P.bays.get(n.parentId).parentId));
const shiftBad = LEVELS.flatMap((lv) => isl[lv].filter((n) => {
  const was = P[lv].get(n.id).box;
  if (lv === 'wings') {
    const rooms = plain.rooms.filter((r) => r.parentId === n.id).length;
    return json(n.box) !== json({ x: was.x + n.order * WING_GAP, y: was.y, w: was.w, h: was.h + (rooms - 1) * ROOM_GAP });
  }
  const r = roomOf(lv, n), dx = P.wings.get(r.parentId).order * WING_GAP, dy = r.order * ROOM_GAP;
  return json(n.box) !== json({ x: was.x + dx, y: was.y + dy, w: was.w, h: was.h });
}).map((n) => `${lv} ${n.id}`));
check(`islands: wing i moves right i * ${WING_GAP}, room j of its wing down j * ${ROOM_GAP}, bays and tiles with their room, a wing grows by its rooms' gaps`,
  shiftBad.length === 0, shiftBad.slice(0, 3).join(' | '));
const bad = islandProblems(isl);
const minWing = Math.min(...isl.wings.flatMap((a, i) => isl.wings.slice(i + 1).map((b) => gap(a.box, b.box))));
const minRoom = Math.min(...isl.rooms.flatMap((a, i) => isl.rooms.slice(i + 1).filter((b) => b.parentId === a.parentId).map((b) => gap(a.box, b.box))));
check(`islands: wings >= ${WING_GAP} apart (closest ${minWing}), rooms of a wing apart (closest ${minRoom}), every box inside its parent`,
  bad.length === 0, bad.slice(0, 3).join(' | '));
const ext = { w: Math.max(...isl.wings.map((w) => w.box.x + w.box.w)) - Math.min(...isl.wings.map((w) => w.box.x)), h: Math.max(...isl.wings.map((w) => w.box.y + w.box.h)) - Math.min(...isl.wings.map((w) => w.box.y)) };
const extOk = LEVELS.every((lv) => isl[lv].every((n) => within(n.box, { x: 0, y: 0, ...ext })));
check(`islands: the extent is ${ext.w} x ${ext.h} plan units, and every box lies inside it`, extOk);

// ---- a live product (owner, 2026-10-25): the same map under another slug nests one level deeper. A wing is a domain, a
// room a capability (its parent the capability's domain's wing), a bay the room's features of one kind in BAY_KINDS order
const liveRaw = { ...raw, project: { ...raw.project, slug: 'kettle-live' } };
const S = loadStructure(liveRaw, events), live = projectPlan(liveRaw, events, 'rev'), liveIsl = projectPlan(liveRaw, events, 'rev', { islands: true });
const capOf = new Map(S.capabilities.map((c) => [c.id, c])), featOf = new Map(S.features.map((f) => [f.id, f]));
const kindOf = (k) => (BAY_KINDS.includes(k) ? k : 'generic');
const roomBad = live.rooms.filter((r) => !capOf.has(r.id) || r.parentId !== '0:' + capOf.get(r.id).domain || r.name !== capOf.get(r.id).name).map((r) => r.id);
check(`live: one wing per domain (${live.wings.length}), one room per capability (${live.rooms.length}), each room in its domain's wing`,
  live.wings.length === S.domains.length && live.rooms.length === S.capabilities.length && roomBad.length === 0, roomBad.slice(0, 3).join(' | '));
const roomBays = new Map(live.rooms.map((r) => [r.id, live.bays.filter((b) => b.parentId === r.id).sort((a, b) => a.order - b.order)]));
const bayBad = [...roomBays].filter(([rid, bs]) => {
  const want = BAY_KINDS.filter((k) => capOf.get(rid).features.some((f) => kindOf(featOf.get(f).kind) === k));
  return json(bs.map((b) => b.id)) !== json(want.map((k) => rid + '.' + k)) || bs.some((b, i) => b.name !== BAY_KIND_NAME[want[i]]);
}).map(([rid]) => rid);
const tileBad = live.tiles.filter((t) => t.parentId !== featOf.get(t.id).capability + '.' + kindOf(featOf.get(t.id).kind)).map((t) => t.id);
check(`live: a room's bays are its features' kinds in BAY_KINDS order (${live.bays.length} bays), each tile in its kind's bay (${live.tiles.length} tiles)`,
  bayBad.length === 0 && tileBad.length === 0 && live.tiles.length === S.features.length, [...bayBad, ...tileBad].slice(0, 3).join(' | '));
const liveBad = islandProblems(liveIsl);
check('live: the islands geometry holds (wings apart, rooms of a wing apart, every box inside its parent)', liveBad.length === 0, liveBad.slice(0, 3).join(' | '));

// ---- permanent controls: the geometry rule refuses the default plan and three broken copies of the islands plan
const broken = (fn) => { const c = structuredClone(isl); fn(c); return islandProblems(c).length > 0; };
check('control: the geometry rule refuses the default plan (its wings touch), a wing pulled within WING_GAP of its neighbour, rooms of one wing made to touch, and a tile pushed out of its bay',
  islandProblems(plain).length > 0
  && broken((c) => { c.wings[1].box.x = c.wings[0].box.x + c.wings[0].box.w + WING_GAP / 2; })
  && broken((c) => { const [a, b] = c.rooms.filter((r) => r.parentId === c.wings[0].id); b.box.y = a.box.y + a.box.h; })
  && broken((c) => { c.tiles[0].box.x -= 1; }));

console.log(`\ncheck-plan-islands: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
