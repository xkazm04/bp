// Bold's sheet totals as a schedule: per built-in lens, the clauses its title block states ('3 unreviewed',
// '$3k/mo direct revenue'), each defined ONCE as its words plus the predicate or the per-feature value behind it.
// The title block (CHANNELS[lens].aggregate), the bay rail (decor.ts railParts) and the Plan-tab schedule
// (ScheduleLegend.tsx, bold's ui.Legend) all read these clauses, so the three places cannot drift, and a schedule row
// knows WHICH features it counts and can walk the plan to them. Pure: check:bold-schedule runs it in node.
import type { Feature } from '@bp/core/data';
import { isLiveSt } from '@bp/core/model';
import { bl, measuredOf, sensitiveUnreviewed, type BuiltinLens } from '../base/legacy';

/** Money in short form: $950, $3.2k, $12k (tiles, aggregates, decor rails). */
export const kUsd = (n: number) => (n >= 1000 ? '$' + (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k' : '$' + n);

/**
 * One counted clause. A COUNT clause has `test` alone: n is how many features pass it. A SUM clause has `value`:
 * n is the sum, and its features are those with value > 0 (or those passing `test`, when it has both). `per` is a
 * second sum the words divide by (e2e tests); without it d is the number of features the clause ran over.
 */
export interface Clause {
  key: string;
  test?: (f: Feature) => boolean;
  value?: (f: Feature) => number;
  per?: (f: Feature) => number;
  words: (n: number, d: number) => string;
}

/** A clause over a set of features: its words, its totals and the ids it counts, in the order given (plan order). */
export interface ScheduleRow { key: string; words: string; ids: string[]; n: number; d: number }

const B = (f: Feature) => bl(f).business, De = (f: Feature) => bl(f).design, Dv = (f: Feature) => bl(f).development;
const O = (f: Feature) => bl(f).operations, Se = (f: Feature) => bl(f).security, Q = (f: Feature) => bl(f).quality;

/** The clause table: the only place a bold lens total is defined. Order is the title block's. */
export const CLAUSES: Record<BuiltinLens, readonly Clause[]> = {
  business: [
    { key: 'asks', value: (f) => B(f).customerRequests30d || 0, words: (n) => n + ' customer asks' },
    { key: 'mrr', value: (f) => (B(f).revenueLink === 'direct' ? B(f).mrrImpactUsd || 0 : 0), words: (n) => kUsd(n) + '/mo direct revenue' },
    { key: 'high', test: (f) => B(f).value >= 4, words: (n) => n + ' high value' },
  ],
  design: [
    { key: 'built', test: (f) => De(f).status === 'polished' || De(f).status === 'implemented', words: (n) => n + ' built to design' },
    { key: 'undesigned', test: (f) => De(f).status === 'none' && f.stage !== 'idea', words: (n) => n + ' without design' },
    { key: 'a11y', test: (f) => De(f).a11y === 'fail', words: (n) => n + ' fail accessibility' },
  ],
  development: [
    { key: 'unreviewed', test: (f) => Dv(f).humanReviewed === false, words: (n) => n + ' unreviewed' },
    { key: 'agent', value: (f) => Dv(f).aiAuthoredPct, words: (n, d) => Math.round(n / Math.max(1, d)) + '% agent-written' },
    { key: 'prs', value: (f) => Dv(f).openPRs || 0, words: (n) => n + ' open PRs' },
    { key: 'thin', test: (f) => (Dv(f).unitCoveragePct ?? Infinity) < 50, words: (n) => n + ' thin coverage' },
  ],
  operations: [
    { key: 'production', test: (f) => O(f).environment === 'production', words: (n) => n + ' in production' },
    { key: 'unalerted', test: (f) => O(f).environment === 'production' && !O(f).alerting, words: (n) => n + ' without alerting' },
    { key: 'incidents', value: (f) => O(f).incidents30d || 0, words: (n) => n + ' incidents · 30 d' },
  ],
  security: [
    { key: 'card', test: (f) => Se(f).dataClass === 'payment', words: (n) => n + ' card data' },
    { key: 'personal', test: (f) => Se(f).dataClass === 'personal', words: (n) => n + ' personal data' },
    { key: 'unreviewed', test: sensitiveUnreviewed, words: (n) => n + ' unreviewed' },
    { key: 'findings', value: (f) => Se(f).openFindings, words: (n) => n + ' findings' },
  ],
  quality: [
    { key: 'e2e', value: (f) => Q(f).e2ePassing, per: (f) => Q(f).e2eTests, test: (f) => Q(f).e2eTests > 0, words: (n, d) => n + '/' + d + ' e2e passing' },
    { key: 'p1', value: (f) => Q(f).openBugs.p1, words: (n) => n + ' open P1' },
    { key: 'untested', test: (f) => Q(f).status === 'untested' && isLiveSt(f.stage), words: (n) => n + ' live untested' },
  ],
};

function run(c: Clause, fs: readonly Feature[]): ScheduleRow {
  const ids: string[] = [];
  let n = 0, d = c.per ? 0 : fs.length;
  for (const f of fs) {
    if (c.per) d += c.per(f);
    if (c.value) {
      const v = c.value(f);
      n += v;
      if (c.test ? c.test(f) : v > 0) ids.push(f.id);
    } else if (c.test!(f)) { n++; ids.push(f.id); }
  }
  return { key: c.key, words: c.words(n, d), ids, n, d };
}

/** Every clause of a lens over the features given (the caller has already kept the measured ones). */
export function tally(lens: BuiltinLens, fs: readonly Feature[]): ScheduleRow[] {
  return CLAUSES[lens].map((c) => run(c, fs));
}
/** The clause words alone: a channel aggregate's parts. */
export const clauseWords = (lens: BuiltinLens, fs: readonly Feature[]): string[] => tally(lens, fs).map((r) => r.words);
/** One row of a tally by its clause key (a clause the table defines; railParts reads its totals this way). */
export function rowOf(rows: readonly ScheduleRow[], key: string): ScheduleRow {
  const r = rows.find((x) => x.key === key);
  if (!r) throw new Error('bold schedule: no clause ' + key);
  return r;
}

/** The schedule of a place: the lens's clauses over its measured features, then the features it has not measured. */
export function schedule(lens: BuiltinLens, feats: readonly Feature[]): ScheduleRow[] {
  const { measured } = measuredOf(feats, lens), seen = new Set(measured);
  const missing = feats.filter((f) => !seen.has(f)).map((f) => f.id);
  return [...tally(lens, measured), { key: 'unmeasured', words: missing.length + ' not measured', ids: missing, n: missing.length, d: feats.length }];
}

/** The match after `cur` in `ids`, wrapping; the first when `cur` is not among them; null for an empty row. */
export function nextMatch(ids: readonly string[], cur: string | null): string | null {
  if (!ids.length) return null;
  const i = cur == null ? -1 : ids.indexOf(cur);
  return ids[(i + 1) % ids.length];
}

/** A row press: fly to the next match with the highlight and return the new cursor (an empty row flies nowhere and returns null). */
export function goNext(E: { flyToFeature(id: string, highlight?: boolean): void }, ids: readonly string[], cur: string | null): string | null {
  const next = nextMatch(ids, cur);
  if (next != null) E.flyToFeature(next, true);
  return next;
}
