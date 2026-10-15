#!/usr/bin/env node
// Gate: every third-party Python import in a tracked .py file is declared in requirements-tools.txt.
// Stdlib and sibling-module imports are not third-party. Exits 1 listing the undeclared packages.
// Run: node scripts/check-python-deps.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STDLIB = new Set(['os', 'sys', 'time', 'json', 'statistics', 're', 'math', 'pathlib', 'argparse', 'subprocess', 'collections', 'itertools', 'functools', 'typing', 'glob', 'shutil', 'datetime', 'random', 'io', 'urllib', 'importlib']);
// import name -> requirements distribution name
const DIST = { PIL: 'pillow', playwright: 'playwright' };

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
      if (STDLIB.has(n) || local.has(n)) continue;
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
console.log(`\n${used.size - missing} of ${used.size} third-party packages declared`);
process.exit(missing ? 1 : 0);
