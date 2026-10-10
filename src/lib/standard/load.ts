// The blueprint's reader for the app-structure standard: parses a context map (v3, or v2 per spec
// section 11) and its events log into the internal model the app draws from. Lenses are data here:
// the registry is the map's `lenses[]` where `enabled` is true (in file order), optionally toggled for
// the session (`?lenses=-security,+com.kettle.cost`). Health per feature and lens is computed ONCE
// per data load with the reference evaluator (health.ts) and cached with its explanation; the frame
// loop never evaluates a rule. History (a feature's stage revisions, the weekly snapshots) is replayed
// from the events log. Pure and dependency-free (types, the bound-field list and the evaluator only),
// so Node's type stripping can run it: `node -e "import('./src/lib/standard/load.ts')"`.
import type {
  AppStructure, Density, Facet, FacetOverride, FacetValues, Feature as V3Feature, GlyphName, Health, HealthRule, Kpi, LensEntry, LensField,
  LensManifest, LineName, Rollup, Scalar, Stage, StructureEvent, Variation,
} from './types.ts';
import { FEATURE_BOUND_FIELDS } from './types.ts';
import { bindValues, conditionFields, explain, lensHealth, matchRule, type EvalContext } from './health.ts';
import { generalHealth } from './present.ts';

// ------------------------------------------------------------------------------------ the model
export type { Stage, Health, Density, Scalar, LensField, LensManifest, FacetValues, FacetOverride, Kpi, StructureEvent, Variation };
export const STAGES: readonly Stage[] = ['idea', 'specified', 'in-dev', 'in-review', 'flagged', 'live', 'deprecated'];
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

/** One enabled (or known) lens: its manifest plus what readers keep asking of it, resolved once. */
export interface LensDef {
  id: string;
  /** Position in the registry (enabled lenses in file order); -1 when not enabled. */
  i: number;
  source: 'builtin' | 'project';
  manifest: LensManifest;
  name: string;
  /** `short`, else the name's first four letters, uppercased. */
  short: string;
  description: string;
  role: string;
  density: Density;
  fields: readonly LensField[];
  F: Readonly<Record<string, LensField>>;
  /** The field that best sums up the lens: the first `headline`, else the first evidence field. */
  headline: LensField | null;
  /** `presentation.evidence` resolved to fields (all of them; readers cut by density). */
  evidence: readonly LensField[];
  /** The field the lens line measures, if any. */
  measures: LensField | null;
  /** For a numeric `measures` without `max`: the largest value in the map (the line's scale). */
  measureMax: number | undefined;
  /** A shared glyph name, a validated custom path (16x16 box), or null when the path was rejected. */
  glyph: GlyphName | { path: string } | null;
  line: LineName;
  accent: { dark: string; light: string } | null;
  rollup: Rollup;
}

/** One feature under one lens, computed at load. */
export interface FeatureLens {
  h: Health;
  /** Facet values with bound fields filled in (KPI values, core feature fields). */
  v: FacetValues;
  /** The matched rule's reason with values filled in; null when no rule decided (spec `explain`). */
  why: string | null;
  /** The matched rule's short form, for tile stamps; null when the rule has none. */
  short: string | null;
  /** The fields the matched rule's condition names (to point at the evidence that decided). */
  whyFields: readonly string[];
  /** The override in force (it decided the health), else null. */
  ov: FacetOverride | null;
  facet: Facet | null;
}
export interface Trouble { lens: string; h: 'bad' | 'watch'; why: string; short: string | null }

export interface Feature {
  /** The key everywhere in the app: the slug (plus a product-line suffix at `?scale` > 1). */
  id: string;
  slug: string;
  /** A short display code: the map's passthrough `id` when it is short (e.g. `PAY-09`), else ''. Display only. */
  code: string;
  name: string;
  summary: string;
  domain: string;
  capability: string;
  /** null = unknown (v2, or not set): shown as unknown, never guessed. */
  stage: Stage | null;
  priority: Priority | null;
  kind: string;
  tier: string;
  status: string;
  milestone: string | null;
  surfaces: string[];
  contexts: string[];
  dependsOn: string[];
  usedBy: string[];
  blockedBy: string[];
  /** Stage revisions replayed from the events log (feature-added `to`, then stage events), oldest first. */
  revs: { stage: Stage; date: string }[];
  stageSince: string;
  created: string;
  owner: string;
  builtBy: string[];
  parts: { name: string; done: boolean }[] | null;
  notes: { by: string; date: string; text: string }[];
  /** v3.1 free tags. */
  tags: string[];
  /** v3.1: the as-is customer experience; '' when the map has none. */
  experience: string;
  /** v3.1: the shared core (tech and schema bullets); null when the map has none. */
  core: { tech: string[]; schema: string[] } | null;
  /** v3.1: variations that extend the core (malformed entries dropped). Lens values stay on the feature. */
  variations: Variation[];
  /** Every lens with a manifest in the map (enabled or not), by id. */
  lens: Readonly<Record<string, FeatureLens>>;
  /** General health: worst-of over enabled lenses, ignoring unmeasured and na (spec 8.4). */
  health: Health;
  /** Enabled lenses at bad or watch, bad first, then in registry order. */
  trouble: Trouble[];
}

