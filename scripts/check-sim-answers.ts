// Pins that an answer acts (src/lib/model/sim.ts: planAnswer / previewAnswer / decide / undoDecision) on the Kettle swarm:
//   (a) for every option with an effect, the state change after decide equals what previewAnswer listed: rollouts, coverage,
//       agents freed and moved, follow-up questions opened, order breaches added and cleared;
//   (b) D-01: Go to 100% -> PAY-09 at 100% with O-1 breached on it; Roll back -> 0% and O-1 cleared there; Hold keeps 25%;
//   (c) D-05: Move two agents -> exactly 2 agents onto recurring auto-booking (BKG-06); Start next sprint moves none;
//   (d) D-10: Cash via payouts -> a security follow-up question for Jonas;
//   (e) undoDecision restores every field the answer wrote;
//   (f) the t=0 breach stamps equal the fixture's (no recount), at scale 1 and 2;
//   plus: an option without an effect previews nothing, and a live product never simulates an effect (only "expected").
//   (g) the Kettle scan sim (packages/core/src/model/scan-sim.ts) mid-run: cancelling a running build leaves its finding approved,
//       cancelling a running release build fails the release so a build may start again, a temporary lens's no-impact
//       features get an activity line and no reading, and a lens disabled mid-run logs one error while the run still ends done.
// Run: node scripts/check-sim-answers.ts  (Node's type stripping for this file; scripts/overlays-loader.mjs transpiles src/**
// on the fly, as for check:overlays). Exit 1 when any expectation fails.
// Control: BP_SIM_MUTATE='[["sim.ts","this.cap[r.f] = r.cap;",""]]' rewrites source text as it loads ([file suffix, find,
// replace] literals), so an assertion can be seen red on a seeded defect.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_SIM_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const { buildModel } = await impCore('src/model/sample.ts');
const { SwarmSim } = await impCore('src/model/sim.ts');
const { SWARM } = await impCore('src/data/sample.ts');
const MAP = (await impCore('data/kettle.app-structure.json')).default as { features: { id?: string; slug: string }[] };
const RAW = (await impCore('data/swarm.json')).default as { orders: { id: string; violations: number }[] };

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
// the sim keys features by map slug; the swarm fixture (and the brief) by the old short ids
const slug = (id: string) => MAP.features.find((f) => f.id === id)?.slug ?? id;
const PAY09 = slug('PAY-09'), BKG06 = slug('BKG-06');

const fresh = (scale = 1) => buildModel(scale, () => 0, null).sim as Any;
// every field an answer may write, as one comparable string
const fp = (sim: Any) => JSON.stringify({
  roll: sim.roll, prog: sim.prog, cap: sim.cap, cov: sim.cov, breaches: sim.breaches,
  agents: sim.agents.map((a: Any) => [a.id, a.f, a.status, a.task, a.wait, a.pct, a.synth, a.nextSynth, a.paused]),
  decisions: sim.decisions.map((d: Any) => [d.id, d.open, d.ans, d.isNew, d.freed, d.freedIds, d.since, d.blocks]),
  DEC: Object.keys(sim.DEC).sort(), orders: sim.orders.map((o: Any) => [o.id, o.n, o.vf]),
});
// the observable state the check derives changes from (independently of the reducer)
const look = (sim: Any) => ({
  roll: Object.fromEntries(sim.P.features.map((f: Any) => [f.id, sim.rolloutOf(f)])),
  cov: Object.fromEntries(sim.P.features.map((f: Any) => [f.id, sim.covOf(f)])),
  at: Object.fromEntries(sim.agents.map((a: Any) => [a.id, [a.f, a.status, a.wait]])),
  open: new Set<string>(sim.openDecs().map((d: Any) => d.id)),
  vf: Object.fromEntries(sim.orders.map((o: Any) => [o.id, new Set<string>(o.vf)])) as Record<string, Set<string>>,
});
const key = (xs: string[]) => xs.slice().sort().join(' | ');

