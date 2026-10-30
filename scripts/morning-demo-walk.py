# The fused Morning Watch demo ("One morning, with memory"), walked headless and asserted: docs/concepts/one-morning/
# README.md "Run it". It needs the demo running from a fresh seed:
#   node scripts/morning-up.mjs --port 3312 --server --prod
# then: python scripts/morning-demo-walk.py [--web http://127.0.0.1:3312] [--server http://127.0.0.1:3412] [--shots DIR]
# Steps (the README's numbers): 1 M opens the deck, the follower already says "Following Web"; 2 the agents card; 3 the
# built card and the release card whose tile agrees; 4 the products open in place; 5 the three decisions with their brief
# (A approves the stop-ship, Enter declines the repeat and the store row reads "Repeats brief-h7", a likeness ignores
# Enter and H holds it); 6 the close card counts them and does not repeat the opening tallies; 7 the phone leads;
# 8 the agent walk prints the brief and marks the approved card; 9 the plan's own card and the brief's GET.
# 10 (S5) a finding lands while the deck is open: "1 new", nothing reshuffles; 11 (S5) back twice and forward once on the
# follower, one rev each, and a second follower goes with it. Throwaway data only (.demo/morning). It decides on the demo's store, so run it once per morning-up. Exit 0 green, 1 red.
import argparse, json, os, sqlite3, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

WT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--web', default='http://127.0.0.1:3312')
ap.add_argument('--server', default='http://127.0.0.1:3412')
ap.add_argument('--shots', default=os.path.join(WT, '.demo', 'morning-walk'))
A = ap.parse_args()
os.makedirs(A.shots, exist_ok=True)
DB = os.path.join(WT, '.demo', 'morning', 'kettle-web', '.ai', 'lens-scan', 'scan.db')
fails = []


def ok(cond, what):
    print(('ok    ' if cond else 'FAIL  ') + what)
    if not cond:
        fails.append(what)


def row(pid):
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    try:
        return c.execute('select status, decision_note from proposals where id=?', (pid,)).fetchone()
    finally:
        c.close()


def text(loc):
    return (loc.first.text_content() or '') if loc.count() else ''


def card(pg):
    return {'tag': text(pg.locator('#mw .card .tag')), 'h': text(pg.locator('#mw .card h2')),
            'lines': pg.locator('#mw .card > ul > li').all_text_contents(),
            'brief': pg.locator('#mw .mw-brief').all_text_contents(), 'steered': ' | '.join(pg.locator('#mw .steered').all_text_contents())}


def answer(pg, key):
    # the deck shows the verdict, then moves on 0.9 s later: read the line while it is up
    pg.keyboard.press(key)
    for _ in range(40):
        t = card(pg)['steered']
        if t:
            return t
        time.sleep(0.05)
    return ''


def nxt(pg, wait=1.6):
    pg.keyboard.press('ArrowRight')
    time.sleep(wait)
    return card(pg)


def walk():
    return subprocess.run(['node', 'scripts/morning-agent-walk.mjs', '--base', A.server, '--every', '0'], cwd=WT, capture_output=True, text=True, timeout=180)


# 8a. before the owner decides, the agent walk reads every decision card's brief through the real MCP door
w = walk()
ok(w.returncode == 0 and w.stdout.count('brief (the lines the person reads on the card):') >= 3, '8 the agent walk prints the brief of each of the 3 decision cards')
ok('the brief recommends Decline: Repeats brief-h7' in w.stdout, "8 ... and the repeat's recommendation in the owner's words")

