// The simulated swarm: 42 agents (per product line), decisions that open and close, standing orders
// and their breaches, and a replayable hour at 1x..240x. Everything here is a simulation over sample
// data; nothing talks to a real system. Pure TS: wall-clock time is injected (`now`) and visual
// effects are recorded as plain data (pulses, heat, travel) for the engine to draw.
//
// Live mode (`{ live: true }`, a live product's lens scan): the same state, driven by the feed instead
// of the replay. There is no recorded hour: waits and ages use the wall clock (`wall`), and each new
// feed (`applyFeed`) sets the agents, the open questions and the recent events directly. Agents are
// the truth, not the replay.
import type { Agent, Decision, DecisionOption, OptionEffect, ReplayEvent, ReplayType, StandingOrder, Swarm, AgentStatus, CrewRole, Squad, ViewId, Feature, Scalar } from '@/lib/data';
import { fval } from '@/lib/standard/load';
import { FIRST_MILESTONE, GA_MILESTONE, HOUR, LATER_MILESTONES, PULSE_OF, SPEND_CAP, type PulseKind } from './constants';
import { isLiveSt } from './aggregates';
import { personLens } from './lens';
import { baseId, lineSuffix, pname, type Product } from './product';

/**
 * The swarm feed's coupling to the product: the simulation moves a feature's rollout and build progress,
 * which the map keeps as these lens fields (read through the facets whether or not the lens is enabled).
 * Together with the standing-order rules below (which read the sample's facets the same way), this is
 * the only place lens field names appear outside the manifests: it belongs to the swarm sample.
 */
export const SIM_FIELDS = { rollout: ['operations', 'rolloutPct'], progress: ['development', 'progressPct'], coverage: ['development', 'unitCoveragePct'] } as const;
const num = (f: Feature, l: string, k: string): number | null => { const v = fval(f, l, k); return typeof v === 'number' ? v : null; };
const txt = (f: Feature, l: string, k: string): string => { const v = fval(f, l, k); return typeof v === 'string' ? v : ''; };
const flag = (f: Feature, l: string, k: string): boolean | null => { const v = fval(f, l, k); return typeof v === 'boolean' ? v : null; };
/** Card data whose security review is not done (order O-1). */
function cardUnreviewed(f: Feature): boolean {
  const r = txt(f, 'security', 'review');
  return txt(f, 'security', 'dataClass') === 'payment' && r !== 'passed' && r !== 'not-required';
}
/**
 * The standing-order rules the simulation can move (at a feature's rollout `r` and unit coverage `c`): read at
 * build to rank the sample's breaches, and re-read on one feature when a flag change or an answer touches it.
 */
const RULES: Record<string, { hit: (f: Feature, r: number, c: number | null) => boolean; why: (f: Feature, r: number, c: number | null) => string }> = {
  'O-1': { hit: (f, r) => isLiveSt(f.stage) && cardUnreviewed(f) && r > 10, why: () => 'card data above 10% without a security review' },
  'O-2': { hit: (f, _r, c) => (f.stage === 'in-review' || isLiveSt(f.stage)) && c != null && c < 70, why: (_f, _r, c) => 'unit coverage ' + c + '%, under 70%' },
  'O-3': { hit: (f, r) => isLiveSt(f.stage) && (!flag(f, 'operations', 'alerting') || !flag(f, 'operations', 'runbook')) && r >= 50, why: (f, r) => 'rollout ' + r + '% without ' + (!flag(f, 'operations', 'alerting') ? 'an alert' : 'a runbook') },
};

export type AgentState = AgentStatus | 'paused';
export interface SimAgent {
  id: string; base: string; b: number; sq: string; role: CrewRole; status: AgentStatus; f: string; task: string;
  pct: number; since: number; tpm: number; cost: number; done: number; wait: string | null; blk: string | null;
  ph: number; paused: boolean; tr: { from: string; to: string; t0: number; dur: number } | null; flash: number;
  synth: boolean; nextSynth: number; code: string; act: number;
}
export interface SimDecision {
  id: string; base: string; b: number; f: string; dom: string; lens: string; decider: string; by: string; q: string;
  opts: DecisionOption[]; rec: number; urg: 'high' | 'medium' | 'low'; since: number;
  blocks: number; freed: number; affects: string[]; arr: number; open: boolean;
  ans: { opt: number; t: number; at: number } | null; isNew: boolean; freedIds: string[];
}
export interface OrderScope { domain?: string; milestone?: string; surface?: string; all?: boolean; feats?: Record<string, 1>; label?: string }
export interface SimOrder { id: string; by: string; lens: string; scope: OrderScope; text: string; since: string; n: number; vf: string[]; user: boolean }
export interface SimEvent { t: number; agent: string; f: string; type: ReplayType; text: string; from: string | null; dec: string | null; syn?: boolean }
export interface Pulse { f: string; k: PulseKind; t0: number }
export interface Target { ids: Record<string, 1>; n: number; label: string }
export type PreviewKind = 'push' | 'pause' | 'resume' | 'order' | 'answer';
/** A label an answer preview draws at a feature (`row` stacks several on one tile); `ring` = a breach it adds or clears. */
export interface AnswerMark { f: string; text: string; tone: 'ok' | 'bad' | 'info'; row: number; ring?: 'add' | 'clear' }
export interface Preview {
  kind: PreviewKind; title: string; moves: { a: SimAgent; to: string }[]; targets: Record<string, 1>; paused: SimAgent[];
  lines: string[]; n: number; order?: string; tpl?: OrderTemplate; text?: string; label?: string;
  /** kind 'answer' (`previewAnswer`): the decision and option, and what answering it changes. */
  dec?: string; oi?: number; freed?: SimAgent[]; rolls?: { f: string; from: number; to: number }[]; cover?: { f: string; from: number; to: number }[];
  asks?: { id: string; f: string; lens: string; decider: string; q: string }[]; breaks?: { o: string; by: string; f: string; add: boolean }[];
  marks?: AnswerMark[];
  /** Live: the proposal's own expected move, the only thing a real product's answer may preview. */
  expected?: string;
}
export type OrderTemplate = 'review' | 'ask' | 'first' | 'hold';
export const ORDER_TEMPLATES: Record<OrderTemplate, string> = {
  review: 'Needs a human review before it merges', ask: 'Agents ask me before any rollout above 10%',
  first: 'Agents here go first, other work waits', hold: 'Hold: no new work starts here until I say',
};
export interface SimToast { strong: string; text: string; action?: 'undo' | 'undo2' | 'replay'; fid?: string }
export interface SimListener {
  /** Discrete change: the queue, agents or orders changed (React re-reads via versions). */
  changed(): void;
  toast(t: SimToast): void;
  event(e: SimEvent): void;
}

