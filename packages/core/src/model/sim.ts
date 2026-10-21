// The simulated swarm: 42 agents (per product line), decisions that open and close, standing orders
// and their breaches, and a replayable hour at 1x..240x. Everything here is a simulation over sample
// data; nothing talks to a real system. Pure TS: wall-clock time is injected (`now`) and visual
// effects are recorded as plain data (pulses, heat, travel) for the engine to draw.
//
// Live mode (`{ live: true }`, a live product's lens scan): the same state, driven by the feed instead
// of the replay. There is no recorded hour: waits and ages use the wall clock (`wall`), and each new
// feed (`applyFeed`) sets the agents, the open questions and the recent events directly. Agents are
// the truth, not the replay.
import type { Agent, Decision, DecisionOption, OptionEffect, ReplayEvent, ReplayType, StandingOrder, Swarm, AgentStatus, CrewRole, Squad, ViewId, Feature, Scalar } from '@bp/core/data';
import { fval } from '@bp/core/standard/load';
import { FIRST_MILESTONE, GA_MILESTONE, HOUR, LATER_MILESTONES, PULSE_OF, SPEND_CAP, USD_PER_KTOK, type PulseKind } from './constants';
import { isLiveSt } from './aggregates';
import { personLens } from './lens';
import { baseId, lineSuffix, pname, type Product } from './product';
import { ymdUTC } from './time';
import { tierRank } from '@bp/core/scan/derive';

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
const RULES: Record<string, { hit: (f: Feature, r: number, c: number | null, ms: (slug: string) => string | null) => boolean; why: (f: Feature, r: number, c: number | null) => string; scoped?: boolean }> = {
  'O-1': { hit: (f, r) => isLiveSt(f.stage) && cardUnreviewed(f) && r > 10, why: () => 'card data above 10% without a security review' },
  'O-2': { hit: (f, _r, c) => (f.stage === 'in-review' || isLiveSt(f.stage)) && c != null && c < 70, why: (_f, _r, c) => 'unit coverage ' + c + '%, under 70%' },
  'O-3': { hit: (f, r) => isLiveSt(f.stage) && (!flag(f, 'operations', 'alerting') || !flag(f, 'operations', 'runbook')) && r >= 50, why: (f, r) => 'rollout ' + r + '% without ' + (!flag(f, 'operations', 'alerting') ? 'an alert' : 'a runbook') },
  // "A P1 bug stops the feature's rollout": an open P1 (quality.openBugsP1) on a feature that is rolled out at all
  'O-6': { hit: (f, r) => (num(f, 'quality', 'openBugsP1') ?? 0) > 0 && r > 0, why: (f, r) => (num(f, 'quality', 'openBugsP1') ?? 0) + ' open P1 bug, rollout ' + r + '%' },
  // "Assistant features stay behind an internal flag until M3 ships": in its scope, any rollout to customers before M3 has shipped
  'O-8': { hit: (f, r, _c, ms) => isLiveSt(f.stage) && r > 0 && ms(M3) !== 'shipped', why: (_f, r) => 'rollout ' + r + '% before M3 ships', scoped: true },
};
/** O-8's "until M3 ships" (the sample's multi-location milestone). */
const M3 = 'multi-location';

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
  /** Asked because of this standing order (an `ask` or `review` order's question). */
  ord?: string;
  /** A kept answer (`keepAnswer`) recommends option `rec` here; `rec0` is the agent's own recommendation, put back if that order goes. */
  recBy?: string; rec0?: number;
  /** v4: a live proposal's severity tier (0 stop-ship .. 3 backlog); absent = untriaged (Kettle's questions never have one). */
  tier?: number;
}
export interface OrderScope { domain?: string; milestone?: string; surface?: string; all?: boolean; feats?: Record<string, 1>; label?: string }
/**
 * What a written order overrode, so undoing it puts the hour back: `n` events held, the rollout each held feature's agents
 * last asked for, where each refused agent last wanted to go, the questions it opened and the agents they made wait.
 */
export interface OrderHeld { n: number; rolls: Record<string, number>; moves: Record<string, string>; asks: string[]; snap: AgentFull[] }
/**
 * An answer kept as a standing order: the decision, its lens, the option's label and effect kinds, and the effects (a roll
 * or cap holds every rollout in scope through the shared constraint path). Later questions it covers are still asked; it
 * only becomes their recommendation.
 */
export interface KeptAnswer { dec: string; lens: string; label: string; kinds: OptionEffect['k'][]; fx: OptionEffect[] }
export interface SimOrder { id: string; by: string; lens: string; scope: OrderScope; text: string; since: string; n: number; vf: string[]; user: boolean; tpl?: OrderTemplate; held?: OrderHeld; keep?: KeptAnswer }
/** Open questions one action may decide together (`batchGroups`): same lens, none urgent, the same kind of recommended answer. */
export interface BatchGroup { key: string; lens: string; ids: string[]; label: string }
/** `held`: the order (O-n) or answer (D-n) that overrode this event; the log shows it as "held by". */
export interface SimEvent { t: number; agent: string; f: string; type: ReplayType; text: string; from: string | null; dec: string | null; syn?: boolean; held?: string }
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
/**
 * How a toast reads. 'bad' = something failed or an order was breached, 'warn' = an action was refused,
 * 'ok' = a failure cleared. ABSENT = neutral: a plain confirmation of what the reader just did. Every path
 * that reports a failure must set one, so the UI half cannot paint it in the success chrome it defaults to;
 * scripts/check-model.ts section (d) pins the failing paths' tones.
 */
