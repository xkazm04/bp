// Pins "keep an answer as a standing order" and batch-deciding (src/lib/model/sim.ts: keepAnswer / precedent / batchGroups /
// previewBatch / decideBatch / undoDecision) on the Kettle swarm:
//   - the pair: Priya's `ask` order on the Studio operations wing asks about STU-06 at t=594; she answers "Hold at 10%" and keeps it
//     as an order over the wing. The later questions it covers (INS-02 at t=798, BKG-02 at t=1248: same lens, an option with the
//     kept effect kind) arrive OPEN with that option recommended and the order named; without the keep they recommend "Go ahead";
//   - an urgent question in scope keeps the agent's recommendation (a synthetic copy of D-27 with the lens and a cap option; the
//     same copy at medium urgency takes the kept order's recommendation, as the control);
//   - undo of the keep removes the order, reopens the question and puts the recommendations back;
//   - a batch of >= 3 like questions decides all with ONE undo that restores every field, its preview listing what happens;
//     an urgent question never joins a batch;
//   - a keep with nobody to sign it is refused; a live sim offers neither action.
// The fixture has no honest pair of its own: no later arrival shares a lens and scope with an earlier question's effect kind
// or option label (D-26 operations/payments, D-27 quality/booking (urgent), D-28 business/scheduling). The pair is the ask
// order's generated questions, which the sample produces on its own once the order is written.
// Run: node scripts/check-sim-precedent.ts  (Node's type stripping for this file; scripts/overlays-loader.mjs transpiles src/**
// on the fly). Exit 1 when any expectation fails.
// Control: BP_SIM_MUTATE="[[\"sim.ts\",\"if (d.urg === 'high') continue;\",\"\"]]" lets an urgent question into a batch (seen red).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_SIM_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const { buildModel } = await impCore('src/model/sample.ts');
const { SwarmSim } = await impCore('src/model/sim.ts');
const { SWARM } = await impCore('src/data/sample.ts');
const MAP = (await impCore('data/kettle.app-structure.json')).default as { features: { id?: string; slug: string }[] };

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const slug = (id: string) => MAP.features.find((f) => f.id === id)?.slug ?? id;
const [STU, INS, BKG] = ['STU-06', 'INS-02', 'BKG-02'].map(slug);

const fp = (sim: Any) => JSON.stringify({
  roll: sim.roll, prog: sim.prog, cap: sim.cap, capBy: sim.capBy, cov: sim.cov, breaches: sim.breaches,
  agents: sim.agents.map((a: Any) => [a.id, a.f, a.status, a.task, a.wait, a.pct, a.synth, a.nextSynth, a.paused]),
  decisions: sim.decisions.map((d: Any) => [d.id, d.open, d.ans, d.isNew, d.freed, d.freedIds, d.since, d.blocks, d.rec, d.recBy ?? null]),
  DEC: Object.keys(sim.DEC).sort(), orders: sim.orders.map((o: Any) => [o.id, o.n, o.vf]),
});
// the sample (or a copy of its swarm), with Priya's ask order written over the Studio operations wing at t=0
function setup(S0?: Any) {
  const M = buildModel(1, () => 0, null), sim = (S0 ? new SwarmSim(M.P, S0, () => 0) : M.sim) as Any;
  const w = M.L.wings.find((x: Any) => x.def.name === 'Studio operations'), ids: Record<string, 1> = {};
  for (const f of w.feats) ids[f.id] = 1;
  const tgt = { ids, n: w.feats.length, label: 'Studio operations' };
  sim.commit(sim.previewOrder(tgt, 'ask', 'priya'), 'priya');
  const ask = sim.orders[sim.orders.length - 1];
  return { M, sim, tgt, ask, q: (f: string) => sim.DEC[ask.id + '@' + f] };
}

// ------------------------------------------------------------------ the pair
{
  const A = setup(); A.sim.seek(600);
  const stu = A.q(STU);
  expect(!!stu?.open && stu.opts[1].label === 'Hold at 10%', `pair: ${A.ask.id}'s question on STU-06 is open at t=600 with "Hold at 10%"`);
  const ok = A.sim.keepAnswer(stu.id, 1, 'priya', A.tgt), kept = A.sim.orders[A.sim.orders.length - 1];
  expect(ok && kept.keep?.dec === stu.id && kept.by === 'priya' && kept.lens === stu.lens && !stu.open, `pair: kept as ${kept.id}, signed ${kept.by}, lens ${kept.lens}, the question answered`);
  A.sim.seek(3600);
  const later = [A.q(INS), A.q(BKG)];
  console.log(`pair: kept ${stu.base} "Hold at 10%" as ${kept.id} over the Studio operations wing (lens ${kept.lens}); later: ${later.map((d: Any) => d ? d.base + ' at rec "' + d.opts[d.rec].label + '" by ' + (d.recBy ?? 'the agent') + (d.open ? ', open' : ', CLOSED') : 'missing').join('; ')}`);
  expect(later.every((d: Any) => d && d.open && !d.ans && d.rec === 1 && d.recBy === kept.id), 'pair: the later questions arrive open, recommending the kept option, naming the order');
  const C = setup(); C.sim.seek(3600);
  expect([C.q(INS), C.q(BKG)].every((d: Any) => d && d.rec === 0 && !d.recBy), 'pair, control: without the keep they recommend "Go ahead"');
  // undo of the keep: the order goes, the question reopens, the recommendations go back
  A.sim.undoDecision();
  expect(!A.sim.orders.some((o: Any) => o.id === kept.id) && stu.open && !stu.ans && later.every((d: Any) => d.rec === 0 && !d.recBy), 'undo of the keep: order removed, answer taken back, recommendations restored');
}

