// Checks that the rail's CSS sizes agree with the engine's layout constants (one vocabulary, two languages):
//   src/engine/chrome.ts   railWidth() shown return (86 = rail 64 + 14 edge + 8 gap), FLYOUT_W (340)
//   src/components/rail.css  #rail width + right, #flyout width, #flyout right (must be var(--rw), the published railWidth)
// The 8 px gap between rail and plan is not a CSS value; it is the only constant kept here.
// A pattern that stops matching fails loud (exit 1), it never passes. Comments are stripped before matching.
// Run: node scripts/check-chrome-sizes.mjs   (plain node, no deps)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStripped } from './lib/source.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAP = 8;
const ts = readStripped(path.join(ROOT, 'src/engine/chrome.ts'));
const css = readStripped(path.join(ROOT, 'src/components/rail.css'));

let failed = 0, pairs = 0;
const fail = (m) => { failed++; console.log('FAIL ' + m); };
const need = (what, m) => { if (!m) fail(`${what}: pattern did not match (the source was reshaped; update the check)`); return m; };

const rw = need('chrome.ts railWidth', /function railWidth\([^)]*\)[^{]*\{\s*return\s+[\w.]+\s*\?\s*(\d+)\s*:\s*(\d+)\s*;/.exec(ts));
const fw = need('chrome.ts FLYOUT_W', /export const FLYOUT_W\s*=\s*(\d+)\s*;/.exec(ts));
/** The declaration `prop: value` inside the last plain `#id { ... }` rule that sets it. */
const decl = (id, prop) => {
  let v = null;
  for (const m of css.matchAll(new RegExp('(?:^|[}\\s])#' + id + '\\s*\\{([^}]*)\\}', 'g'))) {
    const d = new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+)').exec(m[1]);
    if (d) v = d[1].trim();
  }
  return need(`rail.css #${id} ${prop}`, v);
};
const railW = decl('rail', 'width'), railR = decl('rail', 'right'), flyW = decl('flyout', 'width'), flyR = decl('flyout', 'right');
const px = (v) => (v && /^(\d+)px$/.test(v) ? Number(v.slice(0, -2)) : (fail(`not a px length: ${v}`), NaN));

if (rw && fw && railW && railR && flyW && flyR) {
  const shown = Number(rw[2]), sum = px(railW) + px(railR) + GAP;
  pairs++; if (sum !== shown) fail(`#rail width ${railW} + right ${railR} + gap ${GAP} = ${sum}, chrome.ts railWidth() shown = ${shown}`);
  pairs++; if (px(flyW) !== Number(fw[1])) fail(`#flyout width ${flyW}, chrome.ts FLYOUT_W = ${fw[1]}`);
  pairs++; if (flyR.replace(/\s/g, '') !== 'var(--rw)') fail(`#flyout right is ${flyR}, expected var(--rw) (the published railWidth)`);
}
if (failed) { console.log(`check-chrome-sizes: ${failed} failed`); process.exit(1); }
console.log(`check-chrome-sizes: ${pairs} of 3 pairs agree (rail ${railW} + ${railR} + ${GAP} = ${rw[2]}; flyout ${flyW}; right ${flyR})`);
