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

fs.rmSync(dir, { recursive: true, force: true });
console.log(`check-aggregate-report: ${passed} held, ${failed} failed`);
process.exit(failed ? 1 : 0);
