#!/usr/bin/env node
// packages/core stays free of the web stack (plan.md WP1.2): every channel (apps/web, apps/server, the VR client's
// server) runs the same core, so core may not import React, the DOM or Next. Checked per file, printing
// `walked / checked / violations`:
//   imports   packages/core/src/**: no react, react-dom, next, motion or scheduler (or a subpath of one), no `@/` (the
//             web app's alias), no @bp/web, nothing that resolves into apps/. The pure half (everything outside
//             src/server) also imports no Node built-in (node:* or a bare built-in name) and no server file.
//   web       apps/web/src/** and apps/server/src/**: reach core only as @bp/core/*, never by a relative path into
//             packages/.
//   dom       `tsc -p packages/core` (lib ES2023 + Node's types, no DOM lib, src/server excluded) is clean, so
//             no window, document, localStorage, EventSource or HTMLElement in the pure half.
//   strip     packages/core/src/**: no TypeScript syntax Node's strip-only mode rejects (apps/server loads core that way):
//             constructor parameter properties, enum, namespace. Write the field and the assignment out.
// Every run also proves each rule red once on a seeded temp tree (the controls), so a rule that stops matching fails
// the check instead of passing it silently.
// Exit 1 on any violation or a control that stayed green, 2 when no core file was walked, else 0.
// Run: node scripts/check-core-purity.mjs   (plain node; the dom rule uses the repo's own typescript)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = 'packages/core/src', SERVER = 'packages/core/src/server', WEB = 'apps/web/src';
const TSC = createRequire(path.join(ROOT, 'package.json')).resolve('typescript/bin/tsc');

const posix = (p) => p.replace(/\\/g, '/');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const lineAt = (s, i) => s.slice(0, i).split('\n').length;
const blank = (s) => s.replace(/[^\n]/g, ' ');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])(\/\/.*)$/gm, (_, a, b) => a + blank(b));

