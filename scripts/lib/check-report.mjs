// The red report of npm run check (scripts/check-all.mjs): pure helpers, no I/O, pinned by scripts/check-aggregate-report.mjs.
// - failReport: a failing child's output reduced for the operator. Every line starting with FAIL (the twin of the SKIP
//   convention, matched anchored) that falls ABOVE the tail is kept, then the 25-line tail; with no FAIL line it is exactly
//   the tail, so nothing the old report showed is lost and an early FAIL (check-server.mjs prints ~33 lines) no longer is.
// - rerunFor: the exact command that reruns one check, derived from package.json; a name that is not a script is refused.
// - the record: which checks the last run left red, per checkout (os.tmpdir keyed by sha1 of the root, so a worktree that
//   shares node_modules keeps its own; BP_CHECK_RECORD overrides), read back by `npm run check -- --failed`.
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const TAIL = 25;
const FAIL_LINE = /^\s*FAIL\b/;

/** The lines of a child's output that start with FAIL. */
export const failLines = (out) => out.split(/\r?\n/).filter((l) => FAIL_LINE.test(l));

/** A failing child's output as the report shows it: FAIL lines above the tail, then the last TAIL lines. */
export const failReport = (name, out) => {
  const lines = out.trim().split(/\r?\n/);
  const cut = Math.max(0, lines.length - TAIL);
  const above = lines.slice(0, cut).filter((l) => FAIL_LINE.test(l));
  const tail = lines.slice(cut);
  return above.length ? [...above, `  ... (${cut - above.length} more line(s) of ${name}; its last ${tail.length}:)`, ...tail].join('\n') : tail.join('\n');
};

/** The command that reruns exactly `name`. Throws when package.json has no such script: a printed remedy must exist. */
export const rerunFor = (name, scripts) => {
  if (!Object.hasOwn(scripts, name)) throw new Error(`'${name}' is not a script in package.json`);
  return `npm run -s ${name}`;
};

/** Where this checkout's record of red checks lives. */
export const recordPath = (root, env) => env.BP_CHECK_RECORD
  || path.join(os.tmpdir(), `bp-check-${crypto.createHash('sha1').update(root).digest('hex')}.json`);

/**
 * Parse a record's text. Returns { names } or { error }: a record that is missing, unreadable or empty selects nothing,
 * and "nothing" must never become a green run over 0 checks. `text` is null when there is no record file.
 */
export const parseRecord = (text) => {
  if (text == null) return { error: 'there is no record of a previous run' };
  let v;
  try { v = JSON.parse(text); } catch (e) { return { error: `the record does not parse (${e.message})` }; }
  if (!Array.isArray(v) || !v.every((n) => typeof n === 'string')) return { error: 'the record is not a list of check names' };
  if (!v.length) return { error: 'the record is empty: the last run had no red checks' };
  return { names: v };
};

/** The new record: what was red before and did not run this time, plus what is red now. A full run therefore records exactly its red set. */
export const mergeRecord = (prev, ran, red) => [...new Set([...prev.filter((n) => !ran.includes(n)), ...red])];

/** The run's last line. `previously` is the size of the --failed selection, or null for an ordinary run. */
export const lastLine = (red, previously) => red.length
  ? `${red.length} red: ${red.join(', ')}; rerun just these with npm run check -- --failed (then the full npm run check before pushing)`
  : previously != null ? `${previously} of ${previously} previously failing now pass; run npm run check before pushing` : '';

