# Screenshots for the subtle variant (scripts/shots.py's matrix with its own out dir and lens steps) with the
# text-floor check of ../../shotkit.py on every page, the legend and phone views included; exits 1 on a problem.
# usage: python src/variants/subtle/tools/shots.py [quick]   (server: $BP_BASE, else `npm run dev` on :3000)
import os, time, sys, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from shotkit import base, finish, floor_check
OUT = 'docs/shots/subtle'
BASE = base()
QUICK = len(sys.argv) > 1 and sys.argv[1] == 'quick'
LENS = ['business', 'design', 'development', 'operations', 'security', 'quality']
problems = []

def watch(pg):
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:300]))
    return logs
def shot(pg, name): pg.screenshot(path=f'{OUT}/{name}.png')
def wheel(pg, w, h, n=3):
    pg.mouse.move(w * 0.4, h * 0.45)
    for _ in range(n): pg.mouse.wheel(0, -240); time.sleep(0.08)
    time.sleep(1.1)

def run(b, theme, w, h, scale):
    tag = f'{w}x{h}-{theme}-s{scale}'
    pg = b.new_page(); logs = watch(pg)
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
    floor_check(pg, tag, logs, problems); pg.close()

with sync_playwright() as p:
    b = p.chromium.launch()
    combos = [('dark', 1920, 1080, 1)] if QUICK else [(t, w, h, s) for t in ('dark', 'light') for (w, h) in ((1920, 1080), (1280, 800)) for s in (1, 4)]
    if len(sys.argv) > 2: combos = [tuple(x if i == 0 else int(x) for i, x in enumerate(c.split(','))) for c in sys.argv[2:]]
    if sys.argv[1:2] == ['legend']: combos = []
    for c in combos: run(b, *c)
    for theme in ('dark', 'light'):
        pg = b.new_page(viewport={'width': 1920, 'height': 1080}); logs = watch(pg)
        pg.goto(f'{BASE}/v/subtle?intro=0&theme={theme}', wait_until='networkidle'); time.sleep(1.2)
        pg.get_by_text(re.compile(r'^\s*plan\s*$', re.I)).first.click(); time.sleep(0.6); shot(pg, f'legend-{theme}-general')
        pg.keyboard.press('6'); time.sleep(1.0); shot(pg, f'legend-{theme}-security')
        pg.keyboard.press('4'); time.sleep(1.0); shot(pg, f'legend-{theme}-development')
        floor_check(pg, f'legend-{theme}', logs, problems); pg.close()
    for theme in (('dark',) if QUICK else ('dark', 'light')):
        pg = b.new_page(viewport={'width': 390, 'height': 844}); logs = watch(pg)
        pg.goto(f'{BASE}/v/subtle?theme={theme}', wait_until='networkidle'); time.sleep(1.4)
        shot(pg, f'390x844-{theme}-phone')
        floor_check(pg, f'390x844-{theme}-phone', logs, problems); pg.close()
    b.close()
finish(problems)
