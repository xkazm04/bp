// Types for the app-structure v3 standard (context-map.json v3) and lens manifests v1. They mirror
// docs/standard/schema/*.schema.json, which are normative; the spec is docs/standard/app-structure-v3.md.
// This file holds types and one constant only, so Node can load the evaluator with type stripping.

// ------------------------------------------------------------------------------------- vocabulary
/** The fixed, ordered lifecycle. `flagged` = live behind a partial rollout. */
export type Stage = 'idea' | 'specified' | 'in-dev' | 'in-review' | 'flagged' | 'live' | 'deprecated';
/** What a health rule can conclude. */
export type ComputedHealth = 'good' | 'watch' | 'bad';
/** A lens's health for one feature: computed, or `unmeasured` (no facet) / `na` (not applicable). */
export type Health = ComputedHealth | 'unmeasured' | 'na';
/** A built-in short id or a reverse-DNS custom id. Deliberately not a union: lenses are plugins. */
export type LensId = string;
export type Scalar = string | number | boolean;
/** Field key -> value. An unknown value is omitted, never null. */
export type FacetValues = Record<string, Scalar>;
/** The core feature fields a lens field may bind to (`source: { feature }`). Read-only, never stored in facets. */
export type FeatureBoundField = 'stage' | 'priority' | 'kind' | 'tier' | 'milestone' | 'status';

/**
 * The six built-in lens ids, for loading the catalog only. Code must never branch on this list:
 * every lens, built-in or custom, is drawn and evaluated from its manifest.
 */
export const BUILTIN_LENS_IDS = ['business', 'design', 'development', 'operations', 'security', 'quality'] as const;

// ---------------------------------------------------------------------------------- lens manifest
export type FieldType = 'number' | 'integer' | 'percent' | 'money' | 'boolean' | 'string' | 'enum' | 'date';

interface FieldBase {
  key: string;
  label: string;
  description?: string;
  unit?: string;
  min?: number;
  max?: number;
  headline?: boolean;
  /**
   * Where the value comes from instead of the facet: a KPI's current value (decision 6), or a core
   * feature field. Either way it is filled in at evaluation, and a stored facet value is ignored.
   */
  source?: { kpi: string } | { feature: FeatureBoundField };
  /**
   * v3.1: the field is a measured metric. The field key is the metric key in the lens-scan store
   * (docs/standard/lens-scan-store.md); its latest measurement is the facet value, history lives in
   * the store.
   */
  metric?: MetricSpec;
}

/** How a metric is read and which way is better. */
export interface MetricSpec {
  better: 'up' | 'down';
  method: MetricMethod;
  target?: number;
  warn_at?: number;
}
export type MetricMethod = 'static' | 'probe' | 'harness' | 'judgement';
export type LensField =
  | (FieldBase & { type: 'enum'; /** ordered */ values: string[] })
  | (FieldBase & { type: 'money'; /** ISO 4217 */ currency: string })
  | (FieldBase & { type: Exclude<FieldType, 'enum' | 'money'> });

type Leaf<Op extends string, V> = { field: string } & { [K in Op]: V };
/** A leaf names one field and exactly one operator. */
export type ConditionLeaf =
  | Leaf<'eq', Scalar> | Leaf<'ne', Scalar>
  | Leaf<'lt', number | string> | Leaf<'lte', number | string>
  | Leaf<'gt', number | string> | Leaf<'gte', number | string>
  | Leaf<'in', Scalar[]> | Leaf<'nin', Scalar[]>
  | Leaf<'missing', true> | Leaf<'present', true>;
export type Condition = ConditionLeaf | { all: Condition[] } | { any: Condition[] } | { not: Condition };

/** `short` (optional, max 28 chars) is the reason for tight places such as a tile stamp. */
export interface HealthRule { when: Condition; health: ComputedHealth; reason: string; short?: string }

export type Rollup =
  | { method: 'worst-of' }
  /** Thresholds are fractions of the measured features. */
  | { method: 'share'; watch: number; bad: number }
  | { method: 'weighted'; by: string };

export type GlyphName = 'bars' | 'set-square' | 'brackets' | 'pulse' | 'padlock' | 'check';
export type LineName = 'solid' | 'double' | 'dotted' | 'comb' | 'chain' | 'hatched' | 'dimension';
export type Density = 'simple' | 'standard' | 'dense';

export interface Presentation {
  /** A shared glyph, or an SVG path in a 16x16 box (parsed only as a path, never as markup). */
  glyph: GlyphName | { path: string };
  line: LineName;
  accent?: { dark: string; light: string };
  evidence?: string[];
  measures?: string;
}

export interface LensManifest {
  $schema: 'lens-manifest/1';
  id: LensId;
  version: string;
  name: string;
  short?: string;
  description?: string;
  reader: { role?: string; density: Density };
  fields: LensField[];
  health: {
    /** When present and not matching, the lens does not apply: health `na`. Same grammar as rules. */
    applies_when?: Condition;
    rules: HealthRule[];
    default: ComputedHealth;
    rollup: Rollup;
  };
  presentation: Presentation;
}

// ------------------------------------------------------------------------------- context-map v3
export interface Project {
  slug: string; name: string; id?: string; description?: string; kind?: string; root?: string;
  [key: string]: unknown;
}