/** Who decides a live question: a scan names no person, so the UI says this where a name would go. */
export const LIVE_DECIDER = 'whoever reviews';
export interface SimOptions {
  /** Driven by `applyFeed` (a live scan) instead of the replay. */
  live?: boolean;
  /** Wall clock in ms (live waits and ages). Default Date.now. */
  wall?: () => number;
}
type AgentSnap = { a: SimAgent; status: AgentStatus; task: string; wait: string | null; pct: number };
type AgentFull = AgentSnap & { f: string; synth: boolean; nextSynth: number; paused: boolean };
/** What one answer does (`planAnswer`): the agents it frees, then its option's effects, and the breaches they add or clear. */
interface AnswerPlan {
  d: SimDecision; oi: number; freed: SimAgent[]; moves: { a: SimAgent; to: string }[];
  rolls: { f: string; from: number; to: number; cap: number }[]; cover: { f: string; from: number; to: number }[];
  asks: { d: SimDecision; hold: SimAgent | null }[]; breaks: { o: SimOrder; f: string; add: boolean }[];
}
/** What `decide` overwrote, so `undoDecision` restores exactly that. */
interface DecisionUndo {
  d: SimDecision; oi: number; snap: AgentFull[]; dd: { isNew: boolean; freed: number; freedIds: string[] };
  roll: [string, number | undefined, number | undefined][]; cov: [string, number | undefined][];
  ords: { o: SimOrder; vf: string[]; n: number }[]; breaches: number; asks: string[];
}
const sfx = (e: OptionEffect, sf: string): OptionEffect => (e.k === 'staff' ? { ...e, feature: e.feature + sf, from: e.from.domain ? { ...e.from, domain: e.from.domain + sf } : e.from } : { ...e, feature: e.feature + sf });
const liveKey = (e: ReplayEvent) => e.at + '|' + e.agent + '|' + e.feature + '|' + e.text;

export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
function crewCode(id: string): string {
  const m = /^(forge|warden|tender|scout|sentinel)(?:-(\d))?\.(\d+)/.exec(id);
  if (!m) return id;
  return ({ forge: 'F' + m[2], warden: 'WD', tender: 'TD', scout: 'SC', sentinel: 'SN' } as Record<string, string>)[m[1]] + '.' + m[3];
}
const NONE: readonly SimAgent[] = [];
export const astat = (a: SimAgent): AgentState => (a.paused ? 'paused' : a.status);
export function fmtWait(m: number): string {
  return m >= 120 ? Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '') : m >= 60 ? '1 h ' + (m % 60) + ' min' : m + ' min';
}

export class SwarmSim {
  readonly has: boolean;
  /** The feed's as-of in ms: the replay's 09:00, or a live run's start. */
  at0: number;
  /** The feed's replay offsets in seconds (once per feed event, whatever the scale) and the questions that arrive during it: what the time charts draw. */
  readonly replayT: readonly number[];
  readonly arrivals: readonly { id: string; t: number }[];
  readonly live: boolean;
  private wall: () => number;
  /** Live: feed events already applied, so a new feed plays only what is new. */
  private seen = new Set<string>();
  /** Live: questions answered here, with what to restore if the store refuses the answer. */
  private liveSnap = new Map<string, { d: SimDecision; snap: AgentSnap[] }[]>();
  agents: SimAgent[] = []; AG: Record<string, SimAgent> = {};
  decisions: SimDecision[] = []; DEC: Record<string, SimDecision> = {};
  orders: SimOrder[] = []; events: SimEvent[] = [];
  squads: Squad[] = []; SQ: Record<string, Squad> = {};
  /** agents by feature, open decisions by feature, blocked agents by the feature that blocks them */
  AGF: Record<string, SimAgent[]> = {}; DOF: Record<string, SimDecision[]> = {}; BLF: Record<string, SimAgent[]> = {};
  // clock
  t = 0; playing = true; speed = 8; i = 0; over = false;
  log: SimEvent[] = []; pulses: Pulse[] = []; heat: Record<string, { v: number; t: number }> = {};
  roll: Record<string, number> = {}; prog: Record<string, number> = {};
  /** Rollouts an answer holds (agents' flag changes stop there) and unit coverage an answer set, by feature. */
  cap: Record<string, number> = {}; cov: Record<string, number> = {};
  undo: DecisionUndo | null = null;
  undo2: { kind: PreviewKind; snap: ({ order: string } | { a: SimAgent; f: string; status: AgentStatus; task: string; wait: string | null; paused: boolean; synth: boolean })[] } | null = null;
  breaches = 0; tally: Partial<Record<ReplayType, number>> = {};
  /** Bumped on every discrete change (status, queue, orders): cheap change detection for caches. */
  version = 0;
  /** Live: bumped when features' health or fields changed in place (a reading, a map refresh); the static raster must be redone, not patched. */
  healthV = 0;
  private ordCache: Record<string, Record<string, 1>> | null = null;
  private listener: SimListener | null = null;

  constructor(private P: Product, private S0: Swarm | null, private now: () => number, opts: SimOptions = {}) {
    this.has = !!(S0 && S0.agents);
    this.replayT = S0?.replay?.map((e) => e.t) ?? [];
    this.arrivals = S0?.decisions?.filter((d) => d.arrivesAt).map((d) => ({ id: d.id, t: d.arrivesAt! })) ?? [];
    this.live = !!opts.live; this.wall = opts.wall ?? Date.now;
    this.at0 = S0?.asOf ? Date.parse(S0.asOf) : Date.parse('2026-10-08T09:00:00Z');
    // live: nothing plays, so the engine's loop sleeps between feeds (and agents skip the idle orbit)
    if (this.live) this.playing = false;
    this.build();
  }
  /** The clock questions wait against: the simulated hour's time, or the wall clock when live. */
  clockMs(): number { return this.live ? this.wall() : this.at0 + this.t * 1000; }
  /** Live: features changed in place outside a feed (a map refresh): tell the listeners. */
  restamp() { this.healthV++; this.bump(); }
  listen(l: SimListener | null) { this.listener = l; }
  private bump() { this.version++; this.listener?.changed(); }
  private toast(t: SimToast) { this.listener?.toast(t); }

  private build() {
    const S0 = this.S0, P = this.P;
    this.agents = []; this.AG = {}; this.decisions = []; this.DEC = {}; this.orders = []; this.events = [];
    this.squads = []; this.SQ = {};
    if (!S0 || !this.has) { this.index(); return; }
    for (const q of S0.squads) { this.SQ[q.id] = q; this.squads.push(q); }
    for (let b = 0; b < P.scale; b++) {
      const sf = lineSuffix(P.scale, b);
      for (const a of S0.agents) {
        const g: SimAgent = {
          id: a.id + sf, base: this.live ? this.codeOf(a) : a.id, b, sq: a.squad, role: a.role, status: a.status, f: a.feature + sf, task: a.task,
          pct: a.progressPct, since: Date.parse(a.since), tpm: a.tokensPerMin, cost: a.costUsdToday, done: a.doneToday,
          wait: a.waitingOn ? a.waitingOn + sf : null, blk: a.blockedBy ? a.blockedBy + sf : null, ph: hash01(a.id + sf) * 6.2832,
          paused: false, tr: null, flash: 0, synth: false, nextSynth: 0, code: this.codeOf(a), act: 0,
        };
        this.agents.push(g); this.AG[g.id] = g;
      }
      for (const d of S0.decisions) { const g = this.fromDecision(d, b, sf); this.decisions.push(g); this.DEC[g.id] = g; }
      for (const e of S0.replay) {
        this.events.push({ t: e.t, agent: e.agent + sf, f: e.feature + sf, type: e.type, text: e.text, from: e.from ? e.from + sf : null, dec: e.decision ? e.decision + sf : null });
      }
    }
    this.events.sort((a, b) => a.t - b.t);
    if (this.live) {
      // a live feed's events are history, not an hour to play: they seed the log; later feeds append
      for (const e of S0.replay) this.seen.add(liveKey(e));
      this.log = this.events.filter((e) => this.P.F[e.f]).reverse().slice(0, 400);
      this.events = [];
    }
    for (const o of S0.orders) this.orders.push(this.fromOrder(o));
    this.computeViolations();
    this.index();
  }
  private fromDecision(d: Decision, b: number, sf: string): SimDecision {
    return {
      id: d.id + sf, base: d.id, b, f: d.feature + sf, dom: d.domain + sf, lens: d.lens, decider: d.decider, by: d.askedBy + sf,
      q: d.question, opts: sf ? d.options.map((o) => (o.effects ? { ...o, effects: o.effects.map((e) => sfx(e, sf)) } : o)) : d.options, rec: d.recommended, urg: d.urgency, since: Date.parse(d.waitingSince), blocks: d.blocksAgents,
      freed: 0, affects: d.affects.map((x) => x + sf), arr: d.arrivesAt || 0, open: !d.arrivesAt, ans: null, isNew: false, freedIds: [],
    };
  }
  /** The chip code: the sample's crew codes (F1.3); a live agent reads as its lens's short name (DEV.1). */
  private codeOf(a: Agent): string {
    if (!this.live) return crewCode(a.id);
    const lens = this.SQ[a.squad]?.lenses?.[0], n = /\.(\d+)$/.exec(a.id)?.[1] ?? '1';
    return lens ? (this.P.LENS[lens]?.short ?? lens.slice(0, 4)).toUpperCase() + '.' + n : a.id;
  }
  private fromOrder(o: StandingOrder): SimOrder {
    return { id: o.id, by: o.by, lens: o.lens, scope: { ...o.scope }, text: o.text, since: o.since, n: o.violations, vf: [], user: false };
  }
  index() {
    this.AGF = {}; this.DOF = {}; this.BLF = {};
    for (const a of this.agents) { (this.AGF[a.f] ||= []).push(a); if (a.blk && a.status === 'blocked') (this.BLF[a.blk] ||= []).push(a); }
    for (const d of this.decisions) if (d.open) (this.DOF[d.f] ||= []).push(d);
  }

