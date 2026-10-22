// Usage: node scripts/fixtures/gen-swarm.mjs <dir-with-kettle.json> [--js] [--check]
//   (packages/core/data/swarm.json is this output)
// Deterministic agent-swarm layer over kettle.json: who is working where right now, what waits on a human,
// the standing orders humans gave, and one replayable hour of swarm events. Writes swarm.json + swarm.js.
//   --check regenerates in memory and diffs against the committed swarm.json, writing nothing
//   (npm run check:swarm-data): the gate that notices when the committed fixture stops being this file's output.
import fs from 'node:fs';
import path from 'node:path';
import { mulberry32 } from '../lib/prng.ts';
import { outDirFrom, writeOrCheck } from '../lib/fixture-bytes.ts';

const CHECK = process.argv.includes('--check');
const DIR = outDirFrom(process.argv.slice(2));
const K = JSON.parse(fs.readFileSync(path.join(DIR, 'kettle.json'), 'utf8'));
const rnd = mulberry32(7310);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const NOW = new Date('2026-10-08T09:00:00Z');
const at = (sec) => new Date(NOW.getTime() + sec * 1000).toISOString().replace('.000', '');
const ago = (min) => new Date(NOW.getTime() - min * 60000).toISOString().replace('.000', '');

const F = new Map(K.features.map((f) => [f.id, f]));
const featsIn = (stages) => K.features.filter((f) => stages.includes(f.stage));

// ---------- squads and agents ----------
// The six named agents of kettle.json lead squads; the swarm is the crews behind them.
const squads = [
  { id: 'forge-1', name: 'Forge-1 crew', role: 'build', focus: 'backend & workers', size: 9 },
  { id: 'forge-2', name: 'Forge-2 crew', role: 'build', focus: 'web admin & member web', size: 7 },
  { id: 'forge-3', name: 'Forge-3 crew', role: 'build', focus: 'mobile & kiosk', size: 5 },
  { id: 'forge-4', name: 'Forge-4 crew', role: 'build', focus: 'integrations & API', size: 5 },
  { id: 'warden', name: 'Warden crew', role: 'review', focus: 'code review, tests, accessibility checks', size: 6 },
  { id: 'tender', name: 'Tender crew', role: 'operate', focus: 'deploys, flags, alerts, cost', size: 4 },
  { id: 'scout', name: 'Scout crew', role: 'research', focus: 'specs, customer requests, competitor notes', size: 3 },
  { id: 'sentinel', name: 'Sentinel crew', role: 'security', focus: 'threat models, dependency and secret scans', size: 3 },
];
const TASKS = {
  build: ['implement {f}', 'write tests for {f}', 'refactor {f} after review', 'fix failing e2e on {f}', 'wire {f} into the admin UI', 'migrate data for {f}'],
  review: ['review PR for {f}', 'run e2e suite on {f}', 'accessibility check on {f}', 'regression pass on {f}'],
  operate: ['roll out {f} flag', 'watch error rate on {f}', 'tune alert thresholds for {f}', 'cost check on {f}'],
  research: ['draft spec for {f}', 'cluster customer requests for {f}', 'compare competitor flows for {f}'],
  security: ['threat model {f}', 'dependency scan on {f}', 'review data access in {f}'],
};
const STAGES_FOR = { build: ['in-dev', 'in-review', 'specified'], review: ['in-review', 'in-dev', 'flagged'], operate: ['flagged', 'live'], research: ['idea', 'specified'], security: ['in-review', 'flagged', 'in-dev'] };
const focusDomains = { 'forge-3': ['MEM', 'INS', 'BKG'], 'forge-4': ['INT', 'PAY', 'COM'], 'forge-2': ['STU', 'SCH', 'MEM', 'GRO', 'ANA'], 'forge-1': ['PAY', 'BKG', 'SCH', 'PLT', 'AIA', 'IAM', 'COM'] };

