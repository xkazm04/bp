// Types for the app's data: the product read from the app-structure v3 map and its events log (the
// model is built by src/lib/standard/load.ts and re-exported here), and the simulated swarm
// (src/data/swarm.json, the runtime feed; not part of the standard). Lens ids are plain strings: the
// lenses are whatever the map's `lenses[]` enables.
export type {
  ActivityEvent, Capability, Domain, Feature, FeatureLens, Health, LensDef, Milestone, Person, Priority, Scalar, Snapshot, Stage, Structure, Trouble,
} from '@bp/core/standard/load';
export { STAGES } from '@bp/core/standard/load';

/** What the plan shows: 'general' (the composition of every enabled lens) or a lens id from the registry. */
export type ViewId = string;
export const GENERAL = 'general';

// ---------- swarm (runtime feed) ----------
export type AgentStatus = 'working' | 'waiting' | 'blocked' | 'idle' | 'failed';
export type CrewRole = 'build' | 'review' | 'operate' | 'research' | 'security';

/** `lenses`: the lens ids whose work this crew does (crews outside the viewed lens are drawn dimmer). */
export interface Squad { id: string; name: string; role: CrewRole; focus: string; size: number; lenses?: string[] }
export interface Agent {
  id: string; squad: string; role: CrewRole; status: AgentStatus; feature: string; task: string;
  progressPct: number; since: string; tokensPerMin: number; costUsdToday: number; doneToday: number;
  waitingOn?: string; blockedBy?: string;
}
export interface Decision {
  /** `lens` is a lens id string; a decision whose lens is disabled or unknown still shows under General. */
  id: string; feature: string; domain: string; lens: string; decider: string; askedBy: string;
  question: string; options: DecisionOption[]; recommended: number;
  urgency: 'high' | 'medium' | 'low'; waitingSince: string; blocksAgents: number; affects: string[];
  /** Seconds after 09:00 when the decision is asked during the replay; absent = open at 09:00. */
  arrivesAt?: number;
  /** v4 (a live scan's proposal): its severity tier, 0 stop-ship .. 3 backlog; absent = untriaged. The queue's first key. */
  tier?: 0 | 1 | 2 | 3;
}
/**
 * An answer option. `effects`: what choosing it does in the simulation, in a closed vocabulary, and only what
 * the consequence sentence states; absent = narrative only. `expected` (live): the proposal's own expected move,
 * the one thing an Approve may preview on a real product.
 */
export interface DecisionOption { label: string; consequence: string; effects?: OptionEffect[]; expected?: string }
/**
 * The option-effect vocabulary (sample swarm). `feature` is a feature id (re-keyed with the feed's ids):
 * `roll` sets its rollout and holds it there; `cap` holds the rollout at most `max` (lowered if above); `staff`
 * moves `n` working agents of a domain / squad / role onto it; `ask` opens a follow-up question on it; `cover`
 * sets its unit coverage (`pct`) or moves it by `delta` points (the O-2 coverage rule reads it).
 */
export type OptionEffect =
  | { k: 'roll'; feature: string; pct: number }
  | { k: 'cap'; feature: string; max: number }
  | { k: 'staff'; feature: string; n: number; from: { domain?: string; squad?: string; role?: CrewRole } }
  | { k: 'ask'; feature: string; lens: string; decider: string; question: string; options: { label: string; consequence: string }[]; recommended: number; urgency: 'high' | 'medium' | 'low' }
  | { k: 'cover'; feature: string; pct?: number; delta?: number };
export interface StandingOrder {
  id: string; by: string; lens: string;
  scope: { domain?: string; milestone?: string; surface?: string; all?: boolean };
  text: string; since: string; violations: number;
}
export type ReplayType =
  | 'commit' | 'tests-pass' | 'tests-fail' | 'pr-open' | 'task-done' | 'review-pass' | 'review-changes'
  | 'deploy' | 'flag-change' | 'alert' | 'spec-draft' | 'note' | 'finding' | 'scan-clean' | 'move' | 'decision-asked';
export interface ReplayEvent {
  t: number; at: string; agent: string; feature: string; type: ReplayType; text: string;
  from?: string; decision?: string;
}
export interface Swarm {
  asOf: string; note: string; squads: Squad[]; agents: Agent[]; decisions: Decision[];
  orders: StandingOrder[]; replay: ReplayEvent[];
  totals: Record<string, number>;
}
