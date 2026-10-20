// Pins that written orders govern the recorded hour (src/lib/model/sim.ts: govern / rollLimit / orderAsk / unhold), on the Kettle swarm:
//   - `ask` on the Studio operations wing at t=0, signed priya: before, STU-06 / INS-02 / BKG-02 reach 25 / 50 / 50% with no order
//     question; after, exactly 3 questions for priya (one per feature), all three at <=10% after every flag change, the preview's
//     held count is what happened, and "Go ahead to 25%" sets 25% (through the answer reducer);
//   - `hold` on a room: moves into it and generated commits there (> 0 before) are 0 during the hour;
//   - `review` opens one question per feature with a review event and holds the commits after it, as previewed;
//   - `first`: push previews take no donor from its scope;
//   - spend accrues from tokens a minute (more at t=3600 than t=0, the same whatever the frame steps), and pausing research
//     (once its agents work) lowers the hour's growth;
//   - an order with nobody to sign it is refused; undoCommand puts the hour back (rollouts, questions, agents);
//   - per-event toasts collapse above 60x.
// Run: node scripts/check-sim-orders.ts  (Node's type stripping for this file; scripts/overlays-loader.mjs transpiles src/** on the
// fly, as for check:overlays). Exit 1 when any expectation fails.
// Control: BP_SIM_MUTATE='[["sim.ts","if (!lim || 10 < lim.max)","if (false)"]]' rewrites source text as it loads ([file suffix,
// find, replace] literals), so an assertion can be seen red on a seeded defect.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_SIM_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const { buildModel } = await impCore('src/model/sample.ts');
const MAP = (await impCore('data/kettle.app-structure.json')).default as { features: { id?: string; slug: string }[] };

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const slug = (id: string) => MAP.features.find((f) => f.id === id)?.slug ?? id;
const THREE = ['STU-06', 'INS-02', 'BKG-02'].map(slug);

// a fresh sample, with what the hour does recorded through the listener
function run() {
  const M = buildModel(1, () => 0, null), sim = M.sim as Any, L = M.L as Any;
  const rec = { max: {} as Record<string, number>, toasts: [] as Any[], moves: [] as Any[], synth: [] as Any[] };
  sim.listen({
    changed() {}, toast(t: Any) { rec.toasts.push(t); },
    event(e: Any) {
      if (e.type === 'flag-change') rec.max[e.f] = Math.max(rec.max[e.f] ?? 0, sim.roll[e.f]);
      if (e.type === 'move' && !e.held) rec.moves.push(e);
      if (e.type === 'commit' && e.syn) rec.synth.push(e);
    },
  });
  return { M, sim, L, rec };
}
const tgtOf = (feats: Any[], label: string) => { const ids: Record<string, 1> = {}; for (const f of feats) ids[f.id] = 1; return { ids, n: feats.length, label }; };
const write = (sim: Any, tgt: Any, tpl: string, who: string | null) => { const p = sim.previewOrder(tgt, tpl, who); sim.commit(p, who); return { p, o: sim.orders[sim.orders.length - 1] }; };
const orderQs = (sim: Any, o: Any) => sim.decisions.filter((d: Any) => d.ord === o.id);
const look = (sim: Any) => JSON.stringify({ r: THREE.map((f) => sim.rolloutOf(sim.P.F[f])), a: sim.agents.map((a: Any) => [a.id, a.f, a.status]), q: sim.openDecs().map((d: Any) => d.id).sort() });

