#!/usr/bin/env node
// Aggregate gate: typecheck + every check:* script in package.json + validate:structure, one line each.
// New check:* scripts join automatically. check:python-deps runs only when Python is on PATH (else skipped).
// A CHILD reports that it did not run everything by printing a line starting with `SKIP` (the same shape
// this runner prints); those lines are reprinted under the check that emitted them and counted in the
// summary. A SKIP inside a child FAILS the suite (owner ruling, 2026-10-22): a run printing "0 skipped" over ten
// unrun expectations was an unrun check reporting success. The failure names the child and the skip's own text.
// The only exemptions are in OPT_OUT below, each justified where it is declared.
// A check that never exits used to hang the whole gate with no output and no verdict: the run() promise settled only on the
// child's 'close' event. Each check now has a ceiling (BP_CHECK_TIMEOUT_MS, default 120000 - the slowest check in this tree is
// about 16 s) after which its process tree is killed and it is reported as "FAIL <name> (timed out after Ns)"; a spawn that
// fails (an 'error' event) is reported as a failure by name too. Both exit 1.
// Run: npm run check   (BP_CHECK_ONLY=a,b limits the run to scripts whose name contains one of the terms;
// a term that matches no check is a typo and fails the run before anything executes, rather than reporting
// a green gate over 0 checks)
// A red run prints, per failing check, every FAIL line of its output above the 25-line tail and then the tail
// (scripts/lib/check-report.mjs), plus the exact command that reruns it. Each run records the checks it left red
// (os.tmpdir()/bp-check-<sha1(root)>.json, or BP_CHECK_RECORD), and `npm run check -- --failed` reruns exactly that set:
// no record, an empty one or a name no longer in package.json fails before anything runs. --failed is the fix loop,
// never the gate: the full npm run check still runs before a push, and the run's last line says so.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { failReport, rerunFor, recordPath, parseRecord, mergeRecord, lastLine } from './lib/check-report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
const hasPython = ['python', 'python3', 'py'].some((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
const only = (process.env.BP_CHECK_ONLY ?? '').split(',').filter(Boolean);

const all = ['typecheck', ...Object.keys(scripts).filter((k) => k.startsWith('check:')), 'validate:structure'];
const failedMode = process.argv.includes('--failed');
const RECORD = recordPath(ROOT, process.env);
const readRecord = () => { try { return parseRecord(fs.readFileSync(RECORD, 'utf8')); } catch { return parseRecord(null); } };
const prevRecord = readRecord();
if (failedMode) {
  // Exact names from the record, never substrings: BP_CHECK_ONLY=check:standard also selects check:standard-fixtures.
  const stale = prevRecord.names?.filter((n) => !all.includes(n)) ?? [];
  const why = only.length ? `--failed and BP_CHECK_ONLY='${only.join(',')}' together are ambiguous; use one`
    : prevRecord.error ? `--failed: ${prevRecord.error} (${RECORD}); run npm run check`
    : stale.length ? `--failed: the record names ${stale.map((n) => `'${n}'`).join(', ')}, no longer a check in package.json; run npm run check` : '';
  if (why) { console.log(`FAIL  ${why}`); console.log('\n0 passed, 1 failed, 0 skipped of 0'); process.exit(1); }
}
const names = failedMode ? all.filter((n) => prevRecord.names.includes(n))
  : all.filter((n) => !only.length || only.some((o) => n.includes(o)));
// A narrowing term that matches nothing is a TYPO, and the run it produces reads exactly like success:
// `BP_CHECK_ONLY=overlys` ran 0 checks and exited 0, and one dead term among several quietly left its
// checks out of a run the caller believed covered them. Both are refused here, before anything runs.
const dead = only.filter((o) => !all.some((n) => n.includes(o)));
if (!failedMode && (dead.length || !names.length)) {
  for (const o of dead) console.log(`FAIL  BP_CHECK_ONLY term '${o}' matches none of the ${all.length} checks`);
  if (!names.length) console.log(`FAIL  BP_CHECK_ONLY='${only.join(',')}' selected 0 of ${all.length} checks: nothing was run`);
  console.log(`\n0 passed, ${dead.length || 1} failed, 0 skipped of ${all.length}`);
  process.exit(1);
}
const timeoutMs = process.env.BP_CHECK_TIMEOUT_MS === undefined ? 120000 : Number(process.env.BP_CHECK_TIMEOUT_MS);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.log(`FAIL  BP_CHECK_TIMEOUT_MS='${process.env.BP_CHECK_TIMEOUT_MS}' is not a positive number of milliseconds`);
  process.exit(1);
}
/** Kill a child AND its descendants: the child is a shell, and npm and node run under it. */
const killTree = (p) => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/t', '/f'], { stdio: 'ignore' });
  else { try { process.kill(-p.pid, 'SIGKILL'); } catch { p.kill('SIGKILL'); } }
};
// SKIP lines a child may print WITHOUT failing the suite. Keyed by check name; each entry is {when, why}: `when`
// says whether the exemption applies in THIS environment (an exemption that held everywhere would let the skip
// hide on a machine that has the dependency), `why` is the justification. Add nothing here without both.
const OPT_OUT = {
  // check-python-syntax parses the repo's .py files with a python binary; with no interpreter on PATH there is
  // nothing to run it with. That is an environment fact the repo accepted (check:python-deps is skipped by this
  // runner on the same condition). It is exempt ONLY when this runner also found no python: a skip on a machine
  // that has python is a real hole and fails.
  'check:python-syntax': { when: () => !hasPython, why: 'python not on PATH (accepted by design)' },
};
/** The SKIP lines of a result that the suite does not forgive. */
const unforgiven = (name, skips, optOut = OPT_OUT) => (optOut[name]?.when() ? [] : skips);
const skipped = new Map();
if (!hasPython && names.includes('check:python-deps')) skipped.set('check:python-deps', 'python not on PATH');

