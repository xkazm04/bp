// What a failed request to the blueprint server SAYS to a reader. One rule, one place: the surfaces that talk
// to these routes - the scan menu's toast (actions.ts), the project list's alert (projects.ts) - all show the
// reader a sentence and never the fetch implementation's own words. The canvas's half of the same rule is
// `saveFailWords` in engine/copy.ts, and the branches here are deliberately the same ones.
// No imports, no DOM: scripts/check-scan-client.ts runs these under Node's type stripping.

/** A message that is the fetch implementation's words, not a refusal anyone wrote for a reader. */
export const developerWords = (m: string): boolean => !m || /^HTTP \d+$/.test(m) || /Failed to fetch|Load failed|NetworkError|ERR_[A-Z_]+|^\[object |^undefined$|^null$|^NaN$/.test(m);

/**
 * The CAUSE of a failed request, in words, with no remedy attached - the caller's surface adds the remedy,
 * because what to do about it differs (a scan may already be queued; a project list simply has to be re-read).
 *  - a timed-out or aborted request -> said as a timeout, never as the abort's own message;
 *  - no status at all -> the request never left the browser, so the cause is the connection;
 *  - status 0 -> the product answered in a shape the client could not read (client.ts marks those 0);
 *  - any other status -> the route's own refusal text, which is the most useful sentence there is, or its
 *    HTTP status in words when it sent none.
 */
export function causeWords(e: unknown): string {
  const err = (e ?? {}) as { status?: unknown; message?: unknown; name?: unknown };
  const msg = typeof err.message === 'string' ? err.message : '';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'the blueprint server did not answer in time';
  const status = typeof err.status === 'number' ? err.status : undefined;
  if (status === undefined) return 'the request never reached the product: check that the blueprint server is running';
  if (status === 0) return 'the product answered something the blueprint could not read';
  return developerWords(msg) ? `the product refused it (HTTP ${status})` : msg;
}

const REFUSAL: Record<string, string> = {
  'unknown-lens': 'that lens is not enabled in the map',
  'no-scan-method': 'that lens has no scan method (no built-in and no manifest scan block)',
  'bad-scope': 'the scope names a place or feature the map does not have',
  'queue-full': '16 scans are already queued',
};

/**
 * A refusal in words for a scan toast: the route's or the sim's error code explained, else the cause with the
 * remedy this surface owns. A scan we stopped waiting for may well have been queued, so the toast says so and
 * sends the reader to the Agents list rather than inviting a second click that would queue it twice.
 */
export function refusalText(e: unknown): string {
  const msg = typeof (e as { message?: unknown } | null)?.message === 'string' ? (e as { message: string }).message : '';
  if (REFUSAL[msg]) return REFUSAL[msg];
  const cause = causeWords(e);
  if (/did not answer in time/.test(cause)) return cause + ' (it may still run the scan); look at the Agents list before starting it again';
  if (/never reached/.test(cause)) return cause + ', then try again';
  return cause;
}
