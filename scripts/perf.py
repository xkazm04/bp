# Frame times at ?scale=4 (docs/perf.md). Three modes:
#   python scripts/perf.py [url]            zoom + drag gesture from home (default)
#   python scripts/perf.py --lod [url]      static raster at each of 6 fixed LODs: the engine's perf.lastRasterMs
#                                           counter vs the full cost of an invalidated E.draw (the cost the frame
#                                           pays; Chrome defers the 2D raster to the first drawImage). Exit 1 when
#                                           the counter reads under 80% of the full figure at any LOD.
#   python scripts/perf.py --tween [url]    rAF deltas and raster counts during a lens switch (General -> lens ->
#                                           General) at home and three zooms
# Env: BP_BASE (default http://localhost:3010, `npm start`/`npm run dev`), RUNS (gesture runs, default 3),
#      N (rasters per LOD, default 30), TWEEN_RUNS (default 1), VW / VH / DPR (viewport, default 1920x1080 @1).
# Measure a production build: `npm run build && npm start`.
import os, time, json, statistics, sys
from playwright.sync_api import sync_playwright
BASE = (os.environ.get('BP_BASE') or 'http://localhost:3010').rstrip('/')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
mode = 'lod' if '--lod' in sys.argv else 'tween' if '--tween' in sys.argv else 'gesture'
url = args[0] if args else BASE + '/v/subtle?intro=0&scale=4'
W, H = int(os.environ.get('VW', 1920)), int(os.environ.get('VH', 1080))

LOD_JS = r"""
async (N) => {
  const E = window.__bp;
  if (E.M.sim.playing && E.togglePlay) E.togglePlay();
  const B = E.M.L.blds[0];
  const cx = B.x + B.w * 0.35, cy = B.y + B.h * 0.45;
  const levels = [['home', E.HOME.k], ['L-bld', E.KB1], ['L-blend', E.KB1 * 1.35], ['L-tiles', E.KB1 * 1.7], ['L-room', E.KB1 * 3], ['L-feat', E.KB1 * 6]];
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2); };
  const out = [];
  for (const [name, k] of levels) {
    if (name === 'home') E.cam.flyTo(E.HOME, 0); else E.cam.flyTo({ x: cx, y: cy, k }, 0);
    await new Promise((r) => setTimeout(r, 300));
    const ctr = [], full = [];
    for (let i = 0; i < N + 3; i++) {
      E.cache.invalidate();
      const r0 = E.perf.rasters;
      const t0 = performance.now(); E.draw(performance.now(), false); const dt = performance.now() - t0;
      if (i >= 3 && E.perf.rasters === r0 + 1) { ctr.push(E.perf.lastRasterMs); full.push(dt); }
    }
    out.push({ level: name, n: ctr.length, counterMs: med(ctr), fullMs: med(full), ratio: +(med(ctr) / med(full)).toFixed(2) });
  }
  E.cam.flyTo(E.HOME, 0);
  return out;
}
"""

TWEEN_JS = r"""
async () => {
  const E = window.__bp; if (E.M.sim.playing && E.togglePlay) E.togglePlay();
  const lens = E.lensIds[0];
  const B = E.M.L.blds[0];
  const out = [];
  const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(1); };
  for (const [name, m] of [['home', 0], ['L-bld', 1], ['L-tiles', 1.7], ['L-room', 3]]) {
    if (!m) E.cam.flyTo(E.HOME, 0); else E.cam.flyTo({ x: B.x + B.w * 0.35, y: B.y + B.h * 0.45, k: E.KB1 * m }, 0);
    await new Promise((r) => setTimeout(r, 600));
    const d = []; let rec = true, last = performance.now();
    const r0 = E.perf.rasters;
    const tick = (t) => { if (!rec) return; d.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    E.setView(lens); await new Promise((r) => setTimeout(r, 1200));
    E.setView('general'); await new Promise((r) => setTimeout(r, 1200));
    rec = false;
    const ds = d.slice(2);
    out.push({ level: name, frames: ds.length, p50: q(ds, 0.5), p95: q(ds, 0.95), max: q(ds, 1), over20: ds.filter((x) => x > 20).length, rasters: E.perf.rasters - r0, lastRasterMs: +E.perf.lastRasterMs.toFixed(1) });
  }
  E.cam.flyTo(E.HOME, 0);
  return out;
}
"""

res = {}
bad = False
with sync_playwright() as p:
    b = p.chromium.launch(args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=float(os.environ.get('DPR', 1)))
    pg.goto(url, wait_until='networkidle'); time.sleep(3 if mode != 'gesture' else 2)
    if mode == 'lod':
        for r in pg.evaluate(LOD_JS, int(os.environ.get('N', 30))):
            print(json.dumps(r))
            if r['n'] == 0 or r['ratio'] < 0.8: bad = True
        print('LOD counter vs full raster: ' + ('FAIL (counter under 80% of the full figure)' if bad else 'ok'))
    elif mode == 'tween':
        for run in range(int(os.environ.get('TWEEN_RUNS', 1))):
            for r in pg.evaluate(TWEEN_JS): print(json.dumps({'run': run, **r})); sys.stdout.flush()
    else:
        for run in range(int(os.environ.get('RUNS', 3))):
            pg.evaluate("__bp.goHome(0)"); time.sleep(0.8)
            pg.evaluate("""() => { window.__d = []; window.__rec = true; let last = performance.now(); const r0 = __bp.perf.rasters, f0 = __bp.perf.frames; window.__r0 = [r0, f0];
              const tick = (t) => { if (!window.__rec) return; window.__d.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }""")
            t0 = time.time()
            pg.mouse.move(W * 0.4, H * 0.45)
            while time.time() - t0 < 1.5:
                pg.mouse.wheel(0, -110); time.sleep(0.05)
            pg.mouse.move(W * 0.45, H * 0.5); pg.mouse.down()
            t1 = time.time(); i = 0
            while time.time() - t1 < 1.5:
                i += 1; pg.mouse.move(W * 0.45 - (i % 60) * 9 + (30 if (i // 60) % 2 else 0), H * 0.5 - (i % 40) * 4); time.sleep(0.016)
            pg.mouse.up()
            d = pg.evaluate("() => { window.__rec = false; return { d: window.__d, rasters: __bp.perf.rasters - window.__r0[0], frames: __bp.perf.frames - window.__r0[1], lastRasterMs: __bp.perf.lastRasterMs } }")
            ds = sorted(d['d'][2:])
            q = lambda f: ds[min(len(ds) - 1, int(len(ds) * f))]
            res[run] = {'n': len(ds), 'p50': round(q(0.5), 2), 'p95': round(q(0.95), 2), 'p99': round(q(0.99), 2), 'max': round(ds[-1], 2), 'rasters': d['rasters'], 'engineFrames': d['frames'], 'lastRasterMs': round(d['lastRasterMs'], 1)}
            print(json.dumps(res[run])); sys.stdout.flush()
    b.close()
sys.exit(1 if bad else 0)
