// Temporary lenses of the Kettle sample, kept in this browser (a live product keeps them in its map,
// through the lens routes). Every read and write is wrapped: storage can be absent or refuse.
import type { LensEntry } from '@/lib/standard/types';

export const TEMP_LENS_KEY = 'bp.tmpLenses.kettle';

/** The stored temporary lens entries (enabled or retired). [] when storage is empty, absent or unreadable. */
export function readTempLenses(): LensEntry[] { return []; }

/** Add one (id must be new). Notifies subscribers. */
export function addTempLens(entry: LensEntry): void { void entry; throw new Error('temp-lens: not built yet (WP6)'); }
/** Retire (false) or restore (true). */
export function setTempLensEnabled(id: string, enabled: boolean): void { void id; void enabled; throw new Error('temp-lens: not built yet (WP6)'); }
export function deleteTempLens(id: string): void { void id; throw new Error('temp-lens: not built yet (WP6)'); }

/** Called after any change in this tab or another (storage event). Returns the unsubscribe. */
export function subscribeTempLenses(fn: () => void): () => void { void fn; return () => {}; }