  // ---------------------------------------------------------------- reading
  rolloutOf(f: Feature): number {
    const r = this.roll[f.id];
    if (r != null) return r;
    return num(f, ...SIM_FIELDS.rollout) ?? (isLiveSt(f.stage) ? 100 : 0);
  }
  progOf(f: Feature): number { return Math.min(99, this.baseProgress(f) + (this.prog[f.id] || 0)); }
  /** Build progress as the map has it (before the simulated hour). */
  baseProgress(f: Feature): number { return num(f, ...SIM_FIELDS.progress) ?? 0; }
  /** Unit coverage as the simulation has it (an answer may set it), else the map's; null = not measured. */
  covOf(f: Feature): number | null { return this.cov[f.id] ?? num(f, ...SIM_FIELDS.coverage); }
  /** A lens field's value as the simulation has it now (its live rollout and build progress), else the map's. */
  liveValue(f: Feature, lens: string, key: string): Scalar | undefined {
    if (lens === SIM_FIELDS.rollout[0] && key === SIM_FIELDS.rollout[1] && this.roll[f.id] != null) return this.roll[f.id];
    if (lens === SIM_FIELDS.coverage[0] && key === SIM_FIELDS.coverage[1] && this.cov[f.id] != null) return this.cov[f.id];
    if (lens === SIM_FIELDS.progress[0] && key === SIM_FIELDS.progress[1] && this.prog[f.id]) { const p = num(f, lens, key); return p != null && p < 100 ? this.progOf(f) : p ?? undefined; }
    return fval(f, lens, key);
  }
  /** The blocked agents this feature holds (their `blockedBy` names it). */
  blockedByFeature(fid: string): readonly SimAgent[] { return this.BLF[fid] ?? NONE; }
  openDecs(): SimDecision[] { return this.decisions.filter((d) => d.open); }
  blocksNow(d: SimDecision): number { return Math.max(0, d.blocks - d.freed); }
  waitMin(d: SimDecision): number { return Math.max(0, Math.round((this.clockMs() - d.since) / 60000)); }
  score(d: SimDecision): number { return ({ high: 3, medium: 2, low: 1 })[d.urg] * 1e6 + this.blocksNow(d) * 1e4 + Math.min(9999, this.waitMin(d)); }
  /**
   * Is this decision for the current reader (person, else lens)? Lens ids are strings: a decision whose
   * lens is disabled or unknown matches no lens tab and shows under General.
   */
  emph(d: SimDecision, who: string | null, view: ViewId): boolean { return who ? d.decider === who : view === 'general' || d.lens === view; }
  /** Crews that serve the viewed lens stay bright (the feed lists each squad's lenses); a lens no crew serves dims nobody. */
  crewRelevant(a: SimAgent, view: ViewId): boolean {
    if (view === 'general' || !this.servedLens(view)) return true;
    return !!this.SQ[a.sq]?.lenses?.includes(view);
  }
  private served: Record<string, boolean> = {};
  private servedLens(view: ViewId): boolean {
    let v = this.served[view];
    if (v === undefined) { v = this.squads.some((q) => !!q.lenses?.includes(view)); this.served[view] = v; }
    return v;
  }
  queueFor(who: string | null, view: ViewId) {
    const open = this.openDecs().sort((a, b) => this.score(b) - this.score(a));
    const mine = who ? open.filter((d) => d.decider === who) : [];
    const rest = open.filter((d) => !mine.includes(d));
    if (!who && view !== 'general') rest.sort((a, b) => Number(b.lens === view) - Number(a.lens === view) || this.score(b) - this.score(a));
    return { mine, rest, all: open };
  }
  /** Order in which J/K walk the questions. */
  cardOrder(who: string | null, view: ViewId): SimDecision[] {
    const q = this.queueFor(who, view);
    if (who) return q.mine.concat(q.rest);
    if (view === 'general') return q.all;
    return q.rest.filter((d) => d.lens === view).concat(q.rest.filter((d) => d.lens !== view));
  }
  stats(fs: readonly Feature[], who: string | null, view: ViewId) {
    const s = { n: 0, working: 0, waiting: 0, blocked: 0, failed: 0, paused: 0, idle: 0, asks: 0, high: 0, mine: 0 };
    for (const f of fs) {
      const ag = this.AGF[f.id]; if (ag) for (const a of ag) { s.n++; s[astat(a)]++; }
      const ds = this.DOF[f.id]; if (ds) for (const d of ds) { s.asks++; if (d.urg === 'high') s.high++; if (this.emph(d, who, view)) s.mine++; }
    }
    return s;
  }
  tallyStatus() {
    const c = { working: 0, waiting: 0, blocked: 0, failed: 0, paused: 0, idle: 0 };
    for (const a of this.agents) c[astat(a)]++;
    return c;
  }
  agentsIn(ids: Record<string, 1>): SimAgent[] { return this.agents.filter((a) => ids[a.f]); }
  spend(): number { return Math.round(this.agents.reduce((s, a) => s + a.cost, 0)); }
  msOf(fid: string): string | null { return this.P.F[fid] ? this.P.F[fid].milestone : null; }
  heatNow(fid: string, now: number): number { const h = this.heat[fid]; return h ? h.v * Math.exp(-(now - h.t) / 9000) : 0; }
  crewName(sq: string): string { return this.SQ[sq] ? this.SQ[sq].name.replace(' crew', '') : sq; }