const agents = [];
for (const s of squads) {
  for (let i = 1; i <= s.size; i++) {
    const pool = featsIn(STAGES_FOR[s.role]).filter((f) => !focusDomains[s.id] || focusDomains[s.id].includes(f.domain));
    const f = pick(pool.length ? pool : featsIn(STAGES_FOR[s.role]));
    agents.push({
      id: `${s.id}.${i}`, squad: s.id, role: s.role, status: 'working', feature: f.id,
      task: pick(TASKS[s.role]).replace('{f}', f.name), progressPct: ri(5, 95), since: ago(ri(3, 140)),
      tokensPerMin: ri(800, 9000), costUsdToday: +(ri(40, 900) / 10).toFixed(1), doneToday: ri(0, 9),
    });
  }
}

// ---------- decisions waiting on a human ----------
// A row is [feature id, lens, decider, question, options, recommended, urgency]. The feature id is the only
// identity a row carries: the decision's `domain` is read off the feature (`featOf(fid).domain`), never typed
// beside it. It used to be both - a hand-typed domain column here AND a parallel FIDS array of feature ids,
// index-coupled to it - and 3 of the 25 rows disagreed with the feature they were paired with (D-07 typed MEM
// for BKG-08 "Front-desk check-in kiosk", D-09 typed STU for GRO-07 "Legacy landing page builder", D-20 typed
// MEM for PAY-04 "Family plans"). The output was right only because this path overwrote the typed value; the
// `later` path below trusted it, so the same mistake there would have shipped.
// An option's optional third element is its effects (OptionEffect in packages/core/src/data/types.ts): only what the consequence
// sentence states, on the decision's feature; every other option is narrative only. No rnd() here: effects are data.
const decisionDefs = [
  ['PAY-09', 'business', 'mara', 'Raise dunning rollout from 25% to 100% before Payments GA?', [['Go to 100% now', 'Recovers about $3.1k MRR a month sooner; no human or security review yet.', [{ k: 'roll', pct: 100 }]], ['Hold at 25% until review', 'GA date holds only if the review lands this week.', [{ k: 'cap', max: 25 }]], ['Roll back to 0%', 'Stops the risk; failed payments go back to manual follow-up.', [{ k: 'roll', pct: 0 }]]], 1, 'high'],
  ['PAY-09', 'security', 'jonas', 'Dunning emails include the last 4 card digits. Allowed under the card data policy?', [['Allow', 'Matches what most processors show.'], ['Mask fully', 'Two templates and one test to change; about 40 minutes of agent work.']], 1, 'high'],
  ['PAY-12', 'development', 'tomas', 'Tax handling: use the provider\'s tax API or keep the in-house tables?', [['Provider API', 'Adds a dependency and $0.004 per call; removes 1,900 lines.'], ['In-house tables', 'Agents estimate 3 more days; we own the rate updates.']], 0, 'high'],
  ['BKG-03', 'operations', 'priya', 'Waitlist promotion caused the incident on Monday. Re-enable for all studios?', [['Re-enable', 'Fix is merged and passing; no load test yet.'], ['Re-enable for 10 studios', 'Canary for 48 h first.'], ['Keep off', 'Members join the waitlist but are never promoted.']], 1, 'high'],
  ['BKG-06', 'business', 'dev', 'Recurring auto-booking (P0) is not started. Pull two Forge-1 agents off Analytics to start it?', [['Move two agents', 'Analytics exports slip about a week.', [{ k: 'staff', n: 2, from: { domain: 'ANA', role: 'build' } }]], ['Start next sprint', 'P0 waits 9 more days.']], 0, 'high'],
  ['INT-01', 'security', 'jonas', 'Public API has no rate limiting. Block the partner launch until it ships?', [['Block launch', 'Partner integration slips about 5 days.'], ['Launch with a static limit', '100 req/min per key, refined later.']], 1, 'high'],
  ['BKG-08', 'design', 'lea', 'Kiosk check-in fails the contrast check on two screens. Accept the agent\'s proposed palette?', [['Accept proposal', 'Passes AA; buttons change from teal to deep blue.'], ['Send back with notes', 'Agent iterates; adds a day.']], 0, 'medium'],
  ['COM-02', 'business', 'mara', 'SMS reminders cost $1,240 a month and rising. Cap per studio?', [['Cap at 300 per studio', 'Saves about $410 a month; 11 studios hit the cap.'], ['Charge studios for SMS', 'Needs a pricing change and billing work.'], ['No cap', 'Cost keeps growing with bookings.']], 1, 'medium'],
  ['GRO-07', 'development', 'tomas', 'Legacy landing page builder is deprecated but 23 studios still use it. Agents want to delete 6,200 lines.', [['Delete after migration', 'Migration tool first, then delete.'], ['Delete now', 'The 38 studios lose their pages.']], 0, 'medium'],
  ['GRO-02', 'business', 'sam', 'Referral rewards: credit or cash? Agents need an answer to finish the payout flow.', [['Class credit', 'No payout compliance work.'], ['Cash via payouts', 'Needs a security review of the payout path.', [{ k: 'ask', lens: 'security', decider: 'jonas', question: 'Referral rewards will be paid in cash. Review the payout path before the payout flow ships?', options: [{ label: 'Review first', consequence: 'Sentinel crew prepares the review; the payout flow waits for it.' }, { label: 'Ship, review later', consequence: 'Cash leaves through a path nobody has reviewed.' }], recommended: 0, urgency: 'medium' }]]], 0, 'medium'],
  ['AIA-05', 'security', 'jonas', 'Assistant reads member chat history to suggest classes. Allowed by the privacy notice?', [['Allow with opt-out', 'Privacy notice update needed.'], ['Opt-in only', 'Lower adoption; agents estimate 20% opt in.']], 1, 'medium'],
  ['AIA-03', 'design', 'lea', 'Assistant tone: two drafts of the churn outreach message. Pick one.', [['Warm and short', '3 sentences, first name, one offer.'], ['Detailed', 'Lists the classes the member missed.']], 0, 'low'],
  ['SCH-12', 'quality', 'ines', '14 flaky e2e tests on class scheduling. Quarantine them so agents can merge?', [['Quarantine', 'Merges unblock; coverage drops 6%.', [{ k: 'cover', delta: -6 }]], ['Fix first', 'Warden crew spends about 2 days.']], 1, 'medium'],
  ['PLT-04', 'operations', 'priya', 'Database at 78% storage. Upgrade the plan now?', [['Upgrade now', '+$220 a month.'], ['Archive old events', 'Agent proposes a job; frees about 30%.']], 1, 'medium'],
  ['ANA-02', 'business', 'mara', 'Revenue dashboard: show gross or net of refunds by default?', [['Net', 'Matches the accounting export.'], ['Gross', 'Matches what studios see at the till.']], 0, 'low'],
  ['IAM-05', 'security', 'jonas', 'Staff accounts without two-factor: force it on next login?', [['Force now', 'About 60 staff accounts affected.'], ['Nudge for 2 weeks', 'Then force.']], 1, 'medium'],
  ['INS-04', 'quality', 'ines', 'Pay-rate export has 4 open P2 bugs. Ship to the M2 cohort anyway?', [['Ship with known issues', 'Release notes name the 4 bugs.'], ['Hold', 'Agents estimate 1.5 days to close.']], 1, 'medium'],
  ['SCH-03', 'design', 'lea', 'Timetable on mobile: agents propose a week strip instead of a month grid.', [['Accept', 'Prototype attached; 3 screens change.'], ['Keep month grid', 'No change.']], 0, 'low'],
  ['COM-01', 'operations', 'priya', 'Email provider bounced 4% yesterday. Switch the sending domain?', [['Switch domain', 'DNS work; 24 h warm-up.'], ['Investigate first', 'Tender crew opens a ticket.']], 1, 'medium'],
  ['PAY-04', 'business', 'dev', 'Members ask for family plans (31 requests). Pull them into M3?', [['Add to M3', 'Scout crew writes the spec.'], ['Park', 'Stays an idea.']], 0, 'low'],
  ['PAY-14', 'quality', 'ines', 'Payout reconciliation passes on test data only. Require a run on last month\'s real payouts?', [['Require', 'One day; needs read access to production payouts.'], ['Accept test data', 'Faster; risk at GA.']], 0, 'high'],
  ['INT-05', 'development', 'tomas', 'Accounting sync: two agents wrote competing implementations. Keep which?', [['Forge-4.2 version', 'Simpler, 71% coverage.', [{ k: 'cover', pct: 71 }]], ['Forge-4.4 version', 'Handles partial refunds, 58% coverage.', [{ k: 'cover', pct: 58 }]]], 0, 'medium'],
  ['BKG-02', 'design', 'lea', 'Cancellation flow: add a "why are you cancelling" step?', [['Add', 'Better data; one more tap.'], ['Skip', 'Faster cancellation.']], 1, 'low'],
  ['PLT-14', 'security', 'jonas', 'Rotate the payment provider keys before GA?', [['Rotate now', '5 min downtime window at night.'], ['After GA', 'Keys are 14 months old.']], 0, 'high'],
  ['GRO-04', 'design', 'lea', 'Landing page for studios: agents generated three hero images. Pick one or ask for more.', [['Pick image 2', 'Studio at dawn.'], ['Ask for more', 'Scout crew generates five more.']], 0, 'low'],
];
/** A decision's feature by id; its domain is the feature's, never typed again beside it. */
const featOf = (fid, where) => { const f = F.get(fid); if (!f) throw new Error(`${where}: no feature ${fid} in kettle.json`); return f; };
const decisions = decisionDefs.map(([fid, lens, owner, question, opts, rec, urgency], i) => {
  const f = featOf(fid, `decisionDefs[${i}]`), dom = f.domain;
  const asker = pick(agents.filter((a) => a.feature === f.id).concat(agents.filter((a) => F.get(a.feature).domain === dom)).concat([pick(agents)]));
  const waitingMin = urgency === 'high' ? ri(20, 600) : ri(10, 2400);
  return {
    id: `D-${String(i + 1).padStart(2, '0')}`, feature: f.id, domain: dom, lens, decider: owner, askedBy: asker.id,
    question, options: opts.map(([label, consequence, fx]) => ({ label, consequence, ...(fx ? { effects: fx.map(({ k, ...e }) => ({ k, feature: f.id, ...e })) } : {}) })), recommended: rec, urgency,
    waitingSince: ago(waitingMin), blocksAgents: urgency === 'high' ? ri(1, 2) : urgency === 'medium' ? ri(0, 1) : 0,
    affects: [f.id, ...f.usedBy.slice(0, 4)],
  };
});
// agents that wait on a decision say so
for (const d of decisions) {
  const waiting = agents.filter((a) => F.get(a.feature).domain === d.domain && a.status === 'working').slice(0, d.blocksAgents);
  for (const a of waiting) { a.status = 'waiting'; a.waitingOn = d.id; a.feature = d.feature; a.task = `waiting: ${d.question}`; }
  d.blocksAgents = waiting.length;
}
// a few blocked by dependencies, a few idle, a couple failed
const blockedPool = K.features.filter((f) => f.blockedBy.length && ['in-dev', 'specified'].includes(f.stage));
for (const a of agents.filter((x) => x.status === 'working' && x.role === 'build').slice(0, 4)) { const f = pick(blockedPool); a.feature = f.id; }
for (const a of agents.filter((x) => x.status === 'working')) {
  const f = F.get(a.feature);
  if (f.blockedBy.length && chance(0.6)) { a.status = 'blocked'; a.blockedBy = f.blockedBy[0]; a.task = `blocked by ${F.get(f.blockedBy[0]).name}`; }
  else if (chance(0.06)) { a.status = 'idle'; a.task = 'idle: queue empty for this crew'; }
  else if (chance(0.04)) { a.status = 'failed'; a.task = `stopped: 3 failed attempts on ${f.name}`; }
}
// The seed decides how many agents land idle, and with this one it is none: no shipped sample row would ever reach the
// idle word and chip (Overlays.tsx, rail/wide/agents.tsx, model/sim.ts counters). So when the pass left none, the last
// BLOCKED agent is the idle one (a blocked agent is already out of the replay's `live` set, so the replay and every
// order/precedent expectation that reads it stay put); the coverage assertion below says so when any status is still empty.
if (!agents.some((x) => x.status === 'idle')) {
  const spare = agents.filter((x) => x.status === 'blocked').at(-1);
  if (spare) { spare.status = 'idle'; delete spare.blockedBy; spare.task = 'idle: queue empty for this crew'; }
}

