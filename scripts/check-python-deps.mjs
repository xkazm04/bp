#!/usr/bin/env node
// Gate: every third-party Python import in a tracked .py file is declared in requirements-tools.txt.
// Stdlib and sibling-module imports are not third-party. Exits 1 listing the undeclared packages.
//
// WHAT COUNTS AS STDLIB IS ASKED OF PYTHON, not kept here: `sys.stdlib_module_names` is the
// interpreter's own enumeration, so an import of a stdlib module nobody listed (`dataclasses`, `csv`,
// `logging`, `enum`, ...) is not reported as an undeclared third-party package. SEED_STDLIB below is only
// the fallback for a machine with no Python, and the derived set is checked to cover it: a name that
// leaves the standard library is then reported rather than silently excused.
// Run: node scripts/check-python-deps.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_STDLIB = ['os', 'sys', 'time', 'json', 'statistics', 're', 'math', 'pathlib', 'argparse', 'subprocess', 'collections', 'itertools', 'functools', 'typing', 'glob', 'shutil', 'datetime', 'random', 'io', 'urllib', 'importlib'];
/** Python's own stdlib enumeration, or null when no interpreter answers. */
function askPython() {
  for (const bin of ['python', 'python3', 'py']) {
    const r = spawnSync(bin, ['-I', '-c', "import sys;print('\\n'.join(sys.stdlib_module_names))"], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.includes('sys')) return { bin, names: r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) };
  }
  return null;
}
const py = askPython();
const STDLIB = new Set(py ? py.names : SEED_STDLIB);
const source = py ? `${py.bin} sys.stdlib_module_names (${STDLIB.size} modules)` : `the ${SEED_STDLIB.length}-name fallback list (no Python on PATH)`;
let notes = 0, ctlFailed = 0;
// controls: the derived set must cover every name the fallback claims, must hold a stdlib module the
// fallback does not, and must NOT hold a third-party one - a set that stopped answering excuses everything.
if (py) {
  for (const n of SEED_STDLIB) if (!STDLIB.has(n)) { notes++; console.log(`note  '${n}' is in this check's fallback list and not in ${py.bin}'s standard library any more`); }
  for (const [n, want] of [['dataclasses', true], ['logging', true], ['playwright', false], ['PIL', false]]) {
    if (STDLIB.has(n) !== want) { ctlFailed++; console.log(`FAIL  control: ${py.bin} stdlib ${want ? 'should' : 'should not'} name '${n}' - the stdlib query stopped answering`); }
  }
}
// import name -> requirements distribution name
const DIST = { PIL: 'pillow', playwright: 'playwright' };
// modules a host program embeds, not installable with pip: `unreal` is the UE editor's own Python
// (apps/vr/tools/mcp-steps/py runs inside the editor through the MCP)
const HOST_PROVIDED = new Set(['unreal']);

const files = execFileSync('git', ['ls-files', '*.py'], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const local = new Set(files.map((f) => path.basename(f, '.py')));
const reqFile = path.join(ROOT, 'requirements-tools.txt');
const declared = new Set(
  (fs.existsSync(reqFile) ? fs.readFileSync(reqFile, 'utf8') : '').split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim().split(/[<>=!~\[;\s]/)[0].toLowerCase()).filter(Boolean),
);

const used = new Map(); // import name -> files
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/^[ \t]*(?:from[ \t]+([A-Za-z_]\w*)[\w.]*[ \t]+import\b|import[ \t]+([^\n#]+))/gm)) {
    const names = m[1] ? [m[1]] : m[2].split(',').map((s) => s.trim().split(/[ .]/)[0]).filter(Boolean);
    for (const n of names) {
      if (STDLIB.has(n) || local.has(n) || HOST_PROVIDED.has(n)) continue;
      (used.get(n) ?? used.set(n, []).get(n)).push(f);
    }
  }
}
let missing = 0;
for (const [n, fs_] of used) {
  const ok = declared.has((DIST[n] ?? n).toLowerCase());
  if (!ok) missing++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} (${fs_.length} files)${ok ? '' : ' not declared in requirements-tools.txt'}`);
}
console.log(`\n${used.size - missing} of ${used.size} third-party packages declared; stdlib from ${source}${notes ? `; ${notes} note(s)` : ''}${ctlFailed ? `; ${ctlFailed} control(s) failed` : ''}`);
process.exit(missing || ctlFailed ? 1 : 0);
