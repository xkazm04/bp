// Checks the compare panel's pure maths (src/lib/train/perf.ts, src/lib/train/pixels.ts) with the verdict they sit
// beside (src/lib/scan/compare.ts verdictOf):
//   - perf: the real Athena experiment (interaction p95, 3 baseline runs) 80/88/80 -> 64 and 80/184/80 -> 88 are flat
//     (within the one-frame floor, within the spread), the Kettle sample's 96/104/98 -> 72 moved; median, spread, noise,
//     change, %, the outlier rule (more than noise/2 above the median), the frame flag, the range scale, signed figures;
//   - pixels: on tiny synthetic RGBA images, identical -> nothing moved; noise under the threshold -> nothing moved;
//     a faint change -> moved but "visually identical"; a block -> its exact grid cells, bbox, shares and words;
//   - the panel's own modules: the exported functions of apps/web/src/components/ledger/train/compare/** (the patch's
//     rows, the item body's blocks, the shown pairs and their cache keys, the pack order, the latest reading, one
//     performance row and the sentence under it) and the anchors their comments name. Nothing else reads them;
//     scripts/overlays-loader.mjs transpiles the .tsx, as scripts/check-train-budget.ts does.
// Run: node scripts/check-train-compare.ts  (Node's type stripping; no build step). Exit 1 on any failure.
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareOf, verdictOf, type Comparison, type LensFields } from '../packages/core/src/scan/compare.ts';
import { atTarget, beyondNoise, isOutlier, perfFigures, rangeScale, signed } from '../packages/core/src/train/perf.ts';
import { GRID_H, GRID_W, NOISE, bboxCells, diffPixels, pixWords } from '../packages/core/src/train/pixels.ts';
import type { Measurement, Proposal, Shot } from '../packages/core/src/scan/types.ts';
import { stripComments } from './lib/source.ts';

let n = 0, bad = 0;
function ok(cond: boolean, what: string, got?: unknown) {
  n++;
  if (!cond) { bad++; console.log('FAIL ' + what + (got === undefined ? '' : '  (got ' + JSON.stringify(got) + ')')); }
}
const near = (a: number | undefined, b: number, eps = 1e-9) => a !== undefined && Math.abs(a - b) <= eps;

