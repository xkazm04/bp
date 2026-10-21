#!/usr/bin/env node
// Gate: every tracked .py file parses. `tsc --noEmit` covers **/*.ts and **/*.tsx and reaches no .py and no
// .mjs, and check-python-deps.mjs only greps their import lines, so until this check existed a syntax error
// in any of the 13 tracked Python files was invisible offline: scripts/perf.py, scripts/shots.py and
// scripts/fidelity/*.py all need a running server, and the nine variant tools are run by hand.
//
// The files are PARSED, never imported and never byte-compiled: `ast.parse` has no side effects and writes
// no __pycache__ into the tree (compileall would). Each file is parsed in its own `python -I` run, so a
// planted sitecustomize or a module next to it cannot execute. Skipped when no interpreter answers, exactly
// as check-all.mjs skips check:python-deps.
// Every run also proves itself red on a seeded file with a syntax error, in the OS temp dir.
// Run: node scripts/check-python-syntax.mjs   (exit 1 on any file that does not parse)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_FILES = 10;   // floor: below this `git ls-files *.py` stopped matching
const PARSE = 'import ast,sys;p=sys.argv[1];ast.parse(open(p,encoding="utf-8").read(),p)';

const bin = ['python', 'python3', 'py'].find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
if (!bin) { console.log('SKIP  check-python-syntax: python not on PATH'); process.exit(0); }

/** The first line of the SyntaxError python reports for `file`, or null when it parses. */
const parseErr = (file) => {
  const r = spawnSync(bin, ['-I', '-c', PARSE, file], { encoding: 'utf8' });
  if (r.status === 0) return null;
  const lines = (r.stderr || '').trim().split(/\r?\n/);
  return lines.filter((l) => /Error/.test(l)).pop() ?? lines.pop() ?? `exit ${r.status}`;
};

const files = execFileSync('git', ['ls-files', '*.py'], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const bad = [];
for (const f of files) {
  const err = parseErr(path.join(ROOT, f));
  if (err) bad.push(`${f}: ${err}`);
}

// ------------------------------------------------------------------ control: a seeded syntax error is caught
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-py-syntax-'));
let ctl = 0;
try {
  const good = path.join(dir, 'good.py'), broken = path.join(dir, 'broken.py');
  fs.writeFileSync(good, 'import os\n\n\ndef f(a):\n    return os.path.join(a, "x")\n');
  fs.writeFileSync(broken, 'import os\n\n\ndef f(a)\n    return os.path.join(a, "x")\n');
  if (parseErr(good)) { ctl++; console.log('FAIL  control: a well-formed file was reported as broken'); }
  const e = parseErr(broken);
  if (!e) { ctl++; console.log('FAIL  control: a seeded syntax error was not caught - the parse stopped biting'); }
  else console.log(`ok    control: a seeded syntax error is caught (${e})`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
if (files.length < MIN_FILES) { ctl++; console.log(`FAIL  control: ${files.length} tracked .py files found, expected at least ${MIN_FILES}`); }

for (const b of bad) console.log('FAIL  ' + b);
console.log(bad.length || ctl
  ? `check-python-syntax: ${bad.length} of ${files.length} tracked .py files do not parse, ${ctl} control(s) failed`
  : `check-python-syntax: ${files.length} tracked .py files parse under ${bin}`);
process.exit(bad.length || ctl ? 1 : 0);
