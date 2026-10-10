# Screenshot matrix (themes, sizes, scales, variants, phone, sheet, decision card) with the text-floor readout.
# Usage: python scripts/shots.py [base_url] [out_dir]
#   base_url (empty = default): $BP_BASE, else http://localhost:3000 (`npm run dev` / `npm start`); out_dir: docs/shots/foundation
import os, time, json, sys
from playwright.sync_api import sync_playwright
BASE = ((sys.argv[1] if len(sys.argv) > 1 else '') or os.environ.get('BP_BASE') or 'http://localhost:3000').rstrip('/')
OUT = sys.argv[2] if len(sys.argv) > 2 else 'docs/shots/foundation'
problems = []
# The smallest rendered text on the page: every visible element with its own text, in the chrome (.bp-ui, scaled by the
# engine's U) and outside it (the phone view, overlays). Returns [px, where, elements measured]; 0 measured means the
# floor was not checked at all on that page.
MINFONT = """(() => { const U = window.__bp ? window.__bp.U : 1; let min = 99, where = '', n = 0; for (const el of document.body.querySelectorAll('*')) { if (el.closest('script, style, noscript, template')) continue; let txt = false; for (const c of el.childNodes) if (c.nodeType === 3 && c.textContent.trim()) txt = true; if (!txt) continue; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (!r.width) continue; n++; const px = parseFloat(cs.fontSize) * (el.closest('.bp-ui') ? U : 1); if (px < min) { min = px; where = el.tagName + '.' + el.className + ' ' + el.textContent.trim().slice(0, 30); } } return [Math.round(min * 10) / 10, where, n]; })()"""
def run(pg, name, url, w, h, steps):
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)[:300]))
    pg.set_viewport_size({'width': w, 'height': h})
    pg.goto(url, wait_until='networkidle'); time.sleep(1.4)
    for i, st in enumerate(steps):
        kind = st[0]
        if kind == 'wheel':
            pg.mouse.move(w * 0.4, h * 0.45)
            for _ in range(3): pg.mouse.wheel(0, -240); time.sleep(0.08)
            time.sleep(1.1)
        elif kind == 'key':
            pg.keyboard.press(st[1]); time.sleep(1.0)
        if len(st) > 2:
            pg.screenshot(path=f'{OUT}/{st[2]}.png')
    if not steps or len(steps[-1]) < 3:
        pg.screenshot(path=f'{OUT}/{name}.png')
    mf = pg.evaluate(MINFONT)
    cmin = pg.evaluate("window.__bp ? window.__bp.tx.minUsed : null")
    print(name, 'DOM min px', mf, 'canvas min px', cmin, ('LOGS ' + ' | '.join(logs)) if logs else '')
    sys.stdout.flush()
with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in ('dark', 'light'):
        pg = b.new_page()
        run(pg, f'index-{theme}', f'{BASE}/?theme={theme}', 1920, 1080, []); pg.close()
    for theme in ('dark', 'light'):
        for (w, h) in ((1920, 1080), (1280, 800)):
            for scale in (1, 4):
                tag = f'subtle-{w}x{h}-{theme}-s{scale}'
                pg = b.new_page()
                run(pg, tag, f'{BASE}/v/subtle?intro=0&theme={theme}&scale={scale}', w, h, [
                    ('noop', '', tag + '-L0'), ('wheel', '', tag + '-Z1'), ('wheel', '', tag + '-Z2'),
                    ('key', 'Home'), ('key', '4', tag + '-L0-development'), ('key', '6', tag + '-L0-security'),
                ])
                pg.close()
    for v in ('shaped', 'bold'):
        pg = b.new_page(); run(pg, f'{v}-1920x1080-dark-s1', f'{BASE}/v/{v}?intro=0', 1920, 1080, []); pg.close()
    for theme in ('dark', 'light'):
        pg = b.new_page(); run(pg, f'subtle-390x844-{theme}-phone', f'{BASE}/v/subtle?theme={theme}', 390, 844, []); pg.close()
    pg = b.new_page(); run(pg, 'subtle-1920x1080-dark-sheet', f'{BASE}/v/subtle?intro=0#open=PAY-09', 1920, 1080, [('key', '6', 'subtle-1920x1080-dark-sheet-security')]); pg.close()
    pg = b.new_page(); run(pg, 'subtle-1920x1080-dark-decide', f'{BASE}/v/subtle?intro=0', 1920, 1080, [('key', 'j', 'subtle-1920x1080-dark-decision-card')]); pg.close()
    b.close()
