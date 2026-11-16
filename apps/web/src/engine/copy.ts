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

/** U on a live product: an answer there went to the product, so there is no local history to take it back from. */
export const LIVE_UNDO_WORDS = { strong: 'Nothing to undo here:', text: 'an answer on a live product goes straight to it, and cannot be taken back.' } as const;

/** What a reader sees when a link or a back/forward names a feature this map does not have (renamed, or removed by a refresh). */
export function unknownFeatureWords(id: string): { strong: string; text: string } {
  return { strong: `No feature ${id} on this map:`, text: 'it may have been renamed or removed.' };
}

/** A key of a link that names something this map does not have. */
export interface BadLinkKey { key: 'at' | 'lens' | 'blast' | 'who' | 'open'; value: string }
const LINK_NOUN: Record<BadLinkKey['key'], string> = { at: 'place', lens: 'lens', blast: 'blast feature', who: 'person', open: 'feature' };
const LINK_VALUE_MAX = 60;
/** The one notice for a link that cannot be honoured (a value comes from the URL, so it is bounded); null when nothing is wrong. */
export function unknownLinkWords(bad: readonly BadLinkKey[]): { strong: string; text: string } | null {
  if (!bad.length) return null;
  if (bad.length === 1 && bad[0].key === 'open') return unknownFeatureWords(bad[0].value);
  const named = bad.map((b) => LINK_NOUN[b.key] + ' ' + (b.value.length > LINK_VALUE_MAX ? b.value.slice(0, LINK_VALUE_MAX) + '…' : b.value));
  return { strong: 'This link names what is not on this map:', text: named.join(', ') + '. It may have been renamed or removed.' };
}
