// check:subtle-health-ink - the subtle strip glyph must tell 'watch' from 'bad' without colour hue: the two inks
// differ in measured WCAG relative luminance by >= 3:1 (the non-text threshold) in BOTH themes, and trouble is
// drawn with more strokes than watch (a shape channel). Before this, amber vs red was 1.77:1 dark, 1.27:1 light and
// the glyph was identical.
// The ratio is MEASURED from what healthInk() actually returns, with the token values parsed from the dark and light
// blocks of src/app/globals.css (the same blocks check:tokens reads) and served through a stub getComputedStyle;
// a check that matched a token's name would stay green when the colour behind the name changed.
// Run: node scripts/check-subtle-health-ink.ts   (Node's type stripping; scripts/overlays-loader.mjs transpiles src/**)
// Control: BP_HEALTH_INK_MUTATE='[["marks.ts","find","replace"]]' rewrites source as it loads, so the check can be seen red.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_HEALTH_INK_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const marks: Any = await import(pathToFileURL(path.join(SRC, 'variants/subtle/marks.ts')).href);

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

// ---- the token values, per theme, from globals.css
const css = stripComments(fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8'));
function block(sel: RegExp): Record<string, string> {
  const m = sel.exec(css);
  if (!m) { failures.push('globals.css: block not found ' + sel); return {}; }
  const open = css.indexOf('{', m.index);
  let depth = 0, end = open;
  for (let i = open; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) { end = i; break; } }
  const out: Record<string, string> = {};
  for (const d of css.slice(open + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}
const THEMES: Record<string, Record<string, string>> = {
  dark: block(/:root\s*,\s*:root\[data-theme=['"]dark['"]\]\s*\{/),
  light: block(/:root\[data-theme=['"]light['"]\]\s*\{/),
};

const lum = (hex: string): number => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return NaN;
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ---- a recording canvas: every call is one op; the glyph set only strokes, fills, rects and arcs
const recorder = () => {
  const ops: string[] = [];
  const ctx: Any = new Proxy({}, { get: (_t, k: string) => (typeof k === 'string' && /^(stroke|fill|rect|arc|fillRect|strokeRect)$/.test(k) ? () => { ops.push(k); } : () => {}), set: () => true });
  return { ctx, ops };
};

const GLYPHS = ['bars', 'set-square', 'brackets', 'pulse', 'padlock', 'check', 'stopwatch'];
for (const mode of ['dark', 'light'] as const) {
  const tok = THEMES[mode];
  (globalThis as Any).document = { documentElement: {} };
  (globalThis as Any).getComputedStyle = () => ({ getPropertyValue: (n: string) => tok[n] ?? '' });
  // a fresh Theme object per mode: healthInk caches per object, as the engine's readTheme builds one per theme
  const th: Any = { mode, amber: tok['--amber'], red: tok['--red'], inkA: (a: number) => 'rgba(ink,' + a + ')' };
  const watch = marks.healthInk(th, 'watch', true), bad = marks.healthInk(th, 'bad', true);
  const r = ratio(watch, bad);
  expect(Number.isFinite(r) && r >= 3, `${mode}: the watch ink ${watch} and the trouble ink ${bad} are ${r.toFixed(2)}:1 by luminance, under the 3:1 non-text threshold`);
  const ground = tok['--panel-solid'];
  expect(ratio(bad, ground) >= 3, `${mode}: the trouble ink ${bad} on the panel ${ground} is ${ratio(bad, ground).toFixed(2)}:1, under 3:1`);
  expect(ratio(watch, ground) >= 3, `${mode}: the watch ink ${watch} on the panel ${ground} is ${ratio(watch, ground).toFixed(2)}:1, under 3:1`);

  for (const g of GLYPHS) {
    const w = recorder(), b = recorder();
    marks.healthGlyph(w.ctx, th, g, 'watch', true, 0, 0, 10);
    marks.healthGlyph(b.ctx, th, g, 'bad', true, 0, 0, 10);
    expect(w.ops.length > 0, `${mode}/${g}: watch drew nothing`);
    expect(b.ops.length > w.ops.length, `${mode}/${g}: trouble draws ${b.ops.length} strokes, watch ${w.ops.length}: no shape channel`);
  }
}

if (failures.length) { console.log('FAIL check:subtle-health-ink\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`check:subtle-health-ink ok - ${held} assertions held (watch vs trouble: measured luminance >= 3:1 in dark and light, plus a heavier trouble glyph for all ${GLYPHS.length} shared glyphs)`);
