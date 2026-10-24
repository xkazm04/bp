// Pins what the module-hook loaders do with a .json file that does not parse: packages/core/register-hooks.mjs
// (apps/server's loader, installed by register.mjs) and scripts/lib/src-hooks.mjs (the checks' one loader), in both its
// strip mode and its transpile mode, and through the scripts/overlays-loader.mjs shim over it. Each inlines a
// .json as `export default <text>`, so an empty or truncated file used to fail as a bare SyntaxError about the
// GENERATED module ("Unexpected end of input") with no file in it. The rule: the error names the file (and, for a
// truncation, the offset JSON.parse reports); a valid file still loads and still is its parsed value.
// Each case runs in a child node over a throwaway fixture directory, through the real loader entry point.
// It also pins the rest of the one-loader contract: transpile mode loads a .tsx component and a parameter property,
// `mutate` rewrites source before transpiling (the BP_*_MUTATE seeded controls), overlays-loader.mjs stays a shim
// with no resolve()/load() of its own, and check-legacy-unmeasured.mjs registers the transpiling loader instead of
// re-executing itself under a Node flag.
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
const HOOKS = JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts/lib/src-hooks.mjs')).href);
const srcHooks = (opts) => `import { registerSrcHooks } from ${HOOKS};\nregisterSrcHooks(${JSON.stringify(ROOT)}${opts ? ', ' + opts : ''});\n`;
const loaders = {
  'core register-hooks.mjs': (f) => ({ entry: body(f), args: ['--import', pathToFileURL(path.join(ROOT, 'packages/core/register.mjs')).href] }),
  'scripts/lib/src-hooks.mjs': (f) => ({ entry: srcHooks('') + body(f), args: [] }),
  'scripts/lib/src-hooks.mjs transpile': (f) => ({ entry: srcHooks('{ transpile: true }') + body(f), args: [] }),
  'scripts/overlays-loader.mjs': (f) => ({
    entry: `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts/overlays-loader.mjs')).href)}, { data: { src: ${JSON.stringify(path.join(ROOT, 'apps/web/src'))}, root: ${JSON.stringify(ROOT)}, mutate: [] } });\n${body(f)}`,
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

// ---- transpile mode and mutate. The fixture dir links the repo's node_modules (a junction on Windows) so the
// emitted `react/jsx-runtime` import and react-dom/server resolve; it is not under node_modules itself, where Node
// refuses to strip types and a strip-mode refusal would be misread.
const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-loader-ts-'));
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tdir, 'node_modules'), 'junction');
fs.writeFileSync(path.join(tdir, 'comp.tsx'), 'export const Comp = ({ n }: { n: number }) => <b data-n={n}>hi</b>;\n');
fs.writeFileSync(path.join(tdir, 'cls.ts'), 'export class K { constructor(private p: number) {} get(): number { return this.p; } }\n');
fs.writeFileSync(path.join(tdir, 'm.ts'), 'export const f = (): number => { return 1; };\n');
const fx = (f) => JSON.stringify(pathToFileURL(path.join(tdir, f)).href);
const report = `.then((v) => console.log('OK ' + v), (e) => console.log('ERR ' + String(e && e.message).replace(/\\s+/g, ' ')))`;
const runEntry = (name, code) => {
  const file = path.join(tdir, name + '.mjs');
  fs.writeFileSync(file, code + report + ';\n');
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 30000 });
  return (r.stdout ?? '').trim() || (r.stderr ?? '').trim().split('\n').slice(0, 3).join(' ');
};
{
  const out = runEntry('tsx', srcHooks('{ transpile: true }') +
    `Promise.all([import('react'), import('react-dom/server'), import(${fx('comp.tsx')})]).then(([R, S, m]) => S.renderToStaticMarkup(R.createElement(m.Comp, { n: 3 })))`);
  check('transpile: a .tsx JSX component loads and renders through react-dom/server', out === 'OK <b data-n="3">hi</b>', out);
}
{
  const out = runEntry('cls', srcHooks('{ transpile: true }') + `import(${fx('cls.ts')}).then((m) => new m.K(7).get())`);
  check('transpile: a .ts class with a constructor parameter property loads', out === 'OK 7', out);
}
for (const [mutate, want, isGuard] of [[[['m.ts', 'return 1', 'return 2']], 'OK 2', false], [[], 'OK 1', true]]) {
  const out = runEntry('mut' + mutate.length, srcHooks(`{ transpile: true, mutate: ${JSON.stringify(mutate)} }`) + `import(${fx('m.ts')}).then((m) => m.f())`);
  check(`transpile + mutate ${JSON.stringify(mutate)} -> ${want.slice(3)}${isGuard ? ' (guard)' : ''}`, out === want, out);
}
fs.unlinkSync(path.join(tdir, 'node_modules')); // drop the link first: never recurse through it into the repo
fs.rmSync(tdir, { recursive: true, force: true });

// ---- overlays-loader.mjs is a shim: no resolve()/load() body, no source reading or transpiling of its own.
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const shimProblems = (t) => {
  const c = code(t), bad = [];
  if (/function\s+(resolve|load)\b|\b(resolve|load)\s*[:=]\s*(async\s*)?(\(|function|[A-Za-z_$]+\s*=>)/.test(c)) bad.push('defines its own resolve()/load()');
  for (const k of ['readFileSync', 'transpileModule', 'node:fs']) if (c.includes(k)) bad.push('uses ' + k);
  if (!/from\s+['"]\.\/lib\/src-hooks\.mjs['"]/.test(c)) bad.push('does not delegate to ./lib/src-hooks.mjs');
  return bad;
};
const shim = fs.readFileSync(path.join(ROOT, 'scripts/overlays-loader.mjs'), 'utf8');
check('overlays-loader.mjs is only a shim over scripts/lib/src-hooks.mjs', shimProblems(shim).length === 0, shimProblems(shim).join('; '));
check('the shim pin catches a re-added private load() (guard)', shimProblems(shim + '\nexport async function load(u, c, n) { return n(u, c); }\n').some((b) => b.includes('load')));

// ---- check-legacy-unmeasured.mjs registers the transpiling loader; it no longer re-execs under a Node flag.
const legacy = code(fs.readFileSync(path.join(ROOT, 'scripts/check-legacy-unmeasured.mjs'), 'utf8'));
check('check-legacy-unmeasured.mjs has no experimental-transform-types re-exec', !legacy.includes('experimental-transform-types'));
check('check-legacy-unmeasured.mjs registers src-hooks in transpile mode', /registerSrcHooks\(\s*ROOT\s*,\s*\{\s*transpile:\s*true/.test(legacy));

console.log(`\ncheck-loader-json: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