const run = (name, cmd = `npm run -s ${name}`, ceiling = timeoutMs) => new Promise((resolve) => {
  const t0 = performance.now();
  const p = spawn(cmd, { cwd: ROOT, shell: true, detached: process.platform !== 'win32' });
  let out = '', settled = false, why = '';
  const done = (code) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    if (why) out += (out && !out.endsWith('\n') ? '\n' : '') + why + '\n';
    resolve({ name, code, ms: performance.now() - t0, out, skips: out.split(/\r?\n/).filter((l) => /^\s*SKIP\b/.test(l)).map((l) => l.trim()) });
  };
  const timer = setTimeout(() => { why = `FAIL ${name} (timed out after ${ceiling / 1000}s)`; killTree(p); setTimeout(() => done(1), 2000).unref(); }, ceiling);
  p.on('error', (e) => { why = `FAIL ${name} (could not be run: ${e.message})`; done(1); });
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  // `SKIP` at the start of a line is this runner's own convention for "this did not run" (it prints the
  // same shape at the end), so a child reports an internal skip by using it. Matched anchored, never as a
  // bare substring: four checks in this tree use the word "skipped" inside assertion text about a triage
  // API's `skipped` array, and a substring match would read those as skipped checks.
  p.on('close', (code) => done(why ? 1 : code));
});

// The control: a child that never exits must come back as a named timeout AND be dead afterwards (the tree kill reached the
// node process under the shell), or the ceiling above has stopped working and a hung check would again wedge this gate in
// silence. It runs every time, costs about half a second, and fails the run loudly.
const ctl = await run('control:hang', 'node -e "console.log(process.pid);setInterval(function(){},1000)"', 400);
const ctlPid = Number((/^(\d+)\s*$/m.exec(ctl.out) ?? [])[1]);
await new Promise((r) => setTimeout(r, 300));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const ctlWhy = ctl.code === 0 || !/timed out after/.test(ctl.out) ? `it did not time out (exit ${ctl.code})`
  : !ctlPid ? 'the control child never reported its pid'
  : alive(ctlPid) ? `the killed child (pid ${ctlPid}) is still running` : '';