// ---------- standing orders humans gave the swarm ----------
const orders = [
  { id: 'O-1', by: 'jonas', lens: 'security', scope: { domain: 'PAY' }, text: 'Anything touching card or bank data needs a human security review before its flag passes 10%.', since: '2026-09-02', violations: 1 },
  { id: 'O-2', by: 'tomas', lens: 'development', scope: { all: true }, text: 'No merge below 70% unit coverage on new code.', since: '2026-08-11', violations: 3 },
  { id: 'O-3', by: 'priya', lens: 'operations', scope: { all: true }, text: 'Every live feature has an alert and a runbook before rollout passes 50%.', since: '2026-09-20', violations: 6 },
  { id: 'O-4', by: 'mara', lens: 'business', scope: { milestone: 'M2' }, text: 'Payments GA work goes first; agents may be pulled from M3 and M4.', since: '2026-09-28', violations: 0 },
  { id: 'O-5', by: 'lea', lens: 'design', scope: { surface: 'kiosk' }, text: 'Kiosk screens must pass AA contrast before review.', since: '2026-09-14', violations: 1 },
  { id: 'O-6', by: 'ines', lens: 'quality', scope: { all: true }, text: 'A P1 bug stops the feature\'s rollout automatically.', since: '2026-07-30', violations: 0 },
  { id: 'O-7', by: 'mara', lens: 'business', scope: { all: true }, text: 'Daily swarm spend cap: $2,400. Pause research crews first if exceeded.', since: '2026-09-01', violations: 0 },
  { id: 'O-8', by: 'dev', lens: 'business', scope: { domain: 'AIA' }, text: 'Assistant features stay behind an internal flag until M3 ships.', since: '2026-09-25', violations: 0 },
];