export interface Domain { id: string; base: string; code: string; name: string; summary: string; capabilities: string[] }
export interface Capability { id: string; base: string; code: string; domain: string; name: string; features: string[] }
export interface Milestone { id: string; code: string; name: string; date: string; state: 'done' | 'active' | 'planned'; goal: string }
export interface Person { id: string; name: string; kind: 'human' | 'agent'; field: string; title: string }
export interface ActivityEvent { at: string; type: string; feature: string; actor: string; text: string; from?: string; to?: string; severity?: string }
export interface Snapshot { week: string; counts: Record<Stage, number>; total: number }

export interface Structure {
  /** 3, or 2 when read through the v2 compatibility path. */
  version: 2 | 3;
  project: { slug: string; name: string; tagline: string };
  /** The data's as-of date (YYYY-MM-DD) and time: overrides are read on this date. */
  asOf: string;
  asOfTime: string;
  /** The registry: enabled lenses, in file order, after the session toggle. */
  lenses: readonly LensDef[];
  /** Every lens entry with a manifest, enabled or not. */
  allLenses: readonly LensDef[];
  LENS: Readonly<Record<string, LensDef>>;
  features: Feature[];
  domains: Domain[];
  capabilities: Capability[];
  milestones: Milestone[];
  kpis: Kpi[];
  people: Person[];
  activity: ActivityEvent[];
  events: StructureEvent[];
  weeks: string[];
  snapshots: Snapshot[];
}

export interface LoadOptions {
  /** Manifests for a v2 map, whose built-in lenses are "available but unmeasured" (spec 11). */
  catalog?: readonly LensManifest[];
  /** Session toggle, e.g. `-security,+com.kettle.cost` (applied on top of `enabled`). */
  lenses?: string | null;
  /** How many weekly snapshots the history keeps, ending at the as-of date. Default 27. */
  weeks?: number;
}

// --------------------------------------------------------------------------------------- helpers
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isStage = (v: unknown): v is Stage => typeof v === 'string' && (STAGES as readonly string[]).includes(v);
const GLYPHS: readonly GlyphName[] = ['bars', 'set-square', 'brackets', 'pulse', 'padlock', 'check'];
const LINES: readonly LineName[] = ['solid', 'double', 'dotted', 'comb', 'chain', 'hatched', 'dimension'];
/**
 * A custom glyph is untrusted: path commands and numbers only, at most 2048 characters (spec 8.6).
 * The same rule as the schema's `presentation.glyph.path` (lens-manifest-1.schema.json): it opens with
 * a moveto and separates with spaces only, so a path the validator rejects falls back here too.
 */
const PATH_OK = /^[Mm][MmZzLlHhVvCcSsQqTtAa0-9eE.,+\- ]{0,2047}$/;
const DAY = 864e5;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'feature';

/** v3.1 variations, keeping well-formed entries only (slug, name and audience strings; bullets as strings). */
function variationsOf(v: unknown): Variation[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => isObj(x) && typeof x.slug === 'string' && typeof x.name === 'string').map((x) => {
    const out: Variation = { slug: x.slug as string, name: x.name as string, audience: str(x.audience), extends: strs(x.extends), params: strs(x.params) };
    if (isStage(x.stage)) out.stage = x.stage;
    return out;
  });
}

/** Parses an events log (JSON lines). Blank and malformed lines are skipped; so are lines without `at`/`type`. */
export function parseEvents(text: string | null | undefined): StructureEvent[] {
  const out: StructureEvent[] = [];
  if (!text) return out;
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const e = JSON.parse(s) as unknown;
      if (isObj(e) && typeof e.at === 'string' && typeof e.type === 'string') out.push(e as StructureEvent);
    } catch { /* a malformed line is skipped, the log stays readable */ }
  }
  // the log SHOULD be in time order; a stable sort makes replay correct when it is not
  return out.map((e, i) => [e, i] as const).sort((a, b) => (a[0].at < b[0].at ? -1 : a[0].at > b[0].at ? 1 : a[1] - b[1])).map((x) => x[0]);
}

