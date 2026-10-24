"""Drive the ledger port's named interactions in a browser and assert on what the product writes, not only on what it
shows (contest references/promotion.md step 6; the release-ledger spark's WP5a).

    python scripts/fidelity/drive.py [--port 3321] [--shots <dir>]

Needs `npx next dev -p <port> -H 127.0.0.1` running from the bp root. Two products:
  Kettle  (http://localhost:<port>/#page=ledger)  the sample train in the scan sim: every interaction, decisions included
          (the sim's store is the page's own, so a decision changes nothing on disk).
  Athena  (?product=athena)  a live product: read-only navigation only (J/K, Enter, L, M, Esc), and the drive fails if the
          page sends anything but a GET to the product's routes while it runs.

Kettle, in order: J/K move the focus and the open compare item with it; X selects; A accepts (the row reads accepted,
the package pill counts it, no other item moves); R with a note sends to rework (the note is on the row); U reopens (the
item waits again, the pill drops it); the slider drag changes --cut on the frame and nothing else in the table or the
panel (a MutationObserver sees only that style attribute); L and M cycle the compare view's theme and mode; Esc closes in
layers (the note, full width, the panel, the selection); the table head is 34 px (the owner-accepted departure from
A/1's 66 px). Exit 1 on any failure.
"""
import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
SIZE = {'width': 1600, 'height': 800}
FAILS = []
BASE = 'http://localhost:3321'  # main() rebinds it from --port; the default lets kettle()/athena() be driven by import

STATE_JS = """() => {
  const rows = [...document.querySelectorAll('[data-role=tr-row]')];
  const st = (r) => (r.className.match(/\\bs-([a-z-]+)/) || [])[1];
  const pill = document.querySelector('[data-role=tr-bar] .tr-pkg b');
  const seg = [...document.querySelectorAll('[data-role=tr-cmp-screens] h4 .tr-seg')].map((s) => s.querySelector('[aria-pressed=true]')?.textContent);
  return {
    ids: rows.map((r) => r.dataset.fid),
    status: Object.fromEntries(rows.map((r) => [r.dataset.fid, st(r)])),
    focus: rows.find((r) => r.classList.contains('tr-fx'))?.dataset.fid ?? null,
    open: rows.find((r) => r.classList.contains('tr-open'))?.dataset.fid ?? null,
    sel: rows.filter((r) => r.classList.contains('tr-sel')).map((r) => r.dataset.fid),
    cmp: document.querySelector('[data-role=tr-cmp-title]')?.textContent ?? null,
    wide: !!document.querySelector('[data-role=tr-cmp].wide'),
    note: !!document.querySelector('.tr-note'),
    bar: document.querySelector('[data-role=tr-bar] .lg-bar-n')?.textContent ?? null,
    pkg: pill ? Number((pill.textContent.match(/(\\d+)\\s*$/) || [])[1]) : null,
    theme: seg[0] ?? null, mode: seg[1] ?? null,
    head: document.querySelector('[data-role=tr-thead]')?.getBoundingClientRect().height ?? null,
  };
}"""
TITLE_JS = "(id) => document.querySelector('[data-fid=\"' + id + '\"] [data-role=tr-row-title] > span')?.textContent"
NOTE_JS = "(id) => document.querySelector('[data-fid=\"' + id + '\"] [data-role=tr-row-title] small')?.textContent ?? ''"


def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)))
    if not ok:
        FAILS.append(name)


def row_after(name, s):
    """The id of the row after the focused one, or None with a FAIL. A probe that comes back empty is a
    reported failure, not a traceback: `[].index(None)` raises ValueError and takes the whole drive down."""
    ok = s['focus'] in s['ids'] and s['ids'].index(s['focus']) + 1 < len(s['ids'])
    check(name + ': a focused row with another row after it', ok, (s['focus'], len(s['ids'])))
    return s['ids'][s['ids'].index(s['focus']) + 1] if ok else None