export type ToastTone = 'ok' | 'warn' | 'bad';
export interface SimToast { strong: string; text: string; action?: 'undo' | 'undo2' | 'replay'; fid?: string; tone?: ToastTone }
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
export type AgentFull = AgentSnap & { f: string; synth: boolean; nextSynth: number; paused: boolean };
const full = (a: SimAgent): AgentFull => ({ a, f: a.f, status: a.status, task: a.task, wait: a.wait, pct: a.pct, synth: a.synth, nextSynth: a.nextSynth, paused: a.paused });
/** An effect kind in words (batch labels). */
const KIND_WORDS: Record<string, string> = { roll: 'sets a rollout', cap: 'holds a rollout', staff: 'moves agents', ask: 'opens a follow-up', cover: 'sets coverage' };
const REVIEW_EV: Partial<Record<ReplayType, 1>> = { 'pr-open': 1, 'review-pass': 1, 'review-changes': 1 };
/** What one answer does (`planAnswer`): the agents it frees, then its option's effects, and the breaches they add or clear. */
interface AnswerPlan {
  d: SimDecision; oi: number; freed: SimAgent[]; moves: { a: SimAgent; to: string }[];
  rolls: { f: string; from: number; to: number; cap: number }[]; cover: { f: string; from: number; to: number }[];
  asks: { d: SimDecision; hold: SimAgent | null }[]; breaks: { o: SimOrder; f: string; add: boolean }[];
}
/** What `decide` overwrote, so `undoDecision` restores exactly that. */
interface DecisionUndo {
  d: SimDecision; oi: number; snap: AgentFull[]; dd: { isNew: boolean; freed: number; freedIds: string[] };
  roll: [string, number | undefined, number | undefined, string | undefined][]; cov: [string, number | undefined][];
  ords: { o: SimOrder; vf: string[]; n: number }[]; breaches: number; asks: string[];
}
const sfx = (e: OptionEffect, sf: string): OptionEffect => (e.k === 'staff' ? { ...e, feature: e.feature + sf, from: e.from.domain ? { ...e.from, domain: e.from.domain + sf } : e.from } : { ...e, feature: e.feature + sf });
const liveKey = (e: ReplayEvent) => e.at + '|' + e.agent + '|' + e.feature + '|' + e.text;

