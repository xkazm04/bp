// Types for the app's data: the product read from the app-structure v3 map and its events log (the
// model is built by src/lib/standard/load.ts and re-exported here), and the simulated swarm
// (src/data/swarm.json, the runtime feed; not part of the standard). Lens ids are plain strings: the
// lenses are whatever the map's `lenses[]` enables.
export type {
  ActivityEvent, Capability, Domain, Feature, FeatureLens, Health, LensDef, Milestone, Person, Priority, Scalar, Snapshot, Stage, Structure, Trouble,
} from '@/lib/standard/load';
export { STAGES } from '@/lib/standard/load';

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
  question: string; options: { label: string; consequence: string }[]; recommended: number;
  urgency: 'high' | 'medium' | 'low'; waitingSince: string; blocksAgents: number; affects: string[];
  /** Seconds after 09:00 when the decision is asked during the replay; absent = open at 09:00. */
  arrivesAt?: number;
}
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
