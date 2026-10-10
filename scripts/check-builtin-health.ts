// Checks the six built-in lens manifests against the Kettle sample: flattens each feature's lens
// objects into facet values, runs the declarative rules, and compares with the health the sample
// generator stored. Run: node scripts/check-builtin-health.ts  (Node's type stripping; no build step)
//
// The flattening (scripts/sample-facets.ts, shared with the converter) stands in for a producer (a scan,
// a person): it writes only what the lens object says and omits unknown values instead of writing null.
// It never writes the feature's stage or priority into a facet: the manifests bind those fields to the
// feature (`source: { feature }`), and the feature is handed to the evaluator. When a lens applies is
// the manifests' `applies_when`; the producer marks `applicable: false` only for a fact the lens values
// cannot carry (see design).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explain, lensHealth } from '../src/lib/standard/health.ts';
import { BUILTIN_LENSES } from '../src/lib/standard/catalog.ts';
import type { Feature, LensManifest } from '../src/lib/standard/types.ts';
import { FLATTEN, type LensObject } from './sample-facets.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

interface SampleFeature { id: string; name: string; stage: string; priority: string; kind: string; milestone: string | null; [lens: string]: unknown }
const kettle = read('src/data/kettle.json') as { product: { asOf: string }; features: SampleFeature[] };
const manifests: readonly LensManifest[] = BUILTIN_LENSES;

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
