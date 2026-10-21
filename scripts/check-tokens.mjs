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
import { stripComments, blankComments } from './lib/source.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'apps/web/src');
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
  if (rel(f) === 'apps/web/src/engine/theme.ts') {
    themeLiterals = [...s.matchAll(/['"`](--[\w-]+)['"`]/g)].map((m) => m[1]);
    for (const n of themeLiterals) use(n, f);
  }
}
if (used.size < 10) fail(`only ${used.size} custom-property uses found: the scan stopped matching`);
if (!themeLiterals.length) fail("src/engine/theme.ts: no '--x' literals found: the scan stopped matching");
for (const [n, where] of used) if (!defined.has(n)) fail(`${n} is used (${where}) and defined nowhere`);
for (const n of new Set(themeLiterals)) if (!definer.has(n) && !(dark.has(n) && light.has(n))) fail(`${n} is read by src/engine/theme.ts and is not a token of both themes`);

// ------------------------------------------------------------------------------------ the 12 px text floor
// docs/blueprint-ui.md: "12 px text floor (body 14 px)". The only instrument that measured it was
// `python scripts/shots.py`, which needs a running server, so offline nothing saw a raw `font-size: 11px`.
// check-train-quality.mjs holds the floor on the `--fs-*` TOKENS in globals.css; this holds it on the raw px
// sizes written directly into a font / font-size declaration anywhere in src - a disjoint set (a token
// declaration is `--fs-x: 11px`, which is not a font declaration and is not matched here).
// A declaration that must sit below the floor carries `text-floor-exempt: <why>` in a comment on its line or
// the line above - no such site exists today. Comments are stripped before matching, and the scan fails loud
// below a plausibility floor so a matcher that stopped biting cannot read as a clean tree.
// stripComments() DELETES comments, so a multi-line one collapses and every line number after it is wrong
// (measured: a declaration on line 312 was reported as 310). The floor rule reports anchors and reads an
// opt-out comment back out of the file, so it blanks comments instead, keeping every offset and line.
const FLOOR = 12, MIN_DECLS = 300;
const FONT_DECL = /\bfont(?:-size)?\s*:\s*([^;{}'"]+)/g;
const FIRST_PX = /(?<![\w.])([0-9]+(?:\.[0-9]+)?)px/;   // the shorthand's size comes first in its value
let declsSeen = 0, exempt = 0;
for (const f of files) {
  const raw = read(f), s = blankComments(raw), lines = raw.split('\n');
  for (const m of s.matchAll(FONT_DECL)) {
    const px = FIRST_PX.exec(m[1]);
    if (!px) continue;
    declsSeen++;
    if (Number(px[1]) >= FLOOR) continue;
    const line = s.slice(0, m.index).split('\n').length;
    if (lines.slice(Math.max(0, line - 2), line).some((l) => /text-floor-exempt:/.test(l))) { exempt++; continue; }
    fail(`${rel(f)}:${line}  ${m[0].trim().slice(0, 60)} is below the ${FLOOR} px text floor (docs/blueprint-ui.md)`);
  }
}
if (declsSeen < MIN_DECLS) fail(`only ${declsSeen} font declarations with a px size found, expected at least ${MIN_DECLS}: the text-floor scan stopped matching`);
// control: the floor must bite on a seeded declaration and must not bite on a legal one or on an --fs token
for (const [what, text, want] of [['font-size: 11px', 'a { font-size: 11px; }', true], ['font: 500 9px var(--mono)', 'a { font: 500 9px var(--mono); }', true], ['font-size: 12px', 'a { font-size: 12px; }', false], ['a --fs token declaration', 'a { --fs-11: 11px; }', false], ['font: 14px/1.4 sans', 'a { font: 14px/1.4 sans; }', false]]) {
  const m = FONT_DECL.exec(text);
  FONT_DECL.lastIndex = 0;
  const px = m && FIRST_PX.exec(m[1]);
  const bites = !!px && Number(px[1]) < FLOOR;
  if (bites !== want) fail(`control: the text floor ${want ? 'should' : 'should not'} bite on "${what}" - the matcher is wrong`);
}

// ------------------------------------------------------------------------------------------- text contrast, AA
// docs/blueprint-ui.md: text is held to WCAG 1.4.3 (4.5:1 under 18 px). The strip's travelled state tints its own
// ground with the accent (`color-mix(in srgb, var(--accent) 14%, var(--panel))`) and then writes accent text on it,
// so the text and its background move together: light --accent was 4.30:1 there while 5.23:1 on the untinted strip.
// Derived, not typed: the ground and its mix are READ out of timeline.css (comments blanked first), the two text
// rules are checked to still write `color: var(--accent)` on that ground, and both theme blocks are composited
// from the token values in globals.css. A parse that finds no ground, no text rule or no token fails loud.
const AA = 4.5;
const PARSE_COLOR = (v) => {
  const t = v.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null;
};
/** `top` over an opaque `bottom`. */
const OVER = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
/** color-mix(in srgb, a p%, b): premultiplied, as CSS Color 4 specifies. */
const MIX = (a, p, b) => {
  const wa = p, wb = 1 - p, al = wa * a[3] + wb * b[3];
  return [0, 1, 2].map((i) => (wa * a[3] * a[i] + wb * b[3] * b[i]) / al).concat(al);
};
const LUM = (c) => { const f = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const RATIO = (a, b) => { const [hi, lo] = [LUM(a), LUM(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const TOKEN = (body, name) => { const m = new RegExp('(?:^|[;{\\s])' + name + '\\s*:\\s*([^;]+);').exec(body); return m ? PARSE_COLOR(m[1]) : null; };
const MIX_RE = /color-mix\(\s*in srgb\s*,\s*var\((--[\w-]+)\)\s*([\d.]+)%\s*,\s*var\((--[\w-]+)\)\s*\)/;

const tlCss = blankComments(read(path.join(SRC, 'components/timeline.css')));
const travelRule = /#base\.tl-strip\.travel\s*\{([^}]*)\}/.exec(tlCss);
const travelBg = travelRule && /background\s*:\s*([^;]+);/.exec(travelRule[1]);
const travelMix = travelBg && MIX_RE.exec(travelBg[1]);
const textRules = [['.tl-strip.travel .tl-pos b', /\.tl-strip\.travel\s+\.tl-pos\s+b\s*\{([^}]*)\}/], ['.bp .tl-back', /\.bp\s+\.tl-back\s*\{([^}]*)\}/]];
let contrastPairs = 0;
if (!travelMix) fail('timeline.css: the #base.tl-strip.travel color-mix ground was not found: the contrast scan stopped matching');
else {
  const textTokens = new Set();
  for (const [name, re] of textRules) {
    const m = re.exec(tlCss), c = m && /(?:^|[;\s])color\s*:\s*var\((--[\w-]+)\)/.exec(m[1]);
    if (!c) fail(`timeline.css: ${name} no longer writes color: var(--x): the contrast scan stopped matching`);
    else textTokens.add(c[1]);
  }
  for (const [theme, body] of [['dark', darkB], ['light', lightB]]) {
    const paper = TOKEN(body, '--paper');
    const [ta, , tb] = [travelMix[1], travelMix[2], travelMix[3]], tint = TOKEN(body, ta), under = TOKEN(body, tb);
    if (!paper || !tint || !under) { fail(`globals.css ${theme}: --paper, ${ta} or ${tb} did not parse as a colour`); continue; }
    const fill = OVER(MIX(tint, Number(travelMix[2]) / 100, under), paper);
    const panel = OVER(under, paper);
    for (const tok of textTokens) {
      const text = TOKEN(body, tok);
      if (!text) { fail(`globals.css ${theme}: ${tok} did not parse as a colour`); continue; }
      for (const [on, ground] of [['the strip travel fill', fill], ['the panel', panel], ['paper', paper]]) {
        contrastPairs++;
        const r = RATIO(OVER(text, ground), ground);
        if (r < AA) fail(`${theme}: ${tok} text on ${on} is ${r.toFixed(2)}:1, under the ${AA}:1 of WCAG 1.4.3 (timeline.css, globals.css)`);
      }
    }
  }
}
if (contrastPairs < 6) fail(`only ${contrastPairs} contrast pairs measured, expected 6 (2 themes x the accent x 3 grounds): the contrast scan stopped matching`);
// control: the arithmetic and the parser must bite on known pairs, so a gate that stopped measuring cannot pass
for (const [what, ok] of [
  ['black on white is 21:1', Math.abs(RATIO([0, 0, 0, 1], [255, 255, 255, 1]) - 21) < 0.01],
  ['the 2026-10-21 light accent #0a6fb8 on the 14% travel fill is under AA (4.30:1)', RATIO(PARSE_COLOR('#0a6fb8'), OVER(MIX(PARSE_COLOR('#0a6fb8'), 0.14, PARSE_COLOR('rgba(255, 255, 255, 0.86)')), PARSE_COLOR('#f4f8fc'))) < AA],
  ['an unparsable colour is rejected, not read as black', PARSE_COLOR('var(--x)') === null],
]) if (!ok) fail(`control: ${what} - the contrast matcher is wrong`);

if (failed) { console.log(`check-tokens: ${failed} failed`); process.exit(1); }
const outside = [...used.keys()].filter((n) => !dark.has(n) && !light.has(n));
console.log(`check-tokens: dark ${dark.size} / light ${light.size} parity, ${used.size} names used, ${outside.length} resolved outside the themes (${outside.map((n) => n + ' ' + definer.get(n)).join('; ')}), 0 unresolved; ${declsSeen} px font declarations all at or above the ${FLOOR} px floor (${exempt} exempt); ${contrastPairs} text/ground pairs at or above ${AA}:1`);
