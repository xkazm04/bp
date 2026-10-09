# Screenshot matrix for the shaped variant (themes x sizes x scales; General L0 and zoomed twice; the six
# lenses at L2/L3; a mid-transition frame ~150 ms after a lens key; the sheet). Prints the DOM and canvas
# minimum font sizes and any console errors per page.
# Usage: python src/variants/shaped/shots.py [base_url] [out_dir]
import time, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3112'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'docs/shots/shaped'
LENS = [('2', 'business'), ('3', 'design'), ('4', 'development'), ('5', 'operations'), ('6', 'security'), ('7', 'quality')]
MINFONT = """(() => { let min = 99, where = ''; for (const el of document.querySelectorAll('.bp-ui *, main *')) { if (!el.childNodes.length) continue; let txt = false; for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) txt = true; if (!txt) continue; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (!r.width) continue; const px = parseFloat(cs.fontSize) * (window.__bp ? window.__bp.U : 1); if (px < min) { min = px; where = el.tagName + '.' + el.className + ' ' + el.textContent.slice(0, 30); } } return [Math.round(min * 10) / 10, where]; })()"""
def wheel(pg, w, h, n=3, at=(0.4, 0.45)):
    pg.mouse.move(w * at[0], h * at[1])
    for _ in range(n): pg.mouse.wheel(0, -240); time.sleep(0.08)
    time.sleep(1.2)
with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in ('dark', 'light'):
        for (w, h) in ((1920, 1080), (1280, 800)):
            for scale in (1, 4):
                tag = f'shaped-{w}x{h}-{theme}-s{scale}'
                logs = []
                pg = b.new_page(viewport={'width': w, 'height': h})
                pg.on('console', lambda m: logs.append(m.type + ': ' + m.text[:200]) if m.type in ('error', 'warning') else None)
                pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:200]))
                pg.goto(f'{BASE}/v/shaped?intro=0&theme={theme}&scale={scale}', wait_until='networkidle'); time.sleep(1.5)
                pg.screenshot(path=f'{OUT}/{tag}-L0.png')
                pg.keyboard.press('6'); time.sleep(1.0); pg.screenshot(path=f'{OUT}/{tag}-L0-security.png'); pg.keyboard.press('1'); time.sleep(1.0)
                for z in (1, 2):
                    # x1: the Booking / Memberships seam; x4: the same seam in the Studios building (top left)
                    wheel(pg, w, h, 3, (0.4, 0.45) if scale == 1 else (0.28, 0.31))
                    pg.screenshot(path=f'{OUT}/{tag}-Z{z}.png')
                for k, l in LENS:
                    pg.keyboard.press(k); time.sleep(1.0); pg.screenshot(path=f'{OUT}/{tag}-Z2-{l}.png')
                pg.keyboard.press('1'); time.sleep(1.0)
                pg.keyboard.press('6'); time.sleep(0.15); pg.screenshot(path=f'{OUT}/{tag}-Z2-mid-general-to-security.png')
                time.sleep(1.0); pg.keyboard.press('3'); time.sleep(0.2); pg.screenshot(path=f'{OUT}/{tag}-Z2-mid-security-to-design.png')
                time.sleep(1.0)
                mf = pg.evaluate(MINFONT); cmin = pg.evaluate("window.__bp ? window.__bp.tx.minUsed : null")
                print(tag, 'DOM min px', mf, 'canvas min px', cmin, ('LOGS ' + ' | '.join(logs)) if logs else ''); sys.stdout.flush()
                pg.close()
    for theme in ('dark', 'light'):
        pg = b.new_page(viewport={'width': 1920, 'height': 1080})
        pg.goto(f'{BASE}/v/shaped?intro=0&theme={theme}#open=PAY-09', wait_until='networkidle'); time.sleep(1.5)
        for k, l in [('1', 'general')] + LENS:
            pg.keyboard.press(k); time.sleep(0.9)
            pg.evaluate("(document.querySelector('.evp.cur') || document.querySelector('.ev6')).scrollIntoView({block: 'center'})"); time.sleep(0.5)
            pg.screenshot(path=f'{OUT}/shaped-1920x1080-{theme}-sheet-{l}.png')
        pg.close()
        pg = b.new_page(viewport={'width': 390, 'height': 844})
        pg.goto(f'{BASE}/v/shaped?theme={theme}', wait_until='networkidle'); time.sleep(1.5)
        pg.screenshot(path=f'{OUT}/shaped-390x844-{theme}-phone.png'); pg.close()
    b.close()
