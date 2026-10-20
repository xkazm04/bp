// The release train's own quality gate (port-quality.md Q2): new code starts at zero against these rules while the
// old tree stays untouched. It walks only the train's two roots, apps/web/src/components/ledger/train/** and packages/core/src/train/**,
// and checks, per rule, printing `walked / checked / violations`:
//   hygiene   .ts/.tsx: no `as unknown as`, no `any` type, JSON.parse only in packages/core/src/train/wire.ts (the parser door),
//             no keydown listener (keys go through React handlers and keymap.ts), no empty catch block, no
//             ts-ignore / ts-expect-error / ts-nocheck / eslint-disable, no innerHTML-family HTML strings.
//             Matched in code and comments alike (a regex comment stripper is not robust against strings and regex
//             literals), so comments stay clean of these spellings.
//   size      every file at most 400 lines.
//   css       .css under the roots: no colour literal (hex, rgb/hsl/oklch-family functions, common named colours),
//             font-size only as var(--fs-*), the font shorthand's size likewise, no px/rem/pt length except 0, 1px and
//             2px (hairlines and borders). Declarations only: at-rule preludes (media/container breakpoints) are free.
//   floor     every --fs-* declared in apps/web/src/app/globals.css is a px literal >= 12 (the repo's 12 px floor).
//   imports   train components may import react, react-dom, motion/react, the train root, ../useLedger,
//             ../variants/bits, ../../hooks, @bp/core/train/*, @bp/core/scan/* and @/lib/scan/* (never server), @bp/core/standard/types and
//             load, @/engine/state and .css files; packages/core/src/train/** may import itself and ../scan/*.ts (not .server,
//             explicit .ts so Node's type stripping loads it) by value, anything else type-only, and never react or
//             apps/web/src/components. No import cycle inside the roots (every import, type-only included).
//   keymap    apps/web/src/components/ledger/train/keymap.ts exports KEYMAP (imported through Node's type stripping, so the
//             module stays value-import free); no key is bound twice in a scope, case-insensitive, ' ' = Space, and
//             compare's keys collide with neither packs nor backlog (it layers over both).
// Exit 1 on any violation, 2 when no file was walked, else 0. `--self-test` builds a clean tree and a seeded one in a
// temp dir laid out like the roots, asserts the clean one passes and every seeded violation is caught, then removes it.
// Run: node scripts/check-train-quality.mjs [--self-test]   (plain node, no deps)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = 'apps/web/src/components/ledger/train';
const LIB = 'packages/core/src/train';
const GLOBALS_CSS = 'apps/web/src/app/globals.css';
const MAX_LINES = 400;
const FLOOR = 12;

const posix = (p) => p.replace(/\\/g, '/');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const lineAt = (s, i) => s.slice(0, i).split('\n').length;
const blank = (s) => s.replace(/[^\n]/g, ' ');
/** Comments blanked in place (newlines kept, so a match index still maps to its line). */
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])(\/\/.*)$/gm, (_, a, b) => a + blank(b));
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank);