// ------------------------------------------------------------------------------------------- perf
const LENSES: LensFields[] = [{ id: 'performance', manifest: { fields: [{ key: 'interactionP95Ms', metric: { better: 'down' } }] } }];
const P: Proposal = { id: 'p-x', run_id: 'r', feature: 'f', lens: 'performance', metric: 'interactionP95Ms', title: 't', standard: 's', kind: 'fix', status: 'done', created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' };
let mid = 0;
const reading = (value: number, phase: 'before' | 'after', i: number): Measurement => ({
  id: ++mid, run_id: 'r', feature: 'f', lens: 'performance', metric: 'interactionP95Ms', value, unit: 'ms', method: 'probe',
  measured_at: `2026-10-15T00:0${i}:00Z`, proposal_id: 'p-x', phase,
});
function judge(runs: number[], after: number) {
  const before = runs.map((v, i) => reading(v, 'before', i)), aft = [reading(after, 'after', 8)];
  return { v: verdictOf(P, before, aft, LENSES).verdict, f: perfFigures(runs, after, 'ms') };
}

{ // Athena: 80/88/80 -> 64, flat within the one-frame floor
  const { v, f } = judge([80, 88, 80], 64);
  ok(v === 'flat', 'athena 80/88/80 -> 64 is flat', v);
  ok(f.median === 80 && f.spread === 8 && near(f.noise, 16.7), 'athena 80/88/80: median 80, spread 8, noise one frame', f);
  ok(f.frame, 'athena 80/88/80: the noise is the frame floor');
  ok(f.change === -16 && near(f.pct, -20), 'athena 80/88/80 -> 64: change -16, -20 %', [f.change, f.pct]);
  ok(!beyondNoise(f), 'athena 80/88/80 -> 64: not beyond the noise');
  ok(f.outlier.every((x) => !x), 'athena 80/88/80: no outlier (88 is 8 above, half the noise is 8.35)', f.outlier);
}
{ // Athena: 80/184/80 -> 88, flat within the spread; 184 is an outlier
  const { v, f } = judge([80, 184, 80], 88);
  ok(v === 'flat', 'athena 80/184/80 -> 88 is flat', v);
  ok(f.median === 80 && f.spread === 104 && f.noise === 104 && !f.frame, 'athena 80/184/80: median 80, noise = spread 104', f);
  ok(f.change === 8 && near(f.pct, 10), 'athena 80/184/80 -> 88: change +8, +10 %', [f.change, f.pct]);
  ok(isOutlier(184, f) && !isOutlier(80, f), 'athena 80/184/80: 184 is the outlier run');
  ok(f.outlier.join() === 'false,false,true', 'outlier flags follow the sorted runs', f.outlier);
}
{ // a run far too FAST distorts the baseline exactly as much: the rule is symmetric (perf.ts isOutlier) and the table's
  // own words must be too, or the only marked run is the slow one
  const { f } = judge([10, 80, 80, 140], 80);
  ok(f.median === 80 && f.noise === 130, '10/80/80/140: median 80, noise = spread 130', f);
  ok(isOutlier(10, f) && !isOutlier(140, f), '10/80/80/140: the FAST run is the outlier, the slow one is inside', [isOutlier(10, f), isOutlier(140, f)]);
  ok(f.outlier.join() === 'true,false,false,false', 'outlier flags mark the fast tail too', f.outlier);
}
{ // Kettle sample: 96/104/98 -> 72 moved
  const { v, f } = judge([96, 104, 98], 72);
  ok(v === 'moved', 'sample 96/104/98 -> 72 moved', v);
  ok(f.median === 98 && near(f.noise, 16.7) && f.change === -26 && beyondNoise(f), 'sample: median 98, noise 16.7, change -26 beyond it', f);
  const s = rangeScale(f, 100, 200);
  ok(near(s.max, 216) && s.x(108) === '50.00%' && s.x(0) === '0.00%' && s.x(500) === '100.00%', 'range scale: 0..max(…)*1.08, clamped', [s.max, s.x(108), s.x(500)]);
}
{ // a worse change and one reading
  const { v } = judge([50, 52, 51], 90);
  ok(v === 'worse', '50/52/51 -> 90 is worse', v);
  const one = perfFigures([40], 30, 'ms');
  ok(one.noise === 0 && !one.frame && one.median === 40, 'one reading: spread 0, no frame floor', one);
  const none = perfFigures([], undefined, 'ms');
  ok(Number.isNaN(none.median) && none.change === undefined, 'no runs: no median, no change', none);
}
ok(signed(8) === '+8' && signed(-16) === '−16' && signed(0) === '±0' && signed(-2.25) === '−2.3', 'signed figures', [signed(8), signed(-16), signed(0), signed(-2.25)]);
ok(atTarget(90, 100) && !atTarget(110, 100) && atTarget(110, 100, 'up'), 'at target follows the direction');

// ------------------------------------------------------------------------------------------- pixels
const W = 64, H = 36;
const img = (fill: (x: number, y: number) => [number, number, number]) => {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fill(x, y), i = (y * W + x) * 4; a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 255; }
  return a;
};
const base = img((x, y) => [(x * 3) % 256, (y * 5) % 256, 120]);
{
  const g = diffPixels(base, img((x, y) => [(x * 3) % 256, (y * 5) % 256, 120]), W, H);
  ok(g.moved === 0 && g.pct === 0 && g.maxd === 0 && !g.bbox && g.cells.length === GRID_W * GRID_H && g.cells.every((c) => c === 0), 'identical: nothing moved, empty grid', g);
  const w = pixWords(g);
  ok(w.same && w.text.startsWith('Identical'), 'identical: "Identical" words', w);
}
{
  const g = diffPixels(base, img((x, y) => [(x * 3) % 256, (y * 5) % 256, 120 + NOISE]), W, H);
  ok(g.moved === 0 && g.maxd === NOISE && g.cells.every((c) => c === 0), 'noise at the threshold: nothing moved, maxd kept', g);
}
{
  const g = diffPixels(base, img((x, y) => [(x * 3) % 256, (y * 5) % 256, x < 4 && y < 2 ? 130 : 120]), W, H);
  ok(g.moved > 0 && g.pct === 0 && g.maxd === 10, 'a faint change: moved, nothing visible', g);
  ok(pixWords(g).same && pixWords(g).text.startsWith('Visually identical'), 'a faint change reads visually identical', pixWords(g));
}
{ // a block at x 10..17, y 5..8 changed by 100 on red
  const inB = (x: number, y: number) => x >= 10 && x <= 17 && y >= 5 && y <= 8;
  const g = diffPixels(base, img((x, y) => [inB(x, y) ? ((x * 3) % 256) + 100 : (x * 3) % 256, (y * 5) % 256, 120]), W, H);
  ok(g.bbox?.join() === '10,5,17,8', 'block: bbox in image pixels', g.bbox);
  ok(near(g.moved, (32 / (W * H)) * 100) && near(g.pct, g.moved) && g.maxd === 100, 'block: 32 of 2304 pixels moved and visible, maxd 100', [g.moved, g.pct, g.maxd]);
  // grid: 64 px / 32 cols = 2 px per cell, 36 px / 18 rows = 2 px per cell: x 10..17 -> cols 5..8, y 5..8 -> rows 2..4
  const lit = g.cells.map((c, i) => (c ? `${i % GRID_W},${Math.floor(i / GRID_W)}` : '')).filter(Boolean);
  const want: string[] = [];
  for (let r = 2; r <= 4; r++) for (let c = 5; c <= 8; c++) want.push(`${c},${r}`);
  ok(lit.join(' ') === want.join(' '), 'block: exactly the covering grid cells', lit);
  ok(g.cells.every((c) => c === 0 || c === 100), 'block: a cell holds its largest change', [...new Set(g.cells)]);
  const b = bboxCells(g);
  ok(!!b && near(b.x, 5) && near(b.y, 2.5) && near(b.w, 4) && near(b.h, 2), 'block: bbox in grid units', b);
  const w = pixWords(g);
  ok(!w.same && w.text.includes('x 10–17, y 5–8'), 'block: "differ" words with the region', w);
}
{ // GRID_H check against a non-multiple size
  const g = diffPixels(new Uint8ClampedArray(7 * 5 * 4), new Uint8ClampedArray(7 * 5 * 4).fill(200), 7, 5);
  ok(g.moved === 100 && g.cells.filter(Boolean).length <= GRID_W * GRID_H && g.bbox?.join() === '0,0,6,4', 'odd size: every pixel moved, bbox the whole image', g.bbox);
  ok(GRID_H === 18 && GRID_W === 32, 'the grid is 32 x 18');
}

