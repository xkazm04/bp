# Bold's frame-time probe: scripts/perf.py's zoom+drag plus a lens-switch run (the mix tween re-rasters
# the static layer, decor included, every frame). Usage: python src/variants/bold/perf.py [url]
import time, json, sys
from playwright.sync_api import sync_playwright
url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3113/v/bold?intro=0&scale=4'
START = """() => { window.__d = []; window.__rec = true; let last = performance.now(); window.__r0 = [__bp.perf.rasters, __bp.perf.frames];
  const tick = (t) => { if (!window.__rec) return; window.__d.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }"""
STOP = "() => { window.__rec = false; return { d: window.__d, rasters: __bp.perf.rasters - window.__r0[0], lastRasterMs: __bp.perf.lastRasterMs } }"
def stats(tag, d):
    ds = sorted(d['d'][2:]); q = lambda f: ds[min(len(ds) - 1, int(len(ds) * f))]
    r = {'run': tag, 'n': len(ds), 'p50': round(q(0.5), 1), 'p95': round(q(0.95), 1), 'max': round(ds[-1], 1), 'rasters': d['rasters'], 'lastRasterMs': round(d['lastRasterMs'], 1)}
    print(json.dumps(r)); sys.stdout.flush()
with sync_playwright() as p:
    b = p.chromium.launch(args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1920, 'height': 1080})
    pg.goto(url, wait_until='networkidle'); time.sleep(2)
    W, H = 1920, 1080
    for lens_view in ('1', '6', '4'):
        pg.keyboard.press(lens_view); time.sleep(1)
        pg.evaluate("__bp.goHome(0)"); time.sleep(0.8)
        pg.evaluate(START)
        t0 = time.time(); pg.mouse.move(W * 0.4, H * 0.45)
        while time.time() - t0 < 1.5: pg.mouse.wheel(0, -110); time.sleep(0.05)
        pg.mouse.move(W * 0.45, H * 0.5); pg.mouse.down(); t1 = time.time(); i = 0
        while time.time() - t1 < 1.5:
            i += 1; pg.mouse.move(W * 0.45 - (i % 60) * 9 + (30 if (i // 60) % 2 else 0), H * 0.5 - (i % 40) * 4); time.sleep(0.016)
        pg.mouse.up()
        stats('zoom+drag view ' + lens_view, pg.evaluate(STOP))
    for where in ('L0', 'Z'):
        pg.keyboard.press('1'); time.sleep(0.5)
        pg.evaluate("__bp.goHome(0)"); time.sleep(0.8)
        if where == 'Z':
            pg.mouse.move(W * 0.4, H * 0.45)
            for _ in range(4): pg.mouse.wheel(0, -240); time.sleep(0.08)
            time.sleep(1.2)
        pg.evaluate(START)
        for k in ('6', '3', '4', '1', '2', '5', '7', '1'):
            pg.keyboard.press(k); time.sleep(0.75)
        stats('lens switches at ' + where, pg.evaluate(STOP))
    b.close()
