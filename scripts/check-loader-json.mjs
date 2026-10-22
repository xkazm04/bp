// Pins what the two module-hook loaders do with a .json file that does not parse: packages/core/register-hooks.mjs
// (apps/server's loader, installed by register.mjs) and scripts/lib/src-hooks.mjs (the checks' near-twin). Both inline a
// .json as `export default <text>`, so an empty or truncated file used to fail as a bare SyntaxError about the
// GENERATED module ("Unexpected end of input") with no file in it. The rule: the error names the file (and, for a
// truncation, the offset JSON.parse reports); a valid file still loads and still is its parsed value.
// Each case runs in a child node over a throwaway fixture directory, through the real loader entry point.
// Run: node scripts/check-loader-json.mjs   (exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-loader-json-'));
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const fixtures = { 'empty.json': '', 'truncated.json': '{"a": 1, "b": [1, 2', 'good.json': '{"a": 1, "b": [1, 2]}' };
for (const [f, text] of Object.entries(fixtures)) fs.writeFileSync(path.join(dir, f), text);

// One entry per loader; each prints `LOADED <json of the default export>` or `ERR <message>` on stdout.
const body = (f) => `import(${JSON.stringify(pathToFileURL(path.join(dir, f)).href)}).then((m) => console.log('LOADED ' + JSON.stringify(m.default)), (e) => console.log('ERR ' + String(e && e.message).replace(/\\s+/g, ' ')));`;
const loaders = {
  'core register-hooks.mjs': (f) => ({ entry: body(f), args: ['--import', pathToFileURL(path.join(ROOT, 'packages/core/register.mjs')).href] }),
  'scripts/lib/src-hooks.mjs': (f) => ({
    entry: `import { registerSrcHooks } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts/lib/src-hooks.mjs')).href)};\nregisterSrcHooks(${JSON.stringify(ROOT)});\n${body(f)}`,
    args: [],
  }),
};

let n = 0;
for (const [lname, mk] of Object.entries(loaders)) {
  for (const f of Object.keys(fixtures)) {
    const { entry, args } = mk(f);
    const entryFile = path.join(dir, `entry-${n++}.mjs`);
    fs.writeFileSync(entryFile, entry);
    const r = spawnSync(process.execPath, [...args, entryFile], { encoding: 'utf8', timeout: 30000 });
    const out = (r.stdout ?? '').trim();
    const name = `${lname}: ${f}`;
    if (f === 'good.json') {
      check(`${name} still loads as its parsed value`, out === 'LOADED {"a":1,"b":[1,2]}', out || r.stderr);
      continue;
    }
    check(`${name} is refused`, out.startsWith('ERR '), out || r.stderr);
    check(`${name} names the file`, out.includes(f), out);
    if (f === 'truncated.json') check(`${name} names the offset`, /position \d+/.test(out), out);
  }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\ncheck-loader-json: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
