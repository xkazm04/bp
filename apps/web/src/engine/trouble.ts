// The engine's one index of the features in trouble: overall, per lens (bad and watch members) and the
// per-lens counts the Overview's "Trouble by lens" prints. Flags (render/flags.ts), the counts and the
// trouble route (N / Shift+N) all read it, so they agree.
//
// Why an index with a version and not a cache keyed by the feature list: live readings re-judge health IN
// PLACE (live-health.ts restate assigns a new `trouble` to the same Feature objects; applyScan and
// sim.restamp bump `sim.healthV`), so the list's identity never changes while its members do. The index is
// rebuilt when `healthV` has moved since it was built, on the first read after the move (the frame loop reads
// it every draw, and the engine publishes the version to the store so React re-reads the counts). Rebuilding
// costs features x troubles, once per health change, never per frame.
import type { Feature } from '@bp/core/data';

export interface LensCount { bad: number; watch: number }

export class TroubleIndex {
  private v = NaN;
  private allF: Feature[] = [];
  private byLens = new Map<string, Feature[]>();
  private cnt: Record<string, LensCount> = {};
  private static readonly NONE: readonly Feature[] = [];
  constructor(private readonly features: readonly Feature[], private readonly health: { readonly healthV: number }) {}

  /** The health version the index was last built at (NaN before the first read). */
  get version(): number { return this.v; }

  /** Rebuild if health moved since the last build; true when it rebuilt. */
  sync(): boolean {
    const hv = this.health.healthV;
    if (hv === this.v) return false;
    this.v = hv;
    const all: Feature[] = [], by = new Map<string, Feature[]>(), cnt: Record<string, LensCount> = {};
    for (const f of this.features) {
      if (!f.trouble.length) continue;
      all.push(f);
      for (const t of f.trouble) {
        let l = by.get(t.lens); if (!l) by.set(t.lens, (l = []));
        l.push(f);
        (cnt[t.lens] ??= { bad: 0, watch: 0 })[t.h]++;
      }
    }
    this.allF = all; this.byLens = by; this.cnt = cnt;
    return true;
  }
  /** Every feature with any trouble, in model order. */
  all(): readonly Feature[] { this.sync(); return this.allF; }
  /** The features in trouble (bad or watch) under one lens, in model order. */
  of(lens: string): readonly Feature[] { this.sync(); return this.byLens.get(lens) ?? TroubleIndex.NONE; }
  /** Bad and watch counts per lens id (a lens with none is absent). A new object per rebuild, so it can key a memo. */
  counts(): Readonly<Record<string, LensCount>> { this.sync(); return this.cnt; }
}
