// One UTC clock for every time this product prints. Every stamp in the tree is UTC - the store's `at`, a scan
// run's `started_at`, a shot's `captured_at` and the recorded hour's offsets off `sim.at0` - and the reader was
// never told so: ten sites across eight files hand-sliced `iso.slice(11, 16)` and printed "14:05" with no zone,
// in a product whose own sample day runs 09:00-10:00 UTC. These are the one place that formatting lives.
//
// Three rules they all keep:
//   - UTC, always, whatever the viewer's zone (so two readers of one event read the same time);
//   - the zone is part of the word, unless the caller's surface already captions it (`{ zone: false }`);
//   - an instant the caller does not have reads as the absent mark, never "NaN:NaN" or "Invalid Date" - a time
//     nobody recorded must not come out looking like a time somebody did.
// Pure; no DOM, no Node, no Intl (Intl's "UTC" output varies by ICU build, and these strings are pinned by gates).

/** A moment, however the caller happens to hold one: an ISO string, epoch ms, or a Date. */
export type Instant = string | number | Date | null | undefined;

/** What every formatter here says for an instant that is absent or unreadable (the same mark `fmtValue` uses). */
export const NO_TIME = '—';

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Epoch ms for an instant, or NaN. */
export function msOfInstant(t: Instant): number {
  if (t === null || t === undefined) return NaN;
  if (typeof t === 'number') return Number.isFinite(t) ? t : NaN;
  const n = t instanceof Date ? t.getTime() : Date.parse(t);
  return Number.isFinite(n) ? n : NaN;
}

const pad = (n: number) => (n < 10 ? '0' + n : String(n));
const zoned = (s: string, zone: boolean) => (zone ? s + ' UTC' : s);

/** `14:05 UTC` - an event's time of day. `{ zone: false }` for a surface that captions the zone itself. */
export function hhmmUTC(t: Instant, opts: { zone?: boolean; seconds?: boolean } = {}): string {
  const ms = msOfInstant(t);
  if (Number.isNaN(ms)) return NO_TIME;
  const d = new Date(ms);
  const hm = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + (opts.seconds ? ':' + pad(d.getUTCSeconds()) : '');
  return zoned(hm, opts.zone !== false);
}

/** `OCT 08 14:05 UTC` - an event's day and time, for a list that spans more than one day. */
export function dayHhmmUTC(t: Instant, opts: { zone?: boolean; seconds?: boolean } = {}): string {
  const ms = msOfInstant(t);
  if (Number.isNaN(ms)) return NO_TIME;
  const d = new Date(ms);
  return MON[d.getUTCMonth()] + ' ' + pad(d.getUTCDate()) + ' ' + hhmmUTC(ms, opts);
}

/** `2026-10-08` - the UTC day alone (a date carries no zone to show). */
export function ymdUTC(t: Instant): string {
  const ms = msOfInstant(t);
  if (Number.isNaN(ms)) return NO_TIME;
  return new Date(ms).toISOString().slice(0, 10);
}
