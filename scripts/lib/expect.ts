// The one check protocol. A check reports through harness(name) instead of its own held/failures counter, and the harness
// prints the text conventions npm run check (scripts/check-all.mjs) reads, at the source:
//   FAIL  <what>        one per failed expectation, FAIL-anchored so scripts/lib/check-report.mjs keeps it in the red report
//                       above the 25-line tail (a multi-line <what> prints every line FAIL-anchored: `FAIL    <next line>`)
//   SKIP  <why>         one per skip(); check-all FAILS a child that prints one unless its OPT_OUT list names that check
//                       (a skip is an unrun check, never a quiet green)
//   <name>: N expectations held            the human summary (`<name>: F failed, N held` when red; `, S skipped` appended)
//   RESULT {"check":"<name>","held":N,"failed":F,"skipped":S}
//                       the LAST line done() prints, for machines: exactly one per run, a JSON object with exactly these four
//                       keys in this order (check: the harness name, by convention the file's basename without extension;
//                       held/failed/skipped: integers). Match it with /^RESULT (\{.*\})$/m and JSON.parse group 1.
//                       `failed` counts the synthetic failures below too, so failed > 0 exactly when done() set exit 1.
// done() exits 1 (process.exitCode, or process.exit with { exit: true }) when anything failed or when nothing ran: zero
// expectations and zero skips prints `FAIL  <name>: no expectation ran` (a loop that matched nothing is not green). It is
// idempotent. An expect() or skip() after done() is never dropped: it prints `FAIL  <name>: expectation after done(): <what>`
// (after the RESULT line, which describes the run as done() saw it) and sets exit 1. A harness whose done() never ran
// prints `FAIL  <name>: done() was never called` at process exit and sets exit 1.
// Pinned by scripts/check-harness.mjs, which also holds the ratchet: a check file that declares its own
// `const|let expect|check|ok|assert = (` and is not on its LEGACY list fails. No TypeScript parameter properties here:
// node checks import this file under Node's type stripping.

export type Result = { check: string; held: number; failed: number; skipped: number };
export type Harness = {
  /** Count one expectation; on a falsy `ok` record `what` (plus `: <detail>` when a detail is given) as a failure. Returns !!ok. */
  expect: (ok: unknown, what: string, detail?: unknown) => boolean;
  /** Record that part of the check did not run, and why. check-all fails the run unless the check is opted out. */
  skip: (why: string) => void;
  /** Print one informational line now (never a FAIL or SKIP line: those come only from expect and skip). */
  note: (line: string) => void;
  /** Print the SKIP and FAIL lines, the summary and the RESULT line; exit 1 on a failure or on nothing run. Idempotent. */
  done: (opts?: { exit?: boolean }) => Result;
  readonly held: number;
  readonly failed: number;
};

const show = (d: unknown) => (typeof d === 'string' ? d : JSON.stringify(d) ?? String(d));
const anchored = (tag: 'FAIL' | 'SKIP', text: string) => text.split(/\r?\n/).map((l, i) => (i ? `${tag}    ${l}` : `${tag}  ${l}`)).join('\n');

export function harness(name: string): Harness {
  let held = 0, closed = false, result: Result | null = null;
  const failures: string[] = [], skips: string[] = [];
  const out = (line: string) => console.log(line);
  const late = (kind: string, what: string) => { out(anchored('FAIL', `${name}: ${kind} after done(): ${what}`)); process.exitCode = 1; };
  process.on('exit', () => {
    if (closed) return;
    out(anchored('FAIL', `${name}: done() was never called (${held} held, ${failures.length} failed before exit)`));
    process.exitCode = 1;
  });
  return {
    expect(ok, what, detail) {
      if (closed) { late('expectation', what); return !!ok; }
      if (ok) held++;
      else failures.push(detail === undefined || detail === '' ? what : `${what}: ${show(detail)}`);
      return !!ok;
    },
    skip(why) { if (closed) late('skip', why); else skips.push(why); },
    note(line) { out(line); },
    done(opts = {}) {
      if (result) return result;
      closed = true;
      if (!held && !failures.length && !skips.length) failures.push(`${name}: no expectation ran`);
      for (const s of skips) out(anchored('SKIP', s));
      for (const f of failures) out(anchored('FAIL', f));
      out(`${name}: ${failures.length ? `${failures.length} failed, ${held} held` : `${held} expectations held`}${skips.length ? `, ${skips.length} skipped` : ''}`);
      result = { check: name, held, failed: failures.length, skipped: skips.length };
      out(`RESULT ${JSON.stringify(result)}`);
      if (failures.length) process.exitCode = 1;
      if (opts.exit) process.exit();
      return result;
    },
    get held() { return held; },
    get failed() { return failures.length; },
  };
}