/** The graver of two toast tones (a burst of held-back toasts reads as the worst thing in it). */
const TONE_RANK: Record<ToastTone, number> = { ok: 1, warn: 2, bad: 3 };
function worseTone(a: ToastTone | undefined, b: ToastTone | undefined): ToastTone | undefined {
  if (!a) return b;
  if (!b) return a;
  return TONE_RANK[b] > TONE_RANK[a] ? b : a;
}

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
  /** Which answer set each `cap` (its decision's base id): a held flag change logs "held by D-01" like an order's. */
  capBy: Record<string, string> = {};
  /** Spend accrues per whole simulated second up to here (deterministic whatever the frame rate). */
  private paidT = 0;
  /** Per-event toasts above 60x and while seeking: counted, then shown as one. */
  private burst: { n: number; last: SimToast; at: number; tone?: ToastTone } | null = null; private seeking = false;
  undo: { list: DecisionUndo[]; order?: string } | null = null;
  undo2: { kind: PreviewKind; snap: ({ order: string } | { a: SimAgent; f: string; status: AgentStatus; task: string; wait: string | null; paused: boolean; synth: boolean })[] } | null = null;
  breaches = 0; tally: Partial<Record<ReplayType, number>> = {};
  /** Bumped on every discrete change (status, queue, orders): cheap change detection for caches. */
  version = 0;
  /** Live: bumped when features' health or fields changed in place (a reading, a map refresh); the static raster must be redone, not patched. */
  healthV = 0;
  private ordCache: Record<string, Record<string, 1>> | null = null;
  private listener: SimListener | null = null;

  private P: Product;
  private S0: Swarm | null;
  private now: () => number;
  constructor(P: Product, S0: Swarm | null, now: () => number, opts: SimOptions = {}) {
    this.P = P; this.S0 = S0; this.now = now;
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
      ...(d.tier !== undefined ? { tier: d.tier } : {}),
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
  /** The rollout somebody measured (the simulated hour's, else the map's), or null when nobody did - never an invented figure. */
  rolloutMeasured(f: Feature): number | null {
    const r = this.roll[f.id];
    return r != null ? r : num(f, ...SIM_FIELDS.rollout);
  }
  /** Rollout as a plain number: the measured one, else 100 for a live or flagged feature and 0 for the rest. Ask rolloutMeasured to tell a reading from that fallback. */
  rolloutOf(f: Feature): number { return this.rolloutMeasured(f) ?? (isLiveSt(f.stage) ? 100 : 0); }
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
  /** The queue's order: tier ascending (untriaged after tier 3; v4), then the score, highest first. */
  queueCmp = (a: SimDecision, b: SimDecision): number => tierRank(a.tier) - tierRank(b.tier) || this.score(b) - this.score(a);
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
    const open = this.openDecs().sort(this.queueCmp);
    const mine = who ? open.filter((d) => d.decider === who) : [];
    const rest = open.filter((d) => !mine.includes(d));
    if (!who && view !== 'general') rest.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || Number(b.lens === view) - Number(a.lens === view) || this.score(b) - this.score(a));
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
  /** The swarm's burn in USD an hour now: working, unpaused agents at their tokens a minute (`skip` leaves some out, for a preview). */
  burn(skip?: (a: SimAgent) => boolean): number { let s = 0; for (const a of this.agents) if (a.status === 'working' && !a.paused && !skip?.(a)) s += a.tpm * 60 * USD_PER_KTOK / 1000; return Math.round(s); }
  private accrue(to: number) {
    const s = Math.floor(to), n = s - this.paidT; if (n <= 0) return;
    for (const a of this.agents) if (a.status === 'working' && !a.paused) a.cost += (n * a.tpm * USD_PER_KTOK) / 60000;
    this.paidT = s;
  }
  msOf(fid: string): string | null { return this.P.F[fid] ? this.P.F[fid].milestone : null; }
  heatNow(fid: string, now: number): number { const h = this.heat[fid]; return h ? h.v * Math.exp(-(now - h.t) / 9000) : 0; }
  crewName(sq: string): string { return this.SQ[sq] ? this.SQ[sq].name.replace(' crew', '') : sq; }

  // ---------------------------------------------------------------- orders
  computeViolations() {
    const P = this.P, ms = (s: string) => P.MS[s]?.state ?? null;
    // ranked by the same RULES the live re-check reads; the sample's stamp counts pick the top n
    const rules: Record<string, { rank: (f: Feature) => number | null; desc: boolean }> = {
      'O-1': { rank: (f) => { const r = this.rolloutOf(f); return RULES['O-1'].hit(f, r, null, ms) ? r : null; }, desc: true },
      'O-2': { rank: (f) => { const c = this.covOf(f); return RULES['O-2'].hit(f, 0, c, ms) ? c : null; }, desc: false },
      'O-3': { rank: (f) => { const r = this.rolloutOf(f), m = (!flag(f, 'operations', 'alerting') ? 1 : 0) + (!flag(f, 'operations', 'runbook') ? 1 : 0); return RULES['O-3'].hit(f, r, null, ms) ? m * 1000 + r : null; }, desc: true },
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
  /** The first written order of template `tpl` that governs this feature. */
  orderOn(fid: string, tpl: OrderTemplate): SimOrder | null {
    const m = this.ordMap();
    for (const o of this.orders) if (o.tpl === tpl && m[o.id]?.[fid]) return o;
    return null;
  }
  /** An order's one question on a feature (per (order, feature)). */
  oq(o: SimOrder, fid: string): string { return o.id + '@' + fid; }
  /**
   * The one rollout constraint every flag change passes: the lowest of an answer's hold (`cap`, set by decide) and the
   * 10% of each `ask` order over the feature whose question is not answered yet. Null = nothing holds it.
   */
  rollLimit(fid: string): { max: number; by: string; o: SimOrder | null } | null {
    let lim: { max: number; by: string; o: SimOrder | null } | null = this.cap[fid] != null ? { max: this.cap[fid], by: this.capBy[fid] ?? 'an answer', o: null } : null;
    const m = this.ordMap();
    for (const o of this.orders) {
      if (o.tpl !== 'ask' || !m[o.id]?.[fid] || this.DEC[this.oq(o, fid)]?.ans) continue;
      if (!lim || 10 < lim.max) lim = { max: 10, by: o.id, o };
    }
    // a kept answer's roll / cap: the same hold over every feature in its scope (after the ask orders, so they still ask)
    for (const o of this.orders) {
      if (!o.keep || !m[o.id]?.[fid]) continue;
      for (const e of o.keep.fx) { const max = e.k === 'cap' ? e.max : e.k === 'roll' ? e.pct : null; if (max != null && (!lim || max < lim.max)) lim = { max, by: o.id, o: null }; }
    }
    return lim;
  }
  /** A `review` order whose question on this feature is open: build progress there waits for the answer. */
  reviewGate(fid: string): SimOrder | null {
    const m = this.ordMap();
    for (const o of this.orders) if (o.tpl === 'review' && m[o.id]?.[fid] && this.DEC[this.oq(o, fid)]?.open) return o;
    return null;
  }
  ordersOn(fid: string): SimOrder[] { const m = this.ordMap(); return this.orders.filter((o) => m[o.id] && m[o.id][fid]); }
  breachesOn(fid: string): SimOrder[] { return this.orders.filter((o) => o.vf.includes(fid)); }
  scopeWords(o: SimOrder): string {
    const sc = o.scope || {}, P = this.P;
    if (sc.all) return 'Whole product';
    if (sc.domain) { const d = P.base.domains.find((x) => x.id === sc.domain); return d ? d.name : sc.domain; }
    // every branch reads as its own slug when the map does not have that place (the domain branch always did)
    if (sc.milestone) { const m = P.MS[sc.milestone]; return m ? m.name + ' (' + sc.milestone + ')' : sc.milestone; }
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
  /**
   * The one constraint path every event passes before it applies (answers' rollout holds and written orders alike).
   * Null = it applies as recorded. Otherwise `by` holds it (logged "held by"), and a flag change applies at `r`.
   * Opens the order's question where its rule says so (one per order and feature).
   */
  private govern(e: SimEvent, A: SimAgent | undefined, discrete: { v: boolean }): { by: string; r?: number } | null {
    if (this.live) return null;
    const f = e.f, t = e.type;
    if (t === 'flag-change') {
      const m = /(\d+)%/.exec(e.text); if (!m) return null;
      const want = +m[1], lim = this.rollLimit(f);
      if (!lim || want <= lim.max) { for (const o of this.orders) if (o.held) delete o.held.rolls[f]; return null; }
      if (lim.o) { const h = this.heldOf(lim.o); h.n++; h.rolls[f] = want; if (this.orderAsk(lim.o, f, A, want)) discrete.v = true; }
      return { by: lim.by, r: lim.max };
    }
    if (t === 'move') {
      if (!A) return null;
      const o = A.f !== f ? this.orderOn(f, 'hold') : null;
      if (!o) { for (const x of this.orders) if (x.held) delete x.held.moves[A.id]; return null; }
      const h = this.heldOf(o); h.n++; h.moves[A.id] = f;
      if (A.status === 'working') A.task = 'held by ' + o.id + ': stays off ' + this.P.F[f].name;
      return { by: o.id };
    }
    if (t === 'commit') { const o = this.reviewGate(f); if (o) { this.heldOf(o).n++; return { by: o.id }; } return null; }
    if (REVIEW_EV[t]) { const o = this.orderOn(f, 'review'); if (o && this.orderAsk(o, f, A)) discrete.v = true; }
    return null;
  }
  private heldOf(o: SimOrder): OrderHeld { return (o.held ||= { n: 0, rolls: {}, moves: {}, asks: [], snap: [] }); }
  /**
   * Open an order's question on a feature for its author, once per (order, feature). `ask`: the agent wanted `want`%;
   * "Go ahead" sets it through the answer reducer (a roll effect), "Hold at 10%" keeps the order's limit as an answer's
   * cap. `review`: build progress waits until either answer. The agent that raised it waits on it.
   */
  private orderAsk(o: SimOrder, fid: string, A: SimAgent | undefined, want?: number): boolean {
    const id = this.oq(o, fid); if (this.DEC[id]) return false;
    const P = this.P, F = P.F[fid], ask = o.tpl === 'ask', who = A ? A.base : 'An agent';
    const d: SimDecision = {
      id, base: o.id + '/' + (F.code || baseId(fid)), b: A?.b ?? 0, f: fid, dom: F.domain, lens: o.lens, decider: o.by, by: A?.id ?? '',
      q: ask ? who + ' wants ' + F.name + ' at ' + want + '%. Your order ' + o.id + ' says ask above 10%.' : F.name + ' is ready for review. Your order ' + o.id + ' says a human reviews before it merges.',
      opts: ask ? [
        { label: 'Go ahead to ' + want + '%', consequence: 'The flag moves to ' + want + '% and is held there.', effects: [{ k: 'roll', feature: fid, pct: want! }] },
        { label: 'Hold at 10%', consequence: 'The flag stays at 10% or below; agents work on.', effects: [{ k: 'cap', feature: fid, max: 10 }] },
      ] : [
        { label: 'Approve the merge', consequence: 'Build work here resumes.' },
        { label: 'Send back', consequence: 'Agents rework it; build work resumes on the changes.' },
      ],
      rec: 0, urg: 'medium', since: 0, blocks: A && A.status === 'working' ? 1 : 0, freed: 0, affects: [fid], arr: 0,
      open: false, ans: null, isNew: false, freedIds: [], ord: o.id,
    };
    const h = this.heldOf(o); h.asks.push(id); if (A && A.status === 'working') h.snap.push(full(A));
    this.decisions.push(d); this.DEC[id] = d;
    this.openDecision(d, A, true);
    this.evToast({ strong: 'Asked because of ' + o.id, text: (ask ? F.name + ' held at 10%' : F.name + ' waits for review') + ' · for ' + pname(P, o.by), fid });
    return true;
  }
  private evToast(t: SimToast) {
    if (this.speed <= 60 && !this.seeking) { this.toast(t); return; }
    if (this.burst) { this.burst.n++; this.burst.last = t; this.burst.tone = worseTone(this.burst.tone, t.tone); } else this.burst = { n: 1, last: t, at: this.now(), tone: t.tone };
  }
  private flushBurst(force: boolean) {
    const b = this.burst; if (!b || (!force && this.now() - b.at < 2000)) return;
    this.burst = null;
    this.toast(b.n === 1 ? b.last : { strong: b.n + ' updates', text: 'latest: ' + b.last.strong + ' · ' + b.last.text, fid: b.last.fid, ...(b.tone ? { tone: b.tone } : {}) });
  }
  private apply(e: SimEvent, discrete: { v: boolean }) {
    const A = this.AG[e.agent], f = e.f, F = this.P.F[f];
    if (!F) return;
    const g = this.govern(e, A, discrete), le: SimEvent = g ? { ...e, text: e.text + ' · held by ' + g.by + (g.r != null ? ' at ' + g.r + '%' : ''), held: g.by } : e;
    this.log.unshift(le); if (this.log.length > 400) this.log.pop();
    this.tally[e.type] = (this.tally[e.type] || 0) + 1;
    const t = e.type;
    if (t === 'move') { if (A && !g) { this.travel(A, f); if (A.status === 'working') A.task = 'moved here: ' + F.name; discrete.v = true; } }
    else if (t === 'commit' && !this.live) { if (!g) this.prog[f] = (this.prog[f] || 0) + 0.7; }
    else if (t === 'flag-change') { const m = /(\d+)%/.exec(e.text); if (m) { const r = g?.r ?? +m[1], bs = this.ruleDiff(f, r); this.roll[f] = r; this.applyBreaks(bs, true); discrete.v = true; } }
    else if (t === 'task-done') { if (A) { A.done++; A.pct = 3; } }
    else if (t === 'decision-asked') { const d = e.dec ? this.DEC[e.dec] : null; if (d) { this.openDecision(d, A); discrete.v = true; } }
    this.pulse(f, g ? 'bad' : PULSE_OF[t] || 'c');
    if (A) A.act = this.now();
    this.listener?.event(le);
  }
  /**
   * A kept answer as this question's recommendation (never its answer): an order kept from another question, with the same
   * lens, whose scope covers this feature, and an option here with the kept effect kind (effect-free: the same label).
   * Urgent questions keep the agent's own recommendation.
   */
  private precedent(d: SimDecision) {
    if (this.live || d.urg === 'high') return;
    const m = this.ordMap();
    for (const o of this.orders) {
      const k = o.keep; if (!k || k.dec === d.id || k.lens !== d.lens || !m[o.id]?.[d.f]) continue;
      const i = d.opts.findIndex((x) => (k.kinds.length ? !!x.effects?.some((e) => k.kinds.includes(e.k)) : x.label.toLowerCase() === k.label.toLowerCase()));
      if (i < 0) continue;
      d.rec0 ??= d.rec; d.rec = i; d.recBy = o.id;
      return;
    }
  }
  private openDecision(d: SimDecision, A: SimAgent | undefined, quiet = false) {
    d.open = true; d.isNew = true; d.since = this.clockMs();
    this.precedent(d);
    if (A && A.status === 'working') { A.status = 'waiting'; A.wait = d.id; A.task = 'waiting: ' + d.q; }
    this.index(); this.pulse(d.f, 'ask');
    if (!quiet) this.evToast({ strong: 'New question', text: 'from ' + (A ? A.base : 'an agent') + ' · ' + this.P.F[d.f].name + ' · for ' + pname(this.P, d.decider), fid: d.f });
  }
  /**
   * Breaches by difference, read BEFORE the change: the order rules on one feature only, at its current rollout /
   * coverage and at the new ones (`r`, `c`; undefined = unchanged). A rule the change starts to meet adds a stamp;
   * one it stops meeting clears the stamp. Never a recount: the sample's t=0 stamps (top n of more candidates) stay
   * until something moves their feature across the rule.
   */
  private ruleDiff(fid: string, r?: number, c?: number): { o: SimOrder; f: string; add: boolean }[] {
    const F = this.P.F[fid], out: { o: SimOrder; f: string; add: boolean }[] = []; if (!F) return out;
    const r0 = this.rolloutOf(F), c0 = this.covOf(F), r1 = r ?? r0, c1 = c ?? c0, ms = (s: string) => this.P.MS[s]?.state ?? null;
    for (const o of this.orders) {
      const R = o.user ? null : RULES[o.id]; if (!R || (R.scoped && !this.ordMap()[o.id]?.[fid])) continue;
      const was = R.hit(F, r0, c0, ms), now = R.hit(F, r1, c1, ms), on = o.vf.includes(fid);
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
      if (toast) this.evToast(add ? { strong: 'Order ' + o.id + ' breached', text: 'at ' + F.name + ' · ' + RULES[o.id].why(F, this.rolloutOf(F), this.covOf(F)), fid: f, tone: 'bad' } : { strong: 'Breach cleared', text: o.id + ' (' + pname(this.P, o.by) + ') holds again at ' + F.name, fid: f, tone: 'ok' });
    }
  }
  /** Advance the hour by wall time `dtMs` at the current speed. Returns true if anything discrete changed. */
  advance(dtMs: number): boolean {
    if (!this.has || !this.playing || this.live) return false;
    const dt = (Math.min(dtMs, 90) / 1000) * this.speed, last = this.t;
    this.t = Math.min(HOUR, this.t + dt);
    const disc = { v: false };
    while (this.i < this.events.length && this.events[this.i].t <= this.t) { const e = this.events[this.i++]; this.accrue(e.t); this.apply(e, disc); }
    this.accrue(this.t);
    const step = this.t - last;
    for (const a of this.agents) {
      if (a.status === 'working' && !a.paused) a.pct = Math.min(99, a.pct + step * 0.012);
      if (a.synth && !a.paused && this.t >= a.nextSynth && this.P.F[a.f]) {
        a.nextSynth = this.t + 12 + hash01(a.id + this.t) * 26;
        // a hold order: no new work starts inside it, so an agent there generates no commits
        const ho = this.orderOn(a.f, 'hold'); if (ho) { if (a.status === 'working' && !a.task.startsWith('held by')) { a.task = 'held by ' + ho.id + ': no new work here'; disc.v = true; } continue; }
        this.apply({ t: this.t, agent: a.id, f: a.f, type: 'commit', text: 1 + Math.floor(hash01(a.id + a.f + this.t) * 5) + ' commits on ' + this.P.F[a.f].name, from: null, dec: null, syn: true }, disc);
      }
    }
    if (this.t >= HOUR) {
      this.playing = false; this.over = true; disc.v = true;
      this.toast({ strong: 'The hour is over.', text: 'That was the simulated swarm’s next 60 minutes.', action: 'replay' });
    }
    this.flushBurst(this.over);
    if (disc.v) { this.index(); this.bump(); }
    return disc.v;
  }
  seek(t: number) {
    if (this.live) return;
    t = Math.max(0, Math.min(HOUR, t)); if (t <= this.t) return;
    const disc = { v: false };
    this.seeking = true;
    while (this.i < this.events.length && this.events[this.i].t <= t) { const e = this.events[this.i++]; this.accrue(e.t); this.apply(e, disc); }
    this.accrue(t); this.seeking = false; this.flushBurst(true);
    for (const a of this.agents) if (a.status === 'working' && !a.paused) a.pct = Math.min(99, a.pct + (t - this.t) * 0.012);
    this.t = t; this.index(); this.bump();
  }
  reset() {
    if (this.live) return;
    const sp = this.speed;
    this.t = 0; this.playing = true; this.speed = sp; this.i = 0; this.log = []; this.pulses = []; this.heat = {}; this.roll = {};
    this.prog = {}; this.cap = {}; this.cov = {}; this.capBy = {}; this.paidT = 0; this.burst = null; this.undo = null; this.undo2 = null; this.over = false; this.breaches = 0; this.tally = {}; this.ordCache = null;
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
    const pl = this.planAnswer(d, oi), pv = this.describe(pl);
    this.undo = { list: [this.applyAnswer(pl)] };
    const n = pl.freed.length, fx = pv.marks!.map((m) => m.text);
    const cleared = pl.breaks.filter((b) => !b.add).map((b) => b.o.id);
    this.toast({ strong: cleared.length ? 'Decided · breach cleared' : 'Decided', text: d.opts[oi].label + (n ? ' · ' + n + ' agent' + (n > 1 ? 's' : '') + ' back to work' : ' · nobody was blocked') + (fx.length ? ' · ' + fx.join(' · ') : ' · ' + d.affects.length + ' feature' + (d.affects.length > 1 ? 's' : '') + ' touched'), action: 'undo' });
    this.bump();
  }
  /** Write one answer's plan; returns what it overwrote (the undo record). Decide and batch-decide both go through here. */
  private applyAnswer(pl: AnswerPlan): DecisionUndo {
    const d = pl.d, oi = pl.oi, now = this.now(), P = this.P;
    // keep what the plan overwrites, before any of it is written
    const snap: AgentFull[] = [], keep = (a: SimAgent) => { if (!snap.some((s) => s.a === a)) snap.push(full(a)); };
    for (const a of pl.freed) keep(a);
    for (const m of pl.moves) keep(m.a);
    for (const x of pl.asks) if (x.hold) keep(x.hold);
    const u: DecisionUndo = {
      d, oi, snap, dd: { isNew: d.isNew, freed: d.freed, freedIds: d.freedIds },
      roll: pl.rolls.map((r) => [r.f, this.roll[r.f], this.cap[r.f], this.capBy[r.f]]), cov: pl.cover.map((c) => [c.f, this.cov[c.f]]),
      ords: [...new Set(pl.breaks.map((b) => b.o))].map((o) => ({ o, vf: o.vf.slice(), n: o.n })), breaches: this.breaches, asks: pl.asks.map((x) => x.d.id),
    };
    d.open = false; d.isNew = false; d.ans = { opt: oi, t: this.t, at: now };
    for (const a of pl.freed) {
      a.status = 'working'; a.wait = null; a.task = 'resumed after the decision: ' + d.opts[oi].label; a.flash = now; a.synth = true;
      a.nextSynth = this.t + 3 + hash01(a.id) * 10;
    }
    d.freed += pl.freed.length; d.freedIds = pl.freed.map((a) => a.id);
    for (const r of pl.rolls) { this.roll[r.f] = r.to; this.cap[r.f] = r.cap; this.capBy[r.f] = d.base; }
    for (const c of pl.cover) this.cov[c.f] = c.to;
    for (const m of pl.moves) {
      const a = m.a; a.status = 'working'; a.wait = null; a.synth = true; a.nextSynth = this.t + 4 + hash01(a.id) * 14; a.task = 'moved by ' + d.base + ': ' + P.F[m.to].name;
      this.travel(a, m.to);
    }
    this.applyBreaks(pl.breaks, false);
    this.index();
    for (const x of pl.asks) { this.decisions.push(x.d); this.DEC[x.d.id] = x.d; this.openDecision(x.d, x.hold ?? undefined, true); }
    this.pulse(d.f, 'ok'); for (const x of d.affects) if (P.F[x]) this.pulse(x, 'ok');
    return u;
  }
  /** A written order's next free id (O-9, O-10, ...), never one an undone order left behind for a later one to collide with. */
  private nextOrderId(): string { let n = 0; for (const o of this.orders) { const m = /^O-(\d+)$/.exec(o.id); if (m) n = Math.max(n, +m[1]); } return 'O-' + (n + 1); }
  /**
   * Answer and keep it as a standing order (sample only). Decides option `oi`, then mints an order signed by `who` (null =
   * refused, nothing decided), scoped to the current target if one is set, else the question's domain (its room), in the
   * question's lens. Its constraint is the option's effect: a roll / cap holds rollouts in scope (rollLimit). It never
   * answers anything itself; later questions it covers only show it as their recommendation (`precedent`). One undo
   * takes back the answer and the order.
   */
  keepAnswer(id: string, oi: number, who: string | null, tgt?: Target | null): boolean {
    const d = this.DEC[id]; if (this.live || !d || !d.open || !d.opts[oi]) return false;
    if (!who) { this.toast({ strong: 'Not kept:', text: 'nobody to sign the order. Pick who you are (or a lens one person reads), then answer again.', tone: 'warn' }); return false; }
    this.decide(id, oi);
    const o = d.opts[oi], no = this.nextOrderId(), fx = o.effects ?? [];
    const scope: OrderScope = tgt?.n ? { feats: tgt.ids, label: tgt.label } : { domain: d.dom };
    this.orders.push({
      id: no, by: who, lens: d.lens, scope, text: 'Answer like ' + d.base + ': ' + o.label, since: ymdUTC(this.at0 + this.t * 1000),
      n: 0, vf: [], user: true, keep: { dec: d.id, lens: d.lens, label: o.label, kinds: [...new Set(fx.map((e) => e.k))], fx },
    });
    this.ordCache = null;
    if (this.undo) this.undo.order = no;
    this.toast({ strong: 'Decided and kept as ' + no, text: o.label + ' · ' + this.scopeWords(this.orders[this.orders.length - 1]), action: 'undo' });
    this.bump();
    return true;
  }
  private batchCache: { v: number; g: BatchGroup[] } | null = null;
  /**
   * Open questions one action may decide together (sample only): at least two in one lens, none urgent, whose recommended
   * answers share an effect kind (or, effect-free, the same label), touching no feature twice. Cached per sim version.
   */
  batchGroups(): BatchGroup[] {
    if (this.live) return [];
    if (this.batchCache?.v === this.version) return this.batchCache.g;
    const by = new Map<string, SimDecision[]>();
    for (const d of this.openDecs()) {
      if (d.urg === 'high') continue;
      const o = d.opts[d.rec]; if (!o) continue;
      const ks = [...new Set((o.effects ?? []).map((e) => e.k))].sort().join('+'), key = d.lens + '|' + (ks || 'label:' + o.label.toLowerCase());
      let l = by.get(key); if (!l) by.set(key, (l = [])); l.push(d);
    }
    const g: BatchGroup[] = [];
    for (const [key, ds] of by) {
      if (ds.length < 2) continue;
      const fs = new Set<string>(); let clash = false;
      for (const d of ds) for (const e of d.opts[d.rec].effects ?? []) { if (fs.has(e.feature)) clash = true; fs.add(e.feature); }
      if (clash) continue;
      const o = ds[0].opts[ds[0].rec], ks = key.split('|')[1];
      g.push({ key, lens: ds[0].lens, ids: ds.map((d) => d.id), label: ks.startsWith('label:') ? o.label : 'each ' + ks.split('+').map((k) => KIND_WORDS[k] ?? k).join(' and ') });
    }
    this.batchCache = { v: this.version, g };
    return g;
  }
  /** The union of a batch's plans on the plan layer (each question at its recommended answer), before it applies. */
  previewBatch(key: string): Preview | null {
    const grp = this.batchGroups().find((x) => x.key === key); if (!grp) return null;
    const pls = grp.ids.map((id) => this.planAnswer(this.DEC[id], this.DEC[id].rec));
    const u: AnswerPlan = { ...pls[0], freed: [], moves: [], rolls: [], cover: [], asks: [], breaks: [] };
    for (const p of pls) { u.freed.push(...p.freed); u.moves.push(...p.moves); u.rolls.push(...p.rolls); u.cover.push(...p.cover); u.asks.push(...p.asks); u.breaks.push(...p.breaks); }
    const pv = this.describe(u);
    pv.title = 'Batch: ' + grp.ids.length + ' questions'; pv.dec = 'batch:' + key; pv.lines.unshift(grp.ids.length + ' questions decided at their recommendation: ' + grp.ids.map((id) => this.DEC[id].base).join(', '));
    return pv;
  }
  /** Decide a batch, each at its recommended answer, with ONE undo that takes all of them back. High urgency never batches. */
  decideBatch(key: string): number {
    const grp = this.batchGroups().find((x) => x.key === key); if (!grp) return 0;
    const list: DecisionUndo[] = [];
    for (const id of grp.ids) { const d = this.DEC[id]; if (d?.open && d.urg !== 'high') list.push(this.applyAnswer(this.planAnswer(d, d.rec))); }
    this.undo = { list };
    this.toast({ strong: 'Decided ' + list.length + ' together', text: grp.label + ' · one undo takes all of them back', action: 'undo' });
    this.bump();
    return list.length;
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
    this.toast({ strong: err, text: (d ? d.q : base) + (reopen ? ' · the question is open again' : ''), fid: d?.f, tone: 'bad' });
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
        if (g) { g.q = d.question; g.opts = d.options; g.urg = d.urgency; g.tier = d.tier; g.blocks = d.blocksAgents; g.affects = d.affects.map((x) => x + sf); continue; }
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
    const U = this.undo; if (!U) return;
    for (let i = U.list.length - 1; i >= 0; i--) this.revertAnswer(U.list[i]);
    if (U.order) {   // a kept answer: its order goes, and the recommendations it set go back to the agents'
      this.orders = this.orders.filter((o) => o.id !== U.order); this.ordCache = null;
      for (const d of this.decisions) if (d.recBy === U.order) { d.rec = d.rec0 ?? d.rec; delete d.recBy; delete d.rec0; }
    }
    this.undo = null; this.index();
    this.toast({ strong: U.list.length > 1 ? U.list.length + ' decisions taken back' : U.order ? 'Decision and order ' + U.order + ' taken back' : 'Decision taken back', text: U.list.length > 1 ? 'the questions are open again' : 'the question is open again' });
    this.bump();
  }
  private revertAnswer(u: DecisionUndo) {
    const d = u.d; d.open = true; d.ans = null; d.isNew = u.dd.isNew; d.freed = u.dd.freed; d.freedIds = u.dd.freedIds;
    for (const s of u.snap) {
      const a = s.a; a.status = s.status; a.task = s.task; a.wait = s.wait; a.pct = s.pct; a.synth = s.synth; a.nextSynth = s.nextSynth; a.paused = s.paused;
      if (a.f !== s.f) this.travel(a, s.f);
    }
    for (const [f, r, c, by] of u.roll) { if (r == null) delete this.roll[f]; else this.roll[f] = r; if (c == null) delete this.cap[f]; else this.cap[f] = c; if (by == null) delete this.capBy[f]; else this.capBy[f] = by; }
    for (const [f, c] of u.cov) { if (c == null) delete this.cov[f]; else this.cov[f] = c; }
    for (const o of u.ords) { o.o.vf = o.vf; o.o.n = o.n; }
    this.breaches = u.breaches;
    if (u.asks.length) { this.decisions = this.decisions.filter((x) => !u.asks.includes(x.id)); for (const id of u.asks) delete this.DEC[id]; }
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
    const donors = this.agents.filter((a) => { const m = this.msOf(a.f); return !!m && LATER_MILESTONES.includes(m) && a.status !== 'failed' && !a.paused && !this.orderOn(a.f, 'first'); });
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
    const donors = this.agents.filter((a) => !ids[a.f] && a.status === 'working' && !a.paused && this.msOf(a.f) !== GA_MILESTONE && !this.orderOn(a.f, 'first')).sort((a, b) => rank(a) - rank(b) || a.pct - b.pct).slice(0, 5);
    const kept = this.orders.filter((o) => o.tpl === 'first').map((o) => o.id);
    return this.mkPush('Put the swarm on ' + (tgt.label || 'this selection'), donors, targets, ['Only agents that are working and not on Payments GA are pulled'].concat(kept.length ? ['Agents under ' + kept.join(', ') + ' (go first) stay where they are'] : []), wingName);
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
  /**
   * A written order before it applies: what it would hold in the rest of the recorded hour (a dry read of the events
   * still to come, by the same rules `govern` applies), and who signs it (`who`; null = nobody to sign, it is refused).
   */
  previewOrder(tgt: Target, tpl: OrderTemplate, who: string | null = null): Preview | null {
    if (!tgt.n) return null;
    const T = ORDER_TEMPLATES[tpl], gov = this.P.features.filter((f) => tgt.ids[f.id]).length, s = (n: number) => (n === 1 ? '' : 's');
    let held = 0; const asked = new Set<string>();
    for (let k = this.i; k < this.events.length; k++) {
      const e = this.events[k]; if (!tgt.ids[e.f]) continue;
      if (tpl === 'ask' && e.type === 'flag-change') { const m = /(\d+)%/.exec(e.text); if (m && +m[1] > 10) { held++; asked.add(e.f); } }
      else if (tpl === 'hold' && e.type === 'move' && this.AG[e.agent]?.f !== e.f) held++;
      else if (tpl === 'review') { if (REVIEW_EV[e.type]) asked.add(e.f); else if (e.type === 'commit' && asked.has(e.f)) held++; }
    }
    const inside = this.agents.filter((a) => tgt.ids[a.f]).length, name = who ? pname(this.P, who) : null;
    const rule = tpl === 'ask' ? held + ' flag change' + s(held) + ' above 10% held at 10% in the rest of the hour; ' + asked.size + ' question' + s(asked.size) + ' for ' + (name ?? 'its author')
      : tpl === 'hold' ? held + ' move' + s(held) + ' into it refused in the rest of the hour; agents inside generate no new commits'
      : tpl === 'review' ? asked.size + ' review question' + s(asked.size) + ' for ' + (name ?? 'its author') + ' in the rest of the hour; ' + held + ' recorded commit' + s(held) + ' held until answered'
      : 'No recorded event changes; push previews leave its ' + inside + ' agent' + s(inside) + ' where they are';
    return {
      kind: 'order', title: 'Standing order: ' + T, moves: [], targets: tgt.ids, paused: [], tpl, text: T, label: tgt.label, n: held,
      lines: ['Written on ' + gov + ' feature' + s(gov) + ' (' + (tgt.label || 'selection') + ')', rule, name ? 'Signed by ' + name : 'Nobody to sign it: pick who you are (or a lens one person reads) first'],
    };
  }
  previewResearch(): Preview | null {
    const ag = this.agents.filter((a) => a.sq === 'scout' && !a.paused);
    if (!ag.length) return null;
    const ids: Record<string, 1> = {}; for (const a of ag) ids[a.f] = 1;
    return {
      kind: 'pause', title: 'Pause the research crew', moves: [], targets: ids, paused: ag, n: ag.length, order: 'O-7',
      lines: [ag.length + ' research agents stop (spend cap order O-7 says research goes first)', 'Today’s swarm spend: $' + this.spend().toLocaleString('en-US') + ' of the $' + SPEND_CAP.toLocaleString('en-US') + ' cap',
        ((b0, b1) => (b0 === b1 ? 'None of them is working now, so the burn stays at $' + b0 + ' an hour' : 'The burn falls from $' + b0 + ' to $' + b1 + ' an hour'))(this.burn(), this.burn((a) => a.sq === 'scout'))],
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
      // signed by the reader; nobody to sign it = refused (never a default author)
      if (!who) { this.toast({ strong: 'Order not written:', text: 'nobody to sign it. Pick who you are (or a lens one person reads), then write it again.', tone: 'warn' }); return; }
      const no = this.nextOrderId(), by = who;
      this.orders.push({ id: no, by, lens: personLens(this.P, by) ?? 'general', scope: { feats: p.targets, label: p.label }, text: p.text || '', since: ymdUTC(this.at0 + this.t * 1000), n: 0, vf: [], user: true, tpl: p.tpl });
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
      if ('order' in s) { const o = this.orders.find((x) => x.id === s.order); this.orders = this.orders.filter((x) => x.id !== s.order); this.ordCache = null; if (o?.held) this.unhold(o.held); continue; }
      const a = s.a; a.status = s.status; a.task = s.task; a.wait = s.wait; a.paused = s.paused; a.synth = s.synth;
      if (a.f !== s.f) this.travel(a, s.f);
    }
    this.undo2 = null; this.index();
    this.toast({ strong: 'Command taken back', text: '' });
    this.bump();
  }
  /**
   * A written order taken back: its unanswered questions go (the agents they held wait as before), each feature it held
   * gets the rollout its agents last asked for, and each agent it kept out goes where it last wanted to. An answered
   * question stays: that answer is the reader's own decision, with its own undo.
   */
  private unhold(h: OrderHeld) {
    const gone = new Set<string>();
    for (const id of h.asks) { const d = this.DEC[id]; if (d && !d.ans) { gone.add(id); delete this.DEC[id]; } }
    if (gone.size) this.decisions = this.decisions.filter((d) => !gone.has(d.id));
    for (const s of h.snap) if (s.a.wait && gone.has(s.a.wait)) { s.a.status = s.status; s.a.task = s.task; s.a.wait = s.wait; }
    for (const f in h.rolls) {
      if (this.cap[f] != null) continue;   // an answer holds it now
      const r = h.rolls[f], bs = this.ruleDiff(f, r); this.roll[f] = r; this.applyBreaks(bs, false);
    }
    for (const id in h.moves) { const a = this.AG[id]; if (a && this.P.F[h.moves[id]]) { this.travel(a, h.moves[id]); if (a.task.startsWith('held by')) a.task = 'moved here: ' + this.P.F[h.moves[id]].name; } }
    for (const a of this.agents) if (a.task.startsWith('held by') && a.status === 'working' && !h.moves[a.id]) a.task = 'back to work: ' + (this.P.F[a.f]?.name ?? a.f);
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
