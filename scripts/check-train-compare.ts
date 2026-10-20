// Checks the compare panel's pure maths (src/lib/train/perf.ts, src/lib/train/pixels.ts) with the verdict they sit
// beside (src/lib/scan/compare.ts verdictOf):
//   - perf: the real Athena experiment (interaction p95, 3 baseline runs) 80/88/80 -> 64 and 80/184/80 -> 88 are flat
//     (within the one-frame floor, within the spread), the Kettle sample's 96/104/98 -> 72 moved; median, spread, noise,
//     change, %, the outlier rule (more than noise/2 above the median), the frame flag, the range scale, signed figures;
//   - pixels: on tiny synthetic RGBA images, identical -> nothing moved; noise under the threshold -> nothing moved;
//     a faint change -> moved but "visually identical"; a block -> its exact grid cells, bbox, shares and words.
// Run: node scripts/check-train-compare.ts  (Node's type stripping; no build step). Exit 1 on any failure.
import { verdictOf, type LensFields } from '../apps/web/src/lib/scan/compare.ts';
import { atTarget, beyondNoise, isOutlier, perfFigures, rangeScale, signed } from '../apps/web/src/lib/train/perf.ts';
import { GRID_H, GRID_W, NOISE, bboxCells, diffPixels, pixWords } from '../apps/web/src/lib/train/pixels.ts';
import type { Measurement, Proposal } from '../apps/web/src/lib/scan/types.ts';

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

console.log(bad ? `check-train-compare: ${bad} of ${n} failed` : `check-train-compare: ${n} checks passed`);
process.exit(bad ? 1 : 0);
