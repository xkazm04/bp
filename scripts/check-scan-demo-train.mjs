// Checks that the demo live product (scripts/scan-demo.mjs) carries Kettle's sample release train
// (packages/core/src/model/train-sim.ts) in its real SQLite store, so the Release Ledger on ?product=kettle-live opens on
// packs, built items and a draft release rather than empty tables. Seeds a throwaway dir (--reset --no-register, one
// fixed --now), builds the expected train in memory with its own TrainSim over the same copied map, and compares.
//   1  packs holds exactly the packs TrainSim.seed(order, value) builds: k-des-1, k-des-2, k-perf-1, equal on id, lens,
//      n, branch, base_ref and status
//   2  the pack proposals are one per SAMPLE_ITEMS entry (ids and statuses as the sim's), their statuses include done,
//      failed and rework, and every run_id / pack_id / attempt_of / release_id references an existing row
//   3  per pack proposal: at least one `before` reading of its metric, exactly one `after`, and the after equals
//      proposals.after_value
//   4  per pack proposal whose (feature, lens, metric) has a facet value in the copied map: its last `before` reading
//      is that facet value (the compare pane and the canvas tile agree)
//   5  the two pinned done items (des1-booking, perf1-timetable) are accepted and in the one release, which is the
//      sim's suggested version in status draft; no other item carries a release_id
//   6  every shots row with a proposal_id names shots/<...> with an extension the shots route serves, and the file exists
//   7  readSnapshot(openRead(scan.db)) (packages/core/src/server/store.server.ts) reads 3 packs, 1 release and every
//      pack proposal
//   8  a second seed without --reset keeps the store: still 3 packs, 1 release and the same proposal count
//   G  GUARD (held before the change): the scan half is untouched - 7 proposals without a pack, and run-demo-b is still
//      the latest finished run
// Run: node scripts/check-scan-demo-train.mjs   (exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SAMPLE_ITEMS, TrainSim } from '../packages/core/src/model/train-sim.ts';
import { openRead, readSnapshot, close } from '../packages/core/src/server/store.server.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REG = path.join(ROOT, 'bp.products.local.json');
const NOW = '2026-10-08T09:00:00Z';
const ACCEPT = ['des1-booking', 'perf1-timetable'];
const SERVED = new Set(['.png', '.jpg', '.jpeg', '.webp']); // shots/[...path]/route.ts TYPES
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const short = (xs) => (xs.length > 6 ? `${xs.slice(0, 6).join('; ')} ... (${xs.length})` : xs.join('; '));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-scan-demo-train-'));
const regBefore = fs.existsSync(REG) ? fs.readFileSync(REG) : null;
const regRestore = () => {
  const now = fs.existsSync(REG) ? fs.readFileSync(REG) : null;
  const same = regBefore === null ? now === null : now !== null && regBefore.equals(now);
  if (!same) { if (regBefore === null) fs.rmSync(REG, { force: true }); else fs.writeFileSync(REG, regBefore); }
  return same;
};
const DIR = path.join(tmp, 'demo'), STORE = path.join(DIR, '.ai', 'lens-scan'), DB = path.join(STORE, 'scan.db');
const seed = (...extra) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/scan-demo.mjs'), '--dir', DIR, '--no-register', '--now', NOW, ...extra], { cwd: ROOT, encoding: 'utf8' });
  regRestore();
  return { ok: r.status === 0, out: r.stdout || '', err: (r.stderr || '').trim().split('\n').slice(-3).join(' | ') };
};