/** v2 code tree, unchanged. */
export interface Group {
  id?: string; name: string; color?: string; domain?: string; context_count?: number;
  [key: string]: unknown;
}
/** v2 code tree, unchanged. `name` is the stable key. */
export interface Context {
  id?: string; name: string; group?: string; group_id?: string; category?: string;
  business_feature?: string; description?: string; file_paths?: string[]; entry_points?: string[];
  db_tables?: string[]; keywords?: string[]; api_surface?: string; cross_refs?: unknown[];
  tech_stack?: string[]; pinned?: boolean; last_written_at?: string;
  [key: string]: unknown;
}

export interface Domain {
  slug: string; id?: string; name: string; summary?: string; order?: number; source?: 'declared' | 'proposed';
}
export interface Capability {
  slug: string; id?: string; domain: string; name: string; summary?: string; order?: number;
  source?: 'declared' | 'proposed';
}

export interface Feature {
  slug: string;
  id?: string;
  name: string;
  summary?: string;
  kind?: string;
  tier?: string;
  /** Personas compatibility. */
  status?: 'active' | 'archived';
  /** Capability slug; omitted = unplaced in the product tree. */
  capability?: string;
  /** Context names (the code tree). */
  contexts?: string[];
  primary_context?: string;
  /** Omitted = unknown (never guessed). */
  stage?: Stage;
  stage_since?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  milestone?: string;
  depends_on?: string[];
  blocked_by?: string[];
  owner?: string;
  built_by?: string[];
  surfaces?: string[];
  created?: string;
  parts?: { name: string; done: boolean }[];
  notes?: { by: string; date: string; text: string }[];
  /** v3.1: free tags (Personas use cases, for example). */
  tags?: string[];
  /** v3.1: the customer experience as it is today, one short paragraph. */
  experience?: string;
  /** v3.1: what every variation shares: the shared technology and the core schema, as bullets. */
  core?: { tech?: string[]; schema?: string[] };
  /** v3.1: per-customer or per-segment variations that extend the core. */
  variations?: Variation[];
  [key: string]: unknown;
}

/** v3.1: one variation of a feature. Lens values stay on the core feature. */
export interface Variation {
  slug: string;
  name: string;
  /** Who it is for: a customer, a bank, a segment. */
  audience: string;
  /** What it adds to the core, as bullets. */
  extends: string[];
  /** Its parameters, as bullets. */
  params: string[];
  stage?: Stage;
}

export interface Milestone {
  slug: string; id?: string; name: string; status: 'planned' | 'active' | 'shipped'; target_date?: string; goal?: string;
}

/** Exactly one key. Precedence when several KPIs could apply: feature, context, group, project. */
export type KpiScope = { feature: string } | { context: string } | { group: string } | { project: true };

export interface Kpi {
  slug: string;
  id?: string;
  name: string;
  scope: KpiScope;
  category?: 'technical' | 'traffic' | 'value' | 'quality';
  lens?: LensId;
  unit?: string;
  direction?: 'up' | 'down';
  baseline?: number;
  target?: number;
  target_date?: string;
  warn_at?: number;
  crit_at?: number;
  /** Omitted when nothing has been measured (null is never zero). */
  current?: { value: number; measured_at?: string; env?: string; [key: string]: unknown };
  status?: string;
  tier?: string;
  measure_kind?: string;
  [key: string]: unknown;
}

export interface LensEntry {
  id: LensId;
  version: string;
  source: 'builtin' | 'project';
  /** false hides the lens; its facets are kept. */
  enabled: boolean;
  /** A full copy of the manifest the project uses. */
  manifest: LensManifest;
}

export interface FacetOverride { health: ComputedHealth; by: string; why: string; /** inclusive, YYYY-MM-DD */ until: string }

export interface Facet {
  values?: FacetValues;
  /** false = the lens does not apply to this feature (health `na`). */
  applicable?: boolean;
  measured_at?: string;
  source?: string;
  override?: FacetOverride;
  [key: string]: unknown;
}

export interface AppStructure {
  $schema: 'app-structure/3';
  version: 3;
  generator?: string;
  generated_at?: string;
  declared?: boolean;
  provenance?: Record<string, unknown>;
  project: Project;
  taxonomy?: Record<string, string[]>;
  stats?: Record<string, number>;
  groups?: Group[];
  contexts?: Context[];
  domains?: Domain[];
  capabilities?: Capability[];
  features?: Feature[];
  milestones?: Milestone[];
  kpis?: Kpi[];
  lenses?: LensEntry[];
  /** feature slug -> lens id -> facet. Facets of lenses not in `lenses[]` are orphaned but kept. */
  facets?: Record<string, Record<LensId, Facet>>;
  /** reverse-DNS keys; every writer keeps them. */
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

// ------------------------------------------------------------------------------------ events log
export type StructureEventType =
  | 'stage' | 'lens-health' | 'kpi-threshold' | 'milestone'
  | 'feature-added' | 'feature-archived' | 'lens-enabled' | 'lens-disabled';

/** One line of context-map.events.jsonl. `type` is open: readers skip types they do not know. */
export interface StructureEvent {
  at: string;
  type: StructureEventType | (string & {});
  feature?: string;
  lens?: LensId;
  kpi?: string;
  milestone?: string;
  from?: string;
  to?: string;
  actor?: string;
  source?: string;
  [key: string]: unknown;
}
