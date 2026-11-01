// The build-up contract: what an onboarding run tells the screen, in the order the real pipeline (adopt-bp) learns it.
// Three build-up variants (spark project-onboarding, contest blueprint-buildup shortlist A1, B1, E1) consume these events
// and nothing else, so one source can be swapped for another: the preset (a scheduled replay of a finished plan) today,
// the live adopt job's stream later. A variant never reads the plan behind the source's back; it draws what has arrived.
//
// Order of arrival, as adopt-bp produces it (SKILL.md "The run"):
//   check, context-map, seed      -> phase events only (no plan yet)
//   product-tree (LLM)            -> `structure` chunks: wings, rooms, bays and tiles with name, kind, tier, summary, stage
//   events (git history)          -> one `history` event: each tile's first-seen date
//   measure                       -> phase events only (static metrics feed health later)
//   judge (LLM, batches of ~8)    -> `health` events, one per batch
//   register                      -> `done`
// Absent values: a field the pipeline has not produced is `null` (never omitted, never 0).

/** World units (bp's layout: a tile is 160 x 76). */
export interface BBox { x: number; y: number; w: number; h: number }

export type Stage = 'live' | 'flagged' | 'in-review' | 'in-dev' | 'specified' | 'idea' | 'deprecated';
export type Health = 'good' | 'watch' | 'bad' | 'na' | 'unmeasured';

export interface BWing { id: string; name: string; order: number; letter: string; box: BBox }
export interface BRoom { id: string; name: string; order: number; parentId: string; box: BBox }
export interface BBay { id: string; name: string; order: number; parentId: string; box: BBox }
export interface BTile {
  id: string; name: string; order: number; parentId: string; box: BBox;
  stage: Stage | null; kind: string | null; tier: string | null; summary: string | null;
  /** First-seen date (ISO), from the feature or its first `feature-added` event; null until history arrives or when unknown. */
  created: string | null;
  /** Worst lens reading; null until health arrives. */
  general: Health | null;
}

/** A whole product's plan: what a variant has once every event has arrived. The shape the contest prototypes read. */
export interface BuildupPlan {
  project: { slug: string; name: string };
  counts: { wings: number; rooms: number; bays: number; tiles: number };
  wings: BWing[]; rooms: BRoom[]; bays: BBay[]; tiles: BTile[];
}

export const PHASES = ['check', 'context-map', 'seed', 'product-tree', 'events', 'measure', 'judge', 'register'] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  check: 'Check', 'context-map': 'Context map', seed: 'Seed', 'product-tree': 'Product tree',
  events: 'History', measure: 'Measure', judge: 'Judge', register: 'Register',
};
/** The phases a model runs (slow, uneven); the rest are scripts (seconds). */
export const LLM_PHASES: ReadonlySet<Phase> = new Set<Phase>(['product-tree', 'judge']);

export type PhaseState = 'start' | 'done' | 'failed';

/** Tile fields known at product-tree time: everything but the first-seen date and the health reading. */
export type StructureTile = Pick<BTile, 'id' | 'name' | 'order' | 'parentId' | 'box' | 'stage' | 'kind' | 'tier' | 'summary'>;

export type BuildupEvent =
  /** `at`: ms since the run started. `detail`: one human line ("13 domains, 133 features"), or null. */
  | { type: 'begin'; at: number; project: { slug: string; name: string }; /** The plan's extent, known up front only by a preset; null live. */ extent: BBox | null }
  | { type: 'phase'; at: number; phase: Phase; state: PhaseState; detail: string | null }
  /** One chunk of the product tree. Parents always arrive before or with their children. */
  | { type: 'structure'; at: number; wings: BWing[]; rooms: BRoom[]; bays: BBay[]; tiles: StructureTile[] }
  | { type: 'history'; at: number; tiles: { id: string; created: string | null }[] }
  | { type: 'health'; at: number; tiles: { id: string; general: Health }[] }
  | { type: 'done'; at: number }
  | { type: 'failed'; at: number; phase: Phase; message: string };

export type BuildupListener = (e: BuildupEvent) => void;

/**
 * Where events come from. A variant subscribes once; `subscribe` first delivers, synchronously, every event since the
 * last `begin` (a variant that mounts late, or a screen opened mid-run, catches up), then live ones. `replay` restarts
 * from `begin` (listeners are kept).
 */
export interface BuildupSource {
  readonly kind: 'preset-demo' | 'preset-real' | 'live';
  subscribe(fn: BuildupListener): () => void;
  start(): void;
  replay(): void;
  dispose(): void;
}

/** Props every variant component takes. `reducedMotion` mirrors prefers-reduced-motion (the variant may also read it). */
export interface BuildupVariantProps {
  source: BuildupSource;
  reducedMotion: boolean;
  theme: 'dark' | 'light';
}
