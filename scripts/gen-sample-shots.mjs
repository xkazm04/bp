#!/usr/bin/env node
// Draws Kettle's sample screenshots: public/sample-shots/<item>-<phase>-<theme>.svg, 1600x900, for every sample release
// item that has a screen (packages/core/src/model/train-sim.ts SAMPLE_ITEMS). Each is a plain app screen of the Kettle feature (a
// header, a nav, a few panels, text at 14-16 px) with a clear SAMPLE SCREEN stamp; an item's after differs from its
// before only by the state the item designed (an error banner with its action, a disabled button with its reason), so
// the compare panel's slider, blink and change map have a small, real, localised difference to show. An item whose change
// does not render in the default state gets an identical pair (the honest common case). Deterministic: same input, same
// bytes. Each file stays under 20 KB, and draws exactly the texts screenTexts() lists (the shot reports count them).
// Run: node scripts/gen-sample-shots.mjs   (writes the files and lists their sizes; exit 1 on a size or text-count miss)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV, SAMPLE_ITEMS, screenTexts, shotFile } from '../packages/core/src/model/train-sim.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps/web/public');
const W = 1600, H = 900, MAX_BYTES = 20 * 1024;

const THEMES = {
  light: { bg: '#f4f5f7', surface: '#ffffff', border: '#d9dde3', text: '#1c2230', muted: '#5b6475', accent: '#2f6fde', onAccent: '#ffffff', bar: '#e7eaef',
    warnBg: '#fdecea', warnLine: '#d4483f', warnText: '#7f1d16', offBg: '#e3e6ea', offText: '#5f6673', stamp: '#c2410c', nav: '#eef1f5' },
  dark: { bg: '#11141a', surface: '#1a1f28', border: '#2c3340', text: '#e7eaf0', muted: '#9aa3b2', accent: '#5b8def', onAccent: '#0b0e13', bar: '#252b36',
    warnBg: '#3a1d1b', warnLine: '#e5534b', warnText: '#ffc2bb', offBg: '#2a303b', offText: '#a0a8b6', stamp: '#fb923c', nav: '#161a22' },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The panel boxes: the first is the big one on the left, the rest stack on the right. */
function boxes(n) {
  const top = 112, bottom = 860, left = 272, gap = 24, bigW = 760, rightX = left + bigW + gap, rightW = 1568 - rightX;
  const out = [{ x: left, y: top, w: bigW, h: bottom - top }];
  const k = n - 1, h = k ? (bottom - top - gap * (k - 1)) / k : 0;
  for (let i = 0; i < k; i++) out.push({ x: rightX, y: top + i * (h + gap), w: rightW, h });
  return out;
}

function draw(it, phase, themeName) {
  const c = THEMES[themeName], s = it.screen, el = [], texts = [];
  const rect = (x, y, w, h, fill, extra = '') => el.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`);
  const text = (x, y, str, size, fill, extra = '') => { texts.push(str); el.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${extra}>${esc(str)}</text>`); };
  rect(0, 0, W, H, c.bg);
  // header
  rect(0, 0, W, 64, c.surface); rect(0, 64, W, 1, c.border);
  text(32, 39, 'Kettle', 16, c.text, ' font-weight="700"');
  text(132, 39, it.name, 16, c.text);
  text(1568, 39, 'Riverside studio', 14, c.muted, ' text-anchor="end"');
  // nav
  rect(0, 65, 240, H - 65, c.nav); rect(240, 65, 1, H - 65, c.border);
  NAV.forEach((n, i) => { if (i === 0) rect(16, 92 + i * 44, 208, 36, c.bar, ' rx="6"'); text(32, 115 + i * 44, n, 14, i === 0 ? c.text : c.muted); });
  // stamp
  el.push(`<g transform="rotate(-3 1450 84)"><rect x="1340" y="70" width="220" height="30" fill="none" stroke="${c.stamp}" stroke-width="2" rx="4"/>`);
  text(1450, 91, 'SAMPLE SCREEN', 15, c.stamp, ' font-weight="700" text-anchor="middle" letter-spacing="3"');
  el.push('</g>');
  // panels
  const bx = boxes(s.panels.length), ch = phase === 'after' ? s.change : undefined;
  s.panels.forEach((p, i) => {
    const b = bx[i], x = b.x + 24, banner = ch?.kind === 'banner' && ch.at === i ? ch : undefined, reason = ch?.kind === 'reason' && ch.at === i ? ch : undefined;
    rect(b.x, b.y, b.w, b.h, c.surface, ` rx="10" stroke="${c.border}"`);
    text(x, b.y + 40, p.title, 16, c.text, ' font-weight="700"');
    let y = b.y + 76;
    for (const l of p.lines) { text(x, y, l, 14, c.muted); y += 28; }
    if (p.button) {
      const off = !!reason;
      rect(x, y, 220, 44, off ? c.offBg : c.accent, ' rx="8"');
      text(x + 110, y + 28, p.button, 15, off ? c.offText : c.onAccent, ' text-anchor="middle" font-weight="600"');
      y += 44;
      if (reason) text(x, y + 28, reason.text, 14, c.text);
      y += 36; // the reason's line is kept free in both phases, so the after differs only there
    }
    // the panel's body: placeholder rows, as a list or a viewfinder would sit there
    const rows = Math.max(0, Math.floor((b.y + b.h - 40 - (y + 24)) / 40));
    for (let r = 0; r < Math.min(rows, 9); r++) rect(x, y + 24 + r * 40, (b.w - 48) * (r % 3 === 2 ? 0.55 : r % 3 === 1 ? 0.8 : 1), 24, c.bar, ' rx="4"');
    if (banner) {
      const by = banner.place === 'top' ? b.y + 56 : b.y + b.h - 88, bw = b.w - 48;
      rect(x, by, bw, 64, c.warnBg, ` rx="8" stroke="${c.warnLine}"`);
      text(x + 20, by + 38, banner.text, 14, c.warnText, ' font-weight="600"');
      rect(x + bw - 156, by + 12, 140, 40, c.surface, ` rx="6" stroke="${c.warnLine}"`);
      text(x + bw - 86, by + 38, banner.action, 14, c.warnText, ' text-anchor="middle" font-weight="600"');
    }
  });
  const want = screenTexts(it, phase);
  if (texts.join('\n') !== want.join('\n')) throw new Error(`${it.key} ${phase}: drew ${texts.length} texts, screenTexts lists ${want.length}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">\n`
    + `<!-- Generated by node scripts/gen-sample-shots.mjs: a Kettle sample screen (${it.key}, ${themeName}), not a real capture. -->\n`
    + el.join('\n') + '\n</svg>\n';
}

let bad = 0;
const rows = [];
for (const it of SAMPLE_ITEMS) {
  if (!it.screen) continue;
  for (const theme of ['light', 'dark']) for (const phase of ['before', 'after']) {
    const rel = shotFile(it.key, phase, theme), file = path.join(OUT, rel), svg = draw(it, phase, theme);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, svg);
    const n = Buffer.byteLength(svg);
    if (n >= MAX_BYTES) { bad++; console.log(`TOO BIG ${rel}: ${n} bytes`); }
    rows.push(`${String(n).padStart(6)}  ${rel}`);
  }
}
console.log(rows.join('\n'));
console.log(`gen-sample-shots: ${rows.length} files in public/sample-shots` + (bad ? `, ${bad} over 20 KB` : ''));
process.exit(bad ? 1 : 0);