// ------------------------------------------------------------------------------------------- the panel's own modules
const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
const CMP = 'components/ledger/train/compare/';
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = (f: string): Promise<Any> => import(pathToFileURL(path.join(SRC, CMP + f)).href);
const { patchRows } = await imp('CommitDiff.tsx');
const { blocksOf, inline } = await imp('ItemText.tsx');
const { minText, pairKey, pairLabel, shownPairs } = await imp('Screens.tsx');
const { hasRuns, perfItem, perfReason, runsOf } = await imp('PerfTable.tsx');
const { latestOf } = await imp('MetricStrip.tsx');
const { packHeading, packOrder } = await imp('ComparePanel.tsx');

{ // the patch's rows: one header per file, the hunk, and each line's old and new number
  const PATCH = [
    'diff --git a/apps/web/src/a.ts b/apps/web/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/apps/web/src/a.ts',
    '+++ b/apps/web/src/a.ts',
    '@@ -10,3 +10,4 @@ function f() {',
    ' keep',
    '-gone',
    '+added',
    '+also',
    '',
  ].join('\n');
  const rows = patchRows(PATCH);
  ok(rows.filter((r: Any) => r.k === 'file').map((r: Any) => r.text).join() === 'apps/web/src/a.ts', 'patch rows: one header per file, the path as git prints it', rows[0]);
  ok(rows.map((r: Any) => r.k).join() === 'file,hunk,ctx,del,add,add', 'patch rows: the index and ---/+++ lines are dropped, the trailing blank trimmed', rows.map((r: Any) => r.k));
  ok(rows.filter((r: Any) => r.k !== 'file').map((r: Any) => `${r.a}/${r.b}`).join(' ') === '/ 10/10 11/ /11 /12', 'patch rows: old and new line numbers follow the hunk header', rows.map((r: Any) => r.k + ' ' + r.a + '/' + r.b));
  // the file list beside the patch (git --numstat) keeps a space, so the patch's own header must keep it too
  const spaced = patchRows('diff --git a/apps/web/stage and depths.tsx b/apps/web/stage and depths.tsx\n@@ -1 +1 @@\n+x');
  ok(spaced[0].text === 'apps/web/stage and depths.tsx', 'patch rows: a path with spaces survives the file header', spaced[0]);
  const moved = patchRows('diff --git a/old name.ts b/sub/new name.ts\n@@ -1 +1 @@\n+x');
  ok(moved[0].text === 'sub/new name.ts', 'patch rows: a rename names where the file landed', moved[0]);
}

