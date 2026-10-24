// The "?" rule, once: which features the plan lays the "not scanned yet" texture over. The plan's lensVerdict reads it
// per tile per raster (so the predicate allocates nothing), and the legend's "?" row counts and acts on the same set.
//   General (lens null): no enabled lens has measured the feature and at least one has not (all `na` is not "?").
//   A lens view:         that lens's health is `unmeasured` (an `na` feature fades instead; it is not "?").
// Lens ids are data here: nothing branches on one.
import type { Feature } from '@bp/core/data';

/** True when no lens among `ids` measured `f` and at least one did not (`na` neither measures nor counts). */
export function unscannedGeneral(f: Feature, ids: readonly string[]): boolean {
  let unknown = false;
  for (let i = 0; i < ids.length; i++) {
    const h = f.lens[ids[i]]?.h ?? 'unmeasured';
    if (h === 'unmeasured') unknown = true; else if (h !== 'na') return false;
  }
  return unknown;
}

/** True when `lens` has not measured `f` (no facet, or `unmeasured`). */
export function unscannedUnder(f: Feature, lens: string): boolean { return (f.lens[lens]?.h ?? 'unmeasured') === 'unmeasured'; }

/** One feature under General (`lens` null) or a lens. */
export function isUnscanned(f: Feature, ids: readonly string[], lens: string | null): boolean {
  return lens === null ? unscannedGeneral(f, ids) : unscannedUnder(f, lens);
}

/** The features the plan draws a "?" over, in `fs` order. */
export function unscanned<F extends Feature>(fs: readonly F[], ids: readonly string[], lens: string | null): F[] {
  return fs.filter((f) => isUnscanned(f, ids, lens));
}
