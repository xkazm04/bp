// Holds the strip's CSS size to the safe area the engine fits the plan into. chrome.ts baseHeight() is the only number
// the home fit reads (the strip, its bottom margin and a 6 px gap); timeline.css draws the strip with its own literals,
// because a stylesheet cannot call baseHeight(). A strip that grows without baseHeight overlaps the plan's bottom row;
// one that shrinks leaves a dead band. Normal and compact are both checked.
// Run: node src/components/timeline/check-size.ts  (Node's type stripping; no build step). Exit 1 on any disagreement.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseHeight } from '../../engine/chrome.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAP = 6; // chrome.ts: "the strip, its bottom margin and a 6 px gap"
const css = fs.readFileSync(path.join(HERE, '../timeline.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

/** The declarations of the one rule whose selector list is exactly `sel` (whitespace-normalised). */
function rule(sel: string): Map<string, string> | null {
  const want = sel.replace(/\s+/g, ' ').trim();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].replace(/\s+/g, ' ').trim() !== want) continue;
    return new Map([...m[2].matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].map((d) => [d[1], d[2].trim()]));
  }
  return null;
}
const px = (v: string | undefined) => (v && /^\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : NaN);

const normal = rule('#base.tl-strip'), compact = rule('.bp-compact #base.tl-strip');
expect(!!normal, 'timeline.css has no `#base.tl-strip` rule');
expect(!!compact, 'timeline.css has no `.bp-compact #base.tl-strip` rule');
for (const [name, r, isCompact] of [['normal', normal, false], ['compact', compact, true]] as const) {
  if (!r) continue;
  const h = px(r.get('height')), b = px(r.get('bottom') ?? normal?.get('bottom'));
  expect(!isNaN(h) && !isNaN(b), `${name}: height ${r.get('height')} / bottom ${r.get('bottom')} are not plain px`);
  const want = baseHeight({ compact: isCompact });
  expect(h + b + GAP === want, `${name}: strip ${h} px + bottom ${b} px + gap ${GAP} px = ${h + b + GAP}, chrome.ts baseHeight = ${want}`);
}

if (failures.length) {
  console.error(`check-size: ${failures.length} failure(s), ${held} held`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-size: ${held} expectations held (strip + margin + gap = baseHeight, normal and compact)`);
