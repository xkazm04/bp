#!/usr/bin/env node
// Aggregate gate: typecheck + every check:* script in package.json + validate:structure, one line each.
// New check:* scripts join automatically. check:python-deps runs only when Python is on PATH (else skipped).
// A CHILD reports that it did not run everything by printing a line starting with `SKIP` (the same shape
// this runner prints); those lines are reprinted under the check that emitted them and counted in the
// summary. They are NOT fatal - whether a skipped expectation should fail the suite is the owner's call -
// but a passing check that skipped ten expectations must not read identically to one that ran them all.
// A check that never exits used to hang the whole gate with no output and no verdict: the run() promise settled only on the
// child's 'close' event. Each check now has a ceiling (BP_CHECK_TIMEOUT_MS, default 120000 - the slowest check in this tree is
// about 16 s) after which its process tree is killed and it is reported as "FAIL <name> (timed out after Ns)"; a spawn that
// fails (an 'error' event) is reported as a failure by name too. Both exit 1.
// Run: npm run check   (BP_CHECK_ONLY=a,b limits the run to scripts whose name contains one of the terms;
// a term that matches no check is a typo and fails the run before anything executes, rather than reporting
// a green gate over 0 checks)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
const hasPython = ['python', 'python3', 'py'].some((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
const only = (process.env.BP_CHECK_ONLY ?? '').split(',').filter(Boolean);

const all = ['typecheck', ...Object.keys(scripts).filter((k) => k.startsWith('check:')), 'validate:structure'];
const names = all.filter((n) => !only.length || only.some((o) => n.includes(o)));
// A narrowing term that matches nothing is a TYPO, and the run it produces reads exactly like success:
// `BP_CHECK_ONLY=overlys` ran 0 checks and exited 0, and one dead term among several quietly left its
// checks out of a run the caller believed covered them. Both are refused here, before anything runs.
const dead = only.filter((o) => !all.some((n) => n.includes(o)));
if (dead.length || !names.length) {
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

const todo = names.filter((n) => !skipped.has(n));
const results = [];
const queue = [...todo];
const width = Math.max(...names.map((n) => n.length));
// a few at a time: the checks are independent and read-only
await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
  for (let n; (n = queue.shift()); ) {
    const r = await run(n);
    results.push(r);
    console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${(r.ms / 1000).toFixed(1).padStart(5)}s`);
    // A child's own SKIP lines are the only sign that a passing check did not run everything, and this
    // runner used to discard the output of anything that exited 0. They are REPRINTED here, under the
    // check that reported them, and counted in the summary - a passing check that skipped ten expectations
    // must not read identically to one that ran them all.
    for (const l of r.skips) console.log(`      ${r.name}: ${l}`);
  }
}));
for (const [n, why] of skipped) console.log(`SKIP  ${n.padEnd(width)}  ${why}`);
const failed = results.filter((r) => r.code !== 0);
for (const r of failed) console.log(`\n--- ${r.name} (exit ${r.code}) ---\n${r.out.trim().split('\n').slice(-25).join('\n')}`);
const partial = results.filter((r) => r.skips.length);
const nSkips = partial.reduce((n, r) => n + r.skips.length, 0);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${skipped.size} skipped of ${names.length}`
  + (partial.length ? `; ${partial.length} passing check(s) skipped ${nSkips} of their own: ${partial.map((r) => r.name).join(', ')} - a green run here is NOT a full run` : ''));
process.exit(failed.length ? 1 : 0);
