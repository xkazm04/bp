// Blocker chains on the plan (tiger swarm-steer S2): the swarm sample names the feature that blocks an agent by its
// old short id (`PAY-14`), so until adaptSwarm re-keyed it no blocked agent pointed at a feature of the map and the
// plan could draw no chain. Pins: every blocked agent's `blk` resolves to a map feature (printed against the raw
// feed's count), `sim.blockedByFeature` is the exact reverse, the payout-reconciliation question (D-21) reports
// its one downstream agent on its card, the same holds with `?scale=2` line suffixes, a crew picked in the Agents
// flyout dims the others, and the key plan paints a paused agent in neutral ink rather than red.
// Run: node scripts/check-sim-blockers.ts  (scripts/overlays-loader.mjs transpiles src/** on the fly). Exit 1 on any miss.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_OVERLAYS_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const req = createRequire(path.join(ROOT, 'package.json'));
const React: Any = req('react'), { renderToString }: Any = req('react-dom/server');
const rawSwarm: Any = (await imp('data/swarm.json')).default;
const { buildModel } = await imp('lib/model/sample.ts');
const { initialState } = await imp('engine/state.ts');
const { EngineCtx, VariantCtx } = await imp('components/hooks.ts');
const { getVariant } = await imp('variants/registry.ts');
const O = await imp('components/Overlays.tsx');
const { agentAlpha } = await imp('engine/render/dynamic.ts');
const { keyDotColor } = await imp('engine/render/keyplan.ts');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

// 1. before: the raw feed's blockedBy against the map's feature ids; after: the sim's blk
const M1 = buildModel(1, () => 0, null), sim1 = M1.sim, P1 = M1.P;
const rawBlocked = rawSwarm.agents.filter((a: Any) => a.blockedBy);
const before = rawBlocked.filter((a: Any) => P1.F[a.blockedBy]).length;
const blocked1 = sim1.agents.filter((a: Any) => a.blk);
const after = blocked1.filter((a: Any) => P1.F[a.blk]).length;
console.log(`blocked agents whose blocker is a map feature: before ${before} of ${rawBlocked.length} (raw feed), after ${after} of ${blocked1.length}`);
expect(rawBlocked.length > 0 && blocked1.length === rawBlocked.length && after === blocked1.length, `only ${after} of ${blocked1.length} blocked agents resolve to a map feature`);

// 2. the reverse index holds each blocked agent under its blocker, and nothing else
function reverseHolds(sim: Any, label: string) {
  let n = 0;
  for (const a of sim.agents) if (a.blk && a.status === 'blocked') { n++; expect(sim.blockedByFeature(a.blk).includes(a), `${label}: blockedByFeature(${a.blk}) misses ${a.id}`); }
  const total = Object.keys(sim.BLF).reduce((s: number, k: string) => s + sim.blockedByFeature(k).length, 0);
  expect(total === n && n > 0, `${label}: the reverse index holds ${total} agents, ${n} are blocked`);
  return n;
}
reverseHolds(sim1, 'scale 1');

// 3. D-21 (payout reconciliation, short id PAY-14) holds one agent downstream, and its card says so
const d21 = sim1.DEC['D-21'];
expect(!!d21 && d21.f === 'payout-reconciliation', `D-21 sits on ${d21?.f}, expected payout-reconciliation`);
const down = d21 ? sim1.blockedByFeature(d21.f) : [];
console.log(`D-21 on ${d21?.f}: ${down.length} downstream blocked (${down.map((a: Any) => a.id).join(', ')})`);
expect(down.length === 1, `D-21 reports ${down.length} downstream blocked agents, expected 1`);
const text = (html: string) => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
function render(M: Any, el: () => Any, patch: Record<string, unknown>) {
  const S = { ...initialState(1, M.P.asOf), ready: true, ...patch };
  const E = {
    M, S, U: 1, SAFE: { l: 0, t: 0, r: 1280, b: 800 }, FW: 1280, FH: 800,
    store: { get: () => S, subscribe: () => () => {} },
    setHoverEl() {}, placeHover() {}, dirty() {}, onFrame: () => () => {}, flyToFeature() {}, featureRect: () => null,
    placeById: () => null, lensAgg: () => ({ parts: [] }), channel: () => null,
  };
  return renderToString(React.createElement(VariantCtx.Provider, { value: getVariant('subtle') }, React.createElement(EngineCtx.Provider, { value: E }, el())));
}
const card = text(render(M1, () => React.createElement(O.DecisionCard), { dec: 'D-21' }));
expect(/1 agent blocked downstream/.test(card), 'the D-21 card does not say "1 agent blocked downstream"');
const blockedAgent = down[0];
const hov = blockedAgent ? text(render(M1, () => React.createElement(O.HoverCard), { hover: { type: 'agent', id: blockedAgent.id } })) : '';
expect(hov.includes('Blocked by ' + P1.F['payout-reconciliation']?.name), `the hover card of ${blockedAgent?.id} does not name its blocker`);

// 4. ?scale=2: line-suffixed ids still resolve, per line
const M2 = buildModel(2, () => 0, null), sim2 = M2.sim;
const blocked2 = sim2.agents.filter((a: Any) => a.blk);
const res2 = blocked2.filter((a: Any) => M2.P.F[a.blk]).length;
console.log(`scale 2: ${res2} of ${blocked2.length} blocked agents resolve`);
expect(blocked2.length === 2 * rawBlocked.length && res2 === blocked2.length, `scale 2: ${res2} of ${blocked2.length} resolve`);
reverseHolds(sim2, 'scale 2');
for (const d of sim2.decisions.filter((x: Any) => x.base === 'D-21')) expect(sim2.blockedByFeature(d.f).length === 1, `scale 2: ${d.id} on ${d.f} reports ${sim2.blockedByFeature(d.f).length}`);

// 5. crew focus: S.crew = forge-1 keeps its agents bright, dims every other crew (whatever the lens says)
const crews = new Set<string>(sim1.agents.map((a: Any) => a.sq));
let dimOk = true;
for (const a of sim1.agents) {
  const al = agentAlpha(a.sq, 'forge-1', true);
  if (a.sq === 'forge-1' ? al !== 1 : al >= 1) dimOk = false;
}
expect(crews.size > 1 && dimOk, 'S.crew=forge-1 does not keep forge-1 at full alpha and dim the other crews');
expect(agentAlpha('scout', null, true) === 1 && agentAlpha('scout', null, false) < 1, 'without a crew picked the lens dimming changed');

// 6. key plan: a paused agent is neutral ink, not red; blocked stays red
const th = { mint: 'MINT', amber: 'AMBER', red: 'RED', inkA: (x: number) => 'INK' + x };
const pausedFill = keyDotColor(th, { status: 'working', paused: true });
expect(pausedFill !== th.red && pausedFill.startsWith('INK'), `paused fill is ${pausedFill}`);
expect(keyDotColor(th, { status: 'blocked', paused: false }) === th.red && keyDotColor(th, { status: 'working', paused: false }) === th.mint, 'key plan colours for blocked/working changed');

if (failures.length) { console.error(`check-sim-blockers: ${failures.length} failed (${held} held)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`check-sim-blockers: ${held} expectations held`);
