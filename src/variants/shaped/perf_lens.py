# Frame times for lens switches (the mix tween re-rasters the plan every frame), shaped variant.
# Usage: python src/variants/shaped/perf_lens.py [url]   (server: NEXT_DIST_DIR=.next-shaped npx next start -p 3112)
# Records requestAnimationFrame deltas while switching General -> Security -> Design -> General at L0 and
# again zoomed to fixtures (L2/L3), where every visible tile runs shape() + marks() on every frame.
import time, json, sys
from playwright.sync_api import sync_playwright
url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3112/v/shaped?intro=0&scale=4'
REC = """() => { const gen = (window.__gen = (window.__gen || 0) + 1), d = (window.__d = []); window.__rec = true; let last = performance.now(); window.__r0 = __bp.perf.rasters;
  const tick = (t) => { if (!window.__rec || window.__gen !== gen) return; d.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }"""
STOP = "() => { window.__rec = false; return { d: window.__d, rasters: __bp.perf.rasters - window.__r0, lastRasterMs: __bp.perf.lastRasterMs } }"
def stats(d):
    ds = sorted(d['d'][2:]); q = lambda f: ds[min(len(ds) - 1, int(len(ds) * f))]
    return {'n': len(ds), 'p50': round(q(0.5), 2), 'p95': round(q(0.95), 2), 'p99': round(q(0.99), 2), 'max': round(ds[-1], 2), 'rasters': d['rasters'], 'lastRasterMs': round(d['lastRasterMs'], 1)}
with sync_playwright() as p:
    b = p.chromium.launch(args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1920, 'height': 1080})
    pg.goto(url, wait_until='networkidle'); time.sleep(2)
    for where in ('L0', 'zoomed'):
        pg.evaluate("__bp.goHome(0)"); time.sleep(0.8)
        if where == 'zoomed':
            pg.mouse.move(1920 * 0.4, 1080 * 0.45)
            for _ in range(7): pg.mouse.wheel(0, -240); time.sleep(0.08)
            time.sleep(1.5)
        for run in range(2):
            pg.evaluate(REC)
            for k in ('6', '3', '1'):
                pg.keyboard.press(k); time.sleep(1.1)
            print(where, run, json.dumps(stats(pg.evaluate(STOP)))); sys.stdout.flush()
    b.close()
