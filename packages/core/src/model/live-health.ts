// A live product's readings between map refreshes. The skill writes each metric's latest value back into the
// map's facets (spec 15), but the page holds the map it loaded; the scan stream brings newer readings first.
// `LiveFacets.apply` lays the latest reading of each metric over the load-time facet value and re-evaluates
// health with the standard evaluator, for the (feature, lens) pairs a scan delta touched and nothing else, so
// the canvas (tile health), the sheet's headline (`sim.liveValue`) and its metric rows say the same. Pure
// and React-free; the model's Feature objects are updated in place (identity, layout and caches stay).
import type { Feature, FeatureLens } from '@bp/core/data';
import type { EvalContext } from '@bp/core/standard/health';
import { readLens, troubleOf } from '@bp/core/standard/load';
import { NUMERIC } from '@bp/core/standard/present';
import type { Facet, FacetValues, FeatureBoundField } from '@bp/core/standard/types';
import type { Measurement, ScanSnapshot } from '@bp/core/scan/types';
import { isCurrent } from '@bp/core/scan/derive';
import type { AggCache } from './aggregates';
import { lineSuffix, type Product } from './product';

const SEP = '\u0000';
const at = (s: string | undefined): number => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : NaN; };

/** Every model object of a base feature: itself, and its clone in each product line at `?scale` > 1. */
export function lineCopies(P: Product, baseId: string): Feature[] {
  const out: Feature[] = [];
  for (let b = 0; b < P.scale; b++) { const f = P.F[baseId + lineSuffix(P.scale, b)]; if (f) out.push(f); }
  return out;
}

/** A feature's General health and trouble list from its lens healths (the loader's rule, for the enabled lenses). */
export function restate(P: Product, f: Feature): void {
  Object.assign(f, troubleOf(P.lenses, (id) => f.lens[id]));
}

export class LiveFacets {
  /** The reading in force per feature + lens, by metric. */
  private pairs = new Map<string, Map<string, Measurement>>();
  /** The map's own facet of each pair that holds a reading or a not-applicable mark: what it falls back to. */
  private orig = new Map<string, Facet | null>();
  /** Pairs a scan judged out of the lens's reach (a temporary lens's "no impact"): read with `applicable: false`, so health is `na`. */
  private na = new Set<string>();
  private base = new Map<string, Feature>();
  private tbl: readonly Measurement[] | null = null;
  private seen = 0;
  private lastId = -1;
  constructor(private P: Product, private agg: AggCache) { this.index(); }
  private index() { this.base = new Map(this.P.base.features.map((f) => [f.id, f])); }

  /** Forget every reading taken (the map was replaced: its facets are the new baseline). */
  reset() { this.pairs.clear(); this.orig.clear(); this.na.clear(); this.tbl = null; this.seen = 0; this.lastId = -1; this.index(); }

  /**
   * Mark (feature, lens) pairs not applicable, in place: the lens is re-read with `applicable: false` (health `na`,
   * so the tile fades in that lens and carries no flag), and General health and trouble follow. Pairs already marked,
   * unknown features and unknown lenses are skipped. Returns the base ids it changed.
   */
  setNa(pairs: Iterable<readonly [feature: string, lens: string]>): string[] {
    const dirty = new Set<string>();
    for (const [feature, lens] of pairs) {
      const k = feature + SEP + lens, f = this.base.get(feature);
      if (this.na.has(k) || !f || !f.lens[lens] || !this.P.LENS[lens]) continue;
      this.na.add(k);
      if (!this.orig.has(k)) this.orig.set(k, f.lens[lens].facet);
      dirty.add(k);
    }
    return this.restamp(dirty);
  }

  /**
   * Put every touched pair back to the map's own facet (readings and not-applicable marks dropped) and forget them.
   * The Kettle sample's features are the loader's cached objects, so a model that is torn down restores them here.
   */
  restore(): string[] {
    const dirty = new Set<string>([...this.pairs.keys(), ...this.na]);
    this.pairs.clear(); this.na.clear(); this.tbl = null; this.seen = 0; this.lastId = -1;
    return this.restamp(dirty);
  }

