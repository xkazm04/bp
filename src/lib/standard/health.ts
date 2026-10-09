// The lens health evaluator: conditions, per-feature health, rollup and explanations. Pure and
// dependency-free (type imports only) so the blueprint, the validator scripts and Node's type
// stripping all run the same code, and a Rust port can follow it line by line. The semantics are
// specified in docs/standard/app-structure-v3.md ("Health").
import type {
  ComputedHealth, Condition, Facet, FacetValues, Feature, FeatureBoundField, Health, HealthRule, Kpi, LensManifest, Scalar,
} from './types.ts';

type Values = Readonly<Record<string, Scalar | null | undefined>>;
type LeafLike = Record<string, unknown> & { field: string };

const OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'missing', 'present'] as const;
type Op = (typeof OPS)[number];
const isOp = (k: string): k is Op => (OPS as readonly string[]).includes(k);

/** The one operator of a leaf, or null when it has none or several (such a leaf never matches). */
function leafOp(leaf: LeafLike): Op | null {
  let op: Op | null = null;
  for (const k in leaf) {
    if (k === 'field') continue;
    if (!isOp(k) || op) return null;
    op = k;
  }
  return op;
}

/** Ordering without coercion: number with number, string with string (ISO dates order correctly). */
function order(v: Scalar, x: unknown): number | null {
  if (typeof v === 'number' && typeof x === 'number') return Number.isNaN(v) || Number.isNaN(x) ? null : v - x;
  if (typeof v === 'string' && typeof x === 'string') return v < x ? -1 : v > x ? 1 : 0;
  return null;
}

/**
 * Evaluates a condition against facet values. An absent value (or a stray null) is "missing": only
 * `missing` matches it, and every comparison, `ne` and `nin` included, is false. No type coercion:
 * 5 never equals "5".
 */
export function evaluateCondition(cond: Condition, values: Values): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, values));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, values));
  if ('not' in cond) return !evaluateCondition(cond.not, values);
  const leaf = cond as unknown as LeafLike;
  const op = leafOp(leaf);
  if (!op) return false;
  const x = leaf[op];
  const raw = Object.prototype.hasOwnProperty.call(values, leaf.field) ? values[leaf.field] : undefined;
  if (raw === undefined || raw === null) return op === 'missing';
  const v: Scalar = raw;
  switch (op) {
    case 'missing': return false;
    case 'present': return true;
    case 'eq': return v === x;
    case 'ne': return v !== x;
    case 'in': return Array.isArray(x) && x.includes(v);
    case 'nin': return Array.isArray(x) && !x.includes(v);
    default: {
      const d = order(v, x);
      if (d === null) return false;
      return op === 'lt' ? d < 0 : op === 'lte' ? d <= 0 : op === 'gt' ? d > 0 : d >= 0;
    }
  }
}

/** Every field a condition names. */
export function conditionFields(cond: Condition, out: string[] = []): string[] {
  if ('all' in cond) cond.all.forEach((c) => conditionFields(c, out));
  else if ('any' in cond) cond.any.forEach((c) => conditionFields(c, out));
  else if ('not' in cond) conditionFields(cond.not, out);
  else out.push((cond as unknown as LeafLike).field);
  return out;
}

/**
 * What a lens's health can read besides the facet: the feature (for `source: { feature }` fields)
 * and the map's KPIs (for `source: { kpi }` fields). A bound field whose source is not given is absent.
 */
export interface EvalContext {
  feature?: Partial<Pick<Feature, FeatureBoundField>>;
  kpis?: readonly Kpi[];
}

interface Compiled {
  /** Rules minus those naming an undeclared field: such a rule never matches. */
  rules: HealthRule[];
  /** null when absent, or when it names an undeclared field (ignored: the lens applies). */
  applies: Condition | null;
  /** Keys of feature-bound fields: never measurements, so they do not make a facet "measured". */
  featureBound: Set<string>;
}
// Health is evaluated per feature and lens whenever data changes; compile each manifest once (which
// rules are usable, which fields are bound) instead of walking its field list once per feature.
const COMPILED = new WeakMap<LensManifest, Compiled>();
function compile(m: LensManifest): Compiled {
  let c = COMPILED.get(m);
  if (!c) {
    const known = new Set(m.fields.map((f) => f.key));
    const usable = (cond: Condition) => conditionFields(cond).every((k) => known.has(k));
    const aw = m.health.applies_when;
    c = {
      rules: m.health.rules.filter((r) => usable(r.when)),
      applies: aw && usable(aw) ? aw : null,
      featureBound: new Set(m.fields.filter((f) => f.source && 'feature' in f.source).map((f) => f.key)),
    };
    COMPILED.set(m, c);
  }
  return c;
}

const isScalar = (v: unknown): v is Scalar => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/**
 * The values health reads: the facet's values with every bound field replaced by its source (a KPI's
 * current value, or the feature's core field). A bound field whose source has no value is absent,
 * whatever the facet stored. Returns a new object.
 */