/** Parses the session toggle: `-id` disables, `+id` (or a bare id) enables. Unknown ids are ignored. */
export function parseLensToggle(raw: string | null | undefined): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!raw) return out;
  for (const tok of raw.split(',')) {
    const t = tok.trim();
    if (!t) continue;
    if (t[0] === '-') out.set(t.slice(1).trim(), false);
    else out.set((t[0] === '+' ? t.slice(1) : t).trim(), true);
  }
  return out;
}

function lensDef(e: LensEntry, i: number): LensDef {
  const m = e.manifest;
  const F: Record<string, LensField> = {};
  for (const f of m.fields) F[f.key] = f;
  const evidence = (m.presentation.evidence ?? []).map((k) => F[k]).filter((f): f is LensField => !!f);
  const headline = m.fields.find((f) => f.headline) ?? evidence[0] ?? m.fields.find((f) => !f.source) ?? m.fields[0] ?? null;
  const g = m.presentation.glyph;
  const glyph = typeof g === 'string' ? (GLYPHS.includes(g) ? g : null) : isObj(g) && typeof g.path === 'string' && PATH_OK.test(g.path) ? { path: g.path } : null;
  return {
    id: e.id, i, source: e.source, manifest: m, name: m.name, short: m.short ?? m.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase(),
    description: m.description ?? '', role: m.reader.role ?? '', density: m.reader.density, fields: m.fields, F, headline,
    evidence: evidence.length ? evidence : headline ? [headline] : [], measures: m.presentation.measures ? F[m.presentation.measures] ?? null : null,
    measureMax: undefined, glyph, line: LINES.includes(m.presentation.line) ? m.presentation.line : 'solid', accent: m.presentation.accent ?? null,
    rollup: m.health.rollup,
  };
}

// --------------------------------------------------------------------------------- the base load
interface Base {
  version: 2 | 3;
  project: Structure['project'];
  asOf: string; asOfTime: string;
  entries: LensEntry[];
  defs: LensDef[];
  features: Feature[];
  domains: Domain[]; capabilities: Capability[]; milestones: Milestone[]; kpis: Kpi[];
  people: Person[]; activity: ActivityEvent[]; events: StructureEvent[];
  weeks: string[]; snapshots: Snapshot[];
  /** Built structures by toggle string. */
  byToggle: Map<string, Structure>;
}
const BASES = new WeakMap<object, Map<string | null, Base>>();

/** Reads the map's extensions for sample sidecar data (people, activity, tagline) under any reverse-DNS key. */
function fromExtensions(ext: unknown) {
  const people: Person[] = [], activity: ActivityEvent[] = [];
  let tagline = '';
  if (isObj(ext)) for (const v of Object.values(ext)) {
    if (!isObj(v)) continue;
    if (!tagline && typeof v.tagline === 'string') tagline = v.tagline;
    if (Array.isArray(v.people)) for (const p of v.people) {
      if (!isObj(p) || typeof p.id !== 'string') continue;
      people.push({ id: p.id, name: str(p.name, p.id), kind: p.kind === 'agent' ? 'agent' : 'human', field: str(p.field), title: str(p.title) });
    }
    if (Array.isArray(v.activity)) for (const a of v.activity) {
      if (!isObj(a) || typeof a.at !== 'string') continue;
      activity.push({ at: a.at, type: str(a.type), feature: str(a.feature), actor: str(a.actor), text: str(a.text), from: typeof a.from === 'string' ? a.from : undefined, to: typeof a.to === 'string' ? a.to : undefined, severity: typeof a.severity === 'string' ? a.severity : undefined });
    }
  }
  return { people, activity, tagline };
}

