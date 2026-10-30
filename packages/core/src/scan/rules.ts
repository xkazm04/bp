// The owner's standing rules (hackathon pack "Rules you set once"): one record of what agents may NOT do (orders) and
// what they MAY decide alone (grants), kept per product in `<root>/.ai/lens-scan/work/bp-rules.json` beside scan.db, the
// directory bp and Personas both already open (rules.server.ts reads and writes it; docs/standard/rules-1.md is the
// contract). Pure: no Node, no React. Three things live here:
//   gate(rules, act)        the ONE gate every agent door consults (wave compose and dispatch, /dispatch, a lens's
//                           execute, scan.place): which items an order holds, and the order that refuses the whole act
//   backtest(rule, rows)    replays a rule over the owner's decided findings: what it would have said on each, and
//                           where it would have disagreed with the owner (decided / matched / differed / abstained)
//   checkRuleBody(body)     the one validation of a rule a person writes (the route's 400)
// Orders: hold (no builds or scans in the place), only (only these lenses' work in the place), cap (no builds in the
// place above an effort, optionally only for one model). Grants: grant (agents may approve findings in the place on
// their own, optionally only of a tier that mild or milder). A rule is live from `at` until it expires or is revoked;
// revoked and expired rules stay in the file as the record.
import type { ScanScope } from './jobs.ts';
import { SAFE_ID } from './jobs.ts';
import { WAVE_EFFORTS, WAVE_MODELS, type WaveEffort, type WaveModel } from './waves.ts';
import { SCAN_SCOPE_KINDS } from '../standard/schema-vocab.ts';

export type RuleKind = 'hold' | 'only' | 'cap' | 'grant';
export const RULE_KINDS: readonly RuleKind[] = ['hold', 'only', 'cap', 'grant'];
/** An order says no; a grant says yes. */
export const isOrder = (k: RuleKind): boolean => k !== 'grant';

export interface Rule {
  /** `O-n` for an order, `G-n` for a grant; numbered per product, never reused. */
  id: string;
  kind: RuleKind;
  /** The rule in the owner's words (the template's sentence, or their own). */
  text: string;
  /** Who set it: `user:<gh login>` (the routes' triageBy), as the store signs a decision. */
  by: string;
  /** When it was set (ISO). */
  at: string;
  /** Where it governs: the features it covers are resolved when it is written, so the gate needs no map. */
  scope: ScanScope;
  /** only: the lenses whose work may still start in the place. */
  lenses?: string[];
  /** cap: the highest effort a build in the place may run at. */
  maxEffort?: WaveEffort;
  /** cap: only builds on this model are capped (absent = every model). */
  model?: WaveModel;
  /** grant: findings of this tier or milder (0 stop-ship .. 3 backlog); absent = any tier, which the backtest flags. */
  minTier?: number;
  /** grant, cautious: it acts only on a lens where its approvals agreed with the owner's own decisions inside its place at
   *  least CAUTION_RATE of the time over at least CAUTION_MIN of them (lensTrust); elsewhere the finding goes to the person. */
  cautious?: boolean;
  /** grant: the agent tools it lets run without a card (catalog names). */
  tools?: string[];
  /** ISO; absent = until revoked. */
  expiresAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  /** What the backtest said when it was set: the evidence the owner granted it on. */
  evidence?: { decided: number; matched: number; differed: number; abstained: number; at: string };
}
export interface RulesFile { version: 1; rules: Rule[] }

/** The four templates the panel offers, in the owner's words ({lenses}, {effort}, {tier} filled from the draft). */
export const RULE_TEMPLATES: Record<RuleKind, string> = {
  hold: 'Hold: no builds or scans start here until I lift it',
  only: 'Only {lenses} work here',
  cap: 'No {model}builds here above {effort} effort',
  grant: 'Agents may approve {tier}findings here on their own{cautious}',
};
/** The tools a grant covers by default: answering a finding, and dispatching a wave of them. */
export const GRANT_TOOLS: readonly string[] = ['decision.answer', 'wave.dispatch'];
export const TIER_WORD = ['stop-ship', 'urgent', 'normal', 'backlog'] as const;
export const RULE_MAX_HOURS = 24 * 30;

