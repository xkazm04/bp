// The simulated swarm: 42 agents (per product line), decisions that open and close, standing orders
// and their breaches, and a replayable hour at 1x..240x. Everything here is a simulation over sample
// data; nothing talks to a real system. Pure TS: wall-clock time is injected (`now`) and visual
// effects are recorded as plain data (pulses, heat, travel) for the engine to draw.
import type { ReplayType, StandingOrder, Swarm, AgentStatus, CrewRole, Squad, ViewId, Feature, Scalar } from '@/lib/data';
import { fval } from '@/lib/standard/load';
import { FIRST_MILESTONE, GA_MILESTONE, HOUR, LATER_MILESTONES, PULSE_OF, type PulseKind } from './constants';
import { isLiveSt } from './aggregates';
import { personLens } from './lens';
import { baseId, lineSuffix, pname, type Product } from './product';

/**
 * The swarm feed's coupling to the product: the simulation moves a feature's rollout and build progress,
 * which the map keeps as these lens fields (read through the facets whether or not the lens is enabled).
 * Together with the standing-order rules below (which read the sample's facets the same way), this is
 * the only place lens field names appear outside the manifests: it belongs to the swarm sample.
 */
export const SIM_FIELDS = { rollout: ['operations', 'rolloutPct'], progress: ['development', 'progressPct'] } as const;
const num = (f: Feature, l: string, k: string): number | null => { const v = fval(f, l, k); return typeof v === 'number' ? v : null; };
const txt = (f: Feature, l: string, k: string): string => { const v = fval(f, l, k); return typeof v === 'string' ? v : ''; };
const flag = (f: Feature, l: string, k: string): boolean | null => { const v = fval(f, l, k); return typeof v === 'boolean' ? v : null; };
/** Card data whose security review is not done (order O-1). */
function cardUnreviewed(f: Feature): boolean {
  const r = txt(f, 'security', 'review');
  return txt(f, 'security', 'dataClass') === 'payment' && r !== 'passed' && r !== 'not-required';
}

export type AgentState = AgentStatus | 'paused';
export interface SimAgent {
  id: string; base: string; b: number; sq: string; role: CrewRole; status: AgentStatus; f: string; task: string;
  pct: number; since: number; tpm: number; cost: number; done: number; wait: string | null; blk: string | null;
  ph: number; paused: boolean; tr: { from: string; to: string; t0: number; dur: number } | null; flash: number;
  synth: boolean; nextSynth: number; code: string; act: number;
}
export interface SimDecision {
  id: string; base: string; b: number; f: string; dom: string; lens: string; decider: string; by: string; q: string;
  opts: { label: string; consequence: string }[]; rec: number; urg: 'high' | 'medium' | 'low'; since: number;
  blocks: number; freed: number; affects: string[]; arr: number; open: boolean;
  ans: { opt: number; t: number; at: number } | null; isNew: boolean; freedIds: string[];
}
export interface OrderScope { domain?: string; milestone?: string; surface?: string; all?: boolean; feats?: Record<string, 1>; label?: string }
export interface SimOrder { id: string; by: string; lens: string; scope: OrderScope; text: string; since: string; n: number; vf: string[]; user: boolean }
export interface SimEvent { t: number; agent: string; f: string; type: ReplayType; text: string; from: string | null; dec: string | null; syn?: boolean }
export interface Pulse { f: string; k: PulseKind; t0: number }
export interface Target { ids: Record<string, 1>; n: number; label: string }
export type PreviewKind = 'push' | 'pause' | 'resume' | 'order';
export interface Preview {
  kind: PreviewKind; title: string; moves: { a: SimAgent; to: string }[]; targets: Record<string, 1>; paused: SimAgent[];
  lines: string[]; n: number; order?: string; tpl?: OrderTemplate; text?: string; label?: string;
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
export const astat = (a: SimAgent): AgentState => (a.paused ? 'paused' : a.status);
export function fmtWait(m: number): string {
  return m >= 120 ? Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '') : m >= 60 ? '1 h ' + (m % 60) + ' min' : m + ' min';
}

export class SwarmSim {
  readonly has: boolean;
  readonly at0: number;
  agents: SimAgent[] = []; AG: Record<string, SimAgent> = {};
  decisions: SimDecision[] = []; DEC: Record<string, SimDecision> = {};
  orders: SimOrder[] = []; events: SimEvent[] = [];
  squads: Squad[] = []; SQ: Record<string, Squad> = {};
  /** agents by feature, open decisions by feature */
  AGF: Record<string, SimAgent[]> = {}; DOF: Record<string, SimDecision[]> = {};
  // clock
  t = 0; playing = true; speed = 8; i = 0; over = false;
  log: SimEvent[] = []; pulses: Pulse[] = []; heat: Record<string, { v: number; t: number }> = {};
  roll: Record<string, number> = {}; prog: Record<string, number> = {};
  undo: { d: SimDecision; snap: { a: SimAgent; status: AgentStatus; task: string; wait: string | null; pct: number }[]; oi: number } | null = null;
  undo2: { kind: PreviewKind; snap: ({ order: string } | { a: SimAgent; f: string; status: AgentStatus; task: string; wait: string | null; paused: boolean; synth: boolean })[] } | null = null;
  breaches = 0; tally: Partial<Record<ReplayType, number>> = {};
  /** Bumped on every discrete change (status, queue, orders): cheap change detection for caches. */
  version = 0;
  private ordCache: Record<string, Record<string, 1>> | null = null;
  private listener: SimListener | null = null;

