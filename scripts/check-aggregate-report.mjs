// Pins npm run check's red report (scripts/check-all.mjs over scripts/lib/check-report.mjs). When the gate goes red it
// used to print each failing check's last 25 lines and nothing else: a FAIL line above the tail (check-server.mjs prints
// ~33 expectation lines before its summary) was dropped, no rerun command was given, and the hand-typed rerun
// BP_CHECK_ONLY=check:standard also ran check:standard-fixtures (substring match). The rules pinned here:
//   - the report keeps every line of the child's output that starts with FAIL, then the 25-line tail; with no FAIL line
//     it is exactly the tail (nothing lost against the old report);
//   - each red check gets an exact rerun command, derived from package.json (a name not in it is refused, never typed);
//   - the run writes a per-checkout record of its red set (BP_CHECK_RECORD, else os.tmpdir()/bp-check-<sha1(ROOT)>.json),
//     and `npm run check -- --failed` reruns exactly that set: no record, an empty one or a stale name fails before
//     anything runs, never a green run over 0 checks;
//   - a red run's last line names the red checks and `npm run check -- --failed`; a --failed run that turns green says
//     so AND says the full gate still has to run before pushing.
//   - the argument refusals exit 1 with their line before any check runs: --failed with BP_CHECK_ONLY, a BP_CHECK_ONLY term
//     matching no check, BP_CHECK_ONLY selecting 0 checks, and a BP_CHECK_TIMEOUT_MS that is not a positive number.
// The --failed cases run a child check-all with BP_CHECK_RECORD in a throwaway dir, selecting only check:standard or
// check:overlays (never this check), so there is no recursion and the real record is never touched. The seeded red
// case reuses check:overlays' own BP_OVERLAYS_MUTATE control (GUARD: a red child still makes the aggregate exit 1).
//   - the counts: each PASS line carries the expectations its check held (countOf: the RESULT line, else a prose summary,
//     else uncounted), the summary totals them and names the uncounted checks, and a per-checkout baseline of the last green
//     counts (BP_CHECK_COUNTS, else os.tmpdir()/bp-check-counts-<sha1(ROOT)>.json) names a check that got THINNER - reported,
//     never failed; a red run never writes it, an unreadable one is noted and rewritten.
// Run: node scripts/check-aggregate-report.mjs   (exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

