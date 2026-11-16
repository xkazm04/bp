// The build-up contract: what an onboarding run tells the screen, in the order the real pipeline (adopt-bp) learns it.
// The build-up (b-outline/, the owner's winner of contest blueprint-buildup, spark project-onboarding) consumes these
// events and nothing else, so one source can be swapped for another: the preset (a scheduled replay of a finished plan) today,
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
//
// Anti-stale events (docs/concepts/onboarding/feasibility.md section 5): a real run is silent for minutes at a time (no
// structure for ~4.5 min, then ~10 min of judging), so four more events carry what the run already knows in between.
// All four are optional to draw: a variant that ignores them still ends on the right frame.
//   context-map, seed             -> `survey` (code areas; re-sent enriched with lines and dates, merge by id)
//   product-tree (LLM)            -> `outline` per decided domain, before the boxes (ids match the later wings/rooms)
//   any time                      -> `activity`: what the agent is reading or writing now, at most one a second
//   judge (and measure)           -> `progress` n of N, with the batch's provisional `health`
//
// Narration (adopt-bp 1.6.0, feasibility.md section 6): the agent appends work/progress.jsonl as it works, so the run
// itself says what it decided, what it is doing and what comes next. Optional to draw, like the four above.
//   product-tree (LLM)            -> `outline` per `domain` line, the moment the domain is decided (deduped with the
//                                    product-tree.d files: a domain is never sent twice)
//   product-tree, judge (LLM)     -> `narration` per `step` line: one plain sentence now, and the next one (or null)
//   judge (LLM)                   -> `narration` per `batch` line as it is dispatched: "Judging batch n of N", with the
//                                    batch's feature slugs (`features`); its provisional `health` follows when it lands

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

/** One code area (a context of the code map): what exists before any product name does. */
export interface SurveyArea {
  id: string; name: string; group: string | null;
  files: number; lines: number | null;
  /** First and last commit touching the area, YYYY-MM-DD. */
  first: string | null; last: string | null;
}

/** A domain the product tree has decided. `id` equals the wing id it becomes; capability ids equal the room ids. */
export interface OutlineDomain {
  id: string; name: string; order: number; summary: string | null;
  capabilities: { id: string; name: string }[];
}

export type ActivityVerb = 'read' | 'write' | 'run';

export type BuildupEvent =
  /** `at`: ms since the run started. `detail`: one human line ("13 domains, 133 features"), or null. */
  | { type: 'begin'; at: number; project: { slug: string; name: string }; /** The plan's extent, known up front only by a preset; null live. */ extent: BBox | null }
  | { type: 'phase'; at: number; phase: Phase; state: PhaseState; detail: string | null }
  /** One chunk of the product tree. Parents always arrive before or with their children. */
  | { type: 'structure'; at: number; wings: BWing[]; rooms: BRoom[]; bays: BBay[]; tiles: StructureTile[] }
  | { type: 'history'; at: number; tiles: { id: string; created: string | null }[] }
  /** `provisional`: read from one judgement batch before the final merge (a later non-provisional event overrides). */
  | { type: 'health'; at: number; provisional: boolean; tiles: { id: string; general: Health }[] }
  /** Code areas, cumulative per send: an area re-sent with the same id replaces the earlier one. */
  | { type: 'survey'; at: number; areas: SurveyArea[] }
  /** Decided domains, merged by id; arrives one domain at a time while the tree is written. */
  | { type: 'outline'; at: number; domains: OutlineDomain[] }
  /** The agent touched `path` (repo-relative); `area` is the survey area that owns it, or null. */
  | { type: 'activity'; at: number; verb: ActivityVerb; path: string; area: string | null }
  /** A long phase's count: judgement batches written, n of `of`. */
  | { type: 'progress'; at: number; phase: Phase; n: number; of: number; detail: string | null }
  /** What the agent says it is doing (`text`, one sentence) and will do next (`next`, or null). `features`: the feature
   *  slugs of a judgement batch it just dispatched (being judged now), else null. */
  | { type: 'narration'; at: number; phase: Phase; text: string; next: string | null; features: string[] | null }
  | { type: 'done'; at: number }
  | { type: 'failed'; at: number; phase: Phase; message: string };

/**
 * `past`: the event is history being caught up, not news. A source sets it on what `subscribe` hands a late listener and
 * on the burst a feed resends when it (re)connects (the server replays from `begin`: a page opened mid-run, a dropped
 * connection). A variant draws a past event at its end state at once instead of animating it, so catching up on a
 * 10-minute run takes a frame, not 10 minutes. Absent means live.
 */
export type BuildupListener = (e: BuildupEvent, past?: boolean) => void;

/**
 * Where events come from. A variant subscribes once; `subscribe` first delivers, synchronously, every event since the
 * last `begin` (a variant that mounts late, or a screen opened mid-run, catches up), marked `past`, then live ones.
 * `replay` restarts from `begin` (listeners are kept).
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
