// Pins the camera's math (src/engine/camera.ts), the one screen <-> world authority the engine, the hit
// testing and the static cache all read: the conversions invert each other, a fit centres the box in the
// region, a wheel zoom keeps the world point under the cursor, the clamp keeps the plan reachable, and
// reduced motion lands a fly-to at once. Without this, a change to any of them passes every other gate
// and shows up only as a drop landing beside the cursor.
// Run: node scripts/check-camera.ts  (Node's type stripping; no build step). Exit 1 when any expectation fails.
import { Camera } from '../src/engine/camera.ts';

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

const WORLD = { x: 0, y: 0, w: 4000, h: 2400 };
const make = () => {
  let moves = 0;
  const c = new Camera(() => { moves++; });
  c.FW = 1280; c.FH = 800; c.world = WORLD; c.reduced = true;
  return { c, moves: () => moves };
};

// ------------------------------------------------------------------ conversions
{
  const { c } = make();
  c.set({ x: 1200, y: 900, k: 0.7 });
  for (const [px, py] of [[0, 0], [640, 400], [1279, 13], [311, 777]]) {
    expect(near(c.sx(c.wx(px)), px) && near(c.sy(c.wy(py)), py), `sx(wx(${px})) and sy(wy(${py})) round-trip`);
  }
  expect(near(c.sx(c.x), c.FW / 2) && near(c.sy(c.y), c.FH / 2), 'the camera centre draws at the screen centre');
}

// ------------------------------------------------------------------ fit
{
  const { c } = make();
  const R = { l: 12, t: 74, r: 1194, b: 760 }, pad = { t: 20, r: 20, b: 20, l: 20 };
  const box = { x: 500, y: 300, w: 800, h: 400 };
  const f = c.fit(box, pad, 1, R);
  const rw = R.r - R.l - 40, rh = R.b - R.t - 40;
  expect(near(f.k, Math.min(rw / box.w, rh / box.h)), `fit picks the limiting scale (got ${f.k})`);
  c.set(f);
  const mx = c.sx(box.x + box.w / 2), my = c.sy(box.y + box.h / 2);
  expect(near(mx, (R.l + R.r) / 2, 1e-9), `fit centres the box horizontally in the region (got ${mx})`);
  expect(near(my, (R.t + R.b) / 2, 1e-9), `fit centres the box vertically in the region (got ${my})`);
  const huge = c.fit({ x: 0, y: 0, w: 1e7, h: 1e7 }, pad, 1, R);
  expect(huge.k === c.KMIN, `fit clamps to KMIN (got ${huge.k})`);
}

// ------------------------------------------------------------------ wheel zoom keeps the anchor
{
  const { c } = make();
  c.reduced = false;
  c.set({ x: 2000, y: 1200, k: 0.5 });
  const px = 300, py = 200, wx = c.wx(px), wy = c.wy(py);
  c.zoomAt(px, py, 1.6);
  let steps = 0;
  while (c.stepWheel() && steps < 500) {
    steps++;
    // mid-flight the anchor drifts only by the world clamp; this region is far from the edges
    expect(near(c.wx(px), wx, 1e-9) && near(c.wy(py), wy, 1e-9), `wheel step ${steps} keeps the world point under the cursor`);
  }
  expect(steps > 1 && steps < 500, `the wheel smoothing settles in a few steps (took ${steps})`);
  expect(near(c.k, 0.8), `the wheel lands on k0 * f (got ${c.k})`);
  expect(!c.moving, 'a settled wheel is not moving');
}

// ------------------------------------------------------------------ clamp to world
{
  const { c } = make();
  c.set({ x: -1e6, y: 1e6, k: 1 });
  const m = 120 / c.k;
  expect(near(c.x, WORLD.x - c.FW / 2 / c.k + m), `the clamp stops a pan off the left edge (x ${c.x})`);
  expect(near(c.y, WORLD.y + WORLD.h + c.FH / 2 / c.k - m), `the clamp stops a pan off the bottom edge (y ${c.y})`);
  c.set({ x: 0, y: 0, k: 99 });
  expect(c.k === c.KMAX, `set clamps k to KMAX (got ${c.k})`);
}

// ------------------------------------------------------------------ reduced motion
{
  const { c, moves } = make();
  const m0 = moves();
  c.flyTo({ x: 1500, y: 1000, k: 0.9 });
  expect(!c.flying && near(c.x, 1500) && near(c.y, 1000) && near(c.k, 0.9), 'under reduced motion a fly-to lands at once');
  expect(moves() === m0 + 1, `a reduced fly-to reports one move (got ${moves() - m0})`);
  c.zoomAt(640, 400, 2);
  expect(!c.wz && near(c.k, 1.8), `under reduced motion a wheel zoom lands at once (k ${c.k})`);
}

if (failures.length) {
  console.error(`check-camera: ${failures.length} failed, ${held} held`);
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}
console.log(`check-camera: ${held} expectations held`);
