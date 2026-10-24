// Pins the plan's undo history (packages/core/src/model/sim.ts: undoLast / undoDepth / undoLabel) on the Kettle swarm:
// one bounded LIFO stack of the reader's gestures (answers, batches, kept answers, push / pause / order commands), walked
// back by U on the plan and by the toast's UNDO, the same method either way.
//   (1) two answers, two undos: every field is back and both questions are open (a second answer no longer destroys
//       the first one's undo);
//   (2) an answer then a push: the first undo takes back only the push, the second the answer (strict LIFO across kinds);
//   (3) a batch is one step; a kept answer is one step (its order goes, its question reopens);
//   (4) an empty history refuses ("Nothing to undo", tone warn) and changes nothing; a live sim keeps no history;
//   (5) the bound: 21 answers keep 20 steps, the oldest evicted; reset() empties it;
//   (7) the toast's UNDO buttons call E.undoLast() and say "Undo (U)" (Overlays.tsx, read as text).
// Case 6 (the U key through Engine.onKey) lives in check-engine-harness.ts section 5.
// Run: node scripts/check-sim-undo.ts  (Node's type stripping; scripts/overlays-loader.mjs transpiles src/** on the fly).
// Control: BP_SIM_MUTATE='[["sim.ts","find","replace"]]' rewrites source text as it loads. Exit 1 when any expectation fails.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_SIM_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const { buildModel } = await impCore('src/model/sample.ts');
const { SwarmSim } = await impCore('src/model/sim.ts');
const { SWARM } = await impCore('src/data/sample.ts');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const run = (what: string, fn: () => void) => { try { fn(); } catch (e) { failures.push(what + ': threw ' + (e as Error).message); } };

// a sim whose toasts are recorded
const fresh = () => { const sim = buildModel(1, () => 0, null).sim as Any; const toasts: Any[] = []; sim.listen({ changed() {}, event() {}, toast: (t: Any) => toasts.push(t) }); return { sim, toasts }; };
// every field an answer or a command may write, as one comparable string (check-sim-answers' fingerprint, plus orders' ids)
const fp = (sim: Any) => JSON.stringify({
  roll: sim.roll, prog: sim.prog, cap: sim.cap, cov: sim.cov, breaches: sim.breaches,
  agents: sim.agents.map((a: Any) => [a.id, a.f, a.status, a.task, a.wait, a.pct, a.synth, a.nextSynth, a.paused]),
  decisions: sim.decisions.map((d: Any) => [d.id, d.open, d.ans, d.isNew, d.freed, d.freedIds, d.since, d.blocks, d.rec, d.recBy]),
  DEC: Object.keys(sim.DEC).sort(), orders: sim.orders.map((o: Any) => [o.id, o.n, o.vf]),
});
const where = (sim: Any) => JSON.stringify(sim.agents.map((a: Any) => [a.id, a.f, a.status, a.wait, a.paused, a.task]));

// ------------------------------------------------------------------ (1) two answers, two undos
run('(1)', () => {
  const { sim } = fresh(), f0 = fp(sim);
  sim.decide('D-01', sim.DEC['D-01'].rec); sim.decide('D-05', sim.DEC['D-05'].rec);
  const a = sim.undoLast();
  expect(a === true && sim.DEC['D-05'].open && !sim.DEC['D-01'].open, '(1) the first undo reopens D-05 and leaves D-01 answered');
  const b = sim.undoLast();
  expect(b === true && sim.DEC['D-01'].open && sim.DEC['D-05'].open, '(1) the second undo reopens D-01: both questions open');
  expect(fp(sim) === f0, '(1) two answers then two undos: every field equals the fresh sim');
});

// ------------------------------------------------------------------ (2) an answer then a push: strict LIFO across kinds
run('(2)', () => {
  const { sim } = fresh(), f0 = fp(sim);
  sim.decide('D-01', sim.DEC['D-01'].rec);
  const afterAnswer = where(sim), fAnswer = fp(sim);
  const p = sim.previewGA((f: string) => f);
  expect(!!p && p.n > 0, '(2) the GA push has agents to move at t=0');
  sim.commit(p, null);
  expect(where(sim) !== afterAnswer, '(2) the push moved agents');
  sim.undoLast();
  expect(where(sim) === afterAnswer && !sim.DEC['D-01'].open, '(2) the first undo takes back only the push: agents where they stood, D-01 still answered');
  expect(fp(sim) === fAnswer, '(2) after the first undo every field equals the state just after the answer');
  sim.undoLast();
  expect(sim.DEC['D-01'].open && fp(sim) === f0, '(2) the second undo takes back the answer: the fresh sim');
});