// ------------------------------------------------------------------ (a) + (e): every option with an effect
const base = fresh();
const withFx: [string, number][] = [];
for (const d of base.decisions) d.opts.forEach((o: Any, i: number) => { if (o.effects?.length) withFx.push([d.id, i]); });
let agree = 0, undone = 0;
for (const [id, oi] of withFx) {
  const sim = fresh(), d = sim.DEC[id];
  if (!d.open) sim.seek(d.arr);                 // a question asked during the hour: answer it once it is open
  const p = sim.previewAnswer(id, oi), b = look(sim), f0 = fp(sim);
  sim.decide(id, oi);
  const a = look(sim), bad: string[] = [];
  // rollouts: every listed one holds after; nothing unlisted moved
  const rolled = Object.keys(a.roll).filter((f) => a.roll[f] !== b.roll[f]).map((f) => f + '>' + a.roll[f]);
  if (key(rolled) !== key(p.rolls.filter((r: Any) => r.from !== r.to).map((r: Any) => r.f + '>' + r.to))) bad.push('rollouts ' + rolled.join(','));
  for (const r of p.rolls) if (a.roll[r.f] !== r.to || sim.cap[r.f] == null) bad.push('rollout ' + r.f + ' not held at ' + r.to);
  const covered = Object.keys(a.cov).filter((f) => a.cov[f] !== b.cov[f]).map((f) => f + '>' + a.cov[f]);
  if (key(covered) !== key(p.cover.filter((c: Any) => c.from !== c.to).map((c: Any) => c.f + '>' + c.to))) bad.push('coverage ' + covered.join(','));
  const moved = Object.keys(a.at).filter((x) => a.at[x][0] !== b.at[x][0]).map((x) => x + '>' + a.at[x][0]);
  if (key(moved) !== key(p.moves.map((m: Any) => m.a.id + '>' + m.to))) bad.push('moves ' + moved.join(','));
  const freed = Object.keys(b.at).filter((x) => b.at[x][2] === id && a.at[x][2] !== id);
  if (key(freed) !== key(p.freed.map((x: Any) => x.id))) bad.push('freed ' + freed.join(','));
  const opened = [...a.open].filter((x) => !b.open.has(x)).map((x) => x + ':' + sim.DEC[x].lens + ':' + sim.DEC[x].decider);
  if (key(opened) !== key(p.asks.map((q: Any) => q.id + ':' + q.lens + ':' + q.decider))) bad.push('questions ' + opened.join(','));
  const br: string[] = [];
  for (const o of Object.keys(a.vf)) { for (const f of a.vf[o]) if (!b.vf[o].has(f)) br.push(o + '+' + f); for (const f of b.vf[o]) if (!a.vf[o].has(f)) br.push(o + '-' + f); }
  if (key(br) !== key(p.breaks.map((x: Any) => x.o + (x.add ? '+' : '-') + x.f))) bad.push('breaches ' + br.join(','));
  if (!bad.length) agree++; else failures.push(`${id} option ${oi + 1}: decide differs from its preview: ${bad.join('; ')}`);
  sim.undoDecision();
  if (fp(sim) === f0) undone++; else failures.push(`${id} option ${oi + 1}: undoDecision left a field changed`);
}
expect(withFx.length >= 7 && agree === withFx.length, `previews that match their outcome: ${agree}/${withFx.length}`);
expect(undone === withFx.length, `undo restores every field: ${undone}/${withFx.length}`);

// effect-free options preview nothing (narrative only)
let none = 0, noneOk = 0;
for (const d of base.openDecs()) d.opts.forEach((o: Any, i: number) => { if (!o.effects?.length) { none++; if (base.previewAnswer(d.id, i) === null) noneOk++; } });
expect(none > 0 && noneOk === none, `options without an effect preview nothing: ${noneOk}/${none}`);

