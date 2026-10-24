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