// ------------------------------------------------------------------ (3) a batch is one step; a kept answer is one step
run('(3) batch', () => {
  // the batch fixture check-sim-precedent uses: Priya's ask order over the Studio operations wing, an hour later
  const M = buildModel(1, () => 0, null), sim = M.sim as Any;
  const w = M.L.wings.find((x: Any) => x.def.name === 'Studio operations'), ids: Record<string, 1> = {};
  for (const f of w.feats) ids[f.id] = 1;
  sim.commit(sim.previewOrder({ ids, n: w.feats.length, label: 'Studio operations' }, 'ask', 'priya'), 'priya'); sim.seek(3600);
  const g = sim.batchGroups()[0];
  expect(!!g && g.ids.length >= 2, '(3) a batch of like questions exists');
  const f0 = fp(sim), d0 = sim.undoDepth(), n = sim.decideBatch(g.key);
  expect(n === g.ids.length && sim.undoDepth() === d0 + 1, `(3) a batch of ${n} is one step (depth ${d0} -> ${sim.undoDepth()})`);
  sim.undoLast();
  expect(g.ids.every((id: string) => sim.DEC[id].open) && fp(sim) === f0 && sim.undoDepth() === d0, '(3) one undo reopens every question of the batch');
});
run('(3) keep', () => {
  const { sim } = fresh(), f0 = fp(sim), n0 = sim.orders.length;
  const ok = sim.keepAnswer('D-02', 1, 'priya', null);
  expect(ok && sim.orders.length === n0 + 1 && !sim.DEC['D-02'].open && sim.undoDepth() === 1, '(3) keepAnswer mints one order and is one step');
  sim.undoLast();
  expect(sim.orders.length === n0 && sim.DEC['D-02'].open && fp(sim) === f0, '(3) one undo removes the minted order and reopens the question');
});

// ------------------------------------------------------------------ (4) empty history; a live sim
run('(4) empty', () => {
  const { sim, toasts } = fresh(), f0 = fp(sim), v0 = sim.version;
  const r = sim.undoLast(), t = toasts[toasts.length - 1];
  expect(r === false && fp(sim) === f0, '(4) an empty history: undoLast() is false and no field changes');
  expect(!!t && t.strong === 'Nothing to undo' && t.tone === 'warn' && !t.action, `(4) it toasts "Nothing to undo" with tone warn (got ${JSON.stringify(t)})`);
  expect(sim.undoLabel() === null && v0 <= sim.version, '(4) undoLabel() is null on an empty history');
});
run('(4) live', () => {
  const P = buildModel(1, () => 0, null).P;
  const L = new SwarmSim(P, SWARM, () => 0, { live: true });
  L.decide('D-01', 0);
  const f0 = fp(L), r = L.undoLast();
  expect(r === false && fp(L) === f0 && L.undoDepth() === 0, '(4) a live sim keeps no history: undoLast() is false and nothing moves');
});

// ------------------------------------------------------------------ (5) the bound
run('(5)', () => {
  const { sim } = fresh();
  const ids = sim.openDecs().map((d: Any) => d.id).slice(0, 21);
  expect(ids.length === 21, '(5) 21 open questions at t=0');
  for (const id of ids) sim.decide(id, sim.DEC[id].rec);
  expect(sim.undoDepth() === 20, `(5) 21 answers keep 20 steps (depth ${sim.undoDepth()})`);
  expect(typeof sim.undoLabel() === 'string' && sim.undoLabel().includes(sim.DEC[ids[20]].base), `(5) undoLabel names the newest answer (${sim.undoLabel()})`);
  for (let i = 0; i < 20; i++) sim.undoLast();
  expect(!sim.DEC[ids[0]].open && ids.slice(1).every((id: string) => sim.DEC[id].open), '(5) the oldest answer was evicted: 20 undos reopen the other 20 and leave it answered');
  expect(sim.undoLast() === false, '(5) the 21st undo finds nothing');
  sim.decide(ids[1], 0); sim.reset();
  expect(sim.undoDepth() === 0, '(5) reset() empties the history');
});

// ------------------------------------------------------------------ (7) the toast's UNDO is the same method as U
{
  const ov = readFileSync(path.join(SRC, 'components/Overlays.tsx'), 'utf8');
  const btns = ov.split('\n').filter((l) => />UNDO</.test(l));
  expect(btns.length >= 1 && btns.every((l) => l.includes('E.undoLast()') && l.includes('title="Undo (U)"')), `(7) every UNDO button calls E.undoLast() and reads "Undo (U)" (${btns.length} found)`);
  expect(!/E\.undoDecision\(|E\.undoCommand\(/.test(ov), '(7) the toast no longer calls undoDecision / undoCommand');
}

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${held} of ${held + failures.length} sim-undo expectations hold`);
process.exit(failures.length ? 1 : 0);
