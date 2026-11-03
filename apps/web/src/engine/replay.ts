// Lens health on a travelled date, for drawing it: the plan's trouble marks and flags on a past date read this, never
// the live model (which speaks of now). It is core's replayTable (packages/core/src/model/timeview.ts): today's rules
// over the readings in force on that date, only for pairs whose every rule input was read by then. A pair that is not
// replayable is absent, so it draws nothing (not recorded), never good and never today's health. The fill stays the
// stage (stageAt); this changes only the marks and flags.
//
// Rebuilt on a discrete change (the travelled date, the scan table), never per frame: the frame loop and the raster
// read `row()` / `troubled`, which allocate nothing.
import type { Feature, Health, LensDef } from '@bp/core/data';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { generalHealth } from '@bp/core/standard/present';
import { replayTable } from '@bp/core/model/timeview';
import { GENERAL } from '@bp/core/data/types';

export interface PastTrouble { lens: string; h: 'bad' | 'watch' }
/** One feature's replayed lenses on the date: health per replayed lens, General over them, and its bad / watch list. */
export interface PastRow { f: Feature; lens: ReadonlyMap<string, Health>; health: Health; trouble: PastTrouble[] }

export class ReplayIndex {
  private t = ''; private scan: ScanSnapshot | undefined | null = null; private built = false;
  private byId = new Map<string, PastRow>();
  /** Features with a replayed bad or watch lens, in model order (what the flags walk). */
  troubled: PastRow[] = [];
  /** Replayed (feature, lens) pairs on the date: 0 at now, or when nothing could be replayed. */
  pairs = 0;
  /** Moves on every rebuild (the static raster's content key reads it). */
  version = 0;
  constructor(private readonly features: readonly Feature[], private readonly lenses: readonly LensDef[]) {}

  /** Rebuild for (t, scan) unless that is what it holds; true when it rebuilt. At or after `asOf` it holds nothing. */
  sync(t: string, asOf: string, scan: ScanSnapshot | undefined): boolean {
    if (this.built && t === this.t && scan === this.scan) return false;
    this.built = true; this.t = t; this.scan = scan; this.version++;
    const by = new Map<string, PastRow>(), troubled: PastRow[] = [];
    let pairs = 0;
    const tbl = replayTable(this.features, this.lenses, scan, t, asOf);
    if (tbl) for (const f of this.features) {
      const lens = tbl.get(f.id); if (!lens) continue;
      pairs += lens.size;
      const trouble: PastTrouble[] = [];
      for (const d of this.lenses) { const h = lens.get(d.id); if (h === 'bad' || h === 'watch') trouble.push({ lens: d.id, h }); }
      trouble.sort((a, c) => (a.h === c.h ? 0 : a.h === 'bad' ? -1 : 1));
      const row: PastRow = { f, lens, health: generalHealth(lens.values()), trouble };
      by.set(f.id, row);
      if (trouble.length) troubled.push(row);
    }
    this.byId = by; this.troubled = troubled; this.pairs = pairs;
    return true;
  }
  /** A feature's replayed row on the date, or null (nothing replayable: draw no health). */
  row(id: string): PastRow | null { return this.byId.get(id) ?? null; }
  /** A replayed health under a view (General: the worst replayed lens); 'unmeasured' where that lens is not replayed. */
  healthUnder(r: PastRow, view: string): Health { return view === GENERAL ? r.health : r.lens.get(view) ?? 'unmeasured'; }
}
