// The engine's own user-facing sentences. The engine speaks to a reader in a few places (a save that did not
// land, a mode it refused) and those sentences used to be built inline, where nothing could read them back:
// `'Not saved: ' + e.message` put a developer's string on a tile, so a dropped connection told the reader
// "Not saved: Failed to fetch" (Chrome), "Not saved: Load failed" (Safari) or a Firefox NetworkError sentence -
// three different words for one thing, none of them an instruction.
//
// Pure functions, no imports and no DOM: scripts/check-engine-copy.ts runs them under Node's type stripping,
// which is the only way anything in Engine.ts is executed by a gate.

/** A rejection from the live product's routes: non-2xx carries the HTTP status, a shape we could not read carries 0, and a fetch that never reached the product carries none. */
export interface SaveFailure {
  status?: number;
  message?: string;
}
/** What a failed save says, and whether the reader should expect to answer again. */
export interface SaveWords {
  text: string;
  /** True when the question goes back on the queue: the reader can retry. A 409 is settled elsewhere, so it does not. */
  retry: boolean;
}

/**
 * The words a failed answer puts on its tile (Engine.decide's rollback -> sim.settle).
 *  - 409: another reader already answered it. Nothing to retry.
 *  - no status at all: the request never reached the product, so the cause is the connection and the remedy
 *    is to answer again - said in those words, never in the fetch implementation's.
 *  - status 0: the product answered, but not in a shape we could read (scan/client.ts marks those 0).
 *  - any other status: the product refused it and said why; its own words are the most useful ones.
 */
export function saveFailWords(e: SaveFailure): SaveWords {
  if (e.status === 409) return { text: 'Already decided elsewhere', retry: false };
  if (e.status === undefined) return { text: 'Not saved: connection lost, the question is open again', retry: true };
  if (e.status === 0) return { text: 'Not saved: the product answered something we could not read, the question is open again', retry: true };
  return { text: 'Not saved: ' + (e.message || `the product refused it (HTTP ${e.status})`), retry: true };
}

/** Developer-facing strings a reader must never be shown, whatever the browser calls them. */
export const DEV_WORDS: readonly string[] = ['Failed to fetch', 'Load failed', 'NetworkError', 'TypeError', 'ERR_', 'undefined', 'NaN'];
