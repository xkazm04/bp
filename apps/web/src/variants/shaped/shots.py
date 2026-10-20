# Screenshot matrix for the shaped variant (themes x sizes x scales; General L0 and zoomed twice; the six
# lenses at L2/L3; a mid-transition frame ~150 ms after a lens key; the sheet). Prints the DOM and canvas
# minimum font sizes (../shotkit.py's text-floor check, the sheet and phone pages included) and any console
# errors per page; exits 1 on a problem.
# Usage: python src/variants/shaped/shots.py [base_url] [out_dir]   (base_url empty = $BP_BASE, else :3000)
import os, time, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from shotkit import base, finish, floor_check
BASE = base(sys.argv[1] if len(sys.argv) > 1 else '')
OUT = sys.argv[2] if len(sys.argv) > 2 else 'docs/shots/shaped'
LENS = [('2', 'business'), ('3', 'design'), ('4', 'development'), ('5', 'operations'), ('6', 'security'), ('7', 'quality')]
problems = []
def watch(pg):
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text[:200]) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:200]))
    return logs
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
                pg = b.new_page(viewport={'width': w, 'height': h}); logs = watch(pg)
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
                floor_check(pg, tag, logs, problems)
                pg.close()
    for theme in ('dark', 'light'):
        pg = b.new_page(viewport={'width': 1920, 'height': 1080}); logs = watch(pg)
        pg.goto(f'{BASE}/v/shaped?intro=0&theme={theme}#open=failed-payment-dunning', wait_until='networkidle'); time.sleep(1.5)
        for k, l in [('1', 'general')] + LENS:
            pg.keyboard.press(k); time.sleep(0.9)
            # the sheet may not have opened (a dead #open= link): say so as a problem instead of crashing the run
            if not pg.evaluate("(() => { const e = document.querySelector('.evp.cur') || document.querySelector('.ev6'); if (e) e.scrollIntoView({block: 'center'}); return !!e; })()"):
                problems.append(f'shaped-1920x1080-{theme}-sheet-{l}: the feature sheet is not open (#open=failed-payment-dunning)')
            time.sleep(0.5)
            pg.screenshot(path=f'{OUT}/shaped-1920x1080-{theme}-sheet-{l}.png')
        floor_check(pg, f'shaped-1920x1080-{theme}-sheet', logs, problems); pg.close()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); logs = watch(pg)
        pg.goto(f'{BASE}/v/shaped?theme={theme}', wait_until='networkidle'); time.sleep(1.5)
        pg.screenshot(path=f'{OUT}/shaped-390x844-{theme}-phone.png')
        floor_check(pg, f'shaped-390x844-{theme}-phone', logs, problems); pg.close()
    b.close()
finish(problems)
