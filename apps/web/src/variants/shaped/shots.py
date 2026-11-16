# Screenshot matrix for the shaped variant (themes x sizes x scales; General L0 and zoomed twice; the six
# lenses at L2/L3; a mid-transition frame ~150 ms after a lens key; the sheet). Prints the DOM and canvas
# minimum font sizes (../shotkit.py's text-floor check, the sheet and phone pages included) and any console
# errors per page; exits 1 on a problem.
# Usage: python src/variants/shaped/shots.py [base_url] [out_dir] [quick|full|light]   (base_url empty = $BP_BASE, else :3000)
#   full (default) is the whole matrix; quick is one dark 1920x1080 page plus the dark phone page (2 page loads);
#   light is the same two pages in the light theme. The mode word may sit anywhere among the arguments.
import os, time, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from shotkit import base, finish, floor_check
MODES = ('quick', 'full', 'light')
MODE = next((a for a in sys.argv[1:] if a in MODES), 'full')
ARGS = [a for a in sys.argv[1:] if a not in MODES]
BASE = base(ARGS[0] if len(ARGS) > 0 else '')
OUT = ARGS[1] if len(ARGS) > 1 else 'docs/shots/shaped'
LENS = []  # (key, lens id) read off the page's own tab strip by discover(): every enabled lens with a digit key, not a literal six
TABS = "[...document.querySelectorAll('#tabs [role=tab][data-lens]')].map(b => [(b.querySelector('.kb') || {}).textContent || '', b.dataset.lens]).filter(([k, l]) => k && l !== 'general')"
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
def discover(b):
    pg = b.new_page(viewport={'width': 1920, 'height': 1080})
    pg.goto(f'{BASE}/v/shaped?intro=0', wait_until='networkidle'); time.sleep(1.5)
    LENS.extend((k, l) for k, l in pg.evaluate(TABS))
    pg.close()
    if not LENS: problems.append('no lens tabs found in #tabs: the matrix would photograph nothing')

with sync_playwright() as p:
    b = p.chromium.launch()
    discover(b)
    print('lenses:', ' '.join(f'{k}={l}' for k, l in LENS))
    themes = ('dark',) if MODE == 'quick' else ('light',) if MODE == 'light' else ('dark', 'light')
    sizes = ((1920, 1080),) if MODE != 'full' else ((1920, 1080), (1280, 800))
    scales = (1,) if MODE != 'full' else (1, 4)
    for theme in themes:
        for (w, h) in sizes:
            for scale in scales:
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
    for theme in themes:
        if MODE == 'full':
            pg = b.new_page(viewport={'width': 1920, 'height': 1080}); logs = watch(pg)
            pg.goto(f'{BASE}/v/shaped?intro=0&theme={theme}#open=failed-payment-dunning', wait_until='networkidle'); time.sleep(1.5)
            for k, l in [('1', 'general')] + LENS:
                pg.keyboard.press(k); time.sleep(0.9)
                # the sheet may not have opened (a dead #open= link): say so as a problem instead of crashing the run
                # (the desktop sheet: a lens tab leads with its .evp.cur panel, General with its first section; .ev6 is the phone's)
                if not pg.evaluate("(() => { const e = document.querySelector('#pg-panel .evp.cur') || document.querySelector('#pg-panel section'); if (e) e.scrollIntoView({block: 'center'}); return !!e; })()"):
                    problems.append(f'shaped-1920x1080-{theme}-sheet-{l}: the feature sheet is not open (#open=failed-payment-dunning)')
                time.sleep(0.5)
                pg.screenshot(path=f'{OUT}/shaped-1920x1080-{theme}-sheet-{l}.png')
                # each lens's panel replaces the last and the floor is a point-in-time DOM query: measure this panel now (logs are reported once, below)
                floor_check(pg, f'shaped-1920x1080-{theme}-sheet-{l}', [], problems)
            floor_check(pg, f'shaped-1920x1080-{theme}-sheet', logs, problems); pg.close()
        pg = b.new_page(viewport={'width': 390, 'height': 844}); logs = watch(pg)
        pg.goto(f'{BASE}/v/shaped?theme={theme}', wait_until='networkidle'); time.sleep(1.5)
        pg.screenshot(path=f'{OUT}/shaped-390x844-{theme}-phone.png')
        floor_check(pg, f'shaped-390x844-{theme}-phone', logs, problems); pg.close()
    b.close()
finish(problems)