if (ctlWhy) {
  console.log(`FAIL  the hang control: ${ctlWhy}; a hung check would wedge this gate`);
  if (ctlPid && alive(ctlPid)) try { process.kill(ctlPid, 'SIGKILL'); } catch { /* gone */ }
  process.exit(1);
}

// The control for the skip policy: a child that prints a SKIP line must come back as a failure naming the line, an
// opted-out one must not, and an opt-out whose `when` is false must not forgive. Fixtures; runs every time.
const skCtl = await run('control:skip', 'node -e "console.log(process.argv[1])" "SKIP  fixture: not run"');
const skWhy = skCtl.code !== 0 || skCtl.skips.length !== 1 ? 'the fixture child did not report exactly one SKIP line'
  : unforgiven('fixture', skCtl.skips, {}).length !== 1 ? 'a SKIP from a check with no opt-out was forgiven'
  : unforgiven('fixture', skCtl.skips, { fixture: { when: () => true, why: 'control' } }).length !== 0 ? 'an opted-out SKIP was not forgiven'
  : unforgiven('fixture', skCtl.skips, { fixture: { when: () => false, why: 'control' } }).length !== 1 ? 'an opt-out whose condition is false forgave a SKIP' : '';
if (skWhy) { console.log(`FAIL  the skip control: ${skWhy}; a skipped check would read as a pass`); process.exit(1); }

const todo = names.filter((n) => !skipped.has(n));
const results = [];
const queue = [...todo];
const width = Math.max(...names.map((n) => n.length));
// a few at a time: the checks are independent and read-only
await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
  for (let n; (n = queue.shift()); ) {
    const r = await run(n);
    results.push(r);
    console.log(`${r.code === 0 && !unforgiven(r.name, r.skips).length ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${(r.ms / 1000).toFixed(1).padStart(5)}s`);
    // A child's own SKIP lines are the only sign that a passing check did not run everything, and this
    // runner used to discard the output of anything that exited 0. They are REPRINTED here, under the
    // check that reported them, and counted in the summary - a passing check that skipped ten expectations
    // must not read identically to one that ran them all.
    for (const l of r.skips) console.log(`      ${r.name}: ${l}`);
  }
}));
for (const [n, why] of skipped) console.log(`SKIP  ${n.padEnd(width)}  ${why}`);
for (const r of results) r.bad = unforgiven(r.name, r.skips);
const failed = results.filter((r) => r.code !== 0 || r.bad.length);
const rerun = (n) => { try { return `  rerun: ${rerunFor(n, scripts)}`; } catch (e) { return `  (no rerun: ${e.message})`; } };
for (const r of failed) {
  if (r.code === 0) console.log(`\nFAIL  ${r.name} exited 0 but printed SKIP, which fails the suite (a skip is an unrun check):\n${r.bad.map((l) => '  ' + l).join('\n')}\n${rerun(r.name)}`);
  else console.log(`\n--- ${r.name} (exit ${r.code}) ---\n${failReport(r.name, r.out)}\n${rerun(r.name)}`);
}
// This checkout's red set; a narrowed run keeps the red checks it did not run. Losing the record costs only --failed.
const red = names.filter((n) => failed.some((r) => r.name === n));
try { fs.writeFileSync(RECORD, JSON.stringify(mergeRecord(prevRecord.names ?? [], todo, red))); }
catch (e) { console.log(`note: could not write the record ${RECORD}: ${e.message}`); }
const partial = results.filter((r) => r.skips.length);
const nSkips = partial.reduce((n, r) => n + r.skips.length, 0);
const nBad = results.reduce((n, r) => n + r.bad.length, 0);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${skipped.size} skipped of ${names.length}`
  + (partial.length ? `; ${partial.length} check(s) printed ${nSkips} SKIP line(s), ${nBad} not opted out and failing: ${partial.map((r) => r.name).join(', ')}` : ''));
const tailLine = lastLine(red, failedMode ? names.length : null);
if (tailLine) console.log(tailLine);
process.exit(failed.length ? 1 : 0);
