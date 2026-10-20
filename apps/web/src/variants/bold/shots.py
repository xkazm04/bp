# Bold's screenshot run (scripts/shots.py's matrix with its own output dir and lens steps) with the text-floor
# check of ../shotkit.py on every page, the phone view included; exits 1 on a problem.
# Usage: python src/variants/bold/shots.py [quick|full|light]   (server: $BP_BASE, else `npm run dev` on :3000)
import os, time, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from shotkit import base, finish, floor_check
OUT = 'docs/shots/bold'
BASE = base()
MODE = sys.argv[1] if len(sys.argv) > 1 else 'quick'
problems = []
LENS = {'2': 'business', '3': 'design', '4': 'development', '5': 'operations', '6': 'security', '7': 'quality'}

def run(pg, name, url, w, h, steps):
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:300]))
    pg.set_viewport_size({'width': w, 'height': h})
    pg.goto(url, wait_until='networkidle'); time.sleep(1.4)
    for st in steps:
        kind = st[0]
        if kind == 'wheel':
            pg.mouse.move(w * st[1][0], h * st[1][1])
            for _ in range(3): pg.mouse.wheel(0, -240); time.sleep(0.08)
            time.sleep(1.1)
        elif kind == 'key':
            pg.keyboard.press(st[1]); time.sleep(st[3] if len(st) > 3 else 1.0)
        elif kind == 'js':
            pg.evaluate(st[1]); time.sleep(1.0)
        if len(st) > 2 and st[2]:
            pg.screenshot(path=f'{OUT}/{st[2]}.png')
    floor_check(pg, name, logs, problems)

def lens_steps(tag, at=(0.4, 0.45)):
    s = [('noop', '', tag + '-L0')]
    for k, l in LENS.items(): s.append(('key', k, f'{tag}-L0-{l}'))
    s += [('key', '1'), ('wheel', at, tag + '-Z1')]
    for k, l in LENS.items(): s.append(('key', k, f'{tag}-Z1-{l}'))
    s += [('key', '1'), ('wheel', at, tag + '-Z2')]
    for k, l in LENS.items(): s.append(('key', k, f'{tag}-Z2-{l}'))
    return s

with sync_playwright() as p:
    b = p.chromium.launch()
    combos = [('dark', 1920, 1080, 1)] if MODE == 'quick' else [(t, w, h, s) for t in ('dark', 'light') for (w, h) in ((1920, 1080), (1280, 800)) for s in (1, 4)]
    if MODE == 'light': combos = [('light', 1920, 1080, 1)]
    for (theme, w, h, scale) in combos:
        tag = f'{w}x{h}-{theme}-s{scale}'
        pg = b.new_page()
        run(pg, tag, f'{BASE}/v/bold?intro=0&theme={theme}&scale={scale}', w, h, lens_steps(tag))
        pg.close()
    if MODE != 'quick':
        for theme in ('dark', 'light'):
            pg = b.new_page()
            SC = "document.querySelector('.ev6') && document.querySelector('.ev6').scrollIntoView({block: 'start'}); document.getElementById('dscroll').scrollBy(0, -90)"
            st = [('js', SC, f'sheet-{theme}-general')]
            for k, l in LENS.items(): st += [('key', k), ('js', SC, f'sheet-{theme}-{l}')]
            run(pg, f'sheet-{theme}', f'{BASE}/v/bold?intro=0&theme={theme}#open=failed-payment-dunning', 1920, 1080, st)
            pg.close()
            pg = b.new_page()
            run(pg, f'mid-{theme}', f'{BASE}/v/bold?intro=0&theme={theme}', 1920, 1080, [('wheel', (0.4, 0.45)), ('wheel', (0.4, 0.45)), ('key', '6', f'mid-{theme}-Z2-to-security-150ms', 0.03), ('key', '1', None, 1.0), ('key', '6', None, 1.0), ('key', '3', f'mid-{theme}-Z2-security-to-design-150ms', 0.03)])
            pg.close()
    for theme in (('dark',) if MODE == 'quick' else ('light',) if MODE == 'light' else ('dark', 'light')):
        pg = b.new_page(); run(pg, f'phone-{theme}', f'{BASE}/v/bold?theme={theme}', 390, 844, [('noop', '', f'390x844-{theme}-phone')]); pg.close()
    b.close()
finish(problems)