  // ---------------------------------------------------------------- orders
  computeViolations() {
    const P = this.P;
    // ranked by the same RULES the live re-check reads; the sample's stamp counts pick the top n
    const rules: Record<string, { rank: (f: Feature) => number | null; desc: boolean }> = {
      'O-1': { rank: (f) => { const r = this.rolloutOf(f); return RULES['O-1'].hit(f, r, null) ? r : null; }, desc: true },
      'O-2': { rank: (f) => { const c = this.covOf(f); return RULES['O-2'].hit(f, 0, c) ? c : null; }, desc: false },
      'O-3': { rank: (f) => { const r = this.rolloutOf(f), m = (!flag(f, 'operations', 'alerting') ? 1 : 0) + (!flag(f, 'operations', 'runbook') ? 1 : 0); return RULES['O-3'].hit(f, r, null) ? m * 1000 + r : null; }, desc: true },
      'O-5': { rank: (f) => (/kiosk/i.test(f.name + ' ' + f.summary) && txt(f, 'design', 'a11y') === 'fail' ? 1 : null), desc: true },
    };
    for (const o of this.orders) {
      const r = rules[o.id]; if (!r) continue;
      const c: [number, string][] = [];
      for (const f of P.base.features) { const v = r.rank(f); if (v != null) c.push([v, f.id]); }
      c.sort((a, b) => (r.desc ? b[0] - a[0] : a[0] - b[0]));
      const ids = c.slice(0, o.n).map((x) => x[1]);
      o.vf = [];
      for (let b = 0; b < P.scale; b++) { const sf = lineSuffix(P.scale, b); for (const id of ids) o.vf.push(id + sf); }
    }
  }
  orderFeats(o: SimOrder): Record<string, 1> {
    const ids: Record<string, 1> = {}, sc = o.scope || {};
    const re = sc.surface ? new RegExp(sc.surface, 'i') : null;
    for (const f of this.P.features) {
      let hit = false;
      if (sc.all) hit = true;
      else if (sc.domain) hit = f.domain === sc.domain || baseId(f.domain) === sc.domain;
      else if (sc.milestone) hit = f.milestone === sc.milestone;
      else if (re && sc.surface) hit = re.test(f.name + ' ' + f.summary) || f.surfaces.includes(sc.surface);
      else if (sc.feats) hit = !!sc.feats[f.id];
      if (hit) ids[f.id] = 1;
    }
    return ids;
  }
  ordMap() {
    if (!this.ordCache) { this.ordCache = {}; for (const o of this.orders) this.ordCache[o.id] = this.orderFeats(o); }
    return this.ordCache;
  }
  ordersOn(fid: string): SimOrder[] { const m = this.ordMap(); return this.orders.filter((o) => m[o.id] && m[o.id][fid]); }
  breachesOn(fid: string): SimOrder[] { return this.orders.filter((o) => o.vf.includes(fid)); }
  scopeWords(o: SimOrder): string {
    const sc = o.scope || {}, P = this.P;
    if (sc.all) return 'Whole product';
    if (sc.domain) { const d = P.base.domains.find((x) => x.id === sc.domain); return d ? d.name : sc.domain; }
    if (sc.milestone) return P.MS[sc.milestone].name + ' (' + sc.milestone + ')';
    if (sc.surface) return 'Everything touching the ' + sc.surface;
    if (sc.feats) return sc.label || 'Targeted places';
    return '';
  }

  // ---------------------------------------------------------------- clock
  private pulse(f: string, k: PulseKind) {
    const now = this.now();
    this.pulses.push({ f, k, t0: now });
    if (this.pulses.length > 90) this.pulses.shift();
    this.heat[f] = { v: Math.min(6, this.heatNow(f, now) + (k === 'c' ? 1 : 2)), t: now };
  }
  private travel(a: SimAgent, to: string) {
    if (a.f === to) return;
    const now = this.now();
    a.tr = { from: a.f, to, t0: now, dur: 1700 }; a.f = to; a.flash = now;
  }
  private apply(e: SimEvent, discrete: { v: boolean }) {
    const A = this.AG[e.agent], f = e.f, F = this.P.F[f];
    if (!F) return;
    this.log.unshift(e); if (this.log.length > 400) this.log.pop();
    this.tally[e.type] = (this.tally[e.type] || 0) + 1;
    const t = e.type;
    if (t === 'move') { if (A) { this.travel(A, f); if (A.status === 'working') A.task = 'moved here: ' + F.name; discrete.v = true; } }
    else if (t === 'commit' && !this.live) this.prog[f] = (this.prog[f] || 0) + 0.7;
    else if (t === 'flag-change') { const m = /(\d+)%/.exec(e.text); if (m) { const c = this.cap[f], r = c != null ? Math.min(c, +m[1]) : +m[1], bs = this.ruleDiff(f, r); this.roll[f] = r; this.applyBreaks(bs, true); discrete.v = true; } }
    else if (t === 'task-done') { if (A) { A.done++; A.pct = 3; } }
    else if (t === 'decision-asked') { const d = e.dec ? this.DEC[e.dec] : null; if (d) { this.openDecision(d, A); discrete.v = true; } }
    this.pulse(f, PULSE_OF[t] || 'c');
    if (A) A.act = this.now();
    this.listener?.event(e);
  }
  private openDecision(d: SimDecision, A: SimAgent | undefined, quiet = false) {
    d.open = true; d.isNew = true; d.since = this.clockMs();
    if (A && A.status === 'working') { A.status = 'waiting'; A.wait = d.id; A.task = 'waiting: ' + d.q; }
    this.index(); this.pulse(d.f, 'ask');
    if (!quiet) this.toast({ strong: 'New question', text: 'from ' + (A ? A.base : 'an agent') + ' · ' + this.P.F[d.f].name + ' · for ' + pname(this.P, d.decider), fid: d.f });
  }
  /**
   * Breaches by difference, read BEFORE the change: the order rules on one feature only, at its current rollout /
   * coverage and at the new ones (`r`, `c`; undefined = unchanged). A rule the change starts to meet adds a stamp;
   * one it stops meeting clears the stamp. Never a recount: the sample's t=0 stamps (top n of more candidates) stay
   * until something moves their feature across the rule.
   */
  private ruleDiff(fid: string, r?: number, c?: number): { o: SimOrder; f: string; add: boolean }[] {
    const F = this.P.F[fid], out: { o: SimOrder; f: string; add: boolean }[] = []; if (!F) return out;
    const r0 = this.rolloutOf(F), c0 = this.covOf(F), r1 = r ?? r0, c1 = c ?? c0;
    for (const o of this.orders) {
      const R = o.user ? null : RULES[o.id]; if (!R) continue;
      const was = R.hit(F, r0, c0), now = R.hit(F, r1, c1), on = o.vf.includes(fid);
      if (now && !was && !on) out.push({ o, f: fid, add: true });
      else if (was && !now && on) out.push({ o, f: fid, add: false });
    }
    return out;
  }
  private applyBreaks(bs: { o: SimOrder; f: string; add: boolean }[], toast: boolean) {
    for (const { o, f, add } of bs) {
      const F = this.P.F[f], i = o.vf.indexOf(f); if (!F || add === i >= 0) continue;
      if (add) { o.vf.push(f); o.n++; this.breaches++; this.pulse(f, 'bad'); }
      else { o.vf.splice(i, 1); o.n = Math.max(0, o.n - 1); this.pulse(f, 'ok'); }
      if (toast) this.toast(add ? { strong: 'Order ' + o.id + ' breached', text: 'at ' + F.name + ' · ' + RULES[o.id].why(F, this.rolloutOf(F), this.covOf(F)), fid: f } : { strong: 'Breach cleared', text: o.id + ' (' + pname(this.P, o.by) + ') holds again at ' + F.name, fid: f });
    }
  }
  /** Advance the hour by wall time `dtMs` at the current speed. Returns true if anything discrete changed. */
  advance(dtMs: number): boolean {
    if (!this.has || !this.playing || this.live) return false;
    const dt = (Math.min(dtMs, 90) / 1000) * this.speed, last = this.t;
    this.t = Math.min(HOUR, this.t + dt);
    const disc = { v: false };
    while (this.i < this.events.length && this.events[this.i].t <= this.t) this.apply(this.events[this.i++], disc);
    const step = this.t - last;
    for (const a of this.agents) {
      if (a.status === 'working' && !a.paused) a.pct = Math.min(99, a.pct + step * 0.012);
      if (a.synth && !a.paused && this.t >= a.nextSynth && this.P.F[a.f]) {
        a.nextSynth = this.t + 12 + hash01(a.id + this.t) * 26;
        this.apply({ t: this.t, agent: a.id, f: a.f, type: 'commit', text: 1 + Math.floor(hash01(a.id + a.f + this.t) * 5) + ' commits on ' + this.P.F[a.f].name, from: null, dec: null, syn: true }, disc);
      }
    }
    if (this.t >= HOUR) {
      this.playing = false; this.over = true; disc.v = true;
      this.toast({ strong: 'The hour is over.', text: 'That was the simulated swarm’s next 60 minutes.', action: 'replay' });
    }
    if (disc.v) { this.index(); this.bump(); }
    return disc.v;
  }
  seek(t: number) {
    if (this.live) return;
    t = Math.max(0, Math.min(HOUR, t)); if (t <= this.t) return;
    const disc = { v: false };
    while (this.i < this.events.length && this.events[this.i].t <= t) this.apply(this.events[this.i++], disc);
    for (const a of this.agents) if (a.status === 'working' && !a.paused) a.pct = Math.min(99, a.pct + (t - this.t) * 0.012);
    this.t = t; this.index(); this.bump();
  }
  reset() {
    if (this.live) return;
    const sp = this.speed;
    this.t = 0; this.playing = true; this.speed = sp; this.i = 0; this.log = []; this.pulses = []; this.heat = {}; this.roll = {};
    this.prog = {}; this.cap = {}; this.cov = {}; this.undo = null; this.undo2 = null; this.over = false; this.breaches = 0; this.tally = {}; this.ordCache = null;
    this.build(); this.bump();
  }
  setSpeed(n: number) { if (this.live) return; this.speed = n; if (!this.over) this.playing = true; this.bump(); }
  togglePlay() { if (this.live) return; if (this.over) { this.reset(); return; } this.playing = !this.playing; this.bump(); }