/** v2 `use_cases[]` (or a v3 map's stand-in) as features: slug, name, kind, tier, status and context links; no stage. */
function fromUseCases(ucs: unknown[]): V3Feature[] {
  const seen = new Set<string>();
  return ucs.filter(isObj).map((u, i) => {
    let slug = typeof u.slug === 'string' ? u.slug : slugify(str(u.name, str(u.id, 'feature-' + (i + 1))));
    while (seen.has(slug)) slug += '-' + (i + 1);
    seen.add(slug);
    const ctx = strs(u.contexts).concat(strs(u.context_names));
    return {
      slug, name: str(u.name, slug), id: typeof u.id === 'string' ? u.id : undefined, summary: str(u.summary, str(u.description)),
      kind: typeof u.kind === 'string' ? u.kind : undefined, tier: typeof u.tier === 'string' ? u.tier : undefined,
      status: u.status === 'archived' ? 'archived' : u.status === 'active' ? 'active' : undefined, contexts: ctx,
    } as V3Feature;
  });
}

function buildBase(raw: unknown, eventsText: string | null, opts: LoadOptions): Base {
  if (!isObj(raw)) throw new Error('app-structure: the map is not an object');
  const v3 = raw.$schema === 'app-structure/3';
  if (!v3 && raw.version !== 2 && !Array.isArray(raw.use_cases)) throw new Error('app-structure: neither a v3 map ($schema app-structure/3) nor a v2 map');
  const map = raw as AppStructure & { use_cases?: unknown[] };
  const events = parseEvents(eventsText);
  const asOfTime = str(map.generated_at) || (events.length ? events[events.length - 1].at : new Date().toISOString());
  const asOf = asOfTime.slice(0, 10);
  const ext = fromExtensions(map.extensions);

  // lenses: the map's entries (v3), or the catalog as available-but-unmeasured (v2)
  const entries: LensEntry[] = v3
    ? (map.lenses ?? []).filter((e) => isObj(e) && isObj(e.manifest) && typeof e.id === 'string')
    : (opts.catalog ?? []).map((m) => ({ id: m.id, version: m.version, source: 'builtin' as const, enabled: true, manifest: m }));
  const defs = entries.map((e) => lensDef(e, -1));

  // features (v3), or the v2 stand-in
  const v3fs: V3Feature[] = v3 && Array.isArray(map.features) ? map.features.filter((f) => isObj(f) && typeof f.slug === 'string') : fromUseCases(map.use_cases ?? []);
  const caps = v3 ? (map.capabilities ?? []) : [];
  const doms = v3 ? (map.domains ?? []) : [];
  const facets = v3 ? (map.facets ?? {}) : {};
  const kpis = v3 ? (map.kpis ?? []) : [];

  // product tree, in declared order; features without a known capability go to an "Unplaced" room
  const byOrder = <T extends { order?: number }>(xs: T[]) => xs.map((x, i) => [x, i] as const).sort((a, b) => (a[0].order ?? 1e9) - (b[0].order ?? 1e9) || a[1] - b[1]).map((x) => x[0]);
  const domains: Domain[] = byOrder(doms).map((d) => ({ id: d.slug, base: d.slug, code: d.id && d.id.length <= 6 ? d.id : '', name: d.name, summary: d.summary ?? '', capabilities: [] }));
  const D: Record<string, Domain> = Object.fromEntries(domains.map((d) => [d.id, d]));
  const capabilities: Capability[] = [];
  const C: Record<string, Capability> = {};
  for (const c of byOrder(caps)) {
    if (!D[c.domain]) continue;
    const cap: Capability = { id: c.slug, base: c.slug, code: c.id && c.id.length <= 8 ? c.id : '', domain: c.domain, name: c.name, features: [] };
    capabilities.push(cap); C[cap.id] = cap; D[c.domain].capabilities.push(cap.id);
  }
  const unplaced = () => {
    if (!C.unplaced) {
      const d: Domain = { id: 'unplaced', base: 'unplaced', code: '', name: 'Unplaced', summary: 'Features not yet placed in the product tree.', capabilities: ['unplaced'] };
      domains.push(d); D.unplaced = d;
      const c: Capability = { id: 'unplaced', base: 'unplaced', code: '', domain: 'unplaced', name: 'Unplaced', features: [] };
      capabilities.push(c); C.unplaced = c;
    }
    return C.unplaced;
  };

  // stage revisions per feature, replayed from the log
  const revs = new Map<string, { stage: Stage; date: string }[]>();
  for (const e of events) {
    if ((e.type !== 'stage' && e.type !== 'feature-added') || typeof e.feature !== 'string' || !isStage(e.to)) continue;
    let r = revs.get(e.feature); if (!r) revs.set(e.feature, (r = []));
    r.push({ stage: e.to, date: e.at.slice(0, 10) });
  }

  const slugs = new Set(v3fs.map((f) => f.slug));
  const features: Feature[] = v3fs.map((f) => {
    const cap = f.capability && C[f.capability] ? C[f.capability] : unplaced();
    const rv = revs.get(f.slug) ?? [];
    const code = typeof f.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,11}$/.test(f.id) ? f.id : '';
    const g: Feature = {
      id: f.slug, slug: f.slug, code, name: f.name, summary: f.summary ?? '', domain: cap.domain, capability: cap.id,
      stage: isStage(f.stage) ? f.stage : null, priority: f.priority ?? null, kind: f.kind ?? '', tier: f.tier ?? '', status: f.status ?? 'active',
      milestone: f.milestone ?? null, surfaces: f.surfaces ?? [], contexts: f.contexts ?? [],
      dependsOn: (f.depends_on ?? []).filter((s) => slugs.has(s)), usedBy: [], blockedBy: (f.blocked_by ?? []).filter((s) => slugs.has(s)),
      revs: rv, stageSince: f.stage_since ?? (rv.length ? rv[rv.length - 1].date : ''), created: f.created ?? (rv.length ? rv[0].date : asOf),
      owner: f.owner ?? '', builtBy: f.built_by ?? [], parts: f.parts ?? null, notes: f.notes ?? [],
      tags: strs(f.tags), experience: str(f.experience), core: isObj(f.core) ? { tech: strs(f.core.tech), schema: strs(f.core.schema) } : null,
      variations: variationsOf(f.variations), lens: {}, health: 'unmeasured', trouble: [],
    };
    cap.features.push(g.id);
    return g;
  });
  const F: Record<string, Feature> = Object.fromEntries(features.map((f) => [f.id, f]));
  for (const f of features) for (const d of f.dependsOn) F[d].usedBy.push(f.id);

  // health per feature and lens: once, here (spec 8.4), with the feature as context for bound fields
  const SRC: Record<string, V3Feature> = Object.fromEntries(v3fs.map((x) => [x.slug, x]));
  for (const f of features) {
    const fx = SRC[f.slug];
    const feature: EvalContext['feature'] = {};
    for (const k of FEATURE_BOUND_FIELDS) if (fx[k] !== undefined) (feature as Record<string, unknown>)[k] = fx[k];
    const ctx: EvalContext = { feature, kpis };
    const out: Record<string, FeatureLens> = {};
    for (const d of defs) {
      const facet = (facets[f.slug]?.[d.id] ?? null) as Facet | null;
      const h = lensHealth(d.manifest, facet ?? undefined, asOf, ctx);
      const v = bindValues(d.manifest, facet?.values, ctx);
      const why = explain(d.manifest, facet ?? undefined, ctx);
      const short = why !== null ? explain(d.manifest, facet ?? undefined, ctx, 'short') : null;
      const rule: HealthRule | null = why !== null ? matchRule(d.manifest, v) : null;
      const o = facet?.override;
      const ov = o && asOf <= o.until && h === o.health ? o : null;
      out[d.id] = { h, v, why, short, whyFields: rule ? conditionFields(rule.when) : [], ov, facet };
    }
    f.lens = out;
  }
  // the line's scale for numeric measures without a max: the largest value in the map
  for (const d of defs) {
    const m = d.measures;
    if (!m || m.type === 'enum' || m.type === 'percent' || m.max !== undefined) continue;
    let mx = 0;
    for (const f of features) { const x = f.lens[d.id].v[m.key]; if (typeof x === 'number' && x > mx) mx = x; }
    d.measureMax = mx > 0 ? mx : undefined;
  }

  // milestones, people, activity
  const milestones: Milestone[] = (v3 ? map.milestones ?? [] : []).map((m) => ({
    id: m.slug, code: m.id && m.id.length <= 6 ? m.id : '', name: m.name, date: m.target_date ?? '', state: m.status === 'shipped' ? 'done' : m.status, goal: m.goal ?? '',
  }));
  const people = ext.people.slice();
  const known = new Set(people.map((p) => p.id));
  const addActor = (id: string) => { if (id && !known.has(id)) { known.add(id); people.push({ id, name: id, kind: 'human', field: '', title: '' }); } };
  for (const f of features) { addActor(f.owner); f.builtBy.forEach(addActor); f.notes.forEach((n) => addActor(n.by)); }
  let activity = ext.activity.slice();
  if (!activity.length) {
    activity = events.filter((e) => typeof e.feature === 'string').map((e) => ({
      at: e.at, type: e.type, feature: e.feature as string, actor: str(e.actor),
      text: e.type === 'stage' ? 'stage ' + str(e.from) + ' → ' + str(e.to) : e.type === 'lens-health' ? str(e.lens) + ' ' + str(e.from) + ' → ' + str(e.to) : e.type.replace(/-/g, ' '),
      from: typeof e.from === 'string' ? e.from : undefined, to: typeof e.to === 'string' ? e.to : undefined,
    }));
  }
  activity.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // weekly snapshots by replay: a feature's stage on a date is its last revision at or before it
  const nW = Math.max(1, opts.weeks ?? 27);
  let w0 = addDays(asOf, -7 * (nW - 1));
  const first = events.length ? events[0].at.slice(0, 10) : asOf;
  while (w0 < first && w0 < asOf) w0 = addDays(w0, 7);
  const weeks: string[] = [];
  for (let w = w0; w <= asOf; w = addDays(w, 7)) weeks.push(w);
  if (weeks[weeks.length - 1] !== asOf) weeks.push(asOf);
  const snapshots: Snapshot[] = weeks.map((week) => {
    const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
    let total = 0;
    for (const f of features) {
      let s: Stage | null = null;
      for (const r of f.revs) { if (r.date > week) break; s = r.stage; }
      if (week >= asOf && f.stage) s = f.stage;
      if (s) { counts[s]++; total++; }
    }
    return { week, counts, total };
  });

  return {
    version: v3 ? 3 : 2,
    project: { slug: str(map.project?.slug, 'project'), name: str(map.project?.name, 'Project'), tagline: ext.tagline || str(map.project?.description) },
    asOf, asOfTime, entries, defs, features, domains, capabilities, milestones, kpis, people, activity, events, weeks, snapshots,
    byToggle: new Map(),
  };
}

