// The lens health evaluator: conditions, per-feature health, rollup and explanations. Pure and
// dependency-free (type imports only) so the blueprint, the validator scripts and Node's type
// stripping all run the same code, and a Rust port can follow it line by line. The semantics are
// specified in docs/standard/app-structure-v3.md ("Health").
import type {
  ComputedHealth, Condition, Facet, FacetValues, Feature, FeatureBoundField, Health, HealthRule, Kpi, LensManifest, Scalar,
} from './types.ts';

type Values = Readonly<Record<string, Scalar | null | undefined>>;
type LeafLike = Record<string, unknown> & { field: string };

/** The condition operators (spec 8.3); the validator reads this list too. */
export const OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'missing', 'present'] as const;
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

/** Every leaf of a condition, in order (the validator checks operands against the field a leaf names). */
export function conditionLeaves(cond: Condition, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if ('all' in cond) cond.all.forEach((c) => conditionLeaves(c, out));
  else if ('any' in cond) cond.any.forEach((c) => conditionLeaves(c, out));
  else if ('not' in cond) conditionLeaves(cond.not, out);
  else out.push(cond as unknown as LeafLike);
  return out;
}

/** Every field a condition names. */
export function conditionFields(cond: Condition): string[] {
  return conditionLeaves(cond).map((l) => l.field as string);
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
  /** Every declared key: a facet value under any other key is not a measurement. */
  declared: Set<string>;
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
      declared: known,
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
  const out: FacetValues = {};
  for (const k in values) if (values[k] !== null && values[k] !== undefined) out[k] = values[k];
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

/** True when something was measured: a present value (null is missing) under a declared, non-feature-bound key. */
function measuredValues(values: FacetValues, c: Compiled): boolean {
  for (const k in values) if (c.declared.has(k) && !c.featureBound.has(k) && isScalar(values[k])) return true;
  return false;
}

/** The first rule that matches bound values, top to bottom; null = none did (the default applies). */
export function matchRule(manifest: LensManifest, values: Values): HealthRule | null {
  for (const r of compile(manifest).rules) if (evaluateCondition(r.when, values)) return r;
  return null;
}

/** One evaluation of a feature under a lens: its health, the rule that matched (if any) and the bound values. */
export interface LensEval { health: Health; rule: HealthRule | null; values: FacetValues }

/**
 * One feature's health under one lens, evaluated once: binding and `applies_when` run a single time and
 * the matched rule comes back with the health. In order:
 *  1. no facet -> unmeasured;
 *  2. `applicable: false` -> na;
 *  3. no measured values and no override -> unmeasured;
 *  4. `applies_when` present and not matching -> na;
 *  5. an override whose `until` (inclusive) is not past -> its health;
 *  6. no measured values (the override has expired) -> unmeasured;
 *  7. the first matching rule, else the manifest's default.
 * `rule` is the first matching rule whenever the facet is measured and the lens applies, even when an
 * override decides the health (like `explain`, it explains the rules, not the override); null otherwise
 * and when only the default applies. `today` is an ISO date or date-time; only its date part is compared.
 */
export function evaluateLens(manifest: LensManifest, facet: Facet | undefined, today: string, ctx?: EvalContext): LensEval {
  const values = bindValues(manifest, facet?.values, ctx);
  if (!facet) return { health: 'unmeasured', rule: null, values };
  if (facet.applicable === false) return { health: 'na', rule: null, values };
  const c = compile(manifest);
  const measured = measuredValues(values, c);
  const o = facet.override;
  if (!measured && !o) return { health: 'unmeasured', rule: null, values };
  if (c.applies && !evaluateCondition(c.applies, values)) return { health: 'na', rule: null, values };
  const rule = measured ? matchRule(manifest, values) : null;
  if (o && today.slice(0, 10) <= o.until) return { health: o.health, rule, values };
  if (!measured) return { health: 'unmeasured', rule: null, values };
  return { health: rule?.health ?? manifest.health.default, rule, values };
}

/** One feature's health under one lens (see `evaluateLens`). */
export function lensHealth(manifest: LensManifest, facet: Facet | undefined, today: string, ctx?: EvalContext): Health {
  return evaluateLens(manifest, facet, today, ctx).health;
}

/**
 * The rule that decides the health, with the bound values it was matched against; null when no rule
 * decides (no facet, not applicable, nothing measured, `applies_when` not matching, or the default).
 * Like `explain`, it ignores an override. A reader that also needs the health calls `evaluateLens`.
 */
export function decidingRule(manifest: LensManifest, facet: Facet | undefined, ctx?: EvalContext): { rule: HealthRule; values: FacetValues } | null {
  const e = evaluateLens(manifest, facet, '', ctx);
  return e.rule ? { rule: e.rule, values: e.values } : null;
}

/** A reason (or short reason) with `{field}` replaced by the bound value, or `unknown` when absent. */
export function fillReason(text: string, values: Values): string {
  return text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, k: string) => {
    const v = Object.prototype.hasOwnProperty.call(values, k) ? values[k] : undefined;
    return v === undefined || v === null ? 'unknown' : String(v);
  });
}

/**
 * The matched rule's reason with `{field}` replaced by the bound value ("unknown" when absent);
 * `form: 'short'` gives the rule's `short` (null when it has none). Null when no rule decides the
 * health (see `decidingRule`). It explains the rules, not an override, which carries its own `why`.
 */
export function explain(manifest: LensManifest, facet: Facet | undefined, ctx?: EvalContext, form: 'full' | 'short' = 'full'): string | null {
  const d = decidingRule(manifest, facet, ctx);
  if (!d) return null;
  const text = form === 'short' ? d.rule.short : d.rule.reason;
  return text === undefined ? null : fillReason(text, d.values);
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
      // A share rollup needs both thresholds (lens-manifest-1.schema.json requires them), but a map carries its
      // own copy of each manifest and nothing re-validates that at load: without them every comparison below is
      // false and a group of `bad` features rolled up to `good`. Fall back to worst-of, as `weighted` already
      // does when nothing it can weigh has a weight.
      if (!Number.isFinite(r.bad) || !Number.isFinite(r.watch)) return worst();
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