// ---------- one replayable hour (NOW .. NOW+60 min) ----------
const EV = {
  build: [['commit', (f) => `${ri(1, 6)} commits on ${f.name}`, 0.5], ['tests-pass', (f) => `tests pass on ${f.name}`, 0.2], ['tests-fail', (f) => `${ri(1, 4)} tests fail on ${f.name}`, 0.12], ['pr-open', (f) => `pull request opened for ${f.name}`, 0.1], ['task-done', (f) => `finished a task on ${f.name}`, 0.08]],
  review: [['review-pass', (f) => `review passed: ${f.name}`, 0.4], ['review-changes', (f) => `changes requested on ${f.name}`, 0.35], ['tests-fail', (f) => `e2e failure on ${f.name}`, 0.25]],
  operate: [['flag-change', (f) => `flag for ${f.name} moved to ${pick([5, 10, 25, 50])}%`, 0.4], ['alert', (f) => `p95 latency up on ${f.name}`, 0.25], ['deploy', (f) => `deployed ${f.name}`, 0.35]],
  research: [['spec-draft', (f) => `spec draft updated: ${f.name}`, 0.6], ['note', (f) => `${ri(2, 9)} customer requests linked to ${f.name}`, 0.4]],
  security: [['finding', (f) => `finding on ${f.name}: ${pick(['token in log line', 'missing authorisation check', 'outdated dependency'])}`, 0.4], ['scan-clean', (f) => `scan clean: ${f.name}`, 0.6]],
};
const replay = [];
const snapAt = new Map(agents.map((a) => [a.id, a.feature]));
const roll = (arr) => { let r = rnd(), acc = 0; for (const x of arr) { acc += x[2]; if (r < acc) return x; } return arr[arr.length - 1]; };
const live = agents.filter((a) => a.status === 'working');
for (let t = 4; t < 3600; t += ri(3, 14)) {
  const a = pick(live);
  const f = F.get(a.feature);
  const [type, text] = roll(EV[a.role]);
  replay.push({ t, at: at(t), agent: a.id, feature: f.id, type, text: text(f) });
  if (chance(0.05)) { // the agent moves on to another feature
    const pool = featsIn(STAGES_FOR[a.role]);
    const nf = pick(pool);
    replay.push({ t: t + 1, at: at(t + 1), agent: a.id, feature: nf.id, type: 'move', text: `${a.id} moves to ${nf.name}`, from: f.id });
    a._moved = true; a.feature = nf.id; // the replay's state, not the snapshot's
  }
}
// new decisions asked during the hour
const later = [
  ['PAY-14', 'operations', 'priya', 'Payout job runs at 02:00 and overlaps backups. Move it to 04:00?', [['Move to 04:00', 'Payouts land two hours later.'], ['Keep', 'Backup slows by about 20 min.']], 0, 'medium', 900],
  ['BKG-03', 'quality', 'ines', 'Waitlist fix passes, but the load test shows 2.1 s p95 at 500 bookings a minute. Accept?', [['Accept', 'Peak today is 140 a minute.'], ['Optimise first', 'About half a day.']], 0, 'high', 1980],
  ['SCH-04', 'business', 'dev', 'Agents finished class packs early. Pull class templates forward from M3?', [['Pull forward', 'Two agents free now.'], ['Keep plan', 'Agents go to the M2 backlog.']], 0, 'low', 3000],
];
const base = decisions.length;
later.forEach(([fid, lens, owner, question, opts, rec, urgency, t], i) => {
  const f = featOf(fid, `later[${i}]`), dom = f.domain;
  const a = pick(agents.filter((x) => F.get(x.feature).domain === dom).concat(agents));
  const d = { id: `D-${base + i + 1}`, feature: f.id, domain: dom, lens, decider: owner, askedBy: a.id, question, options: opts.map(([label, consequence]) => ({ label, consequence })), recommended: rec, urgency, waitingSince: at(t), blocksAgents: ri(1, 3), affects: [f.id, ...f.usedBy.slice(0, 4)], arrivesAt: t };
  replay.push({ t, at: at(t), agent: a.id, feature: f.id, type: 'decision-asked', text: question, decision: d.id });
  decisions.push(d);
});
replay.sort((x, y) => x.t - y.t);
// the agents list is the state at NOW; the replay is what follows, so undo its moves
for (const a of agents) { delete a._moved; a.feature = snapAt.get(a.id); }