/** The registry for a toggle: enabled entries in file order, re-indexed; General health and trouble follow it. */
function withToggle(b: Base, toggle: string | null): Structure {
  const key = toggle ?? '';
  const hit = b.byToggle.get(key);
  if (hit) return hit;
  const t = parseLensToggle(toggle);
  // defs are per base; the registry indexes are per toggle, so each toggle gets its own copies
  const all = b.defs.map((d) => ({ ...d, i: -1 }));
  const lenses: LensDef[] = [];
  b.entries.forEach((e, k) => { if (t.get(e.id) ?? e.enabled) { all[k].i = lenses.length; lenses.push(all[k]); } });
  const ids = lenses.map((l) => l.id);
  const features = b.features.map((f) => {
    const trouble: Trouble[] = [];
    for (const id of ids) {
      const fl = f.lens[id];
      if (fl.h === 'bad' || fl.h === 'watch') trouble.push({ lens: id, h: fl.h, why: fl.ov ? fl.ov.why : fl.why ?? (b.defs.find((d) => d.id === id)!.name + ': ' + fl.h), short: fl.ov ? null : fl.short });
    }
    trouble.sort((a, c) => (a.h === c.h ? 0 : a.h === 'bad' ? -1 : 1));
    return { ...f, health: generalHealth(ids.map((id) => f.lens[id].h)), trouble };
  });
  const s: Structure = {
    version: b.version, project: b.project, asOf: b.asOf, asOfTime: b.asOfTime, lenses, allLenses: all,
    LENS: Object.fromEntries(all.map((d) => [d.id, d])), features, domains: b.domains, capabilities: b.capabilities, milestones: b.milestones,
    kpis: b.kpis, people: b.people, activity: b.activity, events: b.events, weeks: b.weeks, snapshots: b.snapshots,
  };
  b.byToggle.set(key, s);
  return s;
}

/**
 * Loads a context map (v3, or v2 per spec 11) and its events log into the app's model. Cached per map
 * object and events text: the health of every feature under every lens is computed once per data load.
 */
export function loadStructure(raw: unknown, eventsText: string | null, opts: LoadOptions = {}): Structure {
  const k = isObj(raw) ? raw : {};
  let per = BASES.get(k);
  if (!per) BASES.set(k, (per = new Map()));
  let b = per.get(eventsText);
  if (!b) { b = buildBase(raw, eventsText, opts); per.set(eventsText, b); }
  return withToggle(b, opts.lenses ?? null);
}

/** A feature's value for a lens field (bound fields filled in), or undefined. */
export function fval(f: Feature, lens: string, key: string): Scalar | undefined {
  return f.lens[lens]?.v[key];
}
