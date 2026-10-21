#!/usr/bin/env node
// Aggregate gate: typecheck + every check:* script in package.json + validate:structure, one line each.
// New check:* scripts join automatically. check:python-deps runs only when Python is on PATH (else skipped).
// A CHILD reports that it did not run everything by printing a line starting with `SKIP` (the same shape
// this runner prints); those lines are reprinted under the check that emitted them and counted in the
// summary. They are NOT fatal - whether a skipped expectation should fail the suite is the owner's call -
// but a passing check that skipped ten expectations must not read identically to one that ran them all.
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
const skipped = new Map();
if (!hasPython && names.includes('check:python-deps')) skipped.set('check:python-deps', 'python not on PATH');

const run = (name) => new Promise((resolve) => {
  const t0 = performance.now();
  const p = spawn(`npm run -s ${name}`, { cwd: ROOT, shell: true });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  // `SKIP` at the start of a line is this runner's own convention for "this did not run" (it prints the
  // same shape at the end), so a child reports an internal skip by using it. Matched anchored, never as a
  // bare substring: four checks in this tree use the word "skipped" inside assertion text about a triage
  // API's `skipped` array, and a substring match would read those as skipped checks.
  p.on('close', (code) => resolve({ name, code, ms: performance.now() - t0, out, skips: out.split(/\r?\n/).filter((l) => /^\s*SKIP\b/.test(l)).map((l) => l.trim()) }));
});

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
