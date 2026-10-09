# Screenshots for the subtle variant (a copy of scripts/shots.py with its own port and out dir).
# usage: python src/variants/subtle/tools/shots.py [quick]
import time, sys, re
from playwright.sync_api import sync_playwright
OUT = 'docs/shots/subtle'
BASE = 'http://localhost:3111'
QUICK = len(sys.argv) > 1 and sys.argv[1] == 'quick'
LENS = ['business', 'design', 'development', 'operations', 'security', 'quality']
MINFONT = """(() => { let min = 99, where = ''; for (const el of document.querySelectorAll('.bp-ui *, main *')) { if (!el.childNodes.length) continue; let txt = false; for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) txt = true; if (!txt) continue; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (!r.width) continue; const px = parseFloat(cs.fontSize) * (window.__bp ? window.__bp.U : 1); if (px < min) { min = px; where = el.tagName + '.' + el.className + ' ' + el.textContent.slice(0, 30); } } return [Math.round(min * 10) / 10, where]; })()"""

def shot(pg, name): pg.screenshot(path=f'{OUT}/{name}.png')
def wheel(pg, w, h, n=3):
    pg.mouse.move(w * 0.4, h * 0.45)
    for _ in range(n): pg.mouse.wheel(0, -240); time.sleep(0.08)
    time.sleep(1.1)

def run(b, theme, w, h, scale):
    tag = f'{w}x{h}-{theme}-s{scale}'
    pg = b.new_page(); logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:300]))
    pg.set_viewport_size({'width': w, 'height': h})
    pg.goto(f'{BASE}/v/subtle?intro=0&theme={theme}&scale={scale}', wait_until='networkidle'); time.sleep(1.4)
    shot(pg, tag + '-L0')
    pg.keyboard.press('6'); time.sleep(0.15); shot(pg, tag + '-L0-mid-security')
    time.sleep(1.0); shot(pg, tag + '-L0-security')
    if not QUICK:
        for i, l in enumerate(LENS):
            if l == 'security': continue
            pg.keyboard.press(str(i + 2)); time.sleep(1.0); shot(pg, tag + '-L0-' + l)
    pg.keyboard.press('1'); time.sleep(1.0)
    wheel(pg, w, h); shot(pg, tag + '-Z1')
    pg.keyboard.press('4'); time.sleep(0.15); shot(pg, tag + '-Z1-mid-development')
    time.sleep(1.0)
    for i, l in enumerate(LENS):
        pg.keyboard.press(str(i + 2)); time.sleep(1.0); shot(pg, tag + '-Z1-' + l)
        if QUICK and i >= 5: break
    pg.keyboard.press('1'); time.sleep(1.0)
    wheel(pg, w, h); shot(pg, tag + '-Z2')
    for i, l in enumerate(LENS):
        if QUICK and l not in ('security', 'development'): continue
        pg.keyboard.press(str(i + 2)); time.sleep(1.0); shot(pg, tag + '-Z2-' + l)
    pg.keyboard.press('1'); time.sleep(1.0)
    mf = pg.evaluate(MINFONT)
    cmin = pg.evaluate("window.__bp ? window.__bp.tx.minUsed : null")
    print(tag, 'DOM min px', mf, 'canvas min px', cmin, ('LOGS ' + ' | '.join(logs)) if logs else 'no console errors')
    sys.stdout.flush(); pg.close()

with sync_playwright() as p:
    b = p.chromium.launch()
    combos = [('dark', 1920, 1080, 1)] if QUICK else [(t, w, h, s) for t in ('dark', 'light') for (w, h) in ((1920, 1080), (1280, 800)) for s in (1, 4)]
    if len(sys.argv) > 2: combos = [tuple(x if i == 0 else int(x) for i, x in enumerate(c.split(','))) for c in sys.argv[2:]]
    if sys.argv[1:2] == ['legend']: combos = []
    for c in combos: run(b, *c)
    for theme in ('dark', 'light'):
        pg = b.new_page(viewport={'width': 1920, 'height': 1080})
        pg.goto(f'{BASE}/v/subtle?intro=0&theme={theme}', wait_until='networkidle'); time.sleep(1.2)
        pg.get_by_text(re.compile(r'^\s*plan\s*$', re.I)).first.click(); time.sleep(0.6); shot(pg, f'legend-{theme}-general')
        pg.keyboard.press('6'); time.sleep(1.0); shot(pg, f'legend-{theme}-security')
        pg.keyboard.press('4'); time.sleep(1.0); shot(pg, f'legend-{theme}-development')
        pg.close()
    b.close()