  // ---------------------------------------------------------------- deciding
  /**
   * The one answer reducer: what option `oi` of `d` does, as a plan over the current state (nothing changes here).
   * It frees the agents the question holds, then applies the option's effects: rollouts set or held, coverage set,
   * agents moved, follow-up questions opened, and the breaches those changes add or clear (by difference).
   * `previewAnswer` describes this plan, `decide` applies it, `undoDecision` reverts what applying overwrote:
   * preview, outcome and undo read the same plan, so they cannot drift.
   */
  private planAnswer(d: SimDecision, oi: number): AnswerPlan {
    const P = this.P, freed = this.agents.filter((a) => a.wait === d.id);
    const pl: AnswerPlan = { d, oi, freed, moves: [], rolls: [], cover: [], asks: [], breaks: [] };
    const R: Record<string, number> = {}, C: Record<string, number> = {};
    for (const e of d.opts[oi]?.effects ?? []) {
      const F = P.F[e.feature]; if (!F) continue;
      if (e.k === 'roll' || e.k === 'cap') {
        const from = R[F.id] ?? this.rolloutOf(F), to = e.k === 'roll' ? e.pct : Math.min(from, e.max);
        R[F.id] = to; pl.rolls.push({ f: F.id, from, to, cap: e.k === 'roll' ? e.pct : e.max });
      } else if (e.k === 'cover') {
        const from = C[F.id] ?? this.covOf(F); if (from == null) continue;
        const to = Math.max(0, Math.min(100, e.pct ?? from + (e.delta ?? 0)));
        C[F.id] = to; pl.cover.push({ f: F.id, from, to });
      } else if (e.k === 'staff') {
        const s = e.from; let k = 0;
        for (const a of this.agents) {
          if (k >= e.n) break;
          if (a.status !== 'working' || a.paused || a.f === F.id || pl.moves.some((m) => m.a === a)) continue;
          if ((s.domain && P.F[a.f]?.domain !== s.domain) || (s.squad && a.sq !== s.squad) || (s.role && a.role !== s.role)) continue;
          pl.moves.push({ a, to: F.id }); k++;
        }
      } else if (e.k === 'ask') {
        // one follow-up per (question, option): id D-10.2 = D-10's option 2 (per product line)
        const base = d.base + '.' + (oi + 1), id = base + lineSuffix(P.scale, d.b);
        if (this.DEC[id] || pl.asks.some((x) => x.d.id === id)) continue;
        // openDecision holds the asker when it works by then (freed or moved agents do)
        const A = this.AG[d.by], hold = A && (A.status === 'working' || freed.includes(A) || pl.moves.some((m) => m.a === A)) ? A : null;
        pl.asks.push({ hold, d: {
          id, base, b: d.b, f: F.id, dom: F.domain, lens: e.lens, decider: e.decider, by: d.by, q: e.question, opts: e.options, rec: e.recommended, urg: e.urgency,
          since: 0, blocks: hold ? 1 : 0, freed: 0, affects: [F.id], arr: 0, open: false, ans: null, isNew: false, freedIds: [],
        } });
      }
    }
    for (const fid of new Set([...Object.keys(R), ...Object.keys(C)])) pl.breaks.push(...this.ruleDiff(fid, R[fid], C[fid]));
    return pl;
  }
  /** The plan in words and marks for the plan layer (kind 'answer'). */
  private describe(pl: AnswerPlan): Preview {
    const P = this.P, d = pl.d, nm = (f: string) => P.F[f]?.name ?? f, lines: string[] = [], marks: AnswerMark[] = [], targets: Record<string, 1> = {}, rows: Record<string, number> = {};
    const mark = (f: string, text: string, tone: AnswerMark['tone'], ring?: AnswerMark['ring']) => { targets[f] = 1; marks.push({ f, text, tone, row: (rows[f] = (rows[f] ?? -1) + 1), ring }); };
    const ag = (n: number) => n + ' agent' + (n === 1 ? '' : 's');
    for (const r of pl.rolls) {
      const held = r.from === r.to;
      lines.push(nm(r.f) + (held ? ': rollout stays at ' + r.to + '%, held there' : ': rollout ' + r.from + '% → ' + r.to + '%'));
      mark(r.f, held ? 'held at ' + r.to + '%' : 'rollout ' + r.from + '% → ' + r.to + '%', 'info');
    }
    for (const c of pl.cover) { lines.push(nm(c.f) + ': unit coverage ' + c.from + '% → ' + c.to + '%'); mark(c.f, 'coverage ' + c.from + '% → ' + c.to + '%', 'info'); }
    if (pl.freed.length) lines.push(ag(pl.freed.length) + ' back to work: ' + pl.freed.map((a) => a.base).join(', '));
    if (pl.moves.length) {
      const to = pl.moves[0].to, from = [...new Set(pl.moves.map((m) => P.D[P.F[m.a.f]?.domain ?? '']?.name ?? '?'))].join(', ');
      lines.push(ag(pl.moves.length) + ' move to ' + nm(to) + ': ' + pl.moves.map((m) => m.a.base).join(', ') + ' (off ' + from + ')');
      mark(to, '+' + ag(pl.moves.length), 'ok');
    }
    for (const x of pl.asks) {
      lines.push('Opens a ' + (P.LENS[x.d.lens]?.name ?? x.d.lens).toLowerCase() + ' question for ' + pname(P, x.d.decider) + ': “' + x.d.q + '”' + (x.hold ? ' (' + x.hold.base + ' waits on it)' : ''));
      mark(x.d.f, 'question for ' + pname(P, x.d.decider).split(' ')[0], 'info');
    }
    for (const b of pl.breaks) {
      const who = pname(P, b.o.by);
      lines.push((b.add ? 'Breaks ' : 'Clears ') + 'order ' + b.o.id + ' (' + who + ') at ' + nm(b.f));
      mark(b.f, b.add ? b.o.id + ' breached · ' + who.split(' ')[0] : b.o.id + ' cleared · ' + who.split(' ')[0], b.add ? 'bad' : 'ok', b.add ? 'add' : 'clear');
    }
    return {
      kind: 'answer', title: d.opts[pl.oi].label, moves: pl.moves, targets, paused: [], lines, n: pl.rolls.length + pl.cover.length + pl.moves.length + pl.asks.length + pl.breaks.length,
      dec: d.id, oi: pl.oi, freed: pl.freed, rolls: pl.rolls.map(({ f, from, to }) => ({ f, from, to })), cover: pl.cover.slice(),
      asks: pl.asks.map((x) => ({ id: x.d.id, f: x.d.f, lens: x.d.lens, decider: x.d.decider, q: x.d.q })), breaks: pl.breaks.map((b) => ({ o: b.o.id, by: b.o.by, f: b.f, add: b.add })), marks,
    };
  }
  /** Does choosing this option have anything to preview (a modelled effect; live: the proposal's expected move)? */
  hasEffect(d: SimDecision, oi: number): boolean { const o = d.opts[oi]; return !!o && (this.live ? !!o.expected : !!o.effects?.length); }
  /**
   * What answering `id` with option `oi` would change, without changing it (the dry run of `decide`). Null for an
   * option without a modelled effect. Live: never a simulated effect, only the proposal's own expected move.
   */
  previewAnswer(id: string, oi: number): Preview | null {
    const d = this.DEC[id]; if (!d || !d.open || !this.hasEffect(d, oi)) return null;
    if (this.live) {
      const x = d.opts[oi].expected as string;
      return { kind: 'answer', title: d.opts[oi].label, moves: [], targets: { [d.f]: 1 }, paused: [], n: 0, dec: id, oi, expected: x, lines: ['Expected: ' + x], marks: [{ f: d.f, text: 'expected: ' + x, tone: 'info', row: 0 }] };
    }
    return this.describe(this.planAnswer(d, oi));
  }
  decide(id: string, oi: number) {
    const d = this.DEC[id]; if (!d || !d.open) return;
    if (this.live) { this.decideLive(d, oi); return; }
    const pl = this.planAnswer(d, oi), pv = this.describe(pl), now = this.now(), P = this.P;
    // keep what the plan overwrites, before any of it is written
    const snap: AgentFull[] = [], keep = (a: SimAgent) => { if (!snap.some((s) => s.a === a)) snap.push({ a, f: a.f, status: a.status, task: a.task, wait: a.wait, pct: a.pct, synth: a.synth, nextSynth: a.nextSynth, paused: a.paused }); };
    for (const a of pl.freed) keep(a);
    for (const m of pl.moves) keep(m.a);
    for (const x of pl.asks) if (x.hold) keep(x.hold);
    this.undo = {
      d, oi, snap, dd: { isNew: d.isNew, freed: d.freed, freedIds: d.freedIds },
      roll: pl.rolls.map((r) => [r.f, this.roll[r.f], this.cap[r.f]]), cov: pl.cover.map((c) => [c.f, this.cov[c.f]]),
      ords: [...new Set(pl.breaks.map((b) => b.o))].map((o) => ({ o, vf: o.vf.slice(), n: o.n })), breaches: this.breaches, asks: pl.asks.map((x) => x.d.id),
    };
    d.open = false; d.isNew = false; d.ans = { opt: oi, t: this.t, at: now };
    for (const a of pl.freed) {
      a.status = 'working'; a.wait = null; a.task = 'resumed after the decision: ' + d.opts[oi].label; a.flash = now; a.synth = true;
      a.nextSynth = this.t + 3 + hash01(a.id) * 10;
    }
    d.freed += pl.freed.length; d.freedIds = pl.freed.map((a) => a.id);
    for (const r of pl.rolls) { this.roll[r.f] = r.to; this.cap[r.f] = r.cap; }
    for (const c of pl.cover) this.cov[c.f] = c.to;
    for (const m of pl.moves) {
      const a = m.a; a.status = 'working'; a.wait = null; a.synth = true; a.nextSynth = this.t + 4 + hash01(a.id) * 14; a.task = 'moved by ' + d.base + ': ' + P.F[m.to].name;
      this.travel(a, m.to);
    }
    this.applyBreaks(pl.breaks, false);
    this.index();
    for (const x of pl.asks) { this.decisions.push(x.d); this.DEC[x.d.id] = x.d; this.openDecision(x.d, x.hold ?? undefined, true); }
    this.pulse(d.f, 'ok'); for (const x of d.affects) if (P.F[x]) this.pulse(x, 'ok');
    const n = pl.freed.length, fx = pv.marks!.map((m) => m.text);
    const cleared = pl.breaks.filter((b) => !b.add).map((b) => b.o.id);
    this.toast({ strong: cleared.length ? 'Decided · breach cleared' : 'Decided', text: d.opts[oi].label + (n ? ' · ' + n + ' agent' + (n > 1 ? 's' : '') + ' back to work' : ' · nobody was blocked') + (fx.length ? ' · ' + fx.join(' · ') : ' · ' + d.affects.length + ' feature' + (d.affects.length > 1 ? 's' : '') + ' touched'), action: 'undo' });
    this.bump();
  }
  /**
   * Live: answer optimistically. Every product line's copy of the question closes and the agents it
   * held go back to work; the store's answer comes back through `settle`. There is no undo: the
   * decision is written to the product's store.
   */
  private decideLive(d0: SimDecision, oi: number) {
    const now = this.now(), kept: { d: SimDecision; snap: AgentSnap[] }[] = [];
    for (const d of this.decisions) {
      if (d.base !== d0.base || !d.open) continue;
      const freed = this.agents.filter((a) => a.wait === d.id);
      kept.push({ d, snap: freed.map((a) => ({ a, status: a.status, task: a.task, wait: a.wait, pct: a.pct })) });
      d.open = false; d.isNew = false; d.ans = { opt: oi, t: this.t, at: now };
      for (const a of freed) { a.status = 'working'; a.wait = null; a.task = 'resumed after the decision: ' + d.opts[oi].label; a.flash = now; }
      d.freed += freed.length; d.freedIds = freed.map((a) => a.id);
      this.pulse(d.f, 'ok');
    }
    this.liveSnap.set(d0.base, kept);
    this.index();
    const lb = d0.opts[oi].label;
    this.toast({ strong: lb === 'Approve' ? 'Approved' : lb === 'Decline' ? 'Declined' : 'Decided: ' + lb, text: d0.q, fid: d0.f });
    this.bump();
  }
  /**
   * Live: the store's answer to a decision made here (`base` = the proposal id). `err` null = saved.
   * Otherwise the toast says why, and the question reopens when `reopen` (it stays closed when
   * someone else already decided it: the next feed shows their answer).
   */
  settle(base: string, err: string | null, reopen: boolean) {
    const kept = this.liveSnap.get(base); this.liveSnap.delete(base);
    if (!err || !kept) return;
    if (reopen) {
      for (const k of kept) {
        k.d.open = true; k.d.ans = null; k.d.freed = Math.max(0, k.d.freed - k.snap.length);
        for (const s of k.snap) { s.a.status = s.status; s.a.task = s.task; s.a.wait = s.wait; s.a.pct = s.pct; }
        if (!this.DEC[k.d.id]) { this.decisions.push(k.d); this.DEC[k.d.id] = k.d; }
      }
      this.index();
    }
    const d = kept[0]?.d;
    this.toast({ strong: err, text: (d ? d.q : base) + (reopen ? ' · the question is open again' : ''), fid: d?.f });
    this.bump();
  }
  /**
   * Live: take a new feed (`swarmFromScan` over the latest scan). Agents are set from it directly
   * (an agent whose feature changed travels there), questions new to it open (with a toast once a run
   * has been seen), questions it no longer lists close, and its events not shown yet are applied as
   * the replay would apply them (log, pulse, ticker). The product, the layout and the engine stay.
   */
  applyFeed(S: Swarm) {
    if (!this.live || !this.has) return;
    const P = this.P, now = this.now(), had = !!this.S0?.squads.length;
    const at0 = S.asOf ? Date.parse(S.asOf) : this.at0;
    if (Number.isFinite(at0) && at0 !== this.at0) { const dt = (this.at0 - at0) / 1000; for (const e of this.log) e.t += dt; this.at0 = at0; }
    this.S0 = S;
    this.squads = S.squads.slice(); this.SQ = {}; this.served = {};
    for (const q of S.squads) this.SQ[q.id] = q;
    const keep = new Set<string>(), listed = new Set<string>();
    for (let b = 0; b < P.scale; b++) {
      const sf = lineSuffix(P.scale, b);
      for (const a of S.agents) {
        const id = a.id + sf, f = a.feature + sf;
        keep.add(id);
        let g = this.AG[id];
        if (!g) {
          g = {
            id, base: this.codeOf(a), b, sq: a.squad, role: a.role, status: a.status, f, task: a.task, pct: a.progressPct, since: Date.parse(a.since),
            tpm: a.tokensPerMin, cost: a.costUsdToday, done: a.doneToday, wait: null, blk: null, ph: hash01(id) * 6.2832,
            paused: false, tr: null, flash: now, synth: false, nextSynth: 0, code: this.codeOf(a), act: now,
          };
          this.agents.push(g); this.AG[id] = g;
        } else if (g.f !== f && P.F[f]) this.travel(g, f);
        g.sq = a.squad; g.role = a.role; g.status = a.status; g.task = a.task; g.pct = a.progressPct; g.since = Date.parse(a.since);
        g.done = a.doneToday; g.wait = a.waitingOn ? a.waitingOn + sf : null; g.blk = a.blockedBy ? a.blockedBy + sf : null;
        g.paused = false; // the feed is the truth: nothing pauses a live agent (sample steers are refused on live)
      }
      for (const d of S.decisions) {
        const id = d.id + sf, g = this.DEC[id];
        listed.add(id);
        if (g) { g.q = d.question; g.opts = d.options; g.urg = d.urgency; g.blocks = d.blocksAgents; g.affects = d.affects.map((x) => x + sf); continue; }
        const n = this.fromDecision(d, b, sf);
        this.decisions.push(n); this.DEC[id] = n;
        if (had && P.F[n.f]) {
          n.isNew = true; this.pulse(n.f, 'ask');
          if (b === 0) this.toast({ strong: 'New question', text: 'from ' + (this.AG[n.by]?.code ?? 'the scan') + ' · ' + P.F[n.f].name + ' · for ' + pname(P, n.decider), fid: n.f });
        }
      }
    }
    if (keep.size !== this.agents.length) { this.agents = this.agents.filter((a) => keep.has(a.id)); this.AG = {}; for (const a of this.agents) this.AG[a.id] = a; }
    // decided elsewhere (or moved on by the skill): close it; closed ones the feed no longer lists go once their release has drawn
    for (const d of this.decisions) if (d.open && !listed.has(d.id)) d.open = false;
    const n0 = this.decisions.length;
    this.decisions = this.decisions.filter((d) => listed.has(d.id) || d.open || (d.ans && now - d.ans.at < 10000));
    if (this.decisions.length !== n0) { this.DEC = {}; for (const d of this.decisions) this.DEC[d.id] = d; }
    const disc = { v: false };
    for (const e of S.replay) {
      const k = liveKey(e); if (this.seen.has(k)) continue;
      this.seen.add(k);
      const t = (Date.parse(e.at) - this.at0) / 1000;
      for (let b = 0; b < P.scale; b++) {
        const sf = lineSuffix(P.scale, b);
        this.apply({ t: Number.isFinite(t) ? t : e.t, agent: e.agent + sf, f: e.feature + sf, type: e.type, text: e.text, from: null, dec: null }, disc);
      }
    }
    if (this.seen.size > 2000) this.seen = new Set(S.replay.map(liveKey));
    this.index(); this.bump();
  }
  /** Take the last answer back: every field `decide` wrote is put back from what it kept (the same plan). */
  undoDecision() {
    const u = this.undo; if (!u) return;
    const d = u.d; d.open = true; d.ans = null; d.isNew = u.dd.isNew; d.freed = u.dd.freed; d.freedIds = u.dd.freedIds;
    for (const s of u.snap) {
      const a = s.a; a.status = s.status; a.task = s.task; a.wait = s.wait; a.pct = s.pct; a.synth = s.synth; a.nextSynth = s.nextSynth; a.paused = s.paused;
      if (a.f !== s.f) this.travel(a, s.f);
    }
    for (const [f, r, c] of u.roll) { if (r == null) delete this.roll[f]; else this.roll[f] = r; if (c == null) delete this.cap[f]; else this.cap[f] = c; }
    for (const [f, c] of u.cov) { if (c == null) delete this.cov[f]; else this.cov[f] = c; }
    for (const o of u.ords) { o.o.vf = o.vf; o.o.n = o.n; }
    this.breaches = u.breaches;
    if (u.asks.length) { this.decisions = this.decisions.filter((x) => !u.asks.includes(x.id)); for (const id of u.asks) delete this.DEC[id]; }
    this.undo = null; this.index();
    this.toast({ strong: 'Decision taken back', text: 'the question is open again' });
    this.bump();
  }

