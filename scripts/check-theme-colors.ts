// Pins src/engine/theme.ts parseColor, the one place the canvas turns a CSS design token back into pixels.
// A token is a CSS *custom property*, so getPropertyValue hands the engine the authored text and never a
// normalised rgb(): a token in a format parseColor cannot read is drawn as the dark theme's ink in BOTH themes
// (invisible on paper), and `#rgba` used to come back with a NaN channel, which canvas ignores outright, leaving
// whatever fill was set before. Nothing executed parseColor before this file, so either failure shipped silent.
//
// Two halves:
//   1. the formats, round-tripped against hand-computed values, plus the fallback reported once per string;
//   2. GROUND TRUTH: every colour literal declared in globals.css and blueprint.css (both theme blocks), read
//      out of the CSS and pushed through parseColor. A new token in a format parseColor cannot read fails here.
// Run: node scripts/check-theme-colors.ts   (Node's type stripping; theme.ts touches no DOM at module level)
// Control: BP_THEME_COLORS_SEED=1 adds an unreadable token to the ground-truth set, so half 2 can be seen red.
import path from 'node:path';
import fs from 'node:fs';
import { stripBlock } from './lib/source.ts';
import { parseColor, unreadableColors, resetUnreadableColors } from '../apps/web/src/engine/theme.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string, got?: string) => { if (ok) held++; else failures.push(what + (got === undefined ? '' : ` (got ${got})`)); };
const near = (a: number, b: number, eps = 1) => Number.isFinite(a) && Math.abs(a - b) <= eps;
const same = (c: string, r: number, g: number, b: number, a: number) => {
  const p = parseColor(c);
  expect(near(p[0], r) && near(p[1], g) && near(p[2], b) && near(p[3], a, 0.01), `parseColor(${c}) should be [${r},${g},${b},${a}]`, JSON.stringify(p));
};

// --------------------------------------------------------------------- 1. the formats a token may be authored in
const origErr = console.error;
const logged: string[] = [];
console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
try {
  // hex, all four nibble counts (3 and 4 double each nibble)
  same('#dff0ff', 223, 240, 255, 1);
  same('#DFF0FF', 223, 240, 255, 1);
  same('#abc', 170, 187, 204, 1);
  same('#abcd', 170, 187, 204, 221 / 255);
  same('#0b2a4a', 11, 42, 74, 1);
  same('#ff6a5880', 255, 106, 88, 128 / 255);
  // rgb / rgba: the comma form the tokens use today, the modern space form, the slash alpha, percentages
  same('rgba(223, 240, 255, 0.74)', 223, 240, 255, 0.74);
  same('rgba(7,26,51,.92)', 7, 26, 51, 0.92);
  same('rgb(200, 100, 50)', 200, 100, 50, 1);
  same('rgb(200 100 50)', 200, 100, 50, 1);
  same('rgb(200 100 50 / 0.5)', 200, 100, 50, 0.5);
  same('rgba(200 100 50 / 50%)', 200, 100, 50, 0.5);
  same('rgb(100% 50% 0%)', 255, 128, 0, 1);
  // hsl / hsla, including the hue wrap and the grey edge (s = 0)
  same('hsl(0 100% 50%)', 255, 0, 0, 1);
  same('hsl(120, 100%, 50%)', 0, 255, 0, 1);
  same('hsl(240 100% 50%)', 0, 0, 255, 1);
  same('hsl(420 100% 50%)', 255, 255, 0, 1);
  same('hsl(0 0% 50%)', 128, 128, 128, 1);
  same('hsla(200 50% 40% / 0.25)', 51, 119, 153, 0.25);
  expect(logged.length === 0, `a readable colour was reported as unreadable: ${logged.join(' | ')}`);

  // the fallback: loud, once per distinct string, and still a usable colour
  resetUnreadableColors();
  logged.length = 0;
  const bad = ['color-mix(in oklab, red 50%, blue)', 'oklch(62% 0.2 240)', 'rebeccapurple', '#ab', 'rgb(1, 2)'];
  for (const c of bad) {
    const p = parseColor(c);
    expect(p.every((n) => Number.isFinite(n)), `parseColor(${c}) must still return finite channels`, JSON.stringify(p));
  }
  for (const c of bad) parseColor(c); // a second pass must add no second report
  expect(logged.length === bad.length, `${bad.length} unreadable colours, read twice each, should log ${bad.length} times`, String(logged.length));
  expect(logged.every((l) => l.includes('[theme]')), 'the report does not name the theme reader');
  expect(unreadableColors().length === bad.length && bad.every((c) => unreadableColors().includes(c)), 'unreadableColors() does not list exactly what fell back', unreadableColors().join(' | '));
} finally { console.error = origErr; }

// --------------------------------------------------- 2. ground truth: every colour token of both themes parses
const CSS = ['app/globals.css', 'components/blueprint.css'];
const DECL = /(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gi;
/** A declaration value that IS a colour literal (a var() or a length is not this gate's business). */
const COLOUR = /^(#[0-9a-fA-F]+|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\()/i;
const tokens: { file: string; name: string; value: string }[] = [];
for (const rel of CSS) {
  const css = stripBlock(fs.readFileSync(path.join(SRC, rel), 'utf8'));
  for (const m of css.matchAll(DECL)) {
    const value = m[2].trim();
    if (COLOUR.test(value)) tokens.push({ file: rel, name: m[1], value });
  }
}
if (process.env.BP_THEME_COLORS_SEED) tokens.push({ file: 'seeded', name: '--seeded', value: 'color-mix(in oklab, red, blue)' });
expect(tokens.length >= 100, `only ${tokens.length} colour tokens found in ${CSS.join(' + ')}: the scan stopped matching`);

resetUnreadableColors();
const silent = console.error;
console.error = () => {};
try { for (const t of tokens) parseColor(t.value); } finally { console.error = silent; }
const fell = unreadableColors();
const owners = tokens.filter((t) => fell.includes(t.value)).map((t) => `${t.file} ${t.name}: ${t.value}`);
expect(fell.length === 0, `${fell.length} declared colour token(s) cannot be read back into canvas pixels: ${owners.join(' | ')}`);

const byFile = CSS.map((f) => `${f} ${tokens.filter((t) => t.file === f).length}`).join(', ');
if (failures.length) { console.log(failures.map((f) => 'FAIL ' + f).join('\n')); console.log(`check-theme-colors: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-theme-colors: ${held} expectations held; ${tokens.length} declared colour tokens all parse (${byFile})`);