/** The train as Kettle `/` builds it, over the copied map: seeded, the pinned items accepted, the suggested release made. */
function expected(map) {
  const host = { runs: [], ms: [], act: [], props: [], pAt: new Map() };
  let m = 0, a = 0;
  Object.assign(host, {
    now: () => Date.parse(NOW), nextMeasurement: () => ++m, nextActivity: () => ++a, changed: () => {},
    field: (lens, key) => map.lenses.find((l) => l.id === lens)?.manifest?.fields?.find((f) => f.key === key),
  });
  const sim = new TrainSim(host);
  const facet = (f, l, k) => { const v = map.facets?.[f]?.[l]?.values?.[k]; return typeof v === 'number' ? v : undefined; };
  sim.seed(map.features.map((f) => f.slug), facet);
  const idOf = (key) => host.props[SAMPLE_ITEMS.findIndex((i) => i.key === key)].id;
  sim.triage({ ids: ACCEPT.map(idOf), decision: 'accept' });
  sim.create(sim.suggest().version);
  return { sim, props: host.props, idOf, facet };
}

try {
  const one = seed('--reset');
  check('scan-demo seeds a throwaway dir (exit 0)', one.ok, one.err);
  if (!one.ok) throw new Error('seeder failed; the store cases cannot run');
  const map = JSON.parse(fs.readFileSync(path.join(STORE, 'app-structure.json'), 'utf8'));
  const want = expected(map);
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = (sql, ...a) => db.prepare(sql).all(...a);

  // case 1
  const KEYS = ['id', 'lens', 'n', 'branch', 'base_ref', 'status'];
  const pick = (r) => JSON.stringify(KEYS.map((k) => r[k]));
  const gotPacks = rows('SELECT * FROM packs ORDER BY id').map(pick), wantPacks = [...want.sim.packs].sort((x, y) => (x.id < y.id ? -1 : 1)).map(pick);
  check('case 1: packs are the packs TrainSim.seed builds (id, lens, n, branch, base_ref, status)', gotPacks.length === 3 && gotPacks.join() === wantPacks.join(), `got ${gotPacks.length}: ${short(gotPacks)}`);

  // case 2
  const props = rows('SELECT * FROM proposals'), byId = new Map(props.map((p) => [p.id, p]));
  const packProps = props.filter((p) => p.pack_id !== null);
  const ids = (xs) => xs.map((p) => `${p.id}:${p.status}`).sort().join();
  const st = new Set(packProps.map((p) => p.status));
  check('case 2: one pack proposal per SAMPLE_ITEMS entry, as the sim builds them (id and status)', packProps.length === SAMPLE_ITEMS.length && ids(packProps) === ids(want.props), `${packProps.length} vs ${SAMPLE_ITEMS.length}`);
  check('case 2: pack proposal statuses include done, failed and rework', ['done', 'failed', 'rework'].every((s) => st.has(s)), [...st].join());
  const runIds = new Set(rows('SELECT id FROM runs').map((r) => r.id)), packIds = new Set(rows('SELECT id FROM packs').map((r) => r.id)), relIds = new Set(rows('SELECT id FROM releases').map((r) => r.id));
  const dangling = [];
  for (const p of packProps) {
    if (!runIds.has(p.run_id)) dangling.push(`${p.id}.run_id ${p.run_id}`);
    if (!packIds.has(p.pack_id)) dangling.push(`${p.id}.pack_id ${p.pack_id}`);
    if (p.attempt_of !== null && !byId.has(p.attempt_of)) dangling.push(`${p.id}.attempt_of ${p.attempt_of}`);
    if (p.release_id !== null && !relIds.has(p.release_id)) dangling.push(`${p.id}.release_id ${p.release_id}`);
  }
  for (const k of rows('SELECT * FROM packs')) if (k.run_id !== null && !runIds.has(k.run_id)) dangling.push(`pack ${k.id}.run_id ${k.run_id}`);
  check('case 2: every run_id / pack_id / attempt_of / release_id references an existing row', packProps.length > 0 && packProps.some((p) => p.attempt_of !== null) && dangling.length === 0, short(dangling));

  // cases 3 and 4
  const bad3 = [], bad4 = [];
  let anchored = 0;
  for (const p of packProps) {
    const ms = rows('SELECT * FROM measurements WHERE proposal_id = ? AND metric = ? ORDER BY measured_at, id', p.id, p.metric);
    const before = ms.filter((r) => r.phase === 'before'), after = ms.filter((r) => r.phase === 'after');
    if (!before.length) bad3.push(`${p.id}: no before`);
    if (after.length !== 1) bad3.push(`${p.id}: ${after.length} afters`);
    else if (after[0].value !== p.after_value) bad3.push(`${p.id}: after ${after[0].value} vs after_value ${p.after_value}`);
    const v = want.facet(p.feature, p.lens, p.metric);
    if (v !== undefined && before.length) { anchored++; if (before[before.length - 1].value !== v) bad4.push(`${p.id} ${p.feature}.${p.metric}: last before ${before[before.length - 1].value} vs facet ${v}`); }
  }
  check('case 3: each pack proposal has before readings and exactly one after, equal to after_value', packProps.length > 0 && bad3.length === 0, short(bad3));
  check('case 4: a pack proposal whose metric has a facet value ends its baseline on it', anchored > 0 && bad4.length === 0, `${anchored} anchored; ${short(bad4)}`);

  // case 5
  const rels = rows('SELECT * FROM releases'), wantRel = want.sim.releases[0];
  const inRel = packProps.filter((p) => p.release_id !== null).map((p) => p.id).sort(), wantIn = ACCEPT.map(want.idOf).sort();
  check('case 5: one draft release, the suggested version', rels.length === 1 && rels[0].status === 'draft' && rels[0].id === wantRel.id && rels[0].version === wantRel.version, JSON.stringify(rels.map((r) => [r.id, r.status])));
  check('case 5: exactly the two accepted items carry its release_id', rels.length === 1 && inRel.join() === wantIn.join() && inRel.every((id) => byId.get(id).status === 'accepted' && byId.get(id).release_id === rels[0].id) && props.every((p) => p.release_id === null || inRel.includes(p.id)), `${inRel} vs ${wantIn}`);

  // case 6
  const shots = rows('SELECT * FROM shots WHERE proposal_id IS NOT NULL'), bad6 = [];
  for (const s of shots) {
    if (!s.path.startsWith('shots/')) bad6.push(`${s.path}: not under shots/`);
    if (!SERVED.has(path.extname(s.path).toLowerCase())) bad6.push(`${s.path}: not served`);
    if (!fs.existsSync(path.join(STORE, s.path))) bad6.push(`${s.path}: missing`);
  }
  check('case 6: item shots live under <store>/shots with an extension the route serves', shots.length > 0 && bad6.length === 0, `${shots.length} shots; ${short(bad6)}`);

  // guard
  const scanProps = props.filter((p) => p.pack_id === null);
  const latest = db.prepare("SELECT id FROM runs WHERE status = 'done' ORDER BY started_at DESC, rowid DESC LIMIT 1").get()?.id;
  check('guard: the scan half keeps its 7 proposals and run-demo-b stays the latest finished run', scanProps.length === 7 && latest === 'run-demo-b', `${scanProps.length} / ${latest}`);
  const count = props.length;
  db.close();

  // case 7
  const rd = openRead(DB);
  const snap = rd ? readSnapshot(rd) : null;
  close(rd);
  const wired = new Set((snap?.proposals ?? []).map((p) => p.id));
  check('case 7: the live reader reads 3 packs, 1 release and every pack proposal', !!snap && snap.packs.length === 3 && snap.releases.length === 1 && packProps.every((p) => wired.has(p.id)), snap ? `${snap.packs.length} packs, ${snap.releases.length} releases` : 'no store');

  // case 8
  const two = seed();
  const db2 = new DatabaseSync(DB, { readOnly: true });
  const n = (t) => db2.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  check('case 8: a second seed without --reset keeps the store (3 packs, 1 release, no duplicate rows)', two.ok && /^kept /.test(two.out) && n('packs') === 3 && n('releases') === 1 && n('proposals') === count, `${two.err} packs=${n('packs')} releases=${n('releases')} proposals=${n('proposals')}/${count}`);
  db2.close();
} catch (e) {
  check('scan-demo-train check ran to the end', false, e.message);
} finally {
  regRestore();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`check-scan-demo-train: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