// ------------------------------------------------------------------ (b) D-01 on PAY-09
const o1 = (sim: Any) => sim.orders.find((o: Any) => o.id === 'O-1');
{
  const s0 = fresh();
  expect(s0.DEC['D-01'].f === PAY09 && o1(s0).vf.includes(PAY09), `D-01 sits on ${PAY09} and O-1 is breached there at t=0`);
  const s = fresh(); s.decide('D-01', 0);
  expect(s.rolloutOf(s.P.F[PAY09]) === 100 && o1(s).vf.includes(PAY09), `D-01 "Go to 100% now": ${PAY09} at ${s.rolloutOf(s.P.F[PAY09])}%, O-1 breach ${o1(s).vf.includes(PAY09) ? 'kept' : 'missing'}`);
  const r = fresh(), pr = r.previewAnswer('D-01', 2); r.decide('D-01', 2);
  expect(r.rolloutOf(r.P.F[PAY09]) === 0 && !o1(r).vf.includes(PAY09), `D-01 "Roll back to 0%": ${PAY09} at ${r.rolloutOf(r.P.F[PAY09])}%, O-1 ${o1(r).vf.includes(PAY09) ? 'still breached' : 'cleared'}`);
  expect(pr.breaks.some((x: Any) => x.o === 'O-1' && !x.add && x.by === 'jonas'), 'D-01 "Roll back to 0%": the preview names the O-1 clearance and its owner (jonas)');
  const h = fresh(); h.decide('D-01', 1);
  expect(h.rolloutOf(h.P.F[PAY09]) === 25 && h.cap[PAY09] === 25, `D-01 "Hold at 25%": ${PAY09} at ${h.rolloutOf(h.P.F[PAY09])}%, held at ${h.cap[PAY09]}`);
}

// ------------------------------------------------------------------ (c) D-05 onto BKG-06
for (const [oi, want] of [[0, 2], [1, 0]] as const) {
  const s = fresh(), d = s.DEC['D-05'], before = Object.fromEntries(s.agents.map((a: Any) => [a.id, a.f]));
  s.decide('D-05', oi);
  const onto = s.agents.filter((a: Any) => before[a.id] !== a.f && a.f === BKG06).length, anyMove = s.agents.filter((a: Any) => before[a.id] !== a.f).length;
  expect(d.f === BKG06 && onto === want && anyMove === want, `D-05 option ${oi + 1}: ${onto} agents moved onto ${BKG06} (${anyMove} moved in all), expected ${want}`);
}

// ------------------------------------------------------------------ (d) D-10 opens a security follow-up for jonas
{
  const s = fresh(), before = new Set(s.openDecs().map((d: Any) => d.id));
  s.decide('D-10', 1);
  const fu = s.openDecs().filter((d: Any) => !before.has(d.id));
  expect(fu.length === 1 && fu[0].lens === 'security' && fu[0].decider === 'jonas', `D-10 "Cash via payouts": follow-ups ${JSON.stringify(fu.map((d: Any) => [d.id, d.lens, d.decider]))}, expected one security question for jonas`);
  const c = fresh(); c.decide('D-10', 0);
  expect(c.openDecs().length === before.size - 1, 'D-10 "Class credit" opens no follow-up');
}

// ------------------------------------------------------------------ (f) t=0 stamps are the fixture's
for (const scale of [1, 2]) {
  const s = fresh(scale), bad: string[] = [];
  for (const o of RAW.orders) {
    const so = s.orders.find((x: Any) => x.id === o.id);
    if (so.n !== o.violations) bad.push(`${o.id} n ${so.n} != ${o.violations}`);
    if (['O-1', 'O-2', 'O-3', 'O-5'].includes(o.id) && so.vf.length !== o.violations * scale) bad.push(`${o.id} ${so.vf.length} stamps != ${o.violations * scale}`);
  }
  expect(!bad.length && s.breaches === 0, `t=0 breach stamps at scale ${scale} equal the fixture's${bad.length ? ': ' + bad.join(', ') : ''}`);
}