{ // the item body's blocks
  const BODY = '## Summary\nOne line\nwrapped.\n\n- a item\n  continued\n- b item\n\n1. first\n\n> a note\n\n```ts\nconst x = 1;\n```\n';
  const bs = blocksOf(BODY);
  ok(bs.map((b: Any) => b.k).join() === 'h,p,ul,ol,q,code', 'item text: heading, paragraph, both lists, quote, fence', bs.map((b: Any) => b.k));
  ok(bs[1].text === 'One line wrapped.' && bs[2].items.join('|') === 'a item continued|b item', 'item text: a paragraph and a list item join their wrapped lines', [bs[1].text, bs[2].items]);
  ok(bs[5].lang === 'ts' && bs[5].text === 'const x = 1;', 'item text: the fence keeps its language and its exact lines', bs[5]);
  const parts = inline('a `code` and **bold** end');
  ok(parts.length === 5 && parts[1].type === 'code' && parts[3].type === 'b', 'item text: inline code and bold become elements, the text between stays text', parts.map((p: Any) => (typeof p === 'string' ? 'text' : p.type)));
}

{ // the shown pairs and their cache keys
  const pair = (theme?: string, size?: string, both = true): Any => ({ ...(theme ? { theme } : {}), ...(size ? { size } : {}), before: { id: 1, path: 'shots/r/1.png' }, ...(both ? { after: { id: 2, path: 'shots/r/2.png' } } : {}) });
  const pairs = [pair('light'), pair('dark')];
  ok(shownPairs(pairs, 'light').length === 1 && shownPairs(pairs, 'both').length === 2, 'shown pairs: a theme shows its own, "both" shows both');
  ok(shownPairs([pair(undefined, '1280x800')], 'light').length === 1, 'shown pairs: no pair carries the theme, so every pair is shown');
  ok(pairKey('athena', pairs[0]) === 'athena:1:2' && pairKey(null, pairs[0]) === 'kettle:1:2', 'pair key: the product then the two shot ids', pairKey(null, pairs[0]));
  ok(pairKey('athena', pair('light', undefined, false)) === null, 'pair key: null when a side has no capture');
  ok(pairLabel({ theme: 'light', size: '1280x800' }) === 'light · 1280x800' && pairLabel({ theme: 'light', size: '1920x1080' }) !== pairLabel({ theme: 'light', size: '1280x800' }), 'pair label: two sizes of one theme are two different names', pairLabel({ theme: 'light', size: '1280x800' }));
  ok(minText(undefined) === undefined, 'min text: a side with no capture reports no reading at all', minText(undefined));
  ok(minText({ report: { minTextPx: 13 } }) === 'min text 13 px' && minText({}) === 'min text – px', 'min text: a capture reports its reading, or says the reading is missing', [minText({ report: { minTextPx: 13 } }), minText({})]);
  ok(pairLabel({ theme: 'dark' }) === 'dark' && pairLabel({}) === 'screen','pair label: no size adds nothing, no theme reads "screen"', [pairLabel({ theme: 'dark' }), pairLabel({})]);
  const scr = stripComments(fs.readFileSync(path.join(SRC, CMP, 'Screens.tsx'), 'utf8'));
  ok(!/[·,] ' \+ theme\b/.test(scr) && (scr.match(/\+ label\b/g) ?? []).length >= 12, 'pair label: all 12 caption and alt sites name the pair through it, none builds its own name', (scr.match(/\+ label\b/g) ?? []).length);
}

{ // one performance row and the sentence under it
  const read = (value: number, phase: 'before' | 'after', i: number, metric = 'interactionP95Ms'): Measurement =>
    ({ id: ++mid, run_id: 'r', feature: 'booking', lens: 'performance', metric, value, unit: 'ms', method: 'probe', measured_at: `2026-10-15T00:${String(i).padStart(2, '0')}:00Z`, proposal_id: 'p-x', phase });
  const ms = [read(96, 'before', 1), read(104, 'before', 2), read(98, 'before', 3), read(72, 'after', 4), read(40, 'before', 5, 'memMb')];
  const scan = { proposals: [P], measurements: ms, shots: [] as Shot[] };
  const c = compareOf(scan, 'p-x', LENSES) as Comparison;
  const lens: Any = { F: { interactionP95Ms: { label: 'Interaction p95', unit: 'ms', metric: { better: 'down', target: 100 } }, memMb: { label: 'Memory', unit: 'MB', metric: { better: 'down', target: 50 } } } };
  ok(runsOf(c).join() === '96,104,98' && hasRuns(c), 'runs: the item\'s own-metric before readings, in recorded order', runsOf(c));
  ok(latestOf(c.before, 'performance', 'interactionP95Ms')?.value === 98, 'latest reading: the last matching row of the phase wins', latestOf(c.before, 'performance', 'interactionP95Ms'));
  const it = perfItem(c, 'Booking', lens);
  ok(it.label === 'Interaction p95' && it.unit === 'ms' && it.f.after === 72, 'perf item: the lens field names the row, the after is the latest reading', [it.label, it.unit, it.f.after]);
  ok(it.context.length === 1 && it.context[0].key === 'memMb' && it.context[0].value === 40 && it.context[0].target === 50, 'perf item: the feature\'s other metrics of this lens are context rows', it.context);
  ok(perfReason(it).includes('median of 3 baseline runs') && perfReason(it).includes('larger than the noise'), 'perf reason: the change, the number of runs behind the median, and the noise it beat', perfReason(it));
  ok(perfReason({ ...it, f: { ...it.f, change: undefined } }).startsWith('No after reading yet'), 'perf reason: no after reading says so, and judges nothing');
}

{ // the pack order the panel's prev / next walks
  const pk = (id: string, created_at: string): Any => ({ id, lens: 'performance', n: 1, branch: 'pack/' + id, base_ref: 'main', base_sha: 'abc1234', status: 'open', created_at, updated_at: created_at });
  const pr = (id: string, pack_id: string | undefined, created_at: string): Any => ({ ...P, id, ...(pack_id ? { pack_id } : {}), created_at, updated_at: created_at });
  const T: Any = {
    packs: [pk('k-b', '2026-10-15T00:00:00Z'), pk('k-a', '2026-10-14T00:00:00Z')],
    proposals: [pr('p-3', 'k-b', '2026-10-16T00:00:00Z'), pr('p-2', 'k-a', '2026-10-16T00:00:00Z'), pr('p-1', 'k-a', '2026-10-15T00:00:00Z'), pr('p-loose', undefined, '2026-10-16T00:00:00Z')],
  };
  ok(packOrder(T).join() === 'p-1,p-2,p-3', 'pack order: packs oldest first, each pack\'s items by created_at then id, no loose item', packOrder(T));
}

{ // the second table's heading: it holds only the pack's items measured in runs, so it may never say "the pack" alone
  ok(typeof packHeading === 'function', 'pack heading: ComparePanel exports the heading, so it can be read here', typeof packHeading);
  ok(packHeading(3, 12) === 'The whole pack · 3 of 12 items measured in runs', 'pack heading: 3 measured of 12 items says both numbers', packHeading(3, 12));
  ok(packHeading(1, 1).includes('1 of 1 item ') && packHeading(2, 2).includes('2 of 2 items '), 'pack heading: one item is not "items"', [packHeading(1, 1), packHeading(2, 2)]);
}

{ // reduced motion stops the blink: the rate may be claimed only by the element that media query hides
  const scr = stripComments(fs.readFileSync(path.join(SRC, CMP, 'Screens.tsx'), 'utf8'));
  const claims = scr.split('\n').filter((l) => l.includes('0.7 s'));
  ok(claims.length > 0 && claims.every((l) => l.includes('tr-blink-a')), 'blink: every claim of the 0.7 s swap sits in the span reduced motion hides', claims);
  const css = fs.readFileSync(path.join(SRC, CMP, 'Screens.css'), 'utf8');
  const rm = css.slice(css.indexOf('prefers-reduced-motion'));
  ok(/\.tr-blink-a\s*\{[^}]*display:\s*none/.test(rm), 'blink: that span is what the reduced-motion block hides', rm.slice(0, 120));
}

{ // one module, one import statement: a second one hides what the file already has and drifts out of sight at the
  // bottom of the list (ComparePanel.tsx imported @bp/core/train/rules twice, the second line below the .css import)
  const twice: string[] = [];
  for (const f of fs.readdirSync(path.join(SRC, CMP)).filter((f) => /\.tsx?$/.test(f))) {
    const seen = new Map<string, number>();
    for (const m of stripComments(fs.readFileSync(path.join(SRC, CMP, f), 'utf8')).matchAll(/^import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
    for (const [spec, k] of seen) if (k > 1) twice.push(`${f}: ${spec} x${k}`);
  }
  ok(!twice.length, 'imports: no module is imported twice in one file of the compare panel', twice);
}

{ // the comments' anchors: a path named under src/lib/ must be one this tree has
  const files = fs.readdirSync(path.join(SRC, CMP));
  const dead: string[] = [];
  for (const f of files) {
    for (const m of fs.readFileSync(path.join(SRC, CMP, f), 'utf8').matchAll(/\bsrc\/lib\/[\w./-]+\.(?:ts|tsx)\b/g)) {
      if (!fs.existsSync(path.join(SRC, m[0].slice('src/'.length)))) dead.push(f + ': ' + m[0]);
    }
  }
  ok(!dead.length, `anchors: every src/lib/ path the compare panel's comments name exists (${files.length} files read)`, dead);
}

{ // the words beside the outline: the rule marks both tails (perf.ts isOutlier), so the panel's own words must too
  const src = stripComments(fs.readFileSync(path.join(SRC, CMP, 'PerfTable.tsx'), 'utf8'));
  const title = /title="outlier run: ([^"]*)"/.exec(src);
  ok(!!title && /away from the median/.test(title[1]) && !/above the median/.test(title[1]), 'outlier outline: the tooltip names both tails, not only the slow one', title?.[1]);
  const key = src.slice(src.indexOf('tr-pt-key'));
  ok(key.includes('k-out') && /outlier/.test(key), 'outlier outline: the legend explains it, so the only explanation is not a hover title', key.includes('k-out'));
}

console.log(bad ? `check-train-compare: ${bad} of ${n} failed` : `check-train-compare: ${n} checks passed`);
process.exit(bad ? 1 : 0);
