#!/usr/bin/env node
// The art-pipeline scripts' local guards: no Blender, no ComfyUI, no Leonardo, no network beyond a loopback stub.
//   trellis-seed   trellis_run.mjs refuses a missing or non-integer seed before it touches the queue
// Run: node scripts/art/check-art-scripts.mjs   Exit 1 on any failure.
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

// A port nothing listens on. NEVER leave BP_COMFY_URL unset in a run of this file: the owner's ComfyUI may be up on
// 8188, and a script that is not refused submits a real GPU job to it.
const deadPort = await new Promise((res) => { const sv = net.createServer(); sv.listen(0, '127.0.0.1', () => { const { port } = sv.address(); sv.close(() => res(port)); }); });
const DEAD = `http://127.0.0.1:${deadPort}`;

const TRELLIS = path.join(HERE, 'lamp', 'trellis_run.mjs');
for (const args of [[], ['abc'], ['1.5'], ['']]) {
  // No ComfyUI answers here: an unvalidated seed gets past the argument line and dies on the first fetch, so a
  // run that is refused FOR THE SEED says so by name and a run that is not says something else.
  const r = spawnSync(process.execPath, [TRELLIS, ...args], { encoding: 'utf8', timeout: 20000, env: { ...process.env, BP_COMFY_URL: DEAD } });
  check(`trellis-seed: argv ${JSON.stringify(args)} is refused by name`, r.status !== 0 && /seed must be an integer/.test(r.stderr ?? ''), `exit ${r.status}, stderr: ${(r.stderr ?? '').split('\n').find(Boolean) ?? ''}`);
}

{
  const r = spawnSync(process.execPath, [TRELLIS, '303'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, BP_COMFY_URL: DEAD } });
  check('trellis-seed: a valid seed passes the guard (it gets as far as the unreachable ComfyUI)', r.status !== 0 && !/seed must be an integer/.test(r.stderr ?? ''), `exit ${r.status}`);
}

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