export function bindValues(manifest: LensManifest, values: FacetValues | undefined, ctx: EvalContext = {}): FacetValues {
  const out: FacetValues = { ...(values ?? {}) };
  for (const f of manifest.fields) {
    const s = f.source;
    if (!s) continue;
    let v: unknown;
    if ('kpi' in s) v = ctx.kpis?.find((k) => k.slug === s.kpi)?.current?.value;
    else v = ctx.feature?.[s.feature];
    if (isScalar(v)) out[f.key] = v; else delete out[f.key];
  }
  return out;
}

/** True when something was measured: any value other than a feature-bound one. */
function measuredValues(values: FacetValues, c: Compiled): boolean {
  for (const k in values) if (!c.featureBound.has(k)) return true;
  return false;
}

/** The first rule that matches bound values, top to bottom; null = none did (the default applies). */
export function matchRule(manifest: LensManifest, values: Values): HealthRule | null {
  for (const r of compile(manifest).rules) if (evaluateCondition(r.when, values)) return r;
  return null;
}

/**
 * One feature's health under one lens. In order:
 *  1. no facet -> unmeasured;
 *  2. `applicable: false` -> na;
 *  3. no measured values and no override -> unmeasured;
 *  4. `applies_when` present and not matching -> na;
 *  5. an override whose `until` (inclusive) is not past -> its health;
 *  6. no measured values (the override has expired) -> unmeasured;
 *  7. the first matching rule, else the manifest's default.
 * `today` is an ISO date or date-time; only its date part is compared.
 */
export function lensHealth(manifest: LensManifest, facet: Facet | undefined, today: string, ctx?: EvalContext): Health {
  if (!facet) return 'unmeasured';
  if (facet.applicable === false) return 'na';
  const c = compile(manifest);
  const values = bindValues(manifest, facet.values, ctx);
  const measured = measuredValues(values, c);
  const o = facet.override;
  if (!measured && !o) return 'unmeasured';
  if (c.applies && !evaluateCondition(c.applies, values)) return 'na';
  if (o && today.slice(0, 10) <= o.until) return o.health;
  if (!measured) return 'unmeasured';
  return matchRule(manifest, values)?.health ?? manifest.health.default;
}

/**
 * The matched rule's reason with `{field}` replaced by the bound value ("unknown" when absent); null
 * when no rule decides the health (no facet, not applicable, nothing measured, or the default).
 * It explains the rules, not an override, which carries its own `why`.
 */
export function explain(manifest: LensManifest, facet: Facet | undefined, ctx?: EvalContext): string | null {
  if (!facet || facet.applicable === false) return null;
  const c = compile(manifest);
  const values = bindValues(manifest, facet.values, ctx);
  if (!measuredValues(values, c) || (c.applies && !evaluateCondition(c.applies, values))) return null;
  const r = matchRule(manifest, values);
  if (!r) return null;
  return r.reason.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, k: string) => {
    const v = Object.prototype.hasOwnProperty.call(values, k) ? values[k] : undefined;
    return v === undefined ? 'unknown' : String(v);
  });
}

/** One feature's input to a rollup: its health, plus its values when the rollup is weighted. */
export type RollupItem = Health | { health: Health; values?: Values };

const SCORE: Record<ComputedHealth, number> = { good: 0, watch: 1, bad: 2 };
const measured = (h: Health): h is ComputedHealth => h === 'good' || h === 'watch' || h === 'bad';

/**
 * The health of a group of features under one lens. Only measured features (good, watch, bad,
 * overrides already applied) count. None measured: `na` if every feature is na, else `unmeasured`.
 * - worst-of: any bad -> bad, any watch -> watch, else good.
 * - share: bad share >= `bad` -> bad; (watch + bad) share >= `watch` -> watch; else good.
 * - weighted: mean score (good 0, watch 1, bad 2) weighted by the `by` field, rounded to the nearest
 *   health; a feature whose weight is absent, non-numeric or not positive weighs 0. If nothing has
 *   weight, it falls back to worst-of.
 */
export function rollupHealth(manifest: LensManifest, items: readonly RollupItem[]): Health {
  const ms: { h: ComputedHealth; values?: Values }[] = [];
  let na = 0;
  for (const it of items) {
    const h = typeof it === 'string' ? it : it.health;
    if (measured(h)) ms.push({ h, values: typeof it === 'string' ? undefined : it.values });
    else if (h === 'na') na++;
  }
  if (!ms.length) return items.length > 0 && na === items.length ? 'na' : 'unmeasured';
  const worst = (): ComputedHealth => (ms.some((m) => m.h === 'bad') ? 'bad' : ms.some((m) => m.h === 'watch') ? 'watch' : 'good');
  const r = manifest.health.rollup;
  switch (r.method) {
    case 'share': {
      const bad = ms.filter((m) => m.h === 'bad').length / ms.length;
      const trouble = ms.filter((m) => m.h !== 'good').length / ms.length;
      return bad >= r.bad ? 'bad' : trouble >= r.watch ? 'watch' : 'good';
    }
    case 'weighted': {
      let sw = 0, s = 0;
      for (const m of ms) {
        const w = m.values?.[r.by];
        if (typeof w !== 'number' || !(w > 0)) continue;
        sw += w; s += w * SCORE[m.h];
      }
      if (sw === 0) return worst();
      const mean = s / sw;
      return mean < 0.5 ? 'good' : mean < 1.5 ? 'watch' : 'bad';
    }
    default:
      return worst();
  }
}