// ---------------------------------------------------------------- hygiene
const HYGIENE = [
  ['as unknown as', /\bas\s+unknown\s+as\b/g],
  ['`any` type', /:\s*any(?![\w$])(?!\s+[a-z])|\bas\s+any(?![\w$])(?!\s+[a-z])|<\s*any\s*[,>]|,\s*any\s*>|\bany\[\]/g],
  ['JSON.parse outside packages/core/src/train/wire.ts', /\bJSON\s*\.\s*parse\s*\(/g, (rel) => rel === `${LIB}/wire.ts`],
  ['keydown listener (use a React handler and keymap.ts)', /addEventListener\(\s*['"`]keydown['"`]|\.onkeydown\s*=/g],
  ['empty catch block', /(?<![.\w$])catch\s*(\([^()]*\))?\s*\{\s*\}/g],
  ['suppression comment', /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable/g],
  ['HTML string (innerHTML family)', /innerHTML|outerHTML|insertAdjacentHTML/gi],
];

function hygiene(files, root) {
  const r = rule('hygiene');
  for (const f of files.filter((f) => /\.tsx?$/.test(f))) {
    r.walked++;
    const rel = posix(path.relative(root, f)), s = fs.readFileSync(f, 'utf8');
    for (const [what, re, exempt] of HYGIENE) {
      r.checked++;
      if (exempt?.(rel)) continue;
      for (const m of s.matchAll(re)) r.fail(`${rel}:${lineAt(s, m.index)}  ${what}: ${m[0].trim()}`);
    }
  }
  return r;
}

// ---------------------------------------------------------------- size
function size(files, root) {
  const r = rule('size');
  for (const f of files) {
    r.walked++; r.checked++;
    const s = fs.readFileSync(f, 'utf8');
    const n = s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
    if (n > MAX_LINES) r.fail(`${posix(path.relative(root, f))}  ${n} lines (max ${MAX_LINES})`);
  }
  return r;
}

// ---------------------------------------------------------------- css
const NAMED = /(?<![\w-])(white|black|red|green|blue|yellow|orange|gray|grey|purple|pink|silver|navy|teal|cyan|magenta)(?![\w-])/i;
/** Properties whose values are names, not colours (an animation called `blink`, a grid area called `meta`). */
const NAME_PROPS = /^(animation(-name)?|grid-area|grid-template-areas|grid-(row|column)(-start|-end)?|content|font-family|transition(-property)?|will-change|container(-name)?|counter-(reset|increment)|list-style(-type)?|view-transition-name)$/;
const LEN = /(?<![\w.-])(-?\d*\.?\d+)(px|rem|pt)(?![\w-])/g;

function cssRule(files, root) {
  const r = rule('css');
  for (const f of files.filter((f) => f.endsWith('.css'))) {
    r.walked++;
    const rel = posix(path.relative(root, f)), s = stripCss(fs.readFileSync(f, 'utf8'));
    // a declaration is `prop: value` ending at ; or } (a selector's `:hover {` never ends that way)
    for (const m of s.matchAll(/([\w-]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
      r.checked++;
      const prop = m[1].toLowerCase(), raw = m[2].trim(), at = `${rel}:${lineAt(s, m.index)}  ${prop}: ${raw}`;
      // the value with custom-property names and strings blanked, so `var(--red)` or `'sel title'` never match
      const v = raw.replace(/--[\w-]+/g, '').replace(/(['"])(?:(?!\1).)*\1/g, '""');
      if (/#[0-9a-f]{3,8}(?![\w-])/i.test(v) || /\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/i.test(v)) r.fail(`${at}  colour literal (use a var(--…) token)`);
      else if (!NAME_PROPS.test(prop) && NAMED.test(v)) r.fail(`${at}  named colour (use a var(--…) token)`);
      if (prop === 'font-size' && !/^(var\(--fs-[\w-]+\)|inherit)$/.test(raw)) r.fail(`${at}  font-size must be var(--fs-*)`);
      if (prop === 'font' && !/^inherit$/.test(raw) && !/var\(--fs-[\w-]+\)/.test(raw)) r.fail(`${at}  the font shorthand's size must be var(--fs-*)`);
      for (const l of v.matchAll(LEN)) {
        const n = Math.abs(Number(l[1]));
        if (l[2] === 'px' && (n === 0 || n === 1 || n === 2)) continue;
        if (n === 0) continue;
        r.fail(`${at}  raw length ${l[0]} (only 0, 1px, 2px; else a token)`);
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------- type floor
function floor(root) {
  const r = rule('floor');
  const f = path.join(root, GLOBALS_CSS);
  if (!fs.existsSync(f)) { r.fail(`${GLOBALS_CSS}: not found`); return r; }
  r.walked++;
  const s = stripCss(fs.readFileSync(f, 'utf8'));
  for (const m of s.matchAll(/(--fs-[\w-]+)\s*:\s*([^;}]+)/g)) {
    r.checked++;
    const v = m[2].trim(), px = /^(\d+(?:\.\d+)?)px$/.exec(v), at = `${GLOBALS_CSS}:${lineAt(s, m.index)}  ${m[1]}: ${v}`;
    if (!px) r.fail(`${at}  not a px literal (the floor cannot be proven)`);
    else if (Number(px[1]) < FLOOR) r.fail(`${at}  below the ${FLOOR} px floor`);
  }
  if (!r.checked) r.fail(`${GLOBALS_CSS}: no --fs-* token found (the type scale is missing or the parse stopped matching)`);
  return r;
}

// ---------------------------------------------------------------- imports and cycles
/** Every import of a module: static, side-effect, re-export, dynamic and require, with whether it is type-only. */
function importsOf(src) {
  const s = stripTs(src), out = [];
  const add = (m, spec, type) => out.push({ spec, type, line: lineAt(s, m.index) });
  for (const m of s.matchAll(/\bimport\s+(type\s+)?(?:[\w$]+\s*,?\s*)?(?:\{[^}]*\}|\*\s*as\s+[\w$]+)?\s*from\s*(['"])([^'"]+)\2/g)) add(m, m[3], !!m[1]);
  for (const m of s.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) add(m, m[2], false);
  for (const m of s.matchAll(/\bexport\s+(type\s+)?(?:\{[^}]*\}|\*(?:\s*as\s+[\w$]+)?)\s*from\s*(['"])([^'"]+)\2/g)) add(m, m[3], !!m[1]);
  for (const m of s.matchAll(/\b(?:import|require)\s*\(\s*(['"`])([^'"`]+)\1/g)) add(m, m[2], false);
  return out;
}
const noExt = (p) => p.replace(/\.(tsx?|mjs|js)$/, '').replace(/\/index$/, '');
/** The repo path a specifier points at (alias or relative), or null for a package. */
function target(spec, fromRel) {
  if (spec.startsWith('@/')) return posix(path.posix.join('apps/web/src', spec.slice(2)));
  if (spec.startsWith('@bp/core/')) return posix(path.posix.join('packages/core/src', spec.slice('@bp/core/'.length)));
  if (spec.startsWith('.')) return posix(path.posix.join(path.posix.dirname(fromRel), spec));
  return null;
}
const under = (p, dir) => p === dir || p.startsWith(dir + '/');

function allowedUi(spec, t) {
  if (['react', 'react-dom', 'motion/react'].includes(spec)) return true;
  if (spec.endsWith('.css')) return true;
  if (t === null) return false;
  if (/\.server(\.|$)/.test(t)) return false;
  const b = noExt(t);
  if (under(b, UI) || under(b, LIB)) return true;
  if (['apps/web/src/components/ledger/useLedger', 'apps/web/src/components/ledger/variants/bits', 'apps/web/src/components/hooks', 'apps/web/src/engine/state', 'packages/core/src/standard/types', 'packages/core/src/standard/load'].includes(b)) return true;
  return (under(b, 'packages/core/src/scan') && spec.startsWith('@bp/core/')) || (under(b, 'apps/web/src/lib/scan') && spec.startsWith('@/'));
}
/** Why a packages/core/src/train import is refused, or null. */
function refusedLib(spec, t, type) {
  if (spec === 'react' || spec.startsWith('react/') || spec === 'react-dom' || spec.startsWith('react-dom/')) return 'react in packages/core/src/train';
  if (t !== null && under(t, 'apps/web/src/components')) return 'apps/web/src/components in packages/core/src/train';
  if (type) return null;
  if (t !== null && under(noExt(t), LIB) && spec.startsWith('.')) return /\.ts$/.test(spec) ? null : 'a value import needs its explicit .ts (Node type stripping)';
  if (t !== null && spec.startsWith('.') && /^packages\/core\/src\/scan\/[^/]+\.ts$/.test(t) && !/\.server(\.|$)/.test(t)) return null;
  return 'a value import from outside packages/core/src/train and ../scan/*.ts';
}
function resolve(root, t) {
  for (const c of [t, t + '.ts', t + '.tsx', t + '/index.ts', t + '/index.tsx']) if (fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile()) return c;
  return null;
}

function imports(files, root) {
  const r = rule('imports');
  const graph = new Map();
  for (const f of files.filter((f) => /\.tsx?$/.test(f))) {
    r.walked++;
    const rel = posix(path.relative(root, f)), edges = [];
    graph.set(rel, edges);
    for (const { spec, type, line } of importsOf(fs.readFileSync(f, 'utf8'))) {
      r.checked++;
      const t = target(spec, rel);
      if (under(rel, UI) && !allowedUi(spec, t)) r.fail(`${rel}:${line}  import '${spec}' is outside the train components' allowlist`);
      if (under(rel, LIB)) { const why = refusedLib(spec, t, type); if (why) r.fail(`${rel}:${line}  import '${spec}': ${why}`); }
      const to = t && (under(noExt(t), UI) || under(noExt(t), LIB)) ? resolve(root, t) : null;
      if (to) edges.push({ to, line });
    }
  }
  // cycles: a DFS colouring over the import graph inside the roots
  const state = new Map(), stack = [], seen = new Set();
  const dfs = (n) => {
    state.set(n, 1); stack.push(n);
    for (const { to } of graph.get(n) ?? []) {
      r.checked++;
      if (state.get(to) === 1) {
        const cyc = stack.slice(stack.indexOf(to)).concat(to), key = [...cyc].sort().join('|');
        if (!seen.has(key)) { seen.add(key); r.fail(`import cycle: ${cyc.join(' -> ')}`); }
      } else if (!state.has(to) && graph.has(to)) dfs(to);
    }
    state.set(n, 2); stack.pop();
  };
  for (const n of graph.keys()) if (!state.has(n)) dfs(n);
  return r;
}

// ---------------------------------------------------------------- keymap
const keyName = (k) => (k === ' ' ? 'space' : k.toLowerCase());
async function keymap(root) {
  const r = rule('keymap');
  const f = path.join(root, UI, 'keymap.ts');
  if (!fs.existsSync(f)) { r.fail(`${UI}/keymap.ts: not found`); return r; }
  r.walked++;
  let km;
  try { km = (await import(pathToFileURL(f).href + '?t=' + Date.now())).KEYMAP; } catch (e) { r.fail(`${UI}/keymap.ts: does not load under Node's type stripping (${e.message})`); return r; }
  if (!km || typeof km !== 'object') { r.fail(`${UI}/keymap.ts: no KEYMAP export`); return r; }
  const scan = (label, lists) => {
    const by = new Map();
    for (const [scope, list] of lists) for (const b of list ?? []) for (const k of b.keys ?? []) {
      r.checked++;
      const n = keyName(k), prev = by.get(n);
      if (prev) r.fail(`${UI}/keymap.ts  ${label}: '${k}' is bound to ${prev} and to ${scope}.${b.action}`);
      else by.set(n, `${scope}.${b.action}`);
    }
  };
  for (const s of ['packs', 'backlog', 'compare', 'release']) {
    if (!Array.isArray(km[s]) || !km[s].length) r.fail(`${UI}/keymap.ts  scope ${s} is missing or empty`);
    else scan(s, [[s, km[s]]]);
  }
  // compare layers over the scope it was opened from: checked against each, its own duplicates already counted above
  for (const s of ['packs', 'backlog']) if (Array.isArray(km[s]) && Array.isArray(km.compare)) {
    const own = new Set(km[s].flatMap((b) => b.keys.map(keyName)));
    for (const b of km.compare) for (const k of b.keys) { r.checked++; if (own.has(keyName(k))) r.fail(`${UI}/keymap.ts  compare over ${s}: '${k}' (compare.${b.action}) is already bound in ${s}`); }
  }
  return r;
}

// ---------------------------------------------------------------- driver
function rule(name) {
  const r = { name, walked: 0, checked: 0, violations: [], fail: (m) => r.violations.push(m) };
  return r;
}
async function runAll(root) {
  const files = [UI, LIB].flatMap((d) => walk(path.join(root, d)));
  if (!files.length) return { files: 0, rules: [] };
  return { files: files.length, rules: [hygiene(files, root), size(files, root), cssRule(files, root), floor(root), imports(files, root), await keymap(root)] };
}
const report = (rules) => {
  for (const r of rules) console.log(`${r.name.padEnd(8)} walked ${String(r.walked).padStart(3)} / checked ${String(r.checked).padStart(4)} / violations ${r.violations.length}`);
};

if (process.argv.includes('--self-test')) process.exit(await selfTest());
const res = await runAll(REPO);
if (!res.files) { console.log(`check-train-quality: walked no file under ${UI} or ${LIB}`); process.exit(2); }
report(res.rules);
const bad = res.rules.flatMap((r) => r.violations.map((v) => `FAIL ${r.name}  ${v}`));
for (const b of bad) console.log(b);
console.log(bad.length ? `check-train-quality: ${bad.length} violations` : `check-train-quality: ${res.files} files, 0 violations`);
process.exit(bad.length ? 1 : 0);

// ---------------------------------------------------------------- self-test: every rule proven red once
async function selfTest() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'train-quality-'));
  const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  const KEYS = (extra) => `export const KEYMAP = {
  packs: [{ keys: ['j', 'ArrowDown'], action: 'next', label: 'n' }, { keys: ['x', ' '], action: 'select', label: 's' }${extra.packs ?? ''}],
  backlog: [{ keys: ['j'], action: 'next', label: 'n' }, { keys: [' '], action: 'select', label: 's' }${extra.backlog ?? ''}],
  compare: [{ keys: ['l'], action: 'theme', label: 't' }${extra.compare ?? ''}],
  release: [{ keys: ['b'], action: 'build', label: 'b' }],
};\n`;
  const GLOBALS = (fs) => `:root { --fs-12: 12px; --fs-14: 14px;${fs} --sp-4: 4px; }\n`;
  const clean = (root) => {
    put(root, GLOBALS_CSS, GLOBALS(''));
    put(root, `${UI}/keymap.ts`, KEYS({}));
    put(root, `${UI}/Row.tsx`, `// a clean row component\nimport { useState } from 'react';\nimport type { Proposal } from '@bp/core/scan/types';\nimport { rows } from './rows';\nimport { useLedger } from '../useLedger';\nimport './train.css';\nexport function Row(p: { x: Proposal }) { const [a] = useState(0); try { rows(); } catch (e) { void e; } return a + p.x.id.length; }\n`);
    put(root, `${UI}/rows.ts`, `import { isWaiting } from '@bp/core/train/rules';\nexport const rows = (): boolean => isWaiting({ status: 'done' });\n`);
    put(root, `${UI}/long.ts`, 'export const x = 1;\n'.repeat(MAX_LINES));
    put(root, `${UI}/train.css`, `.a { padding: var(--sp-4) 2px; border: 1px solid var(--ink-3); font: 500 var(--fs-12)/1 var(--mono); color: color-mix(in srgb, var(--red) 10%, transparent); width: calc(var(--sp-4) * 2); grid-template-areas: 'red white'; }\n.a:hover { margin: 0; font-size: var(--fs-14); }\n@media (max-width: 760px) { .a { gap: var(--sp-4); } }\n`);
    put(root, `${LIB}/rules.ts`, `import type { Proposal } from '../scan/types.ts';\nimport { stamp } from './stamp.ts';\nexport const isWaiting = (p: Pick<Proposal, 'status'>): boolean => p.status === 'done' && stamp() > 0;\n`);
    put(root, `${LIB}/stamp.ts`, `import { WAIT } from '../scan/compare.ts';\nexport const stamp = (): number => WAIT;\n`);
    put(root, `${LIB}/wire.ts`, `export const parseJson = (t: string): unknown => JSON.parse(t);\n`);
  };
  // each seed: the file it writes, its text, and the rule that must name that file
  const seeds = [
    ['hygiene', `${UI}/h1.ts`, 'export const a = (x: unknown) => x as unknown as number;\n'],
    ['hygiene', `${UI}/h2.ts`, 'export const a = (x: any) => x;\n'],
    ['hygiene', `${UI}/h3.ts`, 'export const a = (x: unknown) => x as any;\n'],
    ['hygiene', `${UI}/h4.ts`, 'export const a: Array<any> = [];\n'],
    ['hygiene', `${UI}/h5.ts`, "export const a = (t: string): unknown => JSON.parse(t);\n"],
    ['hygiene', `${UI}/h6.ts`, "window.addEventListener('keydown', () => undefined);\n"],
    ['hygiene', `${UI}/h7.ts`, 'export function a() { try { a(); } catch {} }\n'],
    ['hygiene', `${UI}/h8.ts`, 'export function a() { try { a(); } catch (e) {  } }\n'],
    ['hygiene', `${UI}/h9.ts`, '// @ts-ignore\nexport const a = 1;\n'],
    ['hygiene', `${UI}/h10.ts`, '// @ts-expect-error\nexport const a = 1;\n'],
    ['hygiene', `${UI}/h11.ts`, '/* eslint-disable */\nexport const a = 1;\n'],
    ['hygiene', `${UI}/h12.ts`, "export const a = (e: HTMLElement) => { e.innerHTML = '<b>x</b>'; };\n"],
    ['hygiene', `${UI}/h13.tsx`, "export const A = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />;\n"],
    ['hygiene', `${LIB}/h14.ts`, "export const a = (t: string): unknown => JSON.parse(t);\n"],
    ['size', `${UI}/big.ts`, 'export const x = 1;\n'.repeat(MAX_LINES + 1)],
    ['css', `${UI}/c1.css`, '.a { color: #ff0000; }\n'],
    ['css', `${UI}/c2.css`, '.a { background: rgba(0, 0, 0, 0.4); }\n'],
    ['css', `${UI}/c3.css`, '.a { background: color-mix(in srgb, var(--mint) 85%, white); }\n'],
    ['css', `${UI}/c4.css`, '.a { font-size: 13px; }\n'],
    ['css', `${UI}/c5.css`, '.a { font-size: var(--sp-4); }\n'],
    ['css', `${UI}/c6.css`, '.a { font: 500 13px var(--mono); }\n'],
    ['css', `${UI}/c7.css`, '.a { padding: 0 12px; }\n'],
    ['css', `${UI}/c8.css`, '.a { margin: 1rem; }\n'],
    ['css', `${UI}/c9.css`, '.a { border: 1.5px solid var(--ink); }\n'],
    ['floor', GLOBALS_CSS, GLOBALS(' --fs-11: 11px; --fs-x: calc(1em);')],
    ['imports', `${UI}/i1.ts`, "import { store } from '@bp/core/server/store.server';\nexport const a = store;\n"],
    ['imports', `${UI}/i2.ts`, "import x from 'lodash';\nexport const a = x;\n"],
    ['imports', `${UI}/i3.ts`, "import { LedgerPage } from '../LedgerPage';\nexport const a = LedgerPage;\n"],
    ['imports', `${UI}/i4.ts`, "export { health } from '@bp/core/standard/health';\n"],
    ['imports', `${LIB}/i5.ts`, "import { useState } from 'react';\nexport const a = useState;\n"],
    ['imports', `${LIB}/i6.ts`, "import type { Row } from '../../../../apps/web/src/components/ledger/train/Row';\nexport type A = Row;\n"],
    ['imports', `${LIB}/i7.ts`, "import { LENSES } from '../standard/catalog.ts';\nexport const a = LENSES;\n"],
    ['imports', `${LIB}/i8.ts`, "import { stamp } from './stamp';\nexport const a = stamp;\n"],
    ['imports', `${LIB}/cyc-a.ts`, "import { b } from './cyc-b.ts';\nexport const a = (): number => b() + 1;\n"],
    ['imports', `${LIB}/cyc-b.ts`, "import { a } from './cyc-a.ts';\nexport const b = (): number => a() + 1;\n"],
    ['keymap', `${UI}/keymap.ts`, KEYS({ packs: ", { keys: ['X'], action: 'accept', label: 'a' }", backlog: ", { keys: ['Space'], action: 'open', label: 'o' }", compare: ", { keys: ['J'], action: 'mode', label: 'm' }" })],
  ];
  let failed = 0;
  const say = (ok, m) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${m}`); };
  try {
    // 0. no file at all -> exit 2
    const empty = path.join(base, 'empty');
    fs.mkdirSync(empty);
    say((await runAll(empty)).files === 0, 'an empty tree walks no file (exit 2)');
    // 1. the clean tree passes every rule
    const good = path.join(base, 'good');
    clean(good);
    const g = await runAll(good);
    report(g.rules);
    for (const r of g.rules) say(r.violations.length === 0 && r.checked > 0, `clean tree: ${r.name} passes (${r.checked} checked)${r.violations.length ? '\n      ' + r.violations.join('\n      ') : ''}`);
    // 2. the seeded tree: every seed is named by its rule
    const bad = path.join(base, 'bad');
    clean(bad);
    for (const [, rel, text] of seeds) put(bad, rel, text);
    const b = await runAll(bad);
    report(b.rules);
    const by = Object.fromEntries(b.rules.map((r) => [r.name, r.violations]));
    for (const [name, rel] of seeds) {
      const hits = (by[name] ?? []).filter((v) => v.includes(name === 'floor' ? GLOBALS_CSS : rel));
      say(hits.length > 0, `${name.padEnd(7)} red on ${rel}${hits.length ? '  <- ' + hits[0] : ''}`);
    }
    say(by.floor.length === 2, `floor names both seeded tokens (${by.floor.length})`);
    say(by.keymap.length === 4, `keymap names all four seeded clashes: x/X, Space/' ', J over packs, J over backlog (${by.keymap.length})`);
    say(by.imports.some((v) => v.startsWith('import cycle')), 'imports reports the seeded cycle');
    // nothing clean is named by any rule
    const cleanFiles = ['Row.tsx', 'rows.ts', 'long.ts', 'train.css', 'rules.ts', 'stamp.ts', 'wire.ts'];
    const stray = b.rules.flatMap((r) => r.violations).filter((v) => { const at = v.split(/[\s:]/)[0]; return cleanFiles.some((c) => at.endsWith('/' + c)); });
    say(stray.length === 0, `no clean file is named in the seeded tree${stray.length ? '\n      ' + stray.join('\n      ') : ''}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  say(!fs.existsSync(base), 'temp dir removed');
  console.log(failed ? `check-train-quality --self-test: ${failed} failed` : 'check-train-quality --self-test: every rule proven red, the clean tree green');
  return failed ? 1 : 0;
}