def until(pg, pred, ms=10000):
    """Poll the page state until pred(state) holds or ms pass; returns the last state."""
    s = pg.evaluate(STATE_JS)
    for _ in range(ms // 100):
        if pred(s):
            return s
        pg.wait_for_timeout(100)
        s = pg.evaluate(STATE_JS)
    return s


def key(pg, k, settle=250):
    pg.keyboard.press(k)
    pg.wait_for_timeout(settle)


def load(pg, url):
    pg.goto(url, wait_until='domcontentloaded')
    pg.wait_for_selector('[data-role=tr-row]', timeout=120000)
    pg.wait_for_timeout(2500)


def others_same(before, after, touched):
    moved = [i for i in before['status'] if i not in touched and after['status'].get(i) != before['status'][i]]
    return not moved, moved


def kettle(pg, shots):
    load(pg, BASE + '/#page=ledger')
    s = until(pg, lambda s: len(s['ids']) >= 6 and s['open'], 8000)
    check('kettle: the first pack item opens in compare on a wide window', bool(s['open']) and s['open'] == s['focus'], s)

    # J / K: the focus moves along the rows and the open compare follows it
    want = row_after('kettle', s)
    if not want:
        return
    key(pg, 'j')
    s2 = pg.evaluate(STATE_JS)
    check('J moves the focus to the next row', s2['focus'] == want, (s2['focus'], want))
    check('J: the open compare follows the focus', s2['open'] == want and s2['cmp'] == pg.evaluate(TITLE_JS, want), (s2['open'], s2['cmp']))
    key(pg, 'k')
    s3 = pg.evaluate(STATE_JS)
    check('K moves the focus back', s3['focus'] == s['focus'] and s3['open'] == s['focus'], (s3['focus'], s3['open']))

    # X selects the focused row, again deselects
    key(pg, 'x')
    s4 = pg.evaluate(STATE_JS)
    check('X selects the focused row', s4['sel'] == [s['focus']] and s4['bar'] == '1 selected', (s4['sel'], s4['bar']))
    key(pg, 'x')
    s5 = pg.evaluate(STATE_JS)
    check('X again deselects it', s5['sel'] == [], s5['sel'])

    # A accepts a waiting item whose metric moved (no note asked): the store says accepted, the package counts it
    target = pg.evaluate("""() => [...document.querySelectorAll('[data-role=tr-row].s-done')].find((r) => r.querySelector('.tr-vd.v-moved'))?.dataset.fid""")
    check('kettle has a waiting item that moved', bool(target), target)
    if not target:
        return
    pg.click('[data-fid="%s"]' % target)
    pg.wait_for_timeout(300)
    b = pg.evaluate(STATE_JS)
    key(pg, 'a', 0)
    early = pg.evaluate(STATE_JS)
    check('A: no optimistic flip (the row is not accepted before the store answers, or the sim answered at once)',
          early['status'][target] in ('done', 'accepted'), early['status'][target])
    a = until(pg, lambda s: s['status'].get(target) == 'accepted')
    check('A accepts: the row reads accepted', a['status'].get(target) == 'accepted', a['status'].get(target))
    check('A: the package pill counts it', a['pkg'] == (b['pkg'] or 0) + 1, (b['pkg'], a['pkg']))
    ok, moved = others_same(b, a, {target})
    check('A: no other item changed', ok, moved)
    check('A: the focus moves on to a waiting item', a['focus'] != target and a['status'].get(a['focus']) in ('done', 'failed'), a['focus'])

    # R with a note: the editor asks, Enter sends, the row carries the note
    rw = a['focus']
    b = a
    key(pg, 'r', 400)
    n = pg.evaluate(STATE_JS)
    check('R opens the note editor', n['note'], n)
    note = 'drive: re-measure, three runs not one'
    pg.keyboard.type(note)
    key(pg, 'Enter', 0)
    r = until(pg, lambda s: s['status'].get(rw) == 'rework')
    check('R with a note sends to rework', r['status'].get(rw) == 'rework', r['status'].get(rw))
    check('R: the triage note shows on the row', note in pg.evaluate(NOTE_JS, rw), pg.evaluate(NOTE_JS, rw))
    ok, moved = others_same(b, r, {rw})
    check('R: no other item changed', ok, moved)

    # U reopens the accepted item: it waits again, the package drops it
    pg.click('[data-fid="%s"]' % target)
    pg.wait_for_timeout(300)
    b = pg.evaluate(STATE_JS)
    key(pg, 'u', 0)
    u = until(pg, lambda s: s['status'].get(target) == 'done')
    check('U reopens: the item waits again', u['status'].get(target) == 'done', u['status'].get(target))
    check('U: the package pill drops it', u['pkg'] == (b['pkg'] or 0) - 1, (b['pkg'], u['pkg']))
    ok, moved = others_same(b, u, {target})
    check('U: no other item changed', ok, moved)
    if shots:
        pg.screenshot(path=str(shots / 'drive-kettle-decided.png'))

    # M cycles the compare view's mode (on a design item: a performance item has no screens)
    design = pg.evaluate("""() => [...document.querySelectorAll('[data-role=tr-row]')].find((r) => r.querySelector('.tr-ev') && !/runs/.test(r.querySelector('.tr-ev').textContent) && /▣ [0-9]/.test(r.querySelector('.tr-ev').textContent))?.dataset.fid""")
    check('kettle has a design item with screens (M and the slider need one)', bool(design), design)
    if not design:
        return
    pg.click('[data-fid="%s"]' % design)
    pg.wait_for_timeout(600)
    v0 = pg.evaluate(STATE_JS)
    seen_m = [v0['mode']]
    for _ in range(4):
        key(pg, 'm')
        seen_m.append(pg.evaluate(STATE_JS)['mode'])
    ml = [m.lower() for m in seen_m if m]
    check('M cycles side by side, slider, blink, change map and back', ml == ['side by side', 'slider', 'blink', 'change map', 'side by side'], seen_m)

    # the slider: dragging changes --cut on the frame and nothing else re-renders. The table, the panel and the bar are
    # snapshotted (the frame's style left out) before and after the drag and must be identical; no node is added or
    # removed (a MutationObserver counts childList and text changes: a re-render that rebuilt anything shows there).
    key(pg, 'm', 600)
    rng = pg.query_selector('[data-role=tr-cmp-screens] input[type=range]')
    check('M: the slider shows a range input', rng is not None)
    if rng:
        snap = """() => ['[data-role=tr-cmp]', '[data-role=tr-table]', '[data-role=tr-bar]'].map((s) => { const e = document.querySelector(s)?.cloneNode(true);
          e?.querySelectorAll('.tr-scr').forEach((f) => f.removeAttribute('style')); return e ? e.outerHTML : ''; }).join('|')"""
        rng.scroll_into_view_if_needed()
        pg.wait_for_timeout(200)
        before = pg.evaluate(snap)
        pg.evaluate("""() => { const w = window.__trMut = [];
          const mo = new MutationObserver((rs) => { for (const r of rs) w.push(r.type === 'attributes' ? (r.attributeName === 'style' && r.target.classList.contains('tr-scr') ? 'cut' : 'attr') : r.type); });
          for (const s of ['[data-role=tr-cmp]', '[data-role=tr-table]', '[data-role=tr-bar]']) { const e = document.querySelector(s); if (e) mo.observe(e, { subtree: true, attributes: true, childList: true, characterData: true }); }
          window.__trMo = mo; }""")
        box = rng.bounding_box()
        cut0 = pg.evaluate("() => document.querySelector('[data-role=tr-cmp-screens] .tr-scr').style.getPropertyValue('--cut')")
        y = box['y'] + box['height'] / 2
        pg.mouse.move(box['x'] + box['width'] * 0.5, y)
        pg.mouse.down()
        for f in (0.4, 0.3, 0.2):
            pg.mouse.move(box['x'] + box['width'] * f, y)
        pg.mouse.up()
        pg.wait_for_timeout(300)
        cut1 = pg.evaluate("() => document.querySelector('[data-role=tr-cmp-screens] .tr-scr').style.getPropertyValue('--cut')")
        muts = pg.evaluate("() => { window.__trMo.disconnect(); const m = window.__trMut; delete window.__trMut; delete window.__trMo; return m; }")
        after = pg.evaluate(snap)
        check('slider drag changes --cut', cut1 and cut1 != cut0, (cut0, cut1))
        nodes = [m for m in muts if m in ('childList', 'characterData')]
        check('slider drag: nothing else in the table, panel or bar changed (same markup, no node added or removed)', before == after and not nodes,
              {'markup same': before == after, 'node or text changes': len(nodes)})
        print('     (%d --cut write(s) on the frame, %s -> %s; %d attribute re-assertion(s) to equal values)' % (muts.count('cut'), cut0 or 'unset', cut1, muts.count('attr')))
    key(pg, 'm')
    key(pg, 'm')
    key(pg, 'm')

    # Esc closes in layers: the note, full width, the panel, the selection
    pg.click('[data-fid="%s"]' % design)
    pg.wait_for_timeout(400)
    row = pg.evaluate(STATE_JS)['focus']
    key(pg, 'x')
    key(pg, 'Enter')
    w = pg.evaluate(STATE_JS)
    check('Enter on the open item: full width', w['wide'], w)
    key(pg, 'r', 400)
    e0 = pg.evaluate(STATE_JS)
    check('R on the selection asks for a note', e0['note'], e0)
    seq = []
    for _ in range(4):
        key(pg, 'Escape', 300)
        s = pg.evaluate(STATE_JS)
        seq.append((s['note'], s['wide'], bool(s['cmp']), len(s['sel'])))
    want = [(False, True, True, 1), (False, False, True, 1), (False, False, False, 1), (False, False, False, 0)]
    check('Esc closes in layers: note, full width, compare, selection', seq == want, seq)
    after = pg.evaluate(STATE_JS)
    check('Esc: the rework was not sent (the note was cancelled)', after['status'].get(row) != 'rework' or row == rw, after['status'].get(row))
    check('the table head is 34 px (owner-accepted; A/1 drew 66)', after['head'] is not None and abs(after['head'] - 34) < 0.5, after['head'])
    if shots:
        pg.screenshot(path=str(shots / 'drive-kettle-table.png'))
    theme_key(pg, 'kettle')


def theme_key(pg, product):
    """L in the open compare cycles its theme, and the page stays the ledger (the header's page switch also answers L)."""
    s = pg.evaluate(STATE_JS)
    if not s['cmp']:
        key(pg, 'Enter', 600)
        s = pg.evaluate(STATE_JS)
    seen = [s['theme']]
    for _ in range(3):
        key(pg, 'l', 400)
        seen.append(pg.evaluate(STATE_JS)['theme'])
    tl = [t.lower() if t else None for t in seen]
    left = '#page=ledger' not in pg.url
    check(product + ': L cycles the compare theme light, dark, both and back, on the ledger', tl == ['light', 'dark', 'both', 'light'] and not left,
          {'themes': seen, 'left the ledger': left, 'url': pg.url})


def athena(pg, shots):
    writes = []
    pg.on('request', lambda r: writes.append(r.method + ' ' + r.url) if r.method != 'GET' and '/api/' in r.url else None)
    load(pg, BASE + '/?product=athena#page=ledger')
    s = until(pg, lambda s: s['open'], 6000)
    check('athena: an item is open in compare', bool(s['open']), s)
    want = row_after('athena', s)
    if not want:
        return
    key(pg, 'j')
    s2 = pg.evaluate(STATE_JS)
    check('athena: J moves the focus and the compare', s2['focus'] == want and s2['open'] == s2['focus'], (s2['focus'], s2['open']))
    key(pg, 'k')
    key(pg, 'm')
    s3 = pg.evaluate(STATE_JS)
    check('athena: M changes the view', s3['mode'] != s['mode'] and s3['mode'], (s['mode'], s3['mode']))
    key(pg, 'Escape')
    s4 = pg.evaluate(STATE_JS)
    check('athena: Esc closes the compare', s4['cmp'] is None, s4['cmp'])
    key(pg, 'Enter', 600)
    s5 = pg.evaluate(STATE_JS)
    check('athena: Enter opens the focused item', s5['open'] == s5['focus'] and s5['cmp'], (s5['open'], s5['focus']))
    if shots:
        pg.screenshot(path=str(shots / 'drive-athena.png'))
    theme_key(pg, 'athena')
    check('athena: no write reached the product (only GETs)', not writes, writes)


def main():
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=3321)
    ap.add_argument('--shots', help='a folder for a frame after each product')
    a = ap.parse_args()
    BASE = 'http://localhost:%d' % a.port
    shots = Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, fn in (('kettle', kettle), ('athena', athena)):
            pg = b.new_page(viewport=SIZE)
            errs = []
            pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)[:200]))
            fn(pg, shots)
            check(name + ': no page errors', not errs, errs)
            pg.close()
        b.close()
    print('\n%d check(s) failed' % len(FAILS) if FAILS else '\nevery interaction passed')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