// every AgentStatus the type declares has at least one agent, read from the type so a sixth status is covered the day it is added
{
  const src = fs.readFileSync(new URL('../../packages/core/src/data/types.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const declared = (src.match(/export type AgentStatus = ([^;]+);/)?.[1] ?? '').match(/'([a-z]+)'/g)?.map((q) => q.slice(1, -1)) ?? [];
  if (declared.length < 5) { console.error('gen-swarm: could not read AgentStatus from packages/core/src/data/types.ts'); process.exit(1); }
  const empty = declared.filter((st) => !agents.some((a) => a.status === st));
  if (empty.length) { console.error('gen-swarm: no agent has status ' + empty.join(', ') + ' - the sample would never reach those consumers; adjust the status pass'); process.exit(1); }
}

const swarm = {
  asOf: NOW.toISOString().replace('.000', ''),
  note: 'Simulated swarm for a design prototype. Agents, decisions and events are invented sample data layered on kettle.json.',
  squads, agents, decisions, orders, replay,
  totals: { agents: agents.length, working: agents.filter((a) => a.status === 'working').length, waiting: agents.filter((a) => a.status === 'waiting').length, blocked: agents.filter((a) => a.status === 'blocked').length, idle: agents.filter((a) => a.status === 'idle').length, failed: agents.filter((a) => a.status === 'failed').length, openDecisions: decisions.filter((d) => !d.arrivesAt).length, spendUsdToday: +agents.reduce((s, a) => s + a.costUsdToday, 0).toFixed(0), replayEvents: replay.length },
};
// --check exits inside writeOrCheck: it diffs and writes nothing, so the --js file and the totals line below
// are skipped with it.
writeOrCheck([[path.join(DIR, 'swarm.json'), JSON.stringify(swarm, null, 1)]], CHECK, 'scripts/fixtures/gen-swarm.mjs');
if (process.argv.includes('--js')) fs.writeFileSync(path.join(DIR, 'swarm.js'), '// Kettle agent swarm (simulated). Loads as a global: window.SWARM. Needs kettle.js for feature ids.\nwindow.SWARM = ' + JSON.stringify(swarm) + ';\n');
console.log(swarm.totals);
