# Frame times while zooming and dragging at ?scale=4 (docs/perf.md).
# Usage: python scripts/perf.py [url]   default: $BP_BASE (else http://localhost:3000, `npm start`/`npm run dev`)
#        + /v/subtle?intro=0&scale=4. Measure a production build: `npm run build && npm start`.
import os, time, json, statistics, sys
from playwright.sync_api import sync_playwright
BASE = (os.environ.get('BP_BASE') or 'http://localhost:3000').rstrip('/')
url = sys.argv[1] if len(sys.argv) > 1 else BASE + '/v/subtle?intro=0&scale=4'
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1920, 'height': 1080})
    pg.goto(url, wait_until='networkidle'); time.sleep(2)
    for run in range(3):
        pg.evaluate("__bp.goHome(0)"); time.sleep(0.8)
        pg.evaluate("""() => { window.__d = []; window.__rec = true; let last = performance.now(); const r0 = __bp.perf.rasters, f0 = __bp.perf.frames; window.__r0 = [r0, f0];
          const tick = (t) => { if (!window.__rec) return; window.__d.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }""")
        W, H = 1920, 1080
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