  // ---------------------------------------------------------------- steering (preview, then commit)
  private wingList(agents: SimAgent[], wingName: (fid: string) => string): string {
    const m: Record<string, number> = {};
    for (const a of agents) { const w = wingName(a.f); m[w] = (m[w] || 0) + 1; }
    return Object.keys(m).map((k) => m[k] + ' in ' + k).join(', ');
  }
  private mkPush(title: string, donors: SimAgent[], targets: Feature[], extra: string[], wingName: (fid: string) => string): Preview | null {
    if (!donors.length || !targets.length) return null;
    const prio = (f: Feature) => (f.priority ? { P0: 0, P1: 1, P2: 2, P3: 3 }[f.priority] : 2);
    const tg = targets.slice().sort((a, b) => (this.AGF[a.id] || []).length - (this.AGF[b.id] || []).length || prio(a) - prio(b));
    const moves = donors.map((a, i) => ({ a, to: tg[i % tg.length].id }));
    const waiting = donors.filter((a) => a.status === 'waiting');
    const lines = [donors.length + ' agent' + (donors.length > 1 ? 's' : '') + ' leave their work (' + this.wingList(donors, wingName) + ')'];
    if (waiting.length) lines.push(waiting.length + ' of them were waiting on a person; those questions stay open but stop blocking anyone');
    const tf: Record<string, 1> = {}; for (const f of targets) tf[f.id] = 1;
    lines.push(targets.length + ' feature' + (targets.length > 1 ? 's' : '') + ' get more hands: ' + tg.slice(0, 3).map((f) => f.name).join(', ') + (tg.length > 3 ? ' and ' + (tg.length - 3) + ' more' : ''));
    lines.push(...extra);
    return { kind: 'push', title, moves, targets: tf, paused: [], lines, n: donors.length };
  }
  previewGA(wingName: (fid: string) => string): Preview | null {
    const donors = this.agents.filter((a) => { const m = this.msOf(a.f); return !!m && LATER_MILESTONES.includes(m) && a.status !== 'failed' && !a.paused; });
    const targets = this.P.features.filter((f) => f.milestone === GA_MILESTONE && f.stage !== 'live');
    const p = this.mkPush('Payments GA first', donors, targets, ['Standing order O-4 (Mara) already allows pulling agents from M3 and M4', 'M3 Multi-location and M4 Assistant slow down until you send the agents back'], wingName);
    if (p) p.order = 'O-4';
    return p;
  }
  previewPushHere(tgt: Target, wingName: (fid: string) => string): Preview | null {
    if (!tgt.n) return null;
    const ids = tgt.ids;
    const targets = this.P.features.filter((f) => ids[f.id] && f.stage !== 'live' && f.stage !== 'deprecated');
    const rank = (a: SimAgent) => { const m = this.msOf(a.f); return m && LATER_MILESTONES.includes(m) ? 0 : m == null ? 1 : m === FIRST_MILESTONE ? 2 : 3; };
    const donors = this.agents.filter((a) => !ids[a.f] && a.status === 'working' && !a.paused && this.msOf(a.f) !== GA_MILESTONE).sort((a, b) => rank(a) - rank(b) || a.pct - b.pct).slice(0, 5);
    return this.mkPush('Put the swarm on ' + (tgt.label || 'this selection'), donors, targets, ['Only agents that are working and not on Payments GA are pulled'], wingName);
  }
  previewPause(tgt: Target, resume: boolean): Preview | null {
    if (!tgt.n) return null;
    const ag = this.agentsIn(tgt.ids).filter((a) => (resume ? a.paused : !a.paused && a.status !== 'failed'));
    if (!ag.length) return null;
    const asks = new Set<string>(); for (const a of ag) if (a.wait && this.DEC[a.wait]?.open) asks.add(a.wait);
    const n = asks.size, s = ag.length > 1 ? 's' : '';
    return {
      kind: resume ? 'resume' : 'pause', title: (resume ? 'Resume ' : 'Pause ') + ag.length + ' agent' + s + ' on ' + (tgt.label || 'the selection'),
      moves: [], targets: tgt.ids, paused: ag, n: ag.length,
      lines: [ag.length + ' agent' + s + (resume ? ' pick up where they stopped' : ' stop where they are: no work is lost'), n ? n + ' open question' + (n > 1 ? 's stay' : ' stays') + ' open' : 'No open question is affected'],
    };
  }
  previewOrder(tgt: Target, tpl: OrderTemplate): Preview | null {
    if (!tgt.n) return null;
    const T = ORDER_TEMPLATES[tpl], gov = this.P.features.filter((f) => tgt.ids[f.id]).length;
    return {
      kind: 'order', title: 'Standing order: ' + T, moves: [], targets: tgt.ids, paused: [], tpl, text: T, label: tgt.label, n: 0,
      lines: ['Written on ' + gov + ' feature' + (gov > 1 ? 's' : '') + ' (' + (tgt.label || 'selection') + ')', 'Shows as a stamp on those places; a breach is marked where it happens', 'Agents read it before their next task'],
    };
  }
  previewResearch(): Preview | null {
    const ag = this.agents.filter((a) => a.sq === 'scout' && !a.paused);
    if (!ag.length) return null;
    const ids: Record<string, 1> = {}; for (const a of ag) ids[a.f] = 1;
    return {
      kind: 'pause', title: 'Pause the research crew', moves: [], targets: ids, paused: ag, n: ag.length, order: 'O-7',
      lines: [ag.length + ' research agents stop (spend cap order O-7 says research goes first)', 'Today’s swarm spend: $' + this.spend().toLocaleString('en-US') + ' of the $' + SPEND_CAP.toLocaleString('en-US') + ' cap'],
    };
  }
  commit(p: Preview, who: string | null) {
    if (p.kind === 'answer') return;   // an answer preview is applied by decide, never as a command
    const snap: NonNullable<SwarmSim['undo2']>['snap'] = [];
    if (p.kind === 'push') {
      for (const m of p.moves) {
        const a = m.a;
        snap.push({ a, f: a.f, status: a.status, task: a.task, wait: a.wait, paused: a.paused, synth: a.synth });
        if (a.wait && this.DEC[a.wait]) this.DEC[a.wait].freed++;
        a.status = 'working'; a.wait = null; a.paused = false; a.synth = true; a.nextSynth = this.t + 4 + hash01(a.id) * 14; a.task = 'joined the push: ' + this.P.F[m.to].name;
        this.travel(a, m.to);
      }
    } else if (p.kind === 'pause' || p.kind === 'resume') {
      const now = this.now();
      for (const a of p.paused) { snap.push({ a, f: a.f, status: a.status, task: a.task, wait: a.wait, paused: a.paused, synth: a.synth }); a.paused = p.kind === 'pause'; a.flash = now; }
    } else if (p.kind === 'order') {
      const no = 'O-' + (this.orders.length + 1), by = who || 'mara';
      this.orders.push({ id: no, by, lens: personLens(this.P, by) ?? 'general', scope: { feats: p.targets, label: p.label }, text: p.text || '', since: new Date(this.at0 + this.t * 1000).toISOString().slice(0, 10), n: 0, vf: [], user: true });
      this.ordCache = null; snap.push({ order: no });
    }
    this.undo2 = { snap, kind: p.kind };
    this.index();
    this.toast(p.kind === 'push' ? { strong: 'Addendum issued · ' + p.n + ' agents are moving', text: p.title, action: 'undo2' } : p.kind === 'order' ? { strong: 'Order written', text: p.text || '', action: 'undo2' } : { strong: p.title, text: '', action: 'undo2' });
    this.bump();
  }
  undoCommand() {
    const u = this.undo2; if (!u) return;
    for (const s of u.snap) {
      if ('order' in s) { this.orders = this.orders.filter((o) => o.id !== s.order); this.ordCache = null; continue; }
      const a = s.a; a.status = s.status; a.task = s.task; a.wait = s.wait; a.paused = s.paused; a.synth = s.synth;
      if (a.f !== s.f) this.travel(a, s.f);
    }
    this.undo2 = null; this.index();
    this.toast({ strong: 'Command taken back', text: '' });
    this.bump();
  }
  /** Drop visual bookkeeping that has expired (called by the engine, not per frame). */
  expire(now: number) {
    if (this.pulses.length) this.pulses = this.pulses.filter((p) => now - p.t0 < 2300);
    for (const a of this.agents) if (a.tr && now - a.tr.t0 - a.tr.dur > 5000) a.tr = null;
  }
  /** Something is visibly moving (pulses, travel, flashes, freed lines): the engine keeps drawing. */
  animating(now: number): boolean {
    if (this.pulses.length) return true;
    for (const a of this.agents) if (a.tr || (a.flash && now - a.flash < 1200)) return true;
    for (const d of this.decisions) if (d.ans && now - d.ans.at < 3300) return true;
    return false;
  }
}
