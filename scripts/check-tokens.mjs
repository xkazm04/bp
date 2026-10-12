// Gates theme-token completeness and var() resolution (docs/blueprint-ui.md, design tokens):
//   1. src/app/globals.css defines the dark block (:root, :root[data-theme='dark']) and the light block
//      (:root[data-theme='light']); every token defined in one must be defined in the other.
//   2. every var(--x) in src/**/*.{css,ts,tsx}, every getPropertyValue('--x'), and every '--x' literal in
//      src/engine/theme.ts (the canvas reads its colours back from the DOM with hard-coded dark fallbacks, so a
//      missing light token paints dark colours on the canvas and nothing on the DOM) must resolve: be defined in
//      the theme blocks, or by a definer found in the source by grep, not by a hand-kept list: a `--x:`
//      declaration in any css file, style.setProperty('--x'), an inline style key '--x':, or next/font's
//      `variable: '--x'`.
//   3. every '--x' literal in src/engine/theme.ts must be a theme token (defined in both blocks), unless a
//      theme-independent definer (next/font, inline style) supplies it.
// Comments are stripped before matching. A parse that finds no blocks or no tokens fails loud.
// Run: node scripts/check-tokens.mjs   (plain node, no deps; exit 1 on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/source.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const strip = stripComments;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(SRC).filter((f) => /\.(css|ts|tsx)$/.test(f));
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const read = (f) => fs.readFileSync(f, 'utf8');

let failed = 0;
const fail = (m) => { failed++; console.log('FAIL ' + m); };

/** The body of the first rule whose selector list matches `sel`, by brace matching. */
function block(css, sel) {
  const m = sel.exec(css);
  if (!m) return null;
  const open = css.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
}
const decls = (body) => new Set([...body.matchAll(/(^|[;{\s])(--[\w-]+)\s*:/g)].map((m) => m[2]));

const globals = strip(read(path.join(SRC, 'app/globals.css')));
const darkB = block(globals, /:root\s*,\s*:root\[data-theme=['"]dark['"]\]\s*\{/);
const lightB = block(globals, /:root\[data-theme=['"]light['"]\]\s*\{/);
if (!darkB || !lightB) { fail('globals.css: the dark or light token block was not found'); process.exit(1); }
const dark = decls(darkB), light = decls(lightB);
if (dark.size < 10 || light.size < 10) fail(`globals.css: implausibly few tokens (dark ${dark.size}, light ${light.size})`);
const darkOnly = [...dark].filter((t) => !light.has(t)), lightOnly = [...light].filter((t) => !dark.has(t));
for (const t of darkOnly) fail(`${t} is defined in the dark theme and not in the light theme`);
for (const t of lightOnly) fail(`${t} is defined in the light theme and not in the dark theme`);

// Definers found by grep.
const defined = new Set([...dark, ...light]);
const definer = new Map(); // name -> where it was found, for the report
for (const f of files) {
  const s = strip(read(f));
  const add = (n, how) => { defined.add(n); if (!definer.has(n)) definer.set(n, how + ' ' + rel(f)); };
  if (f.endsWith('.css')) for (const n of decls(s)) add(n, 'declared in');
  else {
    for (const m of s.matchAll(/setProperty\(\s*['"`](--[\w-]+)['"`]/g)) add(m[1], 'setProperty in');
    for (const m of s.matchAll(/['"`](--[\w-]+)['"`]\s*:/g)) add(m[1], 'inline style key in');
    for (const m of s.matchAll(/variable\s*:\s*['"`](--[\w-]+)['"`]/g)) add(m[1], 'next/font in');
  }
}

// Uses.
const used = new Map(); // name -> first location
const use = (n, f) => { if (!used.has(n)) used.set(n, rel(f)); };
let themeLiterals = [];
for (const f of files) {
  const s = strip(read(f));
  for (const m of s.matchAll(/var\(\s*(--[\w-]+)/g)) use(m[1], f);
  for (const m of s.matchAll(/getPropertyValue\(\s*['"`](--[\w-]+)['"`]/g)) use(m[1], f);
  if (rel(f) === 'src/engine/theme.ts') {
    themeLiterals = [...s.matchAll(/['"`](--[\w-]+)['"`]/g)].map((m) => m[1]);
    for (const n of themeLiterals) use(n, f);
  }
}
if (used.size < 10) fail(`only ${used.size} custom-property uses found: the scan stopped matching`);
if (!themeLiterals.length) fail("src/engine/theme.ts: no '--x' literals found: the scan stopped matching");
for (const [n, where] of used) if (!defined.has(n)) fail(`${n} is used (${where}) and defined nowhere`);
for (const n of new Set(themeLiterals)) if (!definer.has(n) && !(dark.has(n) && light.has(n))) fail(`${n} is read by src/engine/theme.ts and is not a token of both themes`);

if (failed) { console.log(`check-tokens: ${failed} failed`); process.exit(1); }
const outside = [...used.keys()].filter((n) => !dark.has(n) && !light.has(n));
console.log(`check-tokens: dark ${dark.size} / light ${light.size} parity, ${used.size} names used, ${outside.length} resolved outside the themes (${outside.map((n) => n + ' ' + definer.get(n)).join('; ')}), 0 unresolved`);
