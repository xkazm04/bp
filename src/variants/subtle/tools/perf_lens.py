# Frame times during lens switches (General -> lens -> lens -> General) at L0 and at a zoomed level.
# usage: python src/variants/subtle/tools/perf_lens.py [url]   (default: $BP_BASE, else :3000, /v/subtle?intro=0&scale=4)
import os, time, json, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from shotkit import base
url = sys.argv[1] if len(sys.argv) > 1 else base() + '/v/subtle?intro=0&scale=4'
REC = """() => { window.__d = []; window.__rm = []; window.__rec = true; let last = performance.now(); window.__r0 = [__bp.perf.rasters, __bp.perf.frames];
  const tick = (t) => { if (!window.__rec) return; window.__d.push(t - last); last = t; window.__rm.push(__bp.perf.lastRasterMs); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }"""
STOP = "() => { window.__rec = false; return { rm: window.__rm, d: window.__d, rasters: __bp.perf.rasters - window.__r0[0], lastRasterMs: __bp.perf.lastRasterMs } }"
def stats(tag, d):
    ds = sorted(d['d'][2:]); q = lambda f: ds[min(len(ds) - 1, int(len(ds) * f))]
    print(json.dumps({'run': tag, 'n': len(ds), 'p50': round(q(0.5), 2), 'p95': round(q(0.95), 2), 'p99': round(q(0.99), 2), 'max': round(ds[-1], 2), 'rasters': d['rasters'], 'rasterMs_p50': round(sorted(d['rm'])[len(d['rm'])//2], 1), 'rasterMs_p95': round(sorted(d['rm'])[int(len(d['rm'])*0.95)], 1), 'lastRasterMs': round(d['lastRasterMs'], 1)})); sys.stdout.flush()
with sync_playwright() as p:
    b = p.chromium.launch(args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1920, 'height': 1080})
    pg.goto(url, wait_until='networkidle'); time.sleep(2)
    for where in ('L0', 'zoomed'):
        pg.evaluate("__bp.goHome(0)"); time.sleep(0.8)
        if where == 'zoomed':
            pg.mouse.move(1920 * 0.4, 1080 * 0.45)
            for _ in range(5): pg.mouse.wheel(0, -240); time.sleep(0.08)
            time.sleep(1.2)
        for run in range(2):
            pg.evaluate(REC)
            for k in ('6', '3', '4', '1'):
                pg.keyboard.press(k); time.sleep(0.75)
            stats(f'{where}-{run}', pg.evaluate(STOP))
    b.close()
