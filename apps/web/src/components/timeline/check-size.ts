// Holds the strip's CSS size to the safe area the engine fits the plan into. chrome.ts baseHeight() is the only number
// the home fit reads (the strip, its bottom margin and a 6 px gap); timeline.css draws the strip with its own literals,
// because a stylesheet cannot call baseHeight(). A strip that grows without baseHeight overlaps the plan's bottom row;
// one that shrinks leaves a dead band. Normal and compact are both checked.
// Run: node src/components/timeline/check-size.ts  (Node's type stripping; no build step). Exit 1 on any disagreement.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripBlock } from '../../../../../scripts/lib/source.ts';
import { baseHeight } from '../../engine/chrome.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAP = 6; // chrome.ts: "the strip, its bottom margin and a 6 px gap"
const css = stripBlock(fs.readFileSync(path.join(HERE, '../timeline.css'), 'utf8'));

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

/** Every rule in the file, as [normalised selector list, declarations]. A rule nested in an @media block is listed
 *  the same way (its own braces are the ones matched), which is what lets the cascade check below see it. */
const RULES: [string, Map<string, string>][] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [
  m[1].replace(/\s+/g, ' ').trim(),
  new Map([...m[2].matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].map((d) => [d[1], d[2].trim()])),
]);

/** The declarations for the selector list `sel`, every rule that carries it merged in source order: the last
 *  declaration wins, as the cascade would take it. Reading only the FIRST rule let a later override (a media query,
 *  a second rule further down) resize the strip with this check still green. */
function rule(sel: string): Map<string, string> | null {
  const want = sel.replace(/\s+/g, ' ').trim();
  const hits = RULES.filter(([s]) => s === want);
  if (!hits.length) return null;
  const out = new Map<string, string>();
  for (const [, decls] of hits) for (const [k, v] of decls) out.set(k, v);
  return out;
}
const px = (v: string | undefined) => (v && /^\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : NaN);

const SELECTORS = ['#base.tl-strip', '.bp-compact #base.tl-strip'];
const normal = rule(SELECTORS[0]), compact = rule(SELECTORS[1]);
expect(!!normal, 'timeline.css has no `#base.tl-strip` rule');
expect(!!compact, 'timeline.css has no `.bp-compact #base.tl-strip` rule');
// The two rules above are checked against baseHeight; this asserts they are the ONLY rules that size the strip.
// Without it the ground truth is only half read: a third rule (a media query, a second rule further down) could set
// any height at all and every expectation here would still hold, because none of them looks for it.
const sizers = RULES.filter(([s, d]) => /\btl-strip\b/.test(s) && (d.has('height') || d.has('bottom'))).map(([s]) => s);
expect(sizers.length === SELECTORS.length && SELECTORS.every((s) => sizers.includes(s)),
  `timeline.css sizes the strip in ${sizers.length} rule(s) (${sizers.join(' | ')}); chrome.ts baseHeight knows only ${SELECTORS.join(' | ')}`);
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
console.log(`check-size: ${held} expectations held (strip + margin + gap = baseHeight, normal and compact; ${sizers.length} rules size the strip)`);
