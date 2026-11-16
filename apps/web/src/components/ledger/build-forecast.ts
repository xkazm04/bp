// The build forecast in words: what a Dispatch button says before the click. The server's dry dispatch (POST dispatch or
// waves/[wave]/dispatch `{ dry: true }`, fetched through lib/scan/actions.ts forecastDispatch / forecastWave) answers what
// the real call would build and skip; this turns that answer, or its refusal, into the button's label, whether the button
// is blocked, and its title. `Dispatch 9 · 2 held by O-1 · 1 in a job`: the held count is text on the button, cited by the
// order's id (no colour, no lens branch). No forecast yet, or one that failed for another reason (the network, a 5xx),
// reads as today's label over the client's own count, never blocked: the real call still guards itself.
// Pure and import-free, like train/release/preflight.ts: scripts/check-build-forecast.ts runs it in Node.

export interface ForecastSkip { id: string; status: string }
/** What the view reads of a forecast: the ids it would build and the ones it skips. */
export interface ForecastLike { take: readonly string[]; skipped: readonly ForecastSkip[] }
/** A refusal as actions.ts rejects: the route's status, its words, its body (403 `held`, 429 the forecast). */
export interface ForecastRefusal { status?: number; message?: string; body?: unknown }
/** The forecast as the button holds it: none yet (null), the answer, or the refusal. */
export type ForecastState = { forecast: ForecastLike } | { refusal: ForecastRefusal } | null;
export interface ForecastView { label: string; block: boolean; title: string | null }

/** The skipped rows in words: `n held by O-1` per order (first seen first), `n in a job`, `n not open`. */
export function skipWords(skipped: readonly ForecastSkip[]): string[] {
  const held = new Map<string, number>();
  let job = 0, closed = 0;
  for (const s of skipped) {
    if (s.status.startsWith('held:')) { const o = s.status.slice(5); held.set(o, (held.get(o) ?? 0) + 1); }
    else if (s.status === 'in-job') job++;
    else closed++;
  }
  return [...[...held].map(([o, n]) => n + ' held by ' + o), ...(job ? [job + ' in a job'] : []), ...(closed ? [closed + ' not open'] : [])];
}

const join = (verb: string, n: number, words: readonly string[]) => [verb + ' ' + n, ...words].join(' · ');
const skipsOf = (x: unknown): ForecastSkip[] => (Array.isArray(x) ? x.filter((s): s is ForecastSkip => !!s && typeof s.id === 'string' && typeof s.status === 'string') : []);

/** The button for `verb` (`Dispatch`, `Dispatch wave`, ...) over a forecast state; `fallback` = the client's own count. */
export function forecastView(verb: string, s: ForecastState, fallback: number): ForecastView {
  if (s && 'forecast' in s) {
    const n = s.forecast.take.length, words = skipWords(s.forecast.skipped);
    return { label: join(verb, n, words), block: n === 0, title: n ? null : 'Nothing here can be built now' + (words.length ? ': ' + words.join(', ') : '') };
  }
  if (s && 'refusal' in s) {
    const { status, message, body } = s.refusal, b = (body ?? {}) as { held?: unknown; skipped?: unknown; take?: unknown };
    if (status === 403) {
      // every id held: the 403 cites the order(s); its `held` rows name them
      const held = Array.isArray(b.held) ? b.held.map((h) => ({ id: String((h as { id?: unknown })?.id), status: 'held:' + String((h as { order?: { id?: unknown } })?.order?.id ?? '?') })) : [];
      return { label: join(verb, 0, held.length ? skipWords(held) : ['held']), block: true, title: message ?? 'A standing order holds every finding here (Rules)' };
    }
    if (status === 429) {
      const n = Array.isArray(b.take) ? b.take.length : fallback;
      return { label: join(verb, n, ['queue full']), block: true, title: message ?? 'The job queue is full: dispatch when it drains' };
    }
    if (status === 409) return { label: join(verb, 0, skipWords(skipsOf(b.skipped))), block: true, title: message ?? 'Nothing here can be built now' };
  }
  return { label: verb + ' ' + fallback, block: false, title: null };
}

/** A rejection from actions.ts as a forecast state (an Error carrying `status` and `body`). */
export const refusalOf = (e: unknown): ForecastState => {
  const x = e as { status?: unknown; message?: unknown; body?: unknown } | null;
  return { refusal: { status: typeof x?.status === 'number' ? x.status : undefined, message: typeof x?.message === 'string' ? x.message : undefined, body: x?.body } };
};