let lib = {};
try { lib = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/check-report.mjs')).href); }
catch (e) { check('scripts/lib/check-report.mjs loads', false, e.message); }
const call = (fn, ...a) => { try { return typeof lib[fn] === 'function' ? lib[fn](...a) : `<no ${fn}()>`; } catch (e) { return `<threw: ${e.message}>`; } };

// 1. An early FAIL line survives (the check-server.mjs:30 shape: one ok/FAIL line per expectation).
const early = Array.from({ length: 40 }, (_, i) => (i === 2 ? 'FAIL  the server starts: exit 1' : `ok    expectation ${i + 1}`)).join('\n');
const r1 = String(call('failReport', 'check:server', early));
check('failReport keeps a FAIL line outside the 25-line tail', r1.includes('FAIL  the server starts: exit 1'), r1.slice(0, 200));
check('failReport still ends with the tail', r1.trimEnd().endsWith('ok    expectation 40'), r1.slice(-120));

// 2. No FAIL line (a crash stack, a tsc error list): exactly the last 25 lines, as before.
const stack = Array.from({ length: 40 }, (_, i) => `    at frame${i + 1} (file.mjs:${i + 1})`).join('\n');
const r2 = call('failReport', 'check:x', stack);
check('failReport with no FAIL line is exactly the last 25 lines', r2 === stack.split('\n').slice(-25).join('\n'), String(r2).slice(0, 120));

// 3. The rerun command is exact and derived from package.json.
const cmd = call('rerunFor', 'check:standard', scripts);
check('rerunFor runs exactly the one script', cmd === 'npm run -s check:standard', cmd);
check('rerunFor refuses a name not in package.json', String(call('rerunFor', 'check:no-such-check', scripts)).startsWith('<threw'), call('rerunFor', 'check:no-such-check', scripts));
const every = ['typecheck', ...Object.keys(scripts).filter((k) => k.startsWith('check:')), 'validate:structure'];
const bad = every.filter((n) => { const c = call('rerunFor', n, scripts); return !(typeof c === 'string' && c.split(' ').at(-1) in scripts && c.split(' ').at(-1) === n); });
check('every rerun command names its own script in package.json', !bad.length, bad.slice(0, 5).join(', '));

// 4. The record: a run's red set, merged so a narrowed run never forgets checks it did not run.
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('a run with check:a and check:b red records exactly them', eq(call('mergeRecord', [], ['check:a', 'check:b', 'check:c'], ['check:a', 'check:b']), ['check:a', 'check:b']));
check('a fully green run records []', eq(call('mergeRecord', ['check:a'], ['check:a', 'check:b'], []), []));
check('a --failed run keeps only what is still red', eq(call('mergeRecord', ['check:a', 'check:b'], ['check:a', 'check:b'], ['check:b']), ['check:b']));
check('a narrowed run keeps the red checks it did not run', eq(call('mergeRecord', ['check:a'], ['check:c'], []), ['check:a']));
const sha = crypto.createHash('sha1').update(ROOT).digest('hex');
check('the record defaults to os.tmpdir keyed by sha1(ROOT)', call('recordPath', ROOT, {}) === path.join(os.tmpdir(), `bp-check-${sha}.json`), call('recordPath', ROOT, {}));
check('BP_CHECK_RECORD overrides the record path', call('recordPath', ROOT, { BP_CHECK_RECORD: '/x/r.json' }) === '/x/r.json', call('recordPath', ROOT, {}));

// 8 (helpers). The last line.
const red = String(call('lastLine', ['check:a', 'check:b'], null));
check('a red run\'s last line names the red checks and the --failed command', red.includes('check:a') && red.includes('check:b') && red.includes('npm run check -- --failed'), red);
const green = String(call('lastLine', [], 3));
check('a --failed run that turns green says so and names the full gate', green.includes('3 of 3 previously failing now pass; run npm run check before pushing'), green);

// 5-7 + seeded red: through a child check-all with BP_CHECK_RECORD in a throwaway dir.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-aggregate-report-'));
const rec = path.join(dir, 'record.json');
// A check-all that does not know --failed would ignore it and run the WHOLE suite in every child below; such a runner fails
// each child case without spawning it.
const knowsFailed = fs.readFileSync(path.join(ROOT, 'scripts/check-all.mjs'), 'utf8').includes("'--failed'");
check('scripts/check-all.mjs accepts --failed', knowsFailed);
const all = (record, extraEnv = {}) => {
  if (!knowsFailed) return { code: null, out: '<check-all has no --failed>', last: '', ran: [], after: null };
  if (record === undefined) fs.rmSync(rec, { force: true }); else fs.writeFileSync(rec, record);
  const env = { ...process.env, BP_CHECK_RECORD: rec, ...extraEnv };
  delete env.BP_CHECK_ONLY;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-all.mjs'), '--failed'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const lines = out.trim().split(/\r?\n/);
  let after = null;
  try { after = JSON.parse(fs.readFileSync(rec, 'utf8')); } catch { /* none */ }
  return { code: r.status, out, last: lines.at(-1), ran: lines.filter((l) => /^(PASS|FAIL)  \S/.test(l) && !/BP_CHECK|--failed|record/.test(l)), after };
};

const g = all('["check:standard"]');
check('--failed over ["check:standard"] exits 0', g.code === 0, `exit ${g.code}\n${g.out.slice(-600)}`);
check('--failed runs exactly check:standard (not check:standard-fixtures)', g.ran.length === 1 && /^PASS  check:standard\s/.test(g.ran[0]), g.ran.join(' | '));
check('--failed that turns green empties the record', eq(g.after, []), JSON.stringify(g.after));
check('--failed that turns green ends naming the full gate', g.last.includes('1 of 1 previously failing now pass; run npm run check before pushing'), g.last);

for (const [label, record] of [['no record', undefined], ['an empty record', '[]'], ['an unreadable record', '{not json']]) {
  const r = all(record);
  check(`--failed with ${label} exits 1`, r.code === 1, `exit ${r.code}`);
  check(`--failed with ${label} names npm run check and runs nothing`, r.out.includes('npm run check') && !r.ran.length, r.out.slice(0, 300));
}
const st = all('["check:standard","check:gone-away"]');
check('--failed with a stale name exits 1', st.code === 1, `exit ${st.code}`);
check('--failed with a stale name names it before anything runs', st.out.includes('check:gone-away') && !st.ran.length, st.out.slice(0, 300));

// The argument refusals that keep a mistyped filter from turning into a green "0 passed" run (check-all.mjs:40, :50-53,
// :58-60): each is a child check-all with BP_CHECK_ONLY KEPT (the helper above deletes it) and must exit non-zero with its
// line before any check runs. The timeout legs also narrow to check:standard, so a refusal that fell through would run
// one check rather than the whole suite (this check among it).
const refusal = (args, env) => {
  fs.writeFileSync(rec, '["check:standard"]');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-all.mjs'), ...args], { cwd: ROOT, env: { ...process.env, BP_CHECK_RECORD: rec, ...env }, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  return { code: r.status, out, ran: out.split(/\r?\n/).filter((l) => /^(PASS|FAIL)  \S/.test(l) && !/BP_CHECK|--failed|record/.test(l)) };
};
const nAll = every.length;
const amb = refusal(['--failed'], { BP_CHECK_ONLY: 'check:standard' });
check('--failed with BP_CHECK_ONLY: exits 1, names the ambiguity, runs nothing', amb.code === 1 && /^FAIL  --failed and BP_CHECK_ONLY='check:standard' together are ambiguous; use one$/m.test(amb.out) && !amb.ran.length, `exit ${amb.code} ${amb.out.slice(0, 300)}`);
const dead = refusal([], { BP_CHECK_ONLY: 'check:standard,overlys' });
check('a BP_CHECK_ONLY term matching no check: exits 1, names the term, runs nothing (even with a live term beside it)', dead.code === 1 && /^FAIL  BP_CHECK_ONLY term 'overlys' matches none of the \d+ checks$/m.test(dead.out)
  && !/selected 0 of/.test(dead.out) && !dead.ran.length && /^0 passed, 1 failed, 0 skipped of \d+$/m.test(dead.out), `exit ${dead.code} ${dead.out.slice(0, 300)}`);
const zero = refusal([], { BP_CHECK_ONLY: 'overlys' });
check('BP_CHECK_ONLY selecting 0 checks: exits 1 saying nothing was run, runs nothing', zero.code === 1 && new RegExp(`^FAIL  BP_CHECK_ONLY='overlys' selected 0 of ${nAll} checks: nothing was run$`, 'm').test(zero.out)
  && !zero.ran.length && !/^0 passed, 0 failed/m.test(zero.out), `exit ${zero.code} ${zero.out.slice(0, 300)}`);
for (const v of ['abc', '0', '-5']) {
  const t = refusal([], { BP_CHECK_ONLY: 'check:standard', BP_CHECK_TIMEOUT_MS: v });
  check(`BP_CHECK_TIMEOUT_MS=${v}: exits 1 naming the value, runs nothing`, t.code === 1 && t.out.includes(`FAIL  BP_CHECK_TIMEOUT_MS='${v}' is not a positive number of milliseconds`) && !t.ran.length, `exit ${t.code} ${t.out.slice(0, 300)}`);
}

// GUARD: a seeded red child still makes the aggregate exit 1, is recorded, and the report shows its FAIL text + rerun.
const sr = all('["check:overlays"]', { BP_OVERLAYS_MUTATE: '[["Phone.tsx","height: 44","height: 40"]]' });
check('GUARD: a red child makes the aggregate exit 1', sr.code === 1, `exit ${sr.code}\n${sr.out.slice(-400)}`);
check('a red child is recorded', eq(sr.after, ['check:overlays']), JSON.stringify(sr.after));
check('the red report prints the exact rerun', sr.out.includes('npm run -s check:overlays'), sr.out.slice(-400));
check('a red run\'s last line names the check and --failed', sr.last.includes('check:overlays') && sr.last.includes('npm run check -- --failed'), sr.last);

// The counts (platform-checks:B). countOf reads the expectation count a child prints (its RESULT line first, else a prose
// summary, else null), the PASS line shows it, the summary totals it and names the uncounted checks, and a per-checkout
// baseline of the last GREEN counts (BP_CHECK_COUNTS, here in the throwaway dir) names a check that now asserts fewer
// things: THINNER, reported and never failed. A red run never writes the baseline; an unreadable one is noted and rewritten.
const countCase = (label, out, want) => { const got = call('countOf', out); check(`countOf: ${label}`, got === want, `${JSON.stringify(got)}, expected ${want}`); };
countCase('a harness summary', 'check-overlays: 92 expectations held', 92);
countCase('N passed, M failed', 'check-x: 5 passed, 0 failed', 5);
countCase('N of T ... expectations hold', '12 of 12 sim-answer expectations hold', 12);
countCase('N checks passed', 'check-stream-status: 31 checks passed', 31);
countCase('a RESULT line wins over a prose count', 'check-y: 9 expectations held\nRESULT {"check":"check-y","held":7,"failed":0,"skipped":0}', 7);
countCase('tsc\'s silent success is uncounted (null), never 0', '', null);
countCase('two different summaries are null, not a guess', 'a: 3 expectations held\nb: 4 expectations held', null);
countCase('a count quoted in a FAIL line is not read', 'FAIL  expected 5 expectations held, got 4', null);
countCase('an N of T sub-tally gives way to the summary beside it', 'acceptance cases: 8 of 8 hold\nreview record: 15 assertions held', 15);
check('the counts baseline defaults to os.tmpdir keyed by sha1(ROOT), outside the repo', call('countsPath', ROOT, {}) === path.join(os.tmpdir(), `bp-check-counts-${sha}.json`), call('countsPath', ROOT, {}));
check('BP_CHECK_COUNTS overrides the counts path', call('countsPath', ROOT, { BP_CHECK_COUNTS: '/x/c.json' }) === '/x/c.json');

const cnt = path.join(dir, 'counts.json');
const runOnly = (only, counts, extraEnv = {}) => {
  if (counts === undefined) fs.rmSync(cnt, { force: true }); else fs.writeFileSync(cnt, counts);
  fs.rmSync(rec, { force: true });
  const env = { ...process.env, BP_CHECK_RECORD: rec, BP_CHECK_COUNTS: cnt, BP_CHECK_ONLY: only, ...extraEnv };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-all.mjs')], { cwd: ROOT, env, encoding: 'utf8', timeout: 180000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const lines = out.trim().split(/\r?\n/);
  let after = null, parsed = null;
  try { after = fs.readFileSync(cnt, 'utf8'); parsed = JSON.parse(after); } catch { /* none, or not json */ }
  return { code: r.status, out, lines, last: lines.at(-1), after, parsed };
};
// case 2: no baseline yet -> the PASS line carries the count, and the baseline is written from it
const c2 = runOnly('check:overlays', undefined);
const pass2 = c2.lines.find((l) => /^PASS  check:overlays\b/.test(l)) ?? '';
const N = Number((/^PASS  check:overlays  (\d+) held +\d+\.\ds$/.exec(pass2) ?? [])[1]);
check('counts case 2: a green run with no baseline exits 0', c2.code === 0, `exit ${c2.code}\n${c2.out.slice(-400)}`);
check('counts case 2: the PASS line reads PASS  check:overlays  <N> held  <t>s', N > 0, pass2 || c2.out.slice(-400));
check('counts case 2: the baseline is written as {"check:overlays":N}', N > 0 && eq(c2.parsed, { 'check:overlays': N }), c2.after);
// case 3: the baseline holds 5 more -> THINNER, reported and not failed, and the run's last line names it
const c3 = runOnly('check:overlays', JSON.stringify({ 'check:overlays': N + 5 }));
check('counts case 3: a thinner check is reported, not failed (exit 0)', N > 0 && c3.code === 0, `exit ${c3.code}\n${c3.out.slice(-400)}`);
check('counts case 3: the THINNER line names the check and the delta', N > 0 && new RegExp(`^THINNER  check:overlays  ${N + 5} -> ${N} held \\(5 fewer than the last green run\\)$`, 'm').test(c3.out), c3.out.slice(-500));
check('counts case 3: the run\'s last line names check:overlays as thinner', /thinner/i.test(c3.last) && c3.last.includes('check:overlays'), c3.last);
// case 4: the baseline holds 3 fewer -> no THINNER line, and the baseline is raised to N
const c4 = runOnly('check:overlays', JSON.stringify({ 'check:overlays': N - 3 }));
check('counts case 4: a check that grew prints no THINNER line', c4.code === 0 && !/^THINNER/m.test(c4.out), `exit ${c4.code}\n${c4.out.slice(-400)}`);
check('counts case 4: the baseline is raised to N', N > 0 && eq(c4.parsed, { 'check:overlays': N }), c4.after);
// case 5: a check that prints no count is named in the summary, never read as 0
const c5 = runOnly('check:overlays,check:tokens', undefined);
const sum5 = c5.lines.find((l) => /^\d+ passed, \d+ failed/.test(l)) ?? '';
check('counts case 5: the summary ends with the total and names the uncounted check', N > 0 && sum5.endsWith(` · ${N} expectations in 1 counted check; 1 uncounted: check:tokens`), sum5 || c5.out.slice(-400));
check('counts case 5: the uncounted check is not written to the baseline', N > 0 && eq(c5.parsed, { 'check:overlays': N }), c5.after);
// case 6: the seeded red child never lowers the baseline
const c6 = runOnly('check:overlays', JSON.stringify({ 'check:overlays': N }), { BP_OVERLAYS_MUTATE: '[["Phone.tsx","height: 44","height: 40"]]' });
check('counts case 6: the seeded red child exits 1', c6.code === 1, `exit ${c6.code}`);
check('counts case 6: a red run leaves the baseline as it was', N > 0 && eq(c6.parsed, { 'check:overlays': N }), c6.after);
// case 7: an unreadable baseline is noted, the verdict is the normal one, and the file is rewritten from the green counts
const c7 = runOnly('check:overlays', '{not json');
check('counts case 7: an unreadable baseline keeps the normal verdict (exit 0)', c7.code === 0, `exit ${c7.code}\n${c7.out.slice(-400)}`);
check('counts case 7: the unreadable baseline is noted with its path', c7.lines.some((l) => l.startsWith(`note: the counts baseline ${cnt} is unreadable (`) && l.endsWith('); no comparison this run')), c7.out.slice(-500));
check('counts case 7: the baseline is rewritten from this run', N > 0 && eq(c7.parsed, { 'check:overlays': N }), c7.after);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`check-aggregate-report: ${passed} held, ${failed} failed`);
process.exit(failed ? 1 : 0);