  constructor(private P: Product, private S0: Swarm | null, private now: () => number) {
    this.has = !!(S0 && S0.agents);
    this.at0 = S0?.asOf ? Date.parse(S0.asOf) : Date.parse('2026-10-08T09:00:00Z');
    this.build();
  }
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
          id: a.id + sf, base: a.id, b, sq: a.squad, role: a.role, status: a.status, f: a.feature + sf, task: a.task,
          pct: a.progressPct, since: Date.parse(a.since), tpm: a.tokensPerMin, cost: a.costUsdToday, done: a.doneToday,
          wait: a.waitingOn ? a.waitingOn + sf : null, blk: a.blockedBy ? a.blockedBy + sf : null, ph: hash01(a.id + sf) * 6.2832,
          paused: false, tr: null, flash: 0, synth: false, nextSynth: 0, code: crewCode(a.id), act: 0,
        };
        this.agents.push(g); this.AG[g.id] = g;
      }
      for (const d of S0.decisions) {
        const g: SimDecision = {
          id: d.id + sf, base: d.id, b, f: d.feature + sf, dom: d.domain + sf, lens: d.lens, decider: d.decider, by: d.askedBy + sf,
          q: d.question, opts: d.options, rec: d.recommended, urg: d.urgency, since: Date.parse(d.waitingSince), blocks: d.blocksAgents,
          freed: 0, affects: d.affects.map((x) => x + sf), arr: d.arrivesAt || 0, open: !d.arrivesAt, ans: null, isNew: false, freedIds: [],
        };
        this.decisions.push(g); this.DEC[g.id] = g;
      }
      for (const e of S0.replay) {
        this.events.push({ t: e.t, agent: e.agent + sf, f: e.feature + sf, type: e.type, text: e.text, from: e.from ? e.from + sf : null, dec: e.decision ? e.decision + sf : null });
      }
    }
    this.events.sort((a, b) => a.t - b.t);
    for (const o of S0.orders) this.orders.push(this.fromOrder(o));
    this.computeViolations();
    this.index();
  }
  private fromOrder(o: StandingOrder): SimOrder {
    return { id: o.id, by: o.by, lens: o.lens, scope: { ...o.scope }, text: o.text, since: o.since, n: o.violations, vf: [], user: false };
  }
  index() {
    this.AGF = {}; this.DOF = {};
    for (const a of this.agents) (this.AGF[a.f] ||= []).push(a);
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
  /** A lens field's value as the simulation has it now (its live rollout and build progress), else the map's. */
  liveValue(f: Feature, lens: string, key: string): Scalar | undefined {
    if (lens === SIM_FIELDS.rollout[0] && key === SIM_FIELDS.rollout[1] && this.roll[f.id] != null) return this.roll[f.id];
    if (lens === SIM_FIELDS.progress[0] && key === SIM_FIELDS.progress[1] && this.prog[f.id]) { const p = num(f, lens, key); return p != null && p < 100 ? this.progOf(f) : p ?? undefined; }
    return fval(f, lens, key);
  }
  openDecs(): SimDecision[] { return this.decisions.filter((d) => d.open); }
  blocksNow(d: SimDecision): number { return Math.max(0, d.blocks - d.freed); }
  waitMin(d: SimDecision): number { return Math.max(0, Math.round((this.at0 + this.t * 1000 - d.since) / 60000)); }
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
    const rules: Record<string, { rank: (f: Feature) => number | null; desc: boolean }> = {
      'O-1': { rank: (f) => (isLiveSt(f.stage) && cardUnreviewed(f) && this.rolloutOf(f) > 10 ? this.rolloutOf(f) : null), desc: true },
      'O-2': { rank: (f) => { const c = num(f, 'development', 'unitCoveragePct'); return (f.stage === 'in-review' || isLiveSt(f.stage)) && c != null && c < 70 ? c : null; }, desc: false },
      'O-3': { rank: (f) => { const m = (!flag(f, 'operations', 'alerting') ? 1 : 0) + (!flag(f, 'operations', 'runbook') ? 1 : 0); return isLiveSt(f.stage) && m && this.rolloutOf(f) >= 50 ? m * 1000 + this.rolloutOf(f) : null; }, desc: true },
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
    else if (t === 'commit') this.prog[f] = (this.prog[f] || 0) + 0.7;
    else if (t === 'flag-change') { const m = /(\d+)%/.exec(e.text); if (m) { this.roll[f] = +m[1]; this.breachCheck(f, +m[1]); discrete.v = true; } }
    else if (t === 'task-done') { if (A) { A.done++; A.pct = 3; } }
    else if (t === 'decision-asked') { const d = e.dec ? this.DEC[e.dec] : null; if (d) { this.openDecision(d, A); discrete.v = true; } }
    this.pulse(f, PULSE_OF[t] || 'c');
    if (A) A.act = this.now();
    this.listener?.event(e);
  }
  private openDecision(d: SimDecision, A: SimAgent | undefined) {
    d.open = true; d.isNew = true; d.since = this.at0 + this.t * 1000;
    if (A && A.status === 'working') { A.status = 'waiting'; A.wait = d.id; A.task = 'waiting: ' + d.q; }
    this.index(); this.pulse(d.f, 'ask');
    this.toast({ strong: 'New question', text: 'from ' + (A ? A.base : 'an agent') + ' · ' + this.P.F[d.f].name + ' · for ' + pname(this.P, d.decider), fid: d.f });
  }
  private breachCheck(fid: string, pct: number) {
    const ft = this.P.F[fid]; if (!ft) return;
    const o1 = this.orders.find((o) => o.id === 'O-1'), o3 = this.orders.find((o) => o.id === 'O-3');
    const add = (o: SimOrder | undefined, why: string) => {
      if (o && !o.vf.includes(fid)) {
        o.vf.push(fid); o.n++; this.breaches++; this.pulse(fid, 'bad');
        this.toast({ strong: 'Order ' + o.id + ' breached', text: 'at ' + ft.name + ' · ' + why, fid });
      }
    };
    if (pct > 10 && cardUnreviewed(ft)) add(o1, 'card data above 10% without a security review');
    const alerting = flag(ft, 'operations', 'alerting'), runbook = flag(ft, 'operations', 'runbook');
    if (pct >= 50 && isLiveSt(ft.stage) && (!alerting || !runbook)) add(o3, 'rollout ' + pct + '% without ' + (!alerting ? 'an alert' : 'a runbook'));
  }
  /** Advance the hour by wall time `dtMs` at the current speed. Returns true if anything discrete changed. */
  advance(dtMs: number): boolean {
    if (!this.has || !this.playing) return false;
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
    t = Math.max(0, Math.min(HOUR, t)); if (t <= this.t) return;
    const disc = { v: false };
    while (this.i < this.events.length && this.events[this.i].t <= t) this.apply(this.events[this.i++], disc);
    for (const a of this.agents) if (a.status === 'working' && !a.paused) a.pct = Math.min(99, a.pct + (t - this.t) * 0.012);
    this.t = t; this.index(); this.bump();
  }
  reset() {
    const sp = this.speed;
    this.t = 0; this.playing = true; this.speed = sp; this.i = 0; this.log = []; this.pulses = []; this.heat = {}; this.roll = {};
    this.prog = {}; this.undo = null; this.undo2 = null; this.over = false; this.breaches = 0; this.tally = {}; this.ordCache = null;
    this.build(); this.bump();
  }
  setSpeed(n: number) { this.speed = n; if (!this.over) this.playing = true; this.bump(); }
  togglePlay() { if (this.over) { this.reset(); return; } this.playing = !this.playing; this.bump(); }

  // ---------------------------------------------------------------- deciding
  decide(id: string, oi: number) {
    const d = this.DEC[id]; if (!d || !d.open) return;
    const freed = this.agents.filter((a) => a.wait === id), now = this.now();
    const snap = freed.map((a) => ({ a, status: a.status, task: a.task, wait: a.wait, pct: a.pct }));
    d.open = false; d.isNew = false; d.ans = { opt: oi, t: this.t, at: now };
    for (const a of freed) {
      a.status = 'working'; a.wait = null; a.task = 'resumed after the decision: ' + d.opts[oi].label; a.flash = now; a.synth = true;
      a.nextSynth = this.t + 3 + hash01(a.id) * 10;
    }
    d.freed += freed.length; d.freedIds = freed.map((a) => a.id);
    this.undo = { d, snap, oi };
    this.index(); this.pulse(d.f, 'ok'); for (const x of d.affects) if (this.P.F[x]) this.pulse(x, 'ok');
    const n = freed.length;
    this.toast({ strong: 'Decided', text: d.opts[oi].label + (n ? ' · ' + n + ' agent' + (n > 1 ? 's' : '') + ' back to work' : ' · nobody was blocked') + ' · ' + d.affects.length + ' feature' + (d.affects.length > 1 ? 's' : '') + ' touched', action: 'undo' });
    this.bump();
  }
  undoDecision() {
    const u = this.undo; if (!u) return;
    u.d.open = true; u.d.ans = null; u.d.freed = Math.max(0, u.d.freed - u.snap.length);
    for (const s of u.snap) { s.a.status = s.status; s.a.task = s.task; s.a.wait = s.wait; s.a.pct = s.pct; s.a.synth = false; }
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
      lines: [ag.length + ' research agents stop (spend cap order O-7 says research goes first)', 'Today’s swarm spend: $' + this.spend().toLocaleString('en-US') + ' of the $2,400 cap'],
    };
  }
  commit(p: Preview, who: string | null) {
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
