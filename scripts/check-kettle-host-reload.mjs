#!/usr/bin/env node
// The hosted Kettle sims survive a module reload (packages/core/src/server/kettle-sim.server.ts). jobs.server.ts and
// release.server.ts keep their process-lifetime registries on globalThis "so a dev-server module reload keeps" them;
// the Kettle host is the same kind of state and must follow the same rule, or a reload that re-evaluates the module
// drops the host and Kettle answers unknownProduct's 405 as though the process had never hosted a sim.
// The reload is reproduced the way a dev server does it: the module is evaluated twice under two distinct specifiers
// (`?reload=1`, `?reload=2`), so each evaluation gets its own module scope. The sims are installed through the first
// evaluation and asked for through the second; a host that lives in a module-level `let` is lost between the two.
// Control (every run): the same two evaluations over a copy of the module whose host is a module-level `let` must LOSE
// the host, so a probe that cannot tell the two apart (both evaluations sharing one scope) fails the check.
// Run: node scripts/check-kettle-host-reload.mjs   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'packages/core/src/server');
register(pathToFileURL(path.join(ROOT, 'packages/core/register-hooks.mjs')).href);

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

// no product is registered (a registered `kettle` would shadow the sample), so the answer depends on the host alone
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-kettle-host-')));

/** Install through one evaluation of `file`, ask through another; the answer is what the second one hands back. */
async function reloadAnswer(file, tag) {
  const url = pathToFileURL(file).href;
  const first = await import(`${url}?reload=${tag}1`), second = await import(`${url}?reload=${tag}2`);
  const scan = { marker: tag }, swarm = { marker: tag };
  first.hostKettle({ scan, swarm });
  return { same: first !== second, own: first.kettleSim('kettle') === scan, after: second.kettleSim('kettle') === scan };
}

const real = await reloadAnswer(path.join(SERVER, 'kettle-sim.server.ts'), 'real');
check('the module is evaluated twice (two scopes), as a dev-server reload does', real.same);
check('the evaluation that installed the host answers for it', real.own);
check('a second evaluation of the module still answers for the hosted sim', real.after);

// control: a module whose host is a module-level `let` (the shape under test, written out) must LOSE the host between the
// two evaluations; if it did not, both evaluations would be sharing one scope and the checks above would prove nothing
const ctl = path.join(os.tmpdir(), `bp-kettle-host-control-${process.pid}.mjs`);
fs.writeFileSync(ctl, ['let host = null;', 'export const hostKettle = (h) => { host = h; };', 'export const kettleSim = () => (host ? host.scan : null);', ''].join('\n'));
try {
  const c = await reloadAnswer(ctl, 'ctl');
  check('control: the install is seen by the evaluation that made it', c.own);
  check('control: a module-level let loses the host across evaluations (the probe tells the two apart)', c.after === false);
} finally { fs.rmSync(ctl, { force: true }); }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);


