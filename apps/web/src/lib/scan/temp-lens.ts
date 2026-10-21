// The Kettle sample's own lenses, kept in this browser: temporary ones (`tmp.*`, `temporary: true`) and permanent
// project lenses (a reverse-DNS id, no `temporary`). A live product keeps them in its map, through the lens
// routes. Every read and write is wrapped: storage can be absent or refuse. Pure apart from `localStorage` and
// `window` (both guarded), so a Node check loads it as-is. The names keep "temp" from when only temporary
// lenses were kept here, and so does the storage key (a browser's stored lenses survive the change).
import type { LensEntry } from '@bp/core/standard/types';
import { checkLensManifest } from '@bp/core/scan/manifest-check';
import { PROJECT_LENS_ID, TEMP_LENS_ID } from '@bp/core/scan/jobs';

export const TEMP_LENS_KEY = 'bp.tmpLenses.kettle';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** null when `x` is a stored lens entry (temporary or project) the model can take; else why not (one phrase). */
export function tempEntryProblem(x: unknown): string | null {
  if (!isObj(x)) return 'not an object';
  const temporary = typeof x.id === 'string' && TEMP_LENS_ID.test(x.id);
  if (!temporary && (typeof x.id !== 'string' || !PROJECT_LENS_ID.test(x.id))) return 'id is neither tmp.<kebab> nor reverse DNS';
  if (typeof x.version !== 'string' || !x.version) return 'no version';
  if (x.source !== 'project') return "source is not 'project'";
  if (typeof x.enabled !== 'boolean') return 'enabled is not a boolean';
  if (temporary ? x.temporary !== true : x.temporary !== undefined) return temporary ? 'temporary is not true' : 'a project lens carries no temporary';
  if (typeof x.created_at !== 'string' || !Number.isFinite(Date.parse(x.created_at))) return 'created_at is not a date-time';
  const bad = checkLensManifest(x.manifest, { mode: temporary ? 'temporary' : 'project' });
  if (bad) return 'manifest: ' + bad;
  if ((x.manifest as { id?: unknown }).id !== x.id) return 'the manifest id differs from the entry id';
  return null;
}

/**
 * The valid entries of a stored value, in stored order; malformed ones and repeated ids are dropped (first
 * wins). A drop is the only moment a lens someone added can leave this browser, and nothing else records it -
 * the entry is simply absent from the panel afterwards, which reads exactly like never having added it - so
 * each one says what it was and why on the console, where a reader can be pointed at it. `tempEntryProblem`
 * already computes the reason; this used to throw it away.
 */
export function parseTempLenses(raw: string | null): LensEntry[] {
  if (!raw) return [];
  let j: unknown;
  try { j = JSON.parse(raw); } catch { console.warn(`${TEMP_LENS_KEY}: the stored lenses are not JSON and were ignored (${raw.length} characters)`); return []; }
  if (!Array.isArray(j)) { console.warn(`${TEMP_LENS_KEY}: the stored lenses are ${j === null ? 'null' : typeof j}, not a list, and were ignored`); return []; }
  const seen = new Set<string>(), out: LensEntry[] = [], dropped: string[] = [];
  for (const e of j) {
    const id = (e as { id?: unknown } | null)?.id;
    const at = typeof id === 'string' && id ? id : `entry ${j.indexOf(e) + 1}`;
    const bad = tempEntryProblem(e);
    if (bad) { dropped.push(`${at} (${bad})`); continue; }
    const en = e as LensEntry;
    if (seen.has(en.id)) { dropped.push(`${at} (a second entry with this id)`); continue; }
    seen.add(en.id); out.push(en);
  }
  if (dropped.length) console.warn(`${TEMP_LENS_KEY}: ${dropped.length} of ${j.length} stored lenses were dropped: ${dropped.join('; ')}`);
  return out;
}

function readRaw(): string | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(TEMP_LENS_KEY); } catch { return null; }
}

// The parsed list, kept while the stored text is unchanged: the same array comes back on every read, so
// `useSyncExternalStore(subscribeTempLenses, readTempLenses)` re-renders only on a real change.
let memo: { raw: string | null; list: LensEntry[] } = { raw: null, list: [] };

/** The stored lens entries, temporary and project (enabled or retired). [] when storage is empty, absent or unreadable. */
export function readTempLenses(): LensEntry[] {
  const raw = readRaw();
  if (raw !== memo.raw) memo = { raw, list: parseTempLenses(raw) };
  return memo.list;
}

const subs = new Set<() => void>();
function notify() { for (const fn of [...subs]) { try { fn(); } catch (e) { console.error(e); } } }

/** Writes the list and tells subscribers; throws (with a sentence a person can read) when the browser refuses. */
function write(list: LensEntry[]): void {
  try {
    if (typeof localStorage === 'undefined') throw new Error('no storage');
    localStorage.setItem(TEMP_LENS_KEY, JSON.stringify(list));
  } catch (e) {
    throw new Error('This browser did not store the lens (storage is blocked or full): ' + (e as Error).message);
  }
  notify();
}

/** Add one (id must be new). Notifies subscribers. Throws when the entry is malformed, the id exists or storage refuses. */
export function addTempLens(entry: LensEntry): void {
  const bad = tempEntryProblem(entry);
  if (bad) throw new Error(`The lens entry is not valid: ${bad}`);
  const list = readTempLenses();
  if (list.some((e) => e.id === entry.id)) throw new Error(`A lens with id ${entry.id} exists in this browser`);
  write([...list, entry]);
}

/** Retire (false) or restore (true). A no-op for an unknown id. */
export function setTempLensEnabled(id: string, enabled: boolean): void {
  const list = readTempLenses();
  if (!list.some((e) => e.id === id && e.enabled !== enabled)) return;
  write(list.map((e) => (e.id === id ? { ...e, enabled } : e)));
}

/** Remove the entry (the scan sim's readings of it stay). A no-op for an unknown id. */
export function deleteTempLens(id: string): void {
  const list = readTempLenses();
  if (!list.some((e) => e.id === id)) return;
  write(list.filter((e) => e.id !== id));
}

/** Called after any change in this tab or another (storage event). Returns the unsubscribe. */
export function subscribeTempLenses(fn: () => void): () => void {
  subs.add(fn);
  // another tab wrote (or cleared all storage: key null); this tab's own writes never fire `storage`
  const onStorage = (e: StorageEvent) => { if (e.key === TEMP_LENS_KEY || e.key === null) fn(); };
  const w = typeof window === 'undefined' ? null : window;
  w?.addEventListener('storage', onStorage);
  return () => { subs.delete(fn); w?.removeEventListener('storage', onStorage); };
}