  /**
   * Take the measurements a scan carries that this has not seen (the table only grows: rows past the ones taken)
   * and bring the touched features' lenses, health and trouble up to date. Returns the base ids it changed.
   * A table that shrank or no longer starts with the rows taken (a new store) is read again from the top.
   */
  apply(scan: ScanSnapshot): string[] {
    const ms = scan.measurements;
    if (ms === this.tbl) return [];
    const dirty = new Set<string>();
    if (this.tbl && (ms.length < this.seen || (this.seen > 0 && ms[this.seen - 1]?.id !== this.lastId))) {
      for (const k of this.pairs.keys()) dirty.add(k);
      this.pairs.clear(); this.seen = 0;
    }
    for (let i = this.seen; i < ms.length; i++) { const k = this.take(ms[i]); if (k) dirty.add(k); }
    this.tbl = ms; this.seen = ms.length; this.lastId = ms[ms.length - 1]?.id ?? -1;
    return this.restamp(dirty);
  }

  /** Lay one reading over its facet value when it is newer than the facet and fits the field; the pair's key, or null. */
  private take(m: Measurement): string | null {
    const f = this.base.get(m.feature), def = this.P.LENS[m.lens];
    if (!f || !def || !isCurrent(m)) return null; // a pack's `after` reading is not the product's state
    const fl = f.lens[m.lens], field = def.manifest.fields.find((x) => x.key === m.metric);
    if (!fl || !field || field.source || !NUMERIC.has(field.type) || typeof m.value !== 'number') return null;
    const k = m.feature + SEP + m.lens, held = this.pairs.get(k)?.get(m.metric);
    const have = fl.facet?.values?.[m.metric];
    if (have !== undefined && have !== null && typeof have !== 'number') return null;
    const fm = at(fl.facet?.measured_at), mm = at(m.measured_at);
    if (!held && fm > mm) return null; // the map's own value is the newer one
    if (held && at(held.measured_at) > mm) return null;
    let p = this.pairs.get(k);
    if (!p) { this.pairs.set(k, (p = new Map())); if (!this.orig.has(k)) this.orig.set(k, fl.facet); }
    p.set(m.metric, m);
    return k;
  }

  private restamp(dirty: Set<string>): string[] {
    const ids = new Set<string>();
    for (const k of dirty) {
      const [feature, lens] = k.split(SEP);
      const f = this.base.get(feature);
      if (!f) continue;
      (f.lens as Record<string, FeatureLens>)[lens] = this.evaluate(f, lens, this.orig.get(k) ?? null, this.pairs.get(k));
      if (!this.pairs.get(k)?.size && !this.na.has(k)) this.orig.delete(k);
      ids.add(feature);
    }
    for (const id of ids) for (const c of lineCopies(this.P, id)) restate(this.P, c);
    if (ids.size) this.agg.clear();
    return [...ids];
  }

  /** The lens re-evaluated with the readings laid over its facet (the loader's evaluation, same inputs). */
  private evaluate(f: Feature, lens: string, own: Facet | null, readings: Map<string, Measurement> | undefined): FeatureLens {
    const P = this.P, def = P.LENS[lens], prev = f.lens[lens];
    const values: FacetValues = { ...own?.values };
    if (readings) for (const [k, m] of readings) values[k] = m.value;
    const facet: Facet = { ...own, values };
    if (this.na.has(f.id + SEP + lens)) facet.applicable = false;
    // bound fields keep the values the loader bound (the feature's own fields; KPIs come from the map)
    const feature: Record<string, unknown> = {};
    for (const x of def.manifest.fields) if (x.source && 'feature' in x.source && prev.v[x.key] !== undefined) feature[x.source.feature as FeatureBoundField] = prev.v[x.key];
    const ctx: EvalContext = { feature: feature as EvalContext['feature'], kpis: P.base.kpis };
    return readLens(def, facet, P.base.asOf, ctx);
  }
}