with sync_playwright() as p:
    b = p.chromium.launch()
    errs = []
    deck = b.new_page(viewport={'width': 1600, 'height': 900})
    fol = b.new_page(viewport={'width': 1600, 'height': 900})
    for pg in (deck, fol):
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    fol.goto(A.web + '/?product=kettle-web&follow=1', wait_until='networkidle')
    deck.goto(A.web + '/?product=kettle-web', wait_until='networkidle')
    time.sleep(3)
    # 1. the opening card
    deck.keyboard.press('m')
    time.sleep(3)
    c = card(deck)
    allx = ' '.join(c['lines'])
    ok(c['h'] == 'Good morning.', '1 M opens the deck at "Good morning."')
    ok('2 products of 3 moved: 6 items built, 1 failed' in allx, '1 2 of 3 products moved, 6 built, 1 failed')
    ok('3 items confirmed, 1 fell short' in allx, '1 releases: 3 confirmed, 1 fell short')
    ok('checked your decisions 11 times' in allx and 'heard 2 declines' in allx and 'withdrew 1 proposal' in allx and 'decline 1 repeat' in allx,
       '1 the agents line: 11 checks, 2 declines heard, 1 withdrawn, 1 repeat')
    ok(deck.locator('#mw .card table.pf').count() == 1, '1 the opening card carries the portfolio table')
    time.sleep(1.5)
    chip = text(fol.locator('#fx-chip .w'))
    ok('Following Web' in chip, '1 the follower already says "Following Web" at M (' + chip + ')')
    deck.screenshot(path=os.path.join(A.shots, '1-deck.png'))
    fol.screenshot(path=os.path.join(A.shots, '1-follower.png'))
    # 2. the agents card
    c = nxt(deck, 2.5)
    lines = ' '.join(c['lines'])
    ok(c['h'] == 'Agents heard your declines and stood down 1 time.', '2 the agents card: stood down 1 time')
    ok('Add retry to checkout' in lines and 'brief-h7' in lines and 'Withdrew it' in lines and 'brief-o2' in lines,
       '2 the trail lines: about to propose, read brief-h7, withdrew, recommended brief-o2')
    ok('Card payments' in fol.url or 'card-payments' in fol.url or 'Agents heard' in text(fol.locator('#fx-say')), '2 the follower shows the line being read')
    # 3. Kettle Web's night, then its release
    c = nxt(deck, 2.5)
    ok('Kettle Web: agents built 4 items overnight; 1 build failed.' == c['h'], '3 Kettle Web built 4, 1 failed')
    c = nxt(deck, 3)
    ok('1.4.0' in c['h'] and 'both items confirmed' in c['h'], '3 the 1.4.0 release: both items confirmed (' + c['h'] + ')')
    ok(bool(c['lines']) and 'Class packs & credits' in c['lines'][0] and '190' in c['lines'][0], '3 the card names Class packs & credits, 190, first (' + (c['lines'][0] if c['lines'] else '') + ')')
    time.sleep(2)
    body = deck.locator('body').text_content() or ''
    ok('measured 190' in body, '3 the plan behind it shows the tile measured 190')
    deck.screenshot(path=os.path.join(A.shots, '3-release.png'))
    # 4. the other products open in place; then the decisions
    seen, decided = [], {}
    for _ in range(12):
        c = nxt(deck, 3)
        seen.append(c)
        if c['tag'].startswith('Decision'):
            break
    ok(any('Kettle Phone' in s['h'] and 'fell short' in s['h'] for s in seen), '4 Kettle Phone opens with its release that fell short')
    ok('product=kettle-phone' in deck.url or 'product=kettle-front-desk' in deck.url or any('Front Desk' in s['h'] for s in seen), '4 the deck switched product in place')
    ok(any('Front Desk' in s['h'] and 'quiet night' in s['h'] for s in seen), '4 Kettle Front Desk had a quiet night')
    # 5. the decisions
    for k in range(3):
        if not c['tag'].startswith('Decision'):
            break
        brief = ' '.join(c['brief'])
        if 'API key' in c['h']:
            ok('Touches Digital waiver signing' in brief and 'Cost' in brief and 'Undo' in brief, '5 the stop-ship card carries its brief (touches, undo, cost)')
            decided['approve'] = answer(deck, 'a')
            ok('Approved' in decided['approve'], '5 A approves it (' + decided['approve'][:60] + ')')
            time.sleep(1.5)
        elif 'retry to the checkout' in c['h']:
            ok('Repeats a decline' in brief and 'brief-h7' in brief, '5 the re-filed retry: repeats a decline, brief-h7 quoted')
            ok(deck.locator('#mw .act .bt.rec').count() == 1, '5 Decline · repeat is the first button')
            time.sleep(1.5)
            ok('Repeats your decline brief-h7' in text(fol.locator('#fx-say')), "5 the follower's lower third carries the brief's short line")
            fol.screenshot(path=os.path.join(A.shots, '5-follower-repeat.png'))
            decided['decline'] = answer(deck, 'Enter')
            time.sleep(0.5)
            r = row('brief-o2')
            ok(r is not None and r[0] == 'declined' and (r[1] or '').startswith('Repeats brief-h7'), '5 Enter declines brief-o2: the store row starts "Repeats brief-h7" (' + str(r) + ')')
            time.sleep(1.5)
        elif 'webhook' in c['h']:
            ok('Like a declined idea' in brief, '5 the webhook retry: a likeness, yours to decide')
            ok(deck.locator('#mw .act .bt.rec').count() == 0, '5 ... with no Decline button')
            deck.keyboard.press('Enter')
            time.sleep(1)
            ok('Held' not in card(deck)['steered'] and 'Declined' not in card(deck)['steered'], '5 Enter does nothing on a likeness')
            decided['hold'] = answer(deck, 'h')
            ok('Held' in decided['hold'], '5 H holds it (' + decided['hold'][:80] + ')')
            time.sleep(1.5)
        else:
            ok(False, '5 an unexpected decision card: ' + c['h'])
            deck.keyboard.press('ArrowRight')
            time.sleep(1.5)
        c = card(deck)
    ok(len(decided) == 3, '5 all three decisions were met (' + ', '.join(decided) + ')')
    # 6. the close card
    for _ in range(3):
        if c['h'] == 'That is the morning.':
            break
        c = nxt(deck, 2)
    time.sleep(1.5)
    c = card(deck)
    allx = ' '.join(c['lines'])
    ok('1 approved, 0 deferred to tomorrow, 1 held, 1 declined as a repeat' in allx, '6 the close card counts the morning')
    ok('steering-log.md' in allx, '6 ... and names the steering log')
    ok(deck.locator('#mw .card table.pf').count() == 0, "6 the close card does not repeat the opening card's portfolio tallies")
    log = os.path.join(WT, '.demo', 'morning', 'kettle-web', '.ai', 'lens-scan', 'work', 'steering-log.md')
    ok(os.path.exists(log) and 'Repeats brief-h7' in open(log, encoding='utf8').read(), '6 steering-log.md carries the repeat note')
    deck.screenshot(path=os.path.join(A.shots, '6-close.png'))
    # 10. news during the standup (roadmap S5 C1): a finding lands while the deck is open
    bar = lambda: [x for x in deck.locator('#mw .bar button').evaluate_all('(bs) => bs.map((b) => (b.getAttribute("title") || "") + (b.classList.contains("new") ? " NEW" : ""))')]
    before = bar()
    seeded = subprocess.run(['node', 'scripts/morning-demo.mjs', '--news', 'kettle-phone'], cwd=WT, capture_output=True, text=True, timeout=60)
    badge = ''
    for _ in range(30):
        badge = text(deck.locator('#mw .mw-new'))
        if badge:
            break
        time.sleep(0.5)
    after = bar()
    ok(seeded.returncode == 0 and '1 new' in badge, '10 the open deck says "1 new" within its next read (' + badge.strip() + ')')
    ok(after[:len(before) - 1] == before[:-1] and after[-1] == before[-1] and len(after) == len(before) + 1 and after[-2].endswith(' NEW'),
       '10 ...without reshuffling: every card read keeps its place, the new one comes before the close card (' + ' | '.join(after[-3:]) + ')')
    ok(card(deck)['h'] == 'That is the morning.', '10 ...and the card on screen stays the one being read')
    deck.screenshot(path=os.path.join(A.shots, '10-news.png'))
    # 11. follow history (roadmap S5 C2): back twice and forward once on the follower; a second follower goes with it
    fol2 = b.new_page(viewport={'width': 1280, 'height': 800})
    fol2.on('pageerror', lambda e: errs.append(str(e)[:200]))
    fol2.goto(A.web + '/?product=kettle-web&follow=1', wait_until='networkidle')
    time.sleep(3)
    view = lambda: json.load(urllib.request.urlopen(A.server + '/api/session/focus'))
    v0 = view()
    revs, ats, says = [v0['rev']], [v0.get('historyAt')], []
    for i, which in enumerate([0, 0, 1]):
        fol.locator('#fx-chip .fx-step').nth(which).click()
        time.sleep(0.8)
        v = view()
        revs.append(v['rev']); ats.append(v.get('historyAt'))
        time.sleep(2.2)
        says.append((text(fol2.locator('#fx-say')).strip(), (v['shared']['place'].get('say') or '').split('\n')[0]))
    ok(len(v0.get('history') or []) >= 3, '11 the record remembers the shared places (' + str(len(v0.get('history') or [])) + ')')
    ok(revs[1] == revs[0] + 1 and revs[2] == revs[1] + 1 and revs[3] == revs[2] + 1, '11 back, back, forward: exactly one rev each (' + ' -> '.join(map(str, revs)) + ')')
    ok(ats[0] is not None and ats[1] == ats[0] - 1 and ats[2] == ats[0] - 2 and ats[3] == ats[0] - 1, '11 ...through the history: ' + ' -> '.join(map(str, ats)))
    ok(any(sh for _, sh in says) and all((not sh) or sh in got for got, sh in says), '11 the second follower goes back with it (it reads each step\'s line: ' + ' | '.join(g[:40] for g, _ in says) + ')')
    ok('Following' in text(fol2.locator('#fx-chip .w')), '11 ...and still follows')
    ok('Shared from this screen' in text(fol.locator('#fx-chip .w')), '11 the stepping window says it shared the place itself')
    fol.screenshot(path=os.path.join(A.shots, '11-history.png'))
    fol2.close()
    deck.keyboard.press('Escape')
    time.sleep(1)
    # 7. the phone leads
    ph = b.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ph.on('pageerror', lambda e: errs.append(str(e)[:200]))
    ph.goto(A.web + '/?product=kettle-web', wait_until='networkidle')
    time.sleep(2.5)
    ph.locator('#mw-launch').click()
    time.sleep(2.5)
    ok(text(ph.locator('#mw .card h2')) == 'Good morning.', '7 the phone opens the same deck')
    ph.locator('#mw .act .bt.go').click()
    time.sleep(2.5)
    ok('Following Phone' in text(fol.locator('#fx-chip .w')), '7 the follower now says "Following Phone"')
    ph.screenshot(path=os.path.join(A.shots, '7-phone.png'))
    ph.close()
    # 9. e2's surfaces on the same product: the plan's decision card carries the same brief
    deck.keyboard.press('Escape')
    time.sleep(0.5)
    deck.keyboard.press('j')
    time.sleep(1.5)
    ok(deck.locator('#dcard .bf-facts > li').count() >= 3, "9 J: the plan's decision card carries the brief")
    ok(not errs, 'no page errors (' + '; '.join(errs[:2]) + ')')
    b.close()

# 8. the agent walk over the real MCP door (scripted, no model)
w = walk()
out = w.stdout
ok(w.returncode == 0 and 'morning_brief:' in out, '8 the agent walk reads morning_brief')
ok('already approved this morning' in out, '8 ... marks the approved card as approved')
ok('already declined as a repeat this morning' in out and 'already held this morning' in out, '8 ... and the declined and held ones')
# 9. the brief's own GET answers the same lines
j = json.load(urllib.request.urlopen(A.server + '/api/companion/brief?product=kettle-web&id=brief-o2'))
ok(isinstance(j.get('lines'), list) and len(j['lines']) >= 3, "9 GET /api/companion/brief answers brief-o2's lines")
print('MORNING WALK ' + ('GREEN' if not fails else 'RED: ' + '; '.join(fails)))
sys.exit(1 if fails else 0)
