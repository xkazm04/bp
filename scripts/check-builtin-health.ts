// Checks the six built-in lens manifests against the Kettle sample: flattens each feature's lens
// objects into facet values, runs the declarative rules, and compares with the health the sample
// generator stored. Run: node scripts/check-builtin-health.ts  (Node's type stripping; no build step)
//
// The flattening below stands in for a producer (a scan, a person): it writes only what the lens
// object says and omits unknown values instead of writing null. It never writes the feature's stage
// or priority into a facet: the manifests bind those fields to the feature (`source: { feature }`),
// and the feature is handed to the evaluator. When a lens applies is the manifests' `applies_when`;
// the producer marks `applicable: false` only for a fact the lens values cannot carry (see design).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explain, lensHealth } from '../src/lib/standard/health.ts';
import type { Facet, FacetValues, Feature, Health, LensManifest, Scalar } from '../src/lib/standard/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

type LensObject = Record<string, unknown> & { health: Health };
interface SampleFeature { id: string; name: string; stage: string; priority: string; kind: string; milestone: string | null; [lens: string]: unknown }
const kettle = read('src/data/kettle.json') as { product: { asOf: string }; features: SampleFeature[] };
const IDS = ['business', 'design', 'development', 'operations', 'security', 'quality'];
const manifests = IDS.map((id) => read(`docs/standard/lenses/${id}.json`) as LensManifest);

/** Copies scalar values, dropping null/undefined (an unknown value is omitted, never null). */
function scalars(o: Record<string, unknown>, skip: string[] = []): FacetValues {
  const out: FacetValues = {};
  for (const [k, v] of Object.entries(o)) {
    if (skip.includes(k) || k === 'health') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v as Scalar;
  }
  return out;
}

/** Sample lens object -> facet. Nested values are flattened; "n/a" values are omitted. */
const FLATTEN: Record<string, (o: LensObject) => Facet> = {
  business: (o) => ({ values: scalars(o) }),
  // The one producer-side applicability left: "n/a" design means the feature has no screen at all.
  // That is a fact about the feature that no design value carries, so the producer says it directly.
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

/** The lowest per-lens agreement the run accepts; below it the run exits 1. */
const TARGET = 0.95;
const today = kettle.product.asOf.slice(0, 10);
const n = kettle.features.length;
let worst = 1;
for (const m of manifests) {
  const misses: string[] = [];
  let agree = 0;
  for (const f of kettle.features) {
    const o = f[m.id] as LensObject;
    const facet = FLATTEN[m.id](o);
    // the core fields a manifest may bind to; the sample has no tier or status
    const ctx = { feature: { stage: f.stage, priority: f.priority, kind: f.kind, ...(f.milestone ? { milestone: f.milestone } : {}) } as Partial<Feature> };
    const got = lensHealth(m, facet, today, ctx);
    if (got === o.health) { agree++; continue; }
    misses.push(`${f.id.padEnd(7)} ${f.stage.padEnd(10)} stored ${o.health.padEnd(5)} rules ${got.padEnd(5)} ${explain(m, facet, ctx) ?? '(default)'}  — ${f.name}`);
  }
  worst = Math.min(worst, agree / n);
  console.log(`${m.id.padEnd(12)} ${String(agree).padStart(3)} / ${n}  ${((agree / n) * 100).toFixed(1)}%`);
  for (const line of misses) console.log(`    ${line}`);
}
console.log(`\nlowest agreement ${(worst * 100).toFixed(1)}% (target >= ${TARGET * 100}%)`);
// This is a gate (`npm run check:lens-health`): a lens under the target must fail the run, not just print.
if (worst < TARGET) {
  console.error(`FAIL: lowest agreement is under the ${TARGET * 100}% target`);
  process.exit(1);
}
