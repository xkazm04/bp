// Onboarding in the app (spark project-onboarding): the wire types of the folder check and of the build-up feed an `adopt`
// job emits. Client-safe types only; the server half is server/onboarding.server.ts (check, enqueue, routes) and
// server/onboarding-feed.server.ts (the event deriver, its journal and the SSE fan-out).
//
// The build-up events are DEFINED by apps/web/src/buildup/contract.ts (the screen's contract). Core may not import the
// web app (scripts/check-core-purity.mjs), so the event union is restated here field for field, and
// scripts/check-onboarding.ts proves at compile time that the two are mutually assignable: a change to one that the
// other lacks fails typecheck. Absent values follow the contract: a field the pipeline has not produced is `null`.
import { BUILDUP_PHASES as SCHEMA_BUILDUP_PHASES } from '../standard/schema-vocab.ts';

/** One row of `adopt.mjs check --json` (its `key` is this `id`). `state` is adopt-bp's: ok, missing, stale, warn, ... */
export interface OnboardCheckItem { id: string; state: 'ok' | 'missing' | 'stale' | 'partial' | string; detail: string | null }

/** POST /api/onboarding/check: what bp would onboard at `root`, before anything is registered. */
export interface OnboardCheck {
  /** Normalized absolute path, forward slashes, the casing the disk has. */
  root: string;
  git: boolean;
  /** Proposed: kebab of the folder name, unique against the registry (suffix -2, -3). */
  slug: string;
  /** Proposed: the folder name as it is on disk. */
  name: string;
  /** The slug this root is already registered under, or null. */
  registered: string | null;
  /** adopt.mjs check --json items, as it lists them. */
  items: OnboardCheckItem[];
  /** Items whose state is not 'ok'. */
  need: number;
}

// ------------------------------------------------------------------------- the build-up wire (contract.ts restated)
export interface BBox { x: number; y: number; w: number; h: number }
export type Stage = 'live' | 'flagged' | 'in-review' | 'in-dev' | 'specified' | 'idea' | 'deprecated';
export type Health = 'good' | 'watch' | 'bad' | 'na' | 'unmeasured';
export interface BWing { id: string; name: string; order: number; letter: string; box: BBox }
export interface BRoom { id: string; name: string; order: number; parentId: string; box: BBox }
export interface BBay { id: string; name: string; order: number; parentId: string; box: BBox }
export interface StructureTile {
  id: string; name: string; order: number; parentId: string; box: BBox;
  stage: Stage | null; kind: string | null; tier: string | null; summary: string | null;
}

/** The build-up's phases, in run order (adopt-bp SKILL.md "The run"): scan-wire-1's scanJob.adopt_phase, generated. */
export const BUILDUP_PHASES = SCHEMA_BUILDUP_PHASES;
export type BuildupPhase = (typeof BUILDUP_PHASES)[number];
export type PhaseState = 'start' | 'done' | 'failed';
/** What a person reads for a phase (the /projects row: "Onboarding · Judge"). */
export const BUILDUP_PHASE_LABEL: Readonly<Record<BuildupPhase, string>> = {
  check: 'Check', 'context-map': 'Context map', seed: 'Seed', 'product-tree': 'Product tree',
  events: 'History', measure: 'Measure', judge: 'Judge', register: 'Register',
};
export const isBuildupPhase = (p: unknown): p is BuildupPhase => typeof p === 'string' && (BUILDUP_PHASES as readonly string[]).includes(p);

export interface SurveyArea { id: string; name: string; group: string | null; files: number; lines: number | null; first: string | null; last: string | null }
export interface OutlineDomain { id: string; name: string; order: number; summary: string | null; capabilities: { id: string; name: string }[] }
export type ActivityVerb = 'read' | 'write' | 'run';

export type BuildupEvent =
  | { type: 'begin'; at: number; project: { slug: string; name: string }; extent: BBox | null }
  | { type: 'phase'; at: number; phase: BuildupPhase; state: PhaseState; detail: string | null }
  | { type: 'structure'; at: number; wings: BWing[]; rooms: BRoom[]; bays: BBay[]; tiles: StructureTile[] }
  | { type: 'history'; at: number; tiles: { id: string; created: string | null }[] }
  | { type: 'health'; at: number; provisional: boolean; tiles: { id: string; general: Health }[] }
  | { type: 'survey'; at: number; areas: SurveyArea[] }
  | { type: 'outline'; at: number; domains: OutlineDomain[] }
  | { type: 'activity'; at: number; verb: ActivityVerb; path: string; area: string | null }
  | { type: 'progress'; at: number; phase: BuildupPhase; n: number; of: number; detail: string | null }
  | { type: 'done'; at: number }
  | { type: 'failed'; at: number; phase: BuildupPhase; message: string };

/** An event before the feed stamps its time. */
export type BuildupEventIn = BuildupEvent extends infer E ? (E extends { at: number } ? Omit<E, 'at'> : never) : never;
