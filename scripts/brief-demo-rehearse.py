# The decision brief's demo, walked and asserted (.hackathon/DEMO.md "Show me", docs/concepts/decision-brief/README.md):
# the card's brief and its evidence, the repeat recommending Decline, the scripted MCP agent withdrawing, the cards slip
# showing what it heard, one Enter declining with the repeat note, Review's "Decline N repeats", and the same brief
# from apps/server (live and Kettle). Needs the two servers the demo runs - web on $BP_WEB (default :3312) and
# apps/server on $BP_SERVER (default :3412), both on the demo's throwaway BP_HOME (.demo/bp-home) - and
# .demo/kettle-live from scripts/scan-demo.mjs. It reseeds the demo rows (scripts/brief-demo-seed.mjs) before and after,
# and deletes the demo's agent trail first. Throwaway data only. Exit 0 green, 1 red.
#   python scripts/brief-demo-rehearse.py
import json, os, sqlite3, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

WT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.environ.get('BP_WEB', 'http://127.0.0.1:3312')
SRV = os.environ.get('BP_SERVER', 'http://127.0.0.1:3412')
DB = WT + '/.demo/kettle-live/.ai/lens-scan/scan.db'
OUT = os.path.join(WT, '.demo', 'rehearse-')  # screenshots of steps 1, 2, 4 and 6 (git-ignored)
fails = []
def ok(cond, what):
    print(('ok    ' if cond else 'FAIL  ') + what)
    if not cond: fails.append(what)
def status(pid):
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    try: return c.execute('select status, decision_note from proposals where id=?', (pid,)).fetchone()
    finally: c.close()
def node(*args):
    return subprocess.run(['node', *args], cwd=WT, capture_output=True, text=True, timeout=120)

node('scripts/brief-demo-seed.mjs')
TRAIL = os.path.join(WT, '.demo', 'bp-home', 'companion', 'agent-trail.jsonl')
if os.path.exists(TRAIL): os.remove(TRAIL)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1600, 'height': 900})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.goto(WEB + '/?product=kettle-live', wait_until='networkidle'); time.sleep(3)
    # 1. the card
    pg.keyboard.press('Escape'); time.sleep(0.4); pg.keyboard.press('j'); time.sleep(1.3)
    facts = pg.locator('#dcard .bf-facts > li').all_text_contents()
    ok(any('16 features depend on it' in f for f in facts), '1 blast: 16 features depend on it')
    ok(any('You approved 5 of 6 similar decisions under Security, tier 1' in f for f in facts), '1 precedent: 5 of 6')
    pg.locator('#dcard .bf-precedent > button').click(); time.sleep(0.4)
    ok(pg.locator('#dcard .bf-precedent .bf-ev li').count() >= 4, '1 the precedent evidence opens')
    pg.screenshot(path=OUT + '1.png')
    # 2. the repeat (the declined idea filed again), then a like idea (asks, never flips)
    pg.keyboard.press('j'); time.sleep(1.3)
    ok('Add retry to the checkout payment calls' in (pg.locator('#dcard h3').text_content() or ''), '2 J reaches the re-filed retry')
    ok(pg.locator('#dcard .bf-adv').count() == 1 and 'Repeats a decline' in pg.locator('#dcard .bf-adv').text_content(), '2 marked repeats a decline')
    ok('you declined this before' in (pg.locator('#dcard .op.rec').text_content() or '').lower(), '2 Decline is the recommendation')
    pg.screenshot(path=OUT + '2.png')
    pg.keyboard.press('j'); time.sleep(1.3)
    ok('Retry the payment webhook' in (pg.locator('#dcard h3').text_content() or ''), '2b J reaches the webhook retry, a like idea')
    ok('Like a declined idea' in (pg.locator('#dcard .bf-adv').text_content() or '') and 'Approve' in (pg.locator('#dcard .op.rec').text_content() or ''), '2b it shows the decline but Approve stays the default')
    pg.screenshot(path=OUT + '2b.png')
    pg.keyboard.press('Escape'); time.sleep(0.5)
    # 3. the agent
    r = node('scripts/brief-agent-demo.mjs', '--url', SRV)
    ok(r.returncode == 0 and 'withdraw' in r.stdout and 'decision.recommend decline brief-o2' in r.stdout, '3 the scripted agent withdraws and recommends declining brief-o2')
    # 4. the slip
    time.sleep(5)
    ok(pg.locator('.cp-trail').count() == 1 and 'read your decline brief-h7' in pg.locator('.cp-trail').text_content(), '4 the slip shows what the agent heard')
    pg.screenshot(path=OUT + '4.png')
    pg.get_by_text('Then recommended you decline').first.click(); time.sleep(1.3)
    ok('Add retry to the checkout payment calls' in (pg.locator('#dcard h3').text_content() or ''), '4 the slip line opens brief-o2')
    # 5. one keystroke
    pg.keyboard.press('Enter'); time.sleep(2.5)
    st = status('brief-o2')
    ok(st and st[0] == 'declined' and (st[1] or '').startswith('Repeats brief-h7'), '5 Enter declines brief-o2 with the repeat note')
    # 6. the rest
    pg.get_by_text('REVIEW').first.click(); time.sleep(1.3)
    btn = pg.locator('.wb-repeats button')
    ok(btn.count() == 1 and 'Decline 1 repeat' in btn.text_content(), '6 Review offers Decline 1 repeat')
    btn.click(); time.sleep(0.3); btn.click(); time.sleep(2.5)
    st = status('brief-o3')
    ok(st and st[0] == 'declined' and (st[1] or '').startswith('Repeats brief-h6'), '6 the batch declines brief-o3 with its note')
    pg.screenshot(path=OUT + '6.png')
    ok(not errs, 'no page errors (' + '; '.join(errs[:2]) + ')')
    b.close()
# 7. the same brief, every reader
j = json.load(urllib.request.urlopen(SRV + '/api/products/kettle-live/proposals/brief-o1/brief'))
ok(j['lines'][1].startswith('You approved 5 of 6'), '7 apps/server answers the same brief')
k = json.load(urllib.request.urlopen(SRV + '/api/products/kettle/proposals/kf-001/brief'))
ok(len(k['lines']) >= 4, '7 Kettle answers from the sim')
node('scripts/brief-demo-seed.mjs')
print('REHEARSAL ' + ('GREEN' if not fails else 'RED: ' + '; '.join(fails)))
sys.exit(1 if fails else 0)