/** The sentence a draft reads as, from its kind and parameters. */
export function ruleText(r: Pick<Rule, 'kind' | 'lenses' | 'maxEffort' | 'model' | 'minTier' | 'cautious'>, lensName: (id: string) => string = (x) => x): string {
  return RULE_TEMPLATES[r.kind]
    .replace('{lenses}', (r.lenses ?? []).map(lensName).join(' and ') || 'no')
    .replace('{effort}', r.maxEffort ?? 'medium')
    .replace('{model}', r.model ? r.model[0].toUpperCase() + r.model.slice(1) + ' ' : '')
    .replace('{tier}', r.minTier === undefined ? '' : r.minTier >= 3 ? 'backlog ' : `tier ${r.minTier}+ (${TIER_WORD[r.minTier]} or milder) `)
    .replace('{cautious}', r.cautious ? ', where they have agreed with me' : '');
}

/** Live now: not revoked, not expired. */
export const isLive = (r: Rule, now: number = Date.now()): boolean => !r.revokedAt && (!r.expiresAt || Date.parse(r.expiresAt) > now);
/** The rule covers this feature (scope `all` covers every one). */
export const covers = (r: Rule, feature: string): boolean => r.scope.kind === 'all' || r.scope.features.includes(feature);
const effortRank = (e: string | undefined): number => WAVE_EFFORTS.indexOf(e as WaveEffort);

/** How a refusal cites a rule: its id, its author and when, and its words (the companion and MCP clients quote it). */
export interface RuleCite { id: string; kind: RuleKind; by: string; at: string; text: string; place: string }
export const citeOf = (r: Rule): RuleCite => ({ id: r.id, kind: r.kind, by: r.by, at: r.at, text: r.text, place: r.scope.label });
/** When a rule was set, in the clock of the machine bp runs on (the owner's): "Fri 30 Oct, 14:02". */
export const stampOf = (iso: string): string => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
/** "order O-3 (user:ana, Fri 30 Oct, 14:02): Hold: ...". */
export const citeWords = (c: RuleCite): string => `${c.kind === 'grant' ? 'grant' : 'order'} ${c.id} (${c.by}, ${stampOf(c.at)}): ${c.text}`;

// ------------------------------------------------------------------------------------------------ the gate
/** One finding an act would build. */
export interface ActItem { id: string; feature: string; lens: string }
/** What an agent door is about to do: build findings (a wave package, a dispatch, a lens's backlog) or scan a place. */
export type Act =
  | { kind: 'build'; tool: string; items: ActItem[]; model?: string; effort?: string }
  | { kind: 'scan'; tool: string; lens: string; scope: ScanScope };
export interface GateAnswer {
  /** Items an order holds back, each with the first order that holds it. */
  held: { id: string; feature: string; order: RuleCite }[];
  /** The order that refuses the whole act (a scan; or a build all of whose items are held). */
  refused?: RuleCite;
}

/** The first live order that says no to building `it` (with the act's model and effort). */
function holdsBuild(rules: readonly Rule[], it: ActItem, model: string | undefined, effort: string | undefined, now: number): Rule | undefined {
  return rules.find((r) => {
    if (!isOrder(r.kind) || !isLive(r, now) || !covers(r, it.feature)) return false;
    if (r.kind === 'hold') return true;
    if (r.kind === 'only') return !(r.lenses ?? []).includes(it.lens);
    return effort !== undefined && effortRank(effort) > effortRank(r.maxEffort) && (!r.model || r.model === model);
  });
}

/**
 * The gate. A build keeps the items no live order holds; when none is left, the first holding order refuses it. A scan
 * is refused by the first live hold whose place it touches, or the first `only` order whose place it touches with
 * another lens (an `all` scan touches every place). Grants never refuse; caps never touch a scan.
 */
