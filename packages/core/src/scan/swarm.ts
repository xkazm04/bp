// The scan as the swarm feed the canvas draws (moved out of the web client, apps/web/src/lib/scan/client.ts, which
// re-exports it). Pure: the model's live feed and the web client both use it.
import type { Agent, AgentStatus, Decision, ReplayEvent, ReplayType, Squad, Swarm } from '@bp/core/data/types';
import { latestRun, latestReading, measuredFeatures, tierRank } from './derive.ts';
import { scopeFeatures } from './scope.ts';
import type { Activity, ActivityKind, Proposal, ScanSnapshot } from './types.ts';

// ------------------------------------------------------------------------------------------- swarm
const REPLAY_OF: Partial<Record<ActivityKind, ReplayType>> = { measured: 'scan-clean', proposed: 'finding', committed: 'commit', error: 'alert' };
const ms = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The Approve option's consequence: the metric move the proposal promises, from its latest reading when there is one. */
function expectedText(p: Proposal, scan: ScanSnapshot): string {
  if (!p.metric || p.expected_delta === undefined) return 'Queued for the next execute phase';
  const last = latestReading(scan, p.feature, p.lens, p.metric);
  const unit = last?.unit ? ' ' + last.unit : '', d = p.expected_delta;
  const move = (d > 0 ? '+' : '') + fmt(d) + unit;
  return last ? `${p.metric}: ${fmt(last.value)} → ${fmt(last.value + d)}${unit} (${move})` : `${p.metric} ${move}`;
}

/** A feature as the swarm feed needs it: its id and the domain and capability a run's scope can name. */
export interface SwarmFeature { id: string; domain: string; capability: string }

/**
 * The scan as a swarm: one squad and one agent per lens in the latest run, each on the feature of its
 * latest activity row (`error` -> failed); open proposals (`proposed`) become decisions whose options
 * are Approve / Decline (the one a waiting lens agent stands on holds that agent: blocksAgents 1, else 0);
 * activity rows become the replay.
 */
export function swarmFromScan(scan: ScanSnapshot, features: readonly (string | SwarmFeature)[]): Swarm {
  const run = latestRun(scan) ?? undefined;
  const feats: SwarmFeature[] = features.map((f) => (typeof f === 'string' ? { id: f, domain: '', capability: '' } : f));
  const known = new Set(feats.map((f) => f.id)), first = feats[0]?.id ?? '';
  const total = run ? scopeFeatures(run, feats).length : 0; // progress is against what the run was pointed at
  const empty: Swarm = { asOf: run?.started_at ?? new Date().toISOString(), note: 'Live lens scan: no run yet.', squads: [], agents: [], decisions: [], orders: [], replay: [], totals: {} };
  if (!run) return empty;
  const t0 = ms(run.started_at), running = run.status === 'running';
  // tier first (untriaged after tier 3, contract v4), then oldest first as before
  const open = scan.proposals.filter((p) => p.status === 'proposed')
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const inRun = scan.activity.filter((a) => a.run_id === run.id);
  const agentOf = (lens: string) => `scan-${lens}.1`;

  const squads: Squad[] = [], agents: Agent[] = [];
  // `runs.lenses` is a store JSON column filtered to strings, so it can repeat one; one squad and one agent per
  // DISTINCT lens, or two squads share an id and two agents share `scan-<lens>.1` (the canvas keys on both).
  const lenses = [...new Set(run.lenses)];
  for (const lens of lenses) {
    const sq = `scan-${lens}`, role = 'research' as const; // scanners are research crews whatever their lens (lenses are data: no branch on a lens id)
    squads.push({ id: sq, name: `${title(lens)} scan`, role, focus: `measures the ${lens} lens`, size: 1, lenses: [lens] });
    // This run's rows first; a lens the run has not reached yet sits where an earlier run left it.
    const own = inRun.filter((a) => a.lens === lens), rows = own.length ? own : scan.activity.filter((a) => a.lens === lens);
    const last = rows[rows.length - 1];
    let placed: Activity | undefined;
    for (let i = rows.length - 1; i >= 0 && !placed; i--) if (rows[i].feature && known.has(rows[i].feature!)) placed = rows[i];
    const wait = open.find((p) => p.lens === lens);
    const status: AgentStatus = !running ? 'idle' : last?.kind === 'error' ? 'failed' : wait ? 'waiting' : 'working';
    const measured = measuredFeatures(scan, run.id, lens);
    const pct = total ? Math.min(99, Math.round((measured.size / total) * 100)) : 0;
    const a: Agent = {
      id: agentOf(lens), squad: sq, role, status, feature: placed?.feature ?? first,
      task: last?.text ?? (running ? `starting the ${lens} scan` : `${lens} scan ${run.status}`),
      progressPct: pct, since: last?.at ?? run.started_at, tokensPerMin: 0, costUsdToday: 0, doneToday: measured.size,
    };
    if (status === 'waiting' && wait) a.waitingOn = wait.id;
    agents.push(a);
  }
  const agentIds = new Set(agents.map((a) => a.id)), byLens = new Map(lenses.map((l, i) => [l, agents[i]]));
  const held = new Set(agents.map((a) => a.waitingOn).filter((w): w is string => !!w)); // the proposal each waiting lens agent stands on

  const decisions: Decision[] = open.map((p) => ({
    ...(p.tier !== undefined ? { tier: p.tier } : {}),
    id: p.id, feature: p.feature, domain: '', lens: p.lens, decider: '', askedBy: agentIds.has(agentOf(p.lens)) ? agentOf(p.lens) : '',
    question: p.title,
    // `expected`: the proposal's own expected move, the one thing an Approve previews on the plan (never a simulated effect)
    options: [{ label: 'Approve', consequence: expectedText(p, scan), ...(p.metric && p.expected_delta !== undefined ? { expected: expectedText(p, scan) } : {}) }, { label: 'Decline', consequence: 'Stays in the backlog as declined' }],
    recommended: 0, urgency: (p.risk ?? 0) >= 7 ? 'high' : (p.risk ?? 0) >= 4 ? 'medium' : 'low',
    waitingSince: p.created_at, blocksAgents: held.has(p.id) ? 1 : 0, affects: [p.feature],
  }));

  const replay: ReplayEvent[] = inRun.map((e) => {
    const ag = (e.lens && byLens.get(e.lens)) || agents[0];
    return {
      t: Math.max(0, Math.round((ms(e.at) - t0) / 1000)), at: e.at, agent: ag?.id ?? '', feature: e.feature ?? ag?.feature ?? first,
      type: REPLAY_OF[e.kind] ?? 'note', text: e.text,
    };
  });

  return {
    asOf: run.started_at, note: `Live lens scan ${run.id} (${run.status}, ${run.phase}).`,
    squads, agents, decisions, orders: [], replay, totals: {},
  };
}