// ------------------------------------------------------------------ live: no simulated effect, ever
{
  const P = buildModel(1, () => 0, null).P;
  const L = new SwarmSim(P, { ...SWARM, decisions: SWARM.decisions.map((d: Any) => d.id === 'D-08' ? { ...d, options: [{ ...d.options[0], expected: 'cost +12 USD' }, ...d.options.slice(1)] } : d) }, () => 0, { live: true });
  expect(L.previewAnswer('D-01', 0) === null, 'live: an option with a simulated effect previews nothing');
  const e = L.previewAnswer('D-08', 0);
  expect(!!e && e.expected === 'cost +12 USD' && !e.moves.length && !e.rolls && !e.breaks && !e.asks && e.marks.every((m: Any) => m.text.startsWith('expected')), 'live: Approve previews only the expected move, labelled expected');
  const f0 = L.rolloutOf(P.F[PAY09]); L.decide('D-01', 0);
  expect(L.rolloutOf(P.F[PAY09]) === f0 && L.cap[PAY09] === undefined && L.agents.every((a: Any) => a.f === SWARM.agents.find((x: Any) => x.id === a.id).feature), 'live: deciding applies no simulated effect');
}

// ------------------------------------------------------------------ (g) the scan sim's answers mid-run (packages/core/src/model/scan-sim.ts)
// What the Kettle sample does when a person acts on a running job: cancel a build (the finding goes back to approved, nothing
// was committed), cancel a release build (the release fails so a build may start again), a temporary lens that finds nothing
// to say about a feature (no impact: an activity line, no reading, health na), and a lens disabled mid-run (one error line,
// the run still ends done). The sim's own timer runs on this check's clock, one step per advance.
{
  const { ScanSim } = await impCore('src/model/scan-sim.ts');
  const structure = (await impCore('data/kettle.app-structure.json')).default as Any;
  const manifests = new Map<string, Any>(structure.lenses.map((l: Any) => [l.id, l.manifest]));
  const mapValue = (f: string, l: string, k: string): number | undefined => { const v = structure.facets[f]?.[l]?.values?.[k]; return typeof v === 'number' ? v : undefined; };
  const order: string[] = structure.features.map((f: Any) => f.slug);
  const TMP = { id: 'tmp.money-migration', fields: [{ key: 'oldMoneySites', label: 'Old money sites', type: 'integer', metric: { better: 'down', method: 'judgement' } }], presentation: { glyph: 'brackets', line: 'comb' } };
  let clock = Date.parse('2026-10-15T12:00:00.000Z'), off = '';
  const finding = { id: 'p-c0ffee', run_id: 'r0', feature: order[0], lens: 'design', title: 'A finding to build', standard: 'none', kind: 'fix', status: 'approved', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' };
  const sim = new ScanSim({ now: () => clock, findings: [finding] });
  sim.bind({ order, manifest: (l: string) => (l === off ? undefined : l === TMP.id ? TMP : manifests.get(l)), value: mapValue });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const step = async (ms: number) => { clock += ms; await sleep(260); };
  const jobOf = (id: string) => sim.jobs().find((j: Any) => j.id === id);
  const settle = async (id: string, ms = 1200) => { for (let i = 0; i < 40 && ['queued', 'running'].includes(jobOf(id)?.status); i++) await step(ms); return jobOf(id); };
  const runOf = (id: string) => sim.snapshot().runs.find((r: Any) => r.id === id);
  const acts = (run: string) => sim.snapshot().activity.filter((a: Any) => a.run_id === run);
  try {
    // cancel a running build: the finding being built goes back to approved, the run is aborted
    const b = sim.dispatch([finding.id]).job, building = sim.snapshot().proposals.find((p: Any) => p.id === finding.id)?.status;
    const bc = sim.cancel(b.id), after = sim.snapshot().proposals.find((p: Any) => p.id === finding.id);
    expect(building === 'executing' && bc.status === 'cancelled' && after?.status === 'approved' && !after.result_sha && runOf(b.run_id)?.status === 'aborted',
      `scan sim: cancelling a running build leaves the finding approved and the run aborted: ${JSON.stringify([building, bc.status, after?.status, runOf(b.run_id)?.status])}`);
    await step(20000);
    expect(sim.snapshot().proposals.find((p: Any) => p.id === finding.id)?.status === 'approved' && jobOf(b.id)?.status === 'cancelled', 'scan sim: a cancelled build commits nothing later on the timer');

    // cancel a running release build: the release fails with the cancel named, and a build may start again
    const free = sim.snapshot().proposals.filter((p: Any) => p.pack_id && (p.status === 'done' || p.status === 'failed')).map((p: Any) => p.id);
    sim.triage({ ids: free, decision: 'accept', note: 'accepted for this check' });
    const rel = sim.createRelease('0.1.0').release?.id ?? 'rel-0.1.0';
    const relOf = () => sim.snapshot().releases.find((r: Any) => r.id === rel);
    const rj = sim.buildRelease(rel), was = relOf()?.status;
    const rc = sim.cancel(rj.id);
    expect(was === 'building' && rc.status === 'cancelled' && relOf()?.status === 'failed' && /cancelled/.test(relOf()?.error ?? ''),
      `scan sim: cancelling a running release build fails the release, naming the cancel: ${JSON.stringify([was, rc.status, relOf()?.status, relOf()?.error])}`);
    let again: Any = null; try { again = sim.buildRelease(rel); } catch (e) { again = e; }
    expect(again?.kind === 'release' && again.status !== 'cancelled', `scan sim: after the cancel a build of the release starts again: ${JSON.stringify(again?.status ?? again?.message)}`);
    if (again?.id) sim.cancel(again.id);

    // a temporary lens over every feature: the ones it finds nothing on log "no impact on <f>", get no reading, and read na
    const tj = sim.startScan(TMP.id, { kind: 'all', label: 'Everything', features: [] });
    // one advance past every feature's step: a single tick of the sim walks them all
    const td = await settle(tj.id, 1200 * order.length), ta = acts(tj.run_id).filter((a: Any) => a.kind === 'measured');
    const none = ta.filter((a: Any) => a.text === 'no impact on ' + a.feature).map((a: Any) => a.feature), na = sim.noImpact().get(TMP.id);
    const read = new Set(sim.snapshot().measurements.filter((m: Any) => m.run_id === tj.run_id).map((m: Any) => m.feature));
    expect(td?.status === 'done' && ta.length === order.length && none.length > 0 && none.length < order.length && none.every((f: string) => !read.has(f) && na?.has(f)) && na?.size === none.length
      && order.filter((f) => !none.includes(f)).every((f) => read.has(f)),
      `scan sim: a temporary lens logs no impact (no reading, health na) on the features it does not touch and measures the rest: ${JSON.stringify([td?.status, ta.length, none.length, read.size, na?.size])}`);

    // a lens disabled mid-run: the feature after it logs one error, and the run still ends done
    const dj = sim.startScan('design', { kind: 'room', id: 'r', label: 'Two', features: order.slice(0, 2) });
    await step(1200);
    const first = acts(dj.run_id).filter((a: Any) => a.kind === 'measured').length;
    off = 'design';
    const dd = await settle(dj.id);
    off = '';
    const errs = acts(dj.run_id).filter((a: Any) => a.kind === 'error');
    expect(first === 1 && errs.length === 1 && errs[0].text === 'design is no longer enabled' && errs[0].feature === order[1] && dd?.status === 'done' && runOf(dj.run_id)?.status === 'done',
      `scan sim: a lens disabled mid-run logs one error and the run still finishes: ${JSON.stringify([first, errs.map((a: Any) => a.text + '@' + a.feature), dd?.status, runOf(dj.run_id)?.status])}`);
  } finally { sim.dispose(); }
}

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`previews that match their outcome: ${agree}/${withFx.length}`);
console.log(`${held} of ${held + failures.length} sim-answer expectations hold`);
process.exit(failures.length ? 1 : 0);