/** Every import of a module: static, side-effect, re-export, dynamic and require. */
function importsOf(src) {
  const s = strip(src), out = [];
  const add = (m, spec) => out.push({ spec, line: lineAt(s, m.index) });
  for (const m of s.matchAll(/\bimport\s+(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:\{[^}]*\}|\*\s*as\s+[\w$]+)?\s*from\s*(['"])([^'"]+)\1/g)) add(m, m[2]);
  for (const m of s.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) add(m, m[2]);
  for (const m of s.matchAll(/\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s*as\s+[\w$]+)?)\s*from\s*(['"])([^'"]+)\1/g)) add(m, m[2]);
  for (const m of s.matchAll(/\b(?:import|require)\s*\(\s*(['"`])([^'"`]+)\1/g)) add(m, m[2]);
  return out;
}

const WEB_STACK = /^(react|react-dom|next|motion|scheduler)(\/|$)/;
const BUILTIN = new Set(builtinModules.flatMap((b) => [b, b.split('/')[0]]));
const under = (p, dir) => p === dir || p.startsWith(dir + '/');

/** Why one import of a core file is refused, or null. `rel` is the file's repo path. */
function refusedCore(spec, rel) {
  const pure = !under(rel, SERVER);
  if (WEB_STACK.test(spec)) return `'${spec}': React, Next or Motion in core`;
  if (spec.startsWith('@/')) return `'${spec}': the web app's alias in core`;
  if (spec === '@bp/web' || spec.startsWith('@bp/web/')) return `'${spec}': the web app in core`;
  if (spec.startsWith('.')) {
    const t = posix(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
    if (under(t, 'apps')) return `'${spec}': resolves into ${t.split('/').slice(0, 2).join('/')}`;
    if (pure && (under(t, SERVER) || /\.server(\.ts)?$/.test(t))) return `'${spec}': a server file from the pure half`;
  }
  if (pure && spec.startsWith('@bp/core/server/')) return `'${spec}': a server file from the pure half`;
  if (pure && (spec.startsWith('node:') || BUILTIN.has(spec.split('/')[0]))) return `'${spec}': a Node built-in in the pure half (only src/server may)`;
  return null;
}
/** Why one import of a web file is refused, or null. */
function refusedWeb(spec, rel) {
  if (!spec.startsWith('.')) return null;
  const t = posix(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
  return under(t, 'packages') ? `'${spec}': reaches ${t} by path; import it as @bp/core/*` : null;
}

/** TS syntax that needs a transform, not just type stripping. */
function unstrippable(src) {
  const s = strip(src), out = [];
  const add = (m, what) => out.push({ what, line: lineAt(s, m.index) });
  for (const m of s.matchAll(/\bconstructor\s*\(([^)]*)\)/g)) {
    if (/(^|[,(])\s*(?:@\w+\s+)*(?:public|private|protected|readonly|override)\s+[\w$]/.test(m[1])) add(m, 'a constructor parameter property');
  }
  for (const m of s.matchAll(/^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+[\w$]+/gm)) add(m, 'an enum');
  for (const m of s.matchAll(/^\s*(?:export\s+)?(?:declare\s+)?namespace\s+[\w$.]+\s*\{/gm)) add(m, 'a namespace');
  return out;
}
function stripOnly(root) {
  const r = rule('strip');
  for (const f of walk(path.join(root, CORE)).filter((f) => /\.(ts|tsx|mts)$/.test(f))) {
    r.walked++; r.checked++;
    const rel = posix(path.relative(root, f));
    for (const { what, line } of unstrippable(fs.readFileSync(f, 'utf8'))) r.violations.push(`${rel}:${line}  ${what}: Node's strip-only mode rejects it`);
  }
  return r;
}
const rule = (name) => ({ name, walked: 0, checked: 0, violations: [] });
function scan(root, dir, refuse, name) {
  const r = rule(name);
  for (const f of walk(path.join(root, dir)).filter((f) => /\.(ts|tsx|mts|mjs|js)$/.test(f))) {
    r.walked++;
    const rel = posix(path.relative(root, f));
    for (const { spec, line } of importsOf(fs.readFileSync(f, 'utf8'))) {
      r.checked++;
      const why = refuse(spec, rel);
      if (why) r.violations.push(`${rel}:${line}  ${why}`);
    }
  }
  return r;
}
/** tsc over a project with no DOM lib; each error line is a violation. */
function dom(project) {
  const r = rule('dom');
  const p = spawnSync(process.execPath, [TSC, '--noEmit', '-p', project], { cwd: ROOT, encoding: 'utf8' });
  r.walked = 1;
  const lines = (p.stdout + p.stderr).split(/\r?\n/).filter((l) => /error TS\d+/.test(l));
  r.checked = 1;
  r.violations.push(...lines.map((l) => posix(l.trim())));
  if (p.status !== 0 && !lines.length) r.violations.push(`tsc exited ${p.status} with no error line: ${(p.stdout + p.stderr).trim().slice(0, 300)}`);
  return r;
}
const runAll = (root, project) => {
  const web = scan(root, WEB, refusedWeb, 'web'), server = scan(root, 'apps/server/src', refusedWeb, 'web');
  web.walked += server.walked; web.checked += server.checked; web.violations.push(...server.violations);
  return [scan(root, CORE, refusedCore, 'imports'), stripOnly(root), web, dom(project)];
};

// ---------------------------------------------------------------- controls: each rule red once on a seeded tree
function controls() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'core-purity-'));
  const put = (rel, text) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const seeds = [
    ['imports', `${CORE}/s1.ts`, "import { useState } from 'react';\nexport const a = useState;\n"],
    ['imports', `${CORE}/s2.ts`, "import type { NextRequest } from 'next/server';\nexport type A = NextRequest;\n"],
    ['imports', `${CORE}/s3.ts`, "export { motion } from 'motion/react';\n"],
    ['imports', `${CORE}/s4.ts`, "import { useEngine } from '@/components/hooks';\nexport const a = useEngine;\n"],
    ['imports', `${CORE}/s5.ts`, "import { x } from '../../../apps/web/src/engine/state';\nexport const a = x;\n"],
    ['imports', `${CORE}/s6.ts`, "import fs from 'node:fs';\nexport const a = fs;\n"],
    ['imports', `${CORE}/s7.ts`, "import { snapshotOf } from './server/store.server';\nexport const a = snapshotOf;\n"],
    ['imports', `${CORE}/s8.ts`, "export const a = () => import('react-dom');\n"],
    ['strip', `${CORE}/t1.ts`, "export class A {\n  constructor(private p: number, readonly q = 1) {}\n}\n"],
    ['strip', `${CORE}/t2.ts`, "export enum E { A, B }\n"],
    ['strip', `${CORE}/t3.ts`, "export namespace N {\n  export const a = 1;\n}\n"],
    ['web', `${WEB}/w1.ts`, "import { x } from '../../../packages/core/src/model/index.ts';\nexport const a = x;\n"],
    ['dom', `${CORE}/d1.ts`, 'export const title = (): string => document.title;\n'],
  ];
  const clean = [
    [`${CORE}/ok.ts`, "import { b, type T } from './ok2.ts';\nexport const a = (t?: T): number => b + (t ? 1 : 0) + globalThis.setTimeout.length;\n"],
    [`${CORE}/ok2.ts`, "// import React from 'react' in a comment is not an import\nexport const b = 1;\nexport type T = { id: string };\n"],
    [`${CORE}/ok3.ts`, "export class C {\n  private p: number;\n  constructor(p: number, opts: { readonly x?: number } = {}) { this.p = p + (opts.x ?? 0); }\n}\n"],
    [`${SERVER}/ok.server.ts`, "import fs from 'node:fs';\nimport path from 'node:path';\nexport const a = (p: string) => fs.existsSync(path.resolve(p));\n"],
    [`${WEB}/ok.ts`, "import { b } from '@bp/core/ok2';\nimport { c } from './c';\nexport const a = b + c;\n"],
  ];
  let failed = 0;
  const say = (ok, m) => { if (!ok) failed++; if (!ok || process.env.BP_VERBOSE) console.log(`${ok ? 'ok  ' : 'FAIL'}  control: ${m}`); };
  const project = (files) => {
    const cfg = path.join(base, 'tsconfig.json');
    fs.writeFileSync(cfg, JSON.stringify({
      extends: posix(path.join(ROOT, 'packages/core/tsconfig.json')),
      compilerOptions: { typeRoots: [posix(path.join(ROOT, 'node_modules/@types'))] },
      include: files, exclude: [],
    }));
    return cfg;
  };
  try {
    for (const [rel, text] of clean) put(rel, text);
    const green = runAll(base, project(clean.filter(([r]) => under(r, CORE) && !under(r, SERVER)).map(([r]) => r)));
    say(green.every((r) => !r.violations.length), 'the clean tree passes every rule' + green.flatMap((r) => r.violations).map((v) => '\n      ' + v).join(''));
    for (const [name, rel, text] of seeds) put(rel, text);
    const red = runAll(base, project([`${CORE}/d1.ts`]));
    for (const [name, rel] of seeds) {
      const r = red.find((x) => x.name === name);
      say(r.violations.some((v) => v.includes(rel)), `${name} red on ${rel}`);
    }
    say(!red.flatMap((r) => r.violations).some((v) => clean.some(([c]) => v.startsWith(c + ':'))), 'no clean file is named in the seeded tree');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  return { failed, total: seeds.length + 2 };
}

const res = runAll(ROOT, 'packages/core');
for (const r of res) console.log(`${r.name.padEnd(8)} walked ${String(r.walked).padStart(3)} / checked ${String(r.checked).padStart(4)} / violations ${r.violations.length}`);
const bad = res.flatMap((r) => r.violations.map((v) => `FAIL ${r.name}  ${v}`));
for (const b of bad) console.log(b);
const ctl = controls();
const walkedCore = res[0].walked;
console.log(bad.length || ctl.failed
  ? `check-core-purity: ${bad.length} violations, ${ctl.failed} of ${ctl.total} controls failed`
  : `check-core-purity: ${walkedCore} core files, 0 violations; ${ctl.total} seeded controls red as expected`);
process.exit(bad.length || ctl.failed ? 1 : walkedCore ? 0 : 2);