export function gate(rules: readonly Rule[], act: Act, now: number = Date.now()): GateAnswer {
  if (act.kind === 'build') {
    const held: GateAnswer['held'] = [];
    for (const it of act.items) {
      const r = holdsBuild(rules, it, act.model, act.effort, now);
      if (r) held.push({ id: it.id, feature: it.feature, order: citeOf(r) });
    }
    return held.length && held.length === act.items.length ? { held, refused: held[0].order } : { held };
  }
  const touches = (r: Rule) => act.scope.kind === 'all' || r.scope.kind === 'all' || act.scope.features.some((f) => r.scope.features.includes(f));
  const r = rules.find((x) => isOrder(x.kind) && isLive(x, now) && touches(x) && (x.kind === 'hold' || (x.kind === 'only' && !(x.lenses ?? []).includes(act.lens))));
  return r ? { held: [], refused: citeOf(r) } : { held: [] };
}

/** The words a door answers with: "held by order O-3 (...): ..., 2 items left out". */
export function gateWords(g: GateAnswer): string {
  if (g.refused && !g.held.length) return `refused by ${citeWords(g.refused)}`;
  const by = new Map<string, { cite: RuleCite; n: number }>();
  for (const h of g.held) { const x = by.get(h.order.id); if (x) x.n++; else by.set(h.order.id, { cite: h.order, n: 1 }); }
  return [...by.values()].map(({ cite, n }) => `held by ${citeWords(cite)}; ${n} item${n === 1 ? '' : 's'} left out`).join('. ');
}

/** The live grant that lets an agent run `tool` on these findings alone (every one in its place, tiered and mild
 *  enough when it names a tier, and, for a cautious grant, of a lens `trusted` says it has earned), or undefined.
 *  Untiered findings are never covered by a tier-bound grant; without `trusted`, a cautious grant covers nothing. */
export function grantFor(rules: readonly Rule[], tool: string, items: readonly { feature: string; tier?: number; lens?: string }[], now: number = Date.now(), trusted?: (r: Rule) => ReadonlySet<string>): Rule | undefined {
  if (!items.length) return undefined;
  return rules.find((r) => r.kind === 'grant' && isLive(r, now) && (r.tools ?? GRANT_TOOLS).includes(tool)
    && items.every((it) => covers(r, it.feature) && (r.minTier === undefined || (it.tier !== undefined && it.tier >= r.minTier))
      && (!r.cautious || (it.lens !== undefined && !!trusted?.(r).has(it.lens)))));
}

/** A cautious grant's bar: this share of agreement over at least this many of the owner's decisions in one lens. */
export const CAUTION_RATE = 0.9, CAUTION_MIN = 3;
export interface LensTally { lens: string; spoke: number; matched: number; trusted: boolean }
const trustedBy = (t: { spoke: number; matched: number }): boolean => t.spoke >= CAUTION_MIN && t.matched >= CAUTION_RATE * t.spoke;
/** Per lens, how the grant's approvals compare with the owner's decisions in its place (its base verdict, the caution
 *  aside): the lenses a cautious grant has earned. */
export function lensTrust(r: RuleShape, decided: readonly DecidedRow[]): LensTally[] {
  const m = new Map<string, LensTally>();
  for (const row of decided) {
    if (verdictOf({ ...r, cautious: false }, row) !== 'approve') continue;
    const t = m.get(row.lens) ?? { lens: row.lens, spoke: 0, matched: 0, trusted: false };
    t.spoke++; if (row.owner === 'approve') t.matched++;
    m.set(row.lens, t);
  }
  return [...m.values()].map((t) => ({ ...t, trusted: trustedBy(t) })).sort((a, b) => b.spoke - a.spoke);
}

