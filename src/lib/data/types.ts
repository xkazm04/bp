// Types for the staged sample data: src/data/kettle.json (the product) and src/data/swarm.json
// (the simulated agent swarm over it). Field meanings: .contest/stage-swarm/data/SCHEMA.md.

export const STAGES = ['idea', 'specified', 'in-dev', 'in-review', 'flagged', 'live', 'deprecated'] as const;
export type Stage = (typeof STAGES)[number];

export const LENSES = ['business', 'design', 'development', 'operations', 'security', 'quality'] as const;
export type LensId = (typeof LENSES)[number];
/** The General view is the composition of every lens. */
export type ViewId = 'general' | LensId;

export type Health = 'good' | 'watch' | 'bad' | 'na';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type FeatureFlag =
  | 'incident' | 'ai-unreviewed-in-production' | 'unmonitored' | 'blocked' | 'demand-waiting'
  | 'priority-not-started' | 'security-gap' | 'stalled' | 'spec-drift';

export interface Person { id: string; name: string; kind: 'human' | 'agent'; field: string; title: string }
export interface Milestone { id: string; name: string; date: string; state: 'done' | 'active' | 'planned'; goal: string }
export interface Domain { id: string; name: string; summary: string; capabilities: string[] }
export interface Capability { id: string; domain: string; name: string; features: string[] }

export interface BusinessLens {
  value: number; confidence: string; customerRequests30d: number; adoptionPct: number | null;
  revenueLink: string; mrrImpactUsd: number; usageNote?: string; health: Health;
}
export interface DesignLens { status: string; a11y: string; specDrift: boolean; health: Health }
export interface DevelopmentLens {
  status: string; progressPct: number; aiAuthoredPct: number; humanReviewed: boolean | null; openPRs: number;
  unitCoveragePct: number | null; techDebt: number | null; linesOfCode: number; lastCommit: string | null;
  stalled?: boolean; health: Health;
}
export interface OperationsLens {
  environment: string; flag: { key: string; rolloutPct: number } | null; sloTarget: number | null;
  sloActual: number | null; p95ms: number | null; errorRatePct: number | null; incidents30d: number;
  alerting: boolean; runbook: boolean; costUsdMonth: number; health: Health;
}
export interface SecurityLens { dataClass: string; review: string; openFindings: number; health: Health }
export interface QualityLens {
  status: string; e2eTests: number; e2ePassing: number; openBugs: { p1: number; p2: number; p3: number }; health: Health;
}

export interface Feature {
  id: string; name: string; summary: string; domain: string; capability: string;
  stage: Stage; priority: Priority; kind: string; milestone: string | null; surfaces: string[];
  dependsOn: string[]; usedBy: string[]; blockedBy: string[];
  history: { stage: Stage; date: string }[]; stageSince: string; created: string;
  owner: string; builtBy: string[];
  business: BusinessLens; design: DesignLens; development: DevelopmentLens;
  operations: OperationsLens; security: SecurityLens; quality: QualityLens;
  parts: { name: string; done: boolean }[] | null;
  notes: { by: string; date: string; text: string }[];
  health: Health; flags: FeatureFlag[];
}

export interface ActivityEvent {
  at: string; type: string; feature: string; actor: string; text: string;
  from?: string; to?: string; severity?: string;
}
export interface Snapshot { week: string; counts: Record<Stage, number>; total: number }

export interface Kettle {
  product: {
    name: string; tagline: string; asOf: string; stack: Record<string, string>;
    business: { studios: number; members: number; mrrUsd: number; mrrGrowthPct30d: number; churnPct30d: number };
    team: string;
  };
  lenses: LensId[]; stages: Stage[]; people: Person[]; milestones: Milestone[];
  domains: Domain[]; capabilities: Capability[]; features: Feature[];
  activity: ActivityEvent[]; snapshots: Snapshot[];
}

// ---------- swarm ----------
export type AgentStatus = 'working' | 'waiting' | 'blocked' | 'idle' | 'failed';
export type CrewRole = 'build' | 'review' | 'operate' | 'research' | 'security';

export interface Squad { id: string; name: string; role: CrewRole; focus: string; size: number }
export interface Agent {
  id: string; squad: string; role: CrewRole; status: AgentStatus; feature: string; task: string;
  progressPct: number; since: string; tokensPerMin: number; costUsdToday: number; doneToday: number;
  waitingOn?: string; blockedBy?: string;
}
export interface Decision {
  id: string; feature: string; domain: string; lens: LensId; decider: string; askedBy: string;
  question: string; options: { label: string; consequence: string }[]; recommended: number;
  urgency: 'high' | 'medium' | 'low'; waitingSince: string; blocksAgents: number; affects: string[];
  /** Seconds after 09:00 when the decision is asked during the replay; absent = open at 09:00. */
  arrivesAt?: number;
}
export interface StandingOrder {
  id: string; by: string; lens: LensId;
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