// ------------------------------------------------------------------ ask on the Studio operations wing
const ops = (L: Any) => L.wings.find((w: Any) => w.def.name === 'Studio operations');
const before = run(); before.sim.seek(3600);
const reach = THREE.map((f) => before.rec.max[f]);
console.log(`ask, before: STU-06 / INS-02 / BKG-02 reach ${reach.join(' / ')}%, ${before.sim.decisions.filter((d: Any) => d.ord).length} order questions`);
expect(reach.join('/') === '25/50/50', `ask, before: the three reach ${reach.join('/')}%, expected 25/50/50`);
{
  const A = run(), w = ops(A.L), { p, o } = write(A.sim, tgtOf(w.feats, w.def.name), 'ask', 'priya');
  expect(o.by === 'priya' && o.tpl === 'ask', `ask: the order is signed ${o.by} with template ${o.tpl}`);
  A.sim.seek(3600);
  const qs = orderQs(A.sim, o), fs = qs.map((d: Any) => d.f).sort();
  console.log(`ask, after: ${qs.length} questions for ${[...new Set(qs.map((d: Any) => d.decider))].join(',')}; peaks ${THREE.map((f) => A.rec.max[f]).join(' / ')}%; ${o.held?.n ?? 0} events held (preview said ${p.n})`);
  expect(qs.length === 3 && qs.every((d: Any) => d.decider === 'priya' && d.open) && fs.join() === THREE.slice().sort().join(), `ask: ${qs.length} open questions for priya on ${fs.join(', ')}, expected one on each of the three`);
  expect(THREE.every((f) => A.rec.max[f] <= 10 && A.sim.rolloutOf(A.sim.P.F[f]) <= 10), `ask: the three peak at ${THREE.map((f) => A.rec.max[f]).join('/')}% after their flag changes, expected <=10 until answered`);
  expect(o.held?.n === p.n && p.n > 0, `ask: the preview said ${p.n} events would be held, ${o.held?.n} were`);
  expect(A.sim.log.some((e: Any) => e.held === o.id && /held by O-\d+ at 10%/.test(e.text)), 'ask: a held flag change is logged "held by O-n at 10%"');
  const stu = qs.find((d: Any) => d.f === slug('STU-06'));
  expect(!!stu && stu.opts[0].label === 'Go ahead to 25%' && /O-\d+/.test(stu.q), `ask: STU-06's question offers ${JSON.stringify(stu?.opts.map((x: Any) => x.label))}`);
  if (stu) A.sim.decide(stu.id, 0);
  expect(!!stu && A.sim.rolloutOf(A.sim.P.F[slug('STU-06')]) === 25, `ask: "Go ahead to 25%" sets STU-06 to ${A.sim.rolloutOf(A.sim.P.F[slug('STU-06')])}%`);
  // undo of the order puts the hour back: rollouts, questions and agents as without it
  const U = run(), wu = ops(U.L); write(U.sim, tgtOf(wu.feats, wu.def.name), 'ask', 'priya'); U.sim.seek(3600);
  const nq = U.sim.decisions.length; U.sim.undoCommand();
  expect(look(U.sim) === look(before.sim) && U.sim.decisions.length === nq - 3, 'ask: undoCommand restores rollouts, questions and agents to the hour without the order');
}

// ------------------------------------------------------------------ hold on a room (Platform: moves in; freed agents commit there)
const room = (L: Any) => L.rooms.find((r: Any) => r.id === 'platform');
const inRoom = (L: Any, f: string) => L.TILE[f]?.room.id === 'platform';
const holdRun = (order: boolean) => {
  const R = run(), r = room(R.L);
  R.sim.decide('D-14', 0); R.sim.decide('D-24', 0);   // freed agents there generate commits
  const w = order ? write(R.sim, tgtOf(r.feats, r.d.name), 'hold', 'tomas') : null;
  R.sim.setSpeed(240); while (!R.sim.over) R.sim.advance(90);   // generated commits come from advance, not seek
  return { R, w, moves: R.rec.moves.filter((e: Any) => inRoom(R.L, e.f)).length, synth: R.rec.synth.filter((e: Any) => inRoom(R.L, e.f)).length };
};
{
  const b = holdRun(false), a = holdRun(true);
  console.log(`hold, before: ${b.moves} moves into Platform, ${b.synth} generated commits there; after: ${a.moves} and ${a.synth}`);
  expect(b.moves > 0 && b.synth > 0, `hold, before: ${b.moves} moves in and ${b.synth} generated commits, expected both > 0`);
  expect(a.moves === 0 && a.synth === 0, `hold: ${a.moves} moves into the room and ${a.synth} generated commits there, expected 0 and 0`);
  expect(a.w!.o.held?.n === a.w!.p.n, `hold: the preview said ${a.w!.p.n} moves would be refused, ${a.w!.o.held?.n} were`);
  a.R.sim.undoCommand();
  const pos = (s: Any) => JSON.stringify(s.agents.map((x: Any) => [x.id, x.f]));
  expect(pos(a.R.sim) === pos(b.R.sim), 'hold: undoCommand sends the refused agents where the hour took them');
}