// ------------------------------------------------------------------------------------------------ the backtest
/** One finding the owner decided: the record a rule is replayed over. */
export interface DecidedRow {
  id: string; title: string; feature: string; lens: string;
  tier?: number; risk_class?: string;
  /** The owner's verdict: approve (built or meant to be) or decline. */
  owner: 'approve' | 'decline';
  by: string; at: string;
  /** The model and effort it was built with, when a wave package built it. */
  model?: string; effort?: string;
  /** Seeded history (scripts/seed-rules-history.mjs), labelled as such wherever it shows. */
  synthetic?: boolean;
}
export type RuleVerdict = 'approve' | 'hold';
export interface BacktestRow extends DecidedRow { rule: RuleVerdict | null; agree: boolean | null; stopShip?: boolean }
/** The fields a rule is replayed on. */
export type RuleShape = Pick<Rule, 'kind' | 'scope' | 'lenses' | 'maxEffort' | 'model' | 'minTier' | 'cautious'>;
export interface Backtest {
  /** Rows replayed (the newest `limit` decided ones). */
  decided: number;
  /** The rule had a verdict and it was the owner's (approve = approve; hold = decline). */
  matched: number;
  /** The rule had a verdict and it was not the owner's: these rows are the interface. */
  differed: number;
  /** The rule says nothing about the row (outside its place, or not its business). */
  abstained: number;
  synthetic: number;
  /** Differing rows first (newest first), then matched; abstained rows are counted, not listed. */
  rows: BacktestRow[];
  /** What should stop a grant: it would approve a stop-ship, it covers any tier, it never once spoke. */
  flags: { key: 'stop-ship' | 'any-tier' | 'silent' | 'disagrees'; text: string; ids?: string[] }[];
  /** A cautious grant: per lens, its agreement with the owner over the whole record, and whether it acts there now. */
  trust?: LensTally[];
}

/** What the rule says about one decided row, or null to abstain. */
export function verdictOf(r: RuleShape, row: DecidedRow): RuleVerdict | null {
  if (!(r.scope.kind === 'all' || r.scope.features.includes(row.feature))) return null;
  switch (r.kind) {
    case 'hold': return 'hold';
    case 'only': return (r.lenses ?? []).includes(row.lens) ? null : 'hold';
    case 'cap': return row.effort !== undefined && effortRank(row.effort) > effortRank(r.maxEffort) && (!r.model || r.model === row.model) ? 'hold' : null;
    case 'grant': return r.minTier === undefined || (row.tier !== undefined && row.tier >= r.minTier) ? 'approve' : null;
  }
}

/**
 * Replay a rule over decided rows (the newest `limit`): pure, deterministic, no model call. A cautious grant is replayed
 * WALK-FORWARD, oldest first: on each decision it knows only the decisions before it, and approves only in a lens where
 * those had already earned its trust (lensTrust's bar), so its figures are what it would really have done, not a
 * hindsight fit to the record it is judged on.
 */
export function backtest(r: RuleShape, decided: readonly DecidedRow[], limit = 200): Backtest {
  const rows = decided.slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
  const out: Backtest = { decided: rows.length, matched: 0, differed: 0, abstained: 0, synthetic: 0, rows: [], flags: [] };
  const diff: BacktestRow[] = [], same: BacktestRow[] = [], stop: string[] = [];
  const caution = r.kind === 'grant' && !!r.cautious, seen = new Map<string, { spoke: number; matched: number }>(), say = new Map<string, RuleVerdict | null>();
  if (caution) {
    for (const row of rows.slice().reverse()) {
      const base = verdictOf({ ...r, cautious: false }, row), t = seen.get(row.lens) ?? { spoke: 0, matched: 0 };
      say.set(row.id, base === 'approve' && trustedBy(t) ? 'approve' : null);
      if (base === 'approve') { t.spoke++; if (row.owner === 'approve') t.matched++; seen.set(row.lens, t); }
    }
    out.trust = lensTrust(r, rows);
  }
  for (const row of rows) {
    if (row.synthetic) out.synthetic++;
    const v = caution ? say.get(row.id) ?? null : verdictOf(r, row);
    if (!v) { out.abstained++; continue; }
    const agree = (v === 'approve') === (row.owner === 'approve');
    const stopShip = v === 'approve' && row.tier === 0;
    if (stopShip) stop.push(row.id);
    (agree ? same : diff).push({ ...row, rule: v, agree, ...(stopShip ? { stopShip } : {}) });
    if (agree) out.matched++; else out.differed++;
  }
  out.rows = [...diff, ...same];
  if (stop.length) out.flags.push({ key: 'stop-ship', text: `would have approved ${stop.length} stop-ship finding${stop.length === 1 ? '' : 's'} (tier 0) on its own`, ids: stop });
  if (r.kind === 'grant' && (r.minTier === undefined || r.minTier === 0)) out.flags.push({ key: 'any-tier', text: 'covers every tier, stop-ship included: set a tier floor before granting it' });
  if (out.decided && !out.matched && !out.differed) out.flags.push({ key: 'silent', text: 'never applied to one of your decisions: there is no evidence either way' });
  if (out.differed && out.differed * 5 > out.matched + out.differed) out.flags.push({ key: 'disagrees', text: `disagreed with you on ${Math.round((out.differed * 100) / (out.matched + out.differed))}% of the decisions it spoke on` });
  return out;
}