// - the counts: how many expectations each check proved. countOf reads a child's output (the RESULT line of
//   scripts/lib/expect.ts first, else one of the prose summaries older checks print), and a per-checkout baseline of the
//   last green counts (os.tmpdir()/bp-check-counts-<sha1(root)>.json, or BP_CHECK_COUNTS; never inside the repo) names any
//   check that now asserts fewer things than it did (THINNER). That is reported, never failed: whether a shrink fails the
//   gate is the owner's call.
const RESULT_LINE = /^RESULT (\{.*\})\s*$/gm;
// The prose summaries older checks print. A summary is any line that is not an expectation line of its own (FAIL, SKIP,
// 'ok    <what>', a stack frame): a count quoted inside a FAIL text is never read. Per line the first shape that matches gives
// that line's count (group 1, the expectations that held). A 'N of T' tally is weak: beside a strong summary it is a
// sub-tally ('acceptance cases: 8 of 8 hold' over 'review record: 15 assertions held') and gives way. Two different strong
// counts (or, with none, two different weak ones) are null, never a guess.
const NOT_SUMMARY = /^\s*(?:FAIL|SKIP|at|RESULT)\b|^\s*ok(?!:| - )\b/;
const SHAPES = [
  [/\b(\d+) (?:passed|held|ok), \d+ failed\b/, 'strong'],                                            // 'check-x: 5 passed, 0 failed'
  [/\b(\d+)(?: of |\/)\d+ (?:[\w-]+ )*?(?:hold|held|holds|valid|agree|declared|green|passed)\b/, 'weak'], // '12 of 12 sim-answer expectations hold'
  [/\b(\d+) (?:[\w-]+ )?(?:expectations?|checks?|assertions?|cases?|invariants?) (?:held|hold|holds|passed|green)\b/, 'strong'], // '92 expectations held'
  [/^\S[^:]*: (\d+) (?:held|passed)$/, 'strong'],                                                      // 'check-train-budget: 21 held'
];

/** The number of expectations a child's output says held, or null when it states none (or states two different ones). */
export const countOf = (out) => {
  const text = String(out ?? '');
  const results = [...text.matchAll(RESULT_LINE)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
  // The harness prints exactly one RESULT line, as done()'s last line; a check that forwards a child's output prints its own last.
  const own = results.at(-1);
  if (own && Number.isInteger(own.held) && own.held >= 0) return own.held;
  const found = { strong: new Set(), weak: new Set() };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (NOT_SUMMARY.test(line)) continue;
    for (const [re, rank] of SHAPES) { const m = re.exec(line); if (m) { found[rank].add(Number(m[1])); break; } }
  }
  const set = found.strong.size ? found.strong : found.weak;
  return set.size === 1 ? [...set][0] : null;
};

/** Where this checkout's baseline of green counts lives: outside the repo, so it is never committed. */
export const countsPath = (root, env) => env.BP_CHECK_COUNTS
  || path.join(os.tmpdir(), `bp-check-counts-${crypto.createHash('sha1').update(root).digest('hex')}.json`);

/** Parse the baseline's text: { counts } (empty when there is no file, `text` null) or { error } when it cannot be read. */
export const parseCounts = (text) => {
  if (text == null) return { counts: {} };
  let v;
  try { v = JSON.parse(text); } catch (e) { return { error: `it does not parse: ${e.message}` }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'it is not an object of check names' };
  const bad = Object.entries(v).filter(([, n]) => !Number.isInteger(n) || n < 0).map(([k]) => k);
  if (bad.length) return { error: `${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a whole count` };
  return { counts: v };
};

/** The checks whose green count fell below their baseline: [{ name, was, now }] in the order of `now`. */
export const thinner = (prev, now) => Object.entries(now)
  .filter(([n, c]) => Number.isInteger(c) && Number.isInteger(prev[n]) && c < prev[n])
  .map(([name, c]) => ({ name, was: prev[name], now: c }));

/** One THINNER line. */
export const thinnerLine = ({ name, was, now }) => `THINNER  ${name}  ${was} -> ${now} held (${was - now} fewer than the last green run)`;

/** The new baseline: the previous one with this run's GREEN counts written over it (a red or uncounted check keeps its old figure). */
export const mergeCounts = (prev, greenNow) => {
  const next = { ...prev };
  for (const [n, c] of Object.entries(greenNow)) if (Number.isInteger(c)) next[n] = c;
  return next;
};

/** The summary's tail: '· N expectations in K counted check(s)', plus the uncounted names. `counts` maps every check run to a count or null. */
export const countSummary = (counts) => {
  const e = Object.entries(counts);
  const counted = e.filter(([, c]) => Number.isInteger(c));
  const none = e.filter(([, c]) => !Number.isInteger(c)).map(([n]) => n);
  const total = counted.reduce((s, [, c]) => s + c, 0);
  return `· ${total} expectations in ${counted.length} counted check${counted.length === 1 ? '' : 's'}`
    + (none.length ? `; ${none.length} uncounted: ${none.join(', ')}` : '');
};