// ------------------------------------------------------------------ review and first
{
  // the room whose recorded hour has the most commits after a review event (the ones a review order holds)
  const R = run(), score = (r: Any) => { const seen = new Set<string>(); let n = 0; for (const e of R.sim.events) { if (R.L.TILE[e.f]?.room !== r) continue; if (['pr-open', 'review-pass', 'review-changes'].includes(e.type)) seen.add(e.f); else if (e.type === 'commit' && seen.has(e.f)) n++; } return n; };
  const r = R.L.rooms.slice().sort((a: Any, b: Any) => score(b) - score(a))[0], { p, o } = write(R.sim, tgtOf(r.feats, r.d.name), 'review', 'ines');
  const pg0 = { ...R.sim.prog }; R.sim.seek(3600);
  const qs = orderQs(R.sim, o);
  expect(qs.length > 0 && qs.every((d: Any) => d.decider === 'ines' && d.open) && o.held?.n === p.n, `review: ${qs.length} questions for ines, ${o.held?.n} commits held (preview said ${p.n})`);
  const B = run(); B.sim.seek(3600);
  expect(qs.some((d: Any) => (B.sim.prog[d.f] ?? 0) > (R.sim.prog[d.f] ?? 0)) && Object.keys(pg0).length === 0, 'review: build progress on a gated feature stops below the hour without the order');
}
{
  const R = run(), tgt = tgtOf([R.sim.P.F[slug('BKG-06')]], 'Recurring auto-booking');
  const d0 = R.sim.previewPushHere(tgt, () => 'w')?.moves.map((m: Any) => m.a) ?? [];
  const from = d0[0] && R.L.TILE[d0[0].f].room;
  expect(!!from, 'first: a push preview with donors to protect');
  if (from) {
    write(R.sim, tgtOf(from.feats, from.d.name), 'first', 'dev');
    const d1 = R.sim.previewPushHere(tgt, () => 'w')?.moves.map((m: Any) => m.a) ?? [];
    expect(d1.every((a: Any) => R.L.TILE[a.f].room !== from) && d1.length > 0, `first: ${d1.filter((a: Any) => R.L.TILE[a.f].room === from).length} donors from ${from.d.name}, expected 0`);
  }
}

// ------------------------------------------------------------------ spend
{
  const R = run(), s0 = R.sim.spend(); R.sim.seek(3600);
  console.log(`spend: $${s0} at t=0, $${R.sim.spend()} at t=3600`);
  expect(R.sim.spend() > s0, `spend: $${R.sim.spend()} at t=3600, not above $${s0} at t=0`);
  // the same at t=1800 whether the hour ran in small or large frames
  const at = (dt: number, speed: number) => { const X = run(); X.sim.setSpeed(speed); while (X.sim.t < 1700) X.sim.advance(dt); X.sim.seek(1800); return X.sim.agents.reduce((s: number, a: Any) => s + a.cost, 0); };
  const c1 = at(16, 60), c2 = at(90, 240);
  expect(Math.abs(c1 - c2) < 1e-6, `spend: frame steps change it (${c1.toFixed(4)} vs ${c2.toFixed(4)})`);
  const research = (pause: boolean) => {
    const X = run(); X.sim.decide('D-05', 0); X.sim.decide('D-24', 0);   // frees scout.3 and scout.1: research works
    let line = '';
    if (pause) { const p = X.sim.previewResearch(); line = p.lines[2]; X.sim.commit(p, 'mara'); }
    const a = X.sim.spend(); X.sim.seek(3600);
    return { g: X.sim.spend() - a, line };
  };
  const g0 = research(false), g1 = research(true);
  console.log(`spend: growth over the hour $${g0.g} with research working, $${g1.g} after pausing it ("${g1.line}")`);
  expect(g1.g < g0.g && /falls from \$\d+ to \$\d+/.test(g1.line), `spend: pausing research grows spend by $${g1.g}, not below $${g0.g}; preview "${g1.line}"`);
}

// ------------------------------------------------------------------ signing, toasts
{
  const R = run(), w = ops(R.L), n = R.sim.orders.length;
  write(R.sim, tgtOf(w.feats, w.def.name), 'ask', null);
  expect(R.sim.orders.length === n && R.rec.toasts.some((t: Any) => /not written/i.test(t.strong)), 'an order with nobody to sign it is refused with a toast');
  expect(!R.sim.orders.some((o: Any) => o.user && o.by === 'mara'), 'no order is signed mara by default');
}
{
  const toasts = (speed: number) => {
    const R = run(), w = ops(R.L); write(R.sim, tgtOf(w.feats, w.def.name), 'ask', 'priya');
    R.rec.toasts.length = 0; R.sim.setSpeed(speed); while (!R.sim.over) R.sim.advance(90);
    return R.rec.toasts.length;
  };
  const t8 = toasts(8), t240 = toasts(240);
  expect(t240 < t8 && t240 <= 2, `toasts: ${t240} at 240x vs ${t8} at 8x, expected them collapsed above 60x`);
}

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${held} of ${held + failures.length} sim-order expectations hold`);
process.exit(failures.length ? 1 : 0);