/** Whether the evidence lets a person grant it as it is: no stop-ship row, no open tier, and it spoke at least once. */
export const trustworthy = (b: Backtest): boolean => !b.flags.some((f) => f.key === 'stop-ship' || f.key === 'any-tier' || f.key === 'silent');

/**
 * Breaches: findings approved inside an order's place, against it, after it was set (and before it ended). bp's own doors
 * refuse those, so a breach means something went around them (a CLI run, another app's runner): the order's record says
 * so. Grant-signed decisions (`rule:`) are the grants' own and never a breach of an order the gate let them through.
 */
export function breachesOf(r: Rule, decided: readonly DecidedRow[]): DecidedRow[] {
  if (!isOrder(r.kind)) return [];
  const end = r.revokedAt ?? r.expiresAt;
  return decided.filter((x) => x.owner === 'approve' && x.at > r.at && (!end || x.at < end) && verdictOf(r, x) === 'hold');
}

/** One line of the rules log (work/bp-rules-log.jsonl): a door that held items or refused an act, citing the rule. */
export interface HeldEntry { at: string; rule: string; tool: string; ids: string[]; refused: boolean }
/** What the log says about each rule: how often it held, how many items, and the last time. */
export interface HeldTally { times: number; items: number; refused: number; last: string; tools: string[] }
export function tallyHeld(log: readonly HeldEntry[]): Record<string, HeldTally> {
  const out: Record<string, HeldTally> = {};
  for (const e of log) {
    const t = (out[e.rule] ??= { times: 0, items: 0, refused: 0, last: e.at, tools: [] });
    t.times++; t.items += e.ids.length; if (e.refused) t.refused++;
    if (e.at > t.last) t.last = e.at;
    if (!t.tools.includes(e.tool)) t.tools.push(e.tool);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ what it does now
/** A finding still open (proposed or approved): what a rule would act on the moment it is set. */
export interface OpenRow { id: string; title: string; feature: string; lens: string; tier?: number }
export interface Impact {
  /** Open findings on the product. */
  open: number;
  /** The ones the rule acts on now: an order holds (a cap: their builds are capped), a grant lets agents approve alone. */
  hits: (OpenRow & { verdict: RuleVerdict })[];
  /** Features the rule governs (every feature for `all`: `total`). */
  features: number;
}
/** What the rule would do to the open backlog right now: the steer, before the replay says whether to trust it. */
export function impact(r: RuleShape, open: readonly OpenRow[], total: number, trusted?: ReadonlySet<string>): Impact {
  const hits: Impact['hits'] = [];
  for (const o of open) {
    if (!(r.scope.kind === 'all' || r.scope.features.includes(o.feature))) continue;
    const v: RuleVerdict | null = r.kind === 'cap' ? 'hold' : r.cautious && r.kind === 'grant' && !trusted?.has(o.lens) ? null : verdictOf(r, { ...o, owner: 'approve', by: '', at: '' });
    if (v) hits.push({ ...o, verdict: v });
  }
  return { open: open.length, hits, features: r.scope.kind === 'all' ? total : r.scope.features.length };
}

// ------------------------------------------------------------------------------------------------ a rule a person writes
export type RuleDraft = Omit<Rule, 'id' | 'by' | 'at' | 'revokedAt' | 'revokedBy' | 'evidence'> & { hours?: number };
const SCOPE_KINDS: readonly string[] = SCAN_SCOPE_KINDS;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** The draft in a request body, or why not. `features` checks a scope's features against the map; `lens` its lenses. */
export function checkRuleBody(b: unknown, known: { feature(f: string): boolean; lens(l: string): boolean; tool(t: string): boolean }): RuleDraft | string {
  if (!isObj(b)) return 'body must be an object';
  const kind = b.kind as RuleKind;
  if (!RULE_KINDS.includes(kind)) return `kind must be one of ${RULE_KINDS.join(', ')}`;
  const s = b.scope;
  if (!isObj(s) || !SCOPE_KINDS.includes(s.kind as string) || typeof s.label !== 'string' || !s.label.trim() || s.label.length > 200) return 'scope must be { kind, id?, label, features }';
  if (!Array.isArray(s.features) || s.features.length > 2000 || s.features.some((f) => typeof f !== 'string' || !SAFE_ID.test(f) || !known.feature(f))) return 'scope.features must be features of the map';
  if (s.kind !== 'all' && !s.features.length) return 'a scope other than all names at least one feature';
  if (s.id !== undefined && (typeof s.id !== 'string' || !SAFE_ID.test(s.id))) return 'scope.id must be a safe id';
  const scope: ScanScope = { kind: s.kind as ScanScope['kind'], ...(typeof s.id === 'string' ? { id: s.id } : {}), label: s.label.trim(), features: s.kind === 'all' ? [] : [...new Set(s.features as string[])] };
  const d: RuleDraft = { kind, text: '', scope };
  if (kind === 'only') {
    if (!Array.isArray(b.lenses) || !b.lenses.length || b.lenses.some((l) => typeof l !== 'string' || !known.lens(l))) return 'only: lenses must be lenses of the map';
    d.lenses = [...new Set(b.lenses as string[])];
  }
  if (kind === 'cap') {
    if (!WAVE_EFFORTS.includes(b.maxEffort as WaveEffort)) return `cap: maxEffort must be one of ${WAVE_EFFORTS.join(', ')}`;
    d.maxEffort = b.maxEffort as WaveEffort;
    if (b.model !== undefined) { if (!WAVE_MODELS.includes(b.model as WaveModel)) return `cap: model must be one of ${WAVE_MODELS.join(', ')}`; d.model = b.model as WaveModel; }
  }
  if (kind === 'grant') {
    if (b.minTier !== undefined) { if (![0, 1, 2, 3].includes(b.minTier as number)) return 'grant: minTier must be 0..3'; d.minTier = b.minTier as number; }
    if (b.cautious !== undefined) { if (typeof b.cautious !== 'boolean') return 'grant: cautious must be true or false'; if (b.cautious) d.cautious = true; }
    if (b.tools !== undefined) {
      if (!Array.isArray(b.tools) || !b.tools.length || b.tools.some((t) => typeof t !== 'string' || !known.tool(t))) return 'grant: tools must be GATED catalog tools';
      d.tools = [...new Set(b.tools as string[])];
    }
  }
  if (b.hours !== undefined) { if (typeof b.hours !== 'number' || !(b.hours > 0 && b.hours <= RULE_MAX_HOURS)) return `hours must be 0 < h <= ${RULE_MAX_HOURS}`; d.hours = b.hours; }
  if (kind === 'grant' && d.hours === undefined && b.preview !== true) return 'a grant must expire: hours is required'; // a replay needs no expiry
  if (b.text !== undefined && (typeof b.text !== 'string' || b.text.length > 200)) return 'text must be at most 200 characters';
  d.text = typeof b.text === 'string' && b.text.trim() ? b.text.trim() : ruleText(d);
  return d;
}

/** The next id of its kind: one more than the highest `O-n` / `G-n` in the file (revoked ones included: never reused). */
export function nextRuleId(rules: readonly Rule[], kind: RuleKind): string {
  const p = isOrder(kind) ? 'O-' : 'G-';
  return p + (1 + rules.reduce((n, r) => (r.id.startsWith(p) ? Math.max(n, Number(r.id.slice(2)) || 0) : n), 0));
}
/** The rule a draft becomes. */
export function ruleOf(d: RuleDraft, rules: readonly Rule[], by: string, now: number = Date.now()): Rule {
  const { hours, ...rest } = d;
  return { ...rest, id: nextRuleId(rules, d.kind), by, at: new Date(now).toISOString(), ...(hours !== undefined ? { expiresAt: new Date(now + hours * 3600000).toISOString() } : {}) };
}