// ------------------------------------------------------------------ urgent questions keep the agent's recommendation
{
  // synthetic: D-27 (booking, in the wing, arrives t=1980) given the operations lens and a cap option
  const copy = (urg: string) => ({ ...SWARM, decisions: SWARM.decisions.map((d: Any) => d.id !== 'D-27' ? d : {
    ...d, lens: 'operations', urgency: urg,
    options: [{ ...d.options[0], effects: [{ k: 'roll', feature: d.feature, pct: 100 }] }, { ...d.options[1], effects: [{ k: 'cap', feature: d.feature, max: 10 }] }],
  }) });
  const run = (urg: string) => { const A = setup(copy(urg)); A.sim.seek(600); A.sim.keepAnswer(A.q(STU).id, 1, 'priya', A.tgt); A.sim.seek(3600); return A.sim.DEC['D-27']; };
  const hi = run('high'), mid = run('medium');
  expect(hi.open && hi.rec === 0 && !hi.recBy, `urgent: a high question in scope keeps the agent's recommendation (rec ${hi.rec}, by ${hi.recBy ?? 'the agent'})`);
  expect(mid.open && mid.rec === 1 && !!mid.recBy, 'urgent, control: the same question at medium takes the kept recommendation');
}

// ------------------------------------------------------------------ batch
{
  const B = setup(); B.sim.seek(3600);
  const g = B.sim.batchGroups().find((x: Any) => x.ids.includes(B.q(STU).id));
  expect(!!g && g.ids.length >= 3, `batch: a group of ${g?.ids.length ?? 0} like questions (${g?.label})`);
  const p = B.sim.previewBatch(g.key), f0 = fp(B.sim), r0 = Object.fromEntries([STU, INS, BKG].map((f) => [f, B.sim.rolloutOf(B.sim.P.F[f])]));
  const n = B.sim.decideBatch(g.key);
  const closed = g.ids.filter((id: string) => !B.sim.DEC[id].open).length;
  const rolled = p.rolls.filter((r: Any) => B.sim.rolloutOf(B.sim.P.F[r.f]) === r.to).length;
  console.log(`batch: ${n} decided together (${g.ids.join(', ')}); rollouts ${[STU, INS, BKG].map((f) => r0[f] + '→' + B.sim.rolloutOf(B.sim.P.F[f])).join(', ')}; preview listed ${p.rolls.length}`);
  expect(n === g.ids.length && closed === n && rolled === p.rolls.length && p.rolls.length === n, `batch: ${closed}/${n} closed, ${rolled}/${p.rolls.length} previewed rollouts hold`);
  B.sim.undoDecision();
  expect(fp(B.sim) === f0, 'batch: one undo restores every field of every question');
  // an urgent question never joins
  const H = setup(); H.sim.seek(3600);
  const hq = H.q(INS); hq.urg = 'high'; H.sim.version++;
  const hg = H.sim.batchGroups().find((x: Any) => x.ids.includes(H.q(STU).id));
  expect(!!hg && !hg.ids.includes(hq.id) && hg.ids.length === 2, `batch: the urgent question stays out (${hg?.ids.join(', ')})`);
  for (const [t, s] of [[0, buildModel(1, () => 0, null).sim], [3600, H.sim]] as [number, Any][]) {
    const bad = s.batchGroups().flatMap((x: Any) => x.ids).filter((id: string) => s.DEC[id].urg === 'high');
    expect(!bad.length, `batch at t=${t}: no urgent question in any group (${bad.join(', ')})`);
  }
  expect(H.sim.decideBatch('no-such|group') === 0, 'batch: an unknown group decides nothing');
}

// ------------------------------------------------------------------ signing, live
{
  const A = setup(); A.sim.seek(600);
  const n = A.sim.orders.length, toasts: Any[] = []; A.sim.listen({ changed() {}, event() {}, toast(t: Any) { toasts.push(t); } });
  expect(!A.sim.keepAnswer(A.q(STU).id, 1, null, A.tgt) && A.q(STU).open && A.sim.orders.length === n && toasts.some((t) => /not kept/i.test(t.strong)), 'a keep with nobody to sign it is refused and decides nothing');
  const P = buildModel(1, () => 0, null).P, L = new SwarmSim(P, SWARM, () => 0, { live: true });
  const d = L.openDecs()[0];
  expect(L.batchGroups().length === 0 && !L.keepAnswer(d.id, 0, 'priya', null) && d.open, 'live: no batch and no keep (sample only)');
}

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${held} of ${held + failures.length} sim-precedent expectations hold`);
process.exit(failures.length ? 1 : 0);
