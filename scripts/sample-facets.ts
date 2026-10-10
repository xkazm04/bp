// The producer reference for the Kettle sample: how one sample lens object (src/data/kettle.json) becomes a
// v3 facet. Shared by scripts/check-builtin-health.ts (rules vs the stored health) and
// scripts/kettle-to-v3.ts (the converter), so the two can never flatten differently.
//
// It writes only what the lens object says and omits unknown values instead of writing null. It never writes
// the feature's stage or priority into a facet: the manifests bind those fields to the feature
// (`source: { feature }`). The one producer-side applicability: design "n/a" means the feature has no screen.
import type { Facet, FacetValues, Health, Scalar } from '../src/lib/standard/types.ts';

export type LensObject = Record<string, unknown> & { health: Health };

/** Copies scalar values, dropping null/undefined (an unknown value is omitted, never null). */
export function scalars(o: Record<string, unknown>, skip: string[] = []): FacetValues {
  const out: FacetValues = {};
  for (const [k, v] of Object.entries(o)) {
    if (skip.includes(k) || k === 'health') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v as Scalar;
  }
  return out;
}

/** Sample lens object -> facet, per built-in lens. Nested values are flattened; "n/a" values are omitted. */
export const FLATTEN: Record<string, (o: LensObject) => Facet> = {
  business: (o) => ({ values: scalars(o) }),
  // "n/a" design means the feature has no screen at all: a fact no design value carries, so the producer says it.
  design: (o) => (o.status === 'n/a' ? { applicable: false } : { values: scalars(o) }),
  development: (o) => ({ values: scalars(o) }),
  operations: (o) => {
    const flag = o.flag as { key: string; rolloutPct: number } | null;
    const values = scalars(o, ['flag']);
    if (flag) { values.flagKey = flag.key; values.rolloutPct = flag.rolloutPct; }
    else if (o.environment === 'production') values.rolloutPct = 100;
    return { values };
  },
  security: (o) => ({ values: scalars(o) }),
  quality: (o) => {
    const b = o.openBugs as { p1: number; p2: number; p3: number };
    const values = scalars(o, ['openBugs']);
    if (o.status === 'n/a') delete values.status; // "nothing to test yet": not a status, so omitted
    values.openBugsP1 = b.p1; values.openBugsP2 = b.p2; values.openBugsP3 = b.p3;
    const tests = o.e2eTests as number;
    if (tests > 0) values.e2ePassPct = Math.round(((o.e2ePassing as number) / tests) * 100);
    return { values };
  },
};
