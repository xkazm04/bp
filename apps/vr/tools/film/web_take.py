# Records one web take for the demo film: the page's viewport only (no browser chrome, no cursor: headless Chromium draws
# none), driven on cue by a timeline that web-take.mjs passes in. Called by web-take.mjs; run it by hand only to debug:
#
#   python -E -P apps/vr/tools/film/web_take.py <job.json>
#
# job.json: { url, workDir, mode, width, height, fps, settle, duration, steps: [{ at, do, name?, ... }] }
# Steps (`at` is seconds from the clip start, i.e. the frame the editor sees as 0):
#   click-wing  name   a real mouse click on the wing whose name matches (camera flies into it)
#   click-room  name   a real mouse click on the room whose name matches (it lifts and opens)
#   drift       zoom, dx, dur   a slow camera drift from home (the engine's own flyTo, dur in seconds)
# Modes:
#   stepped (default)  the page's clock is Playwright's fake one (Date, performance.now, timers, requestAnimationFrame),
#                      paused once the plan is at rest, then advanced exactly 1/fps per frame with a viewport screenshot
#                      after each: every output frame is a rendered frame, at any machine speed (~0.6 s of wall time per
#                      frame at 1920x1080). Caveat: CSS transitions run on the browser's real clock, so a CSS-animated
#                      overlay (a toast sliding in) lands within one frame instead of sliding.
#   realtime           Playwright's own webm screencast at wall-clock speed; headless software raster gives ~18-21
#                      distinct frames a second during a flight (measured 2026-11-18, n=1), so it is the fallback.
# Prints one JSON line last: { frames | webm, head, events: [{ t, do, name, x, y, settled }], pageErrors }.
# frames is a printf pattern of PNGs (frame 0 = the plan at rest); for a webm, head is the seconds of load to cut.
import json, os, sys, time
from playwright.sync_api import sync_playwright

job = json.load(open(sys.argv[1], encoding='utf-8'))
W, H = int(job.get('width', 1920)), int(job.get('height', 1080))
FPS, MODE, WORK = int(job.get('fps', 30)), job.get('mode', 'stepped'), job['workDir']

# Finds a click point for a wing or a room: on screen, inside the safe area, nothing drawn on top (flag, pin, agent,
# chip), and the click would fly to THIS place (Engine.clickAt: the first place in the hit chain whose fit zooms in by
# more than 12 %). Closest to the box's centre wins; returns client (CSS) pixels plus what was matched.
FIND_JS = r"""
({ kind, name }) => {
  const E = window.__bp, L = E.M.L, norm = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
  const list = kind === 'wing' ? L.wings : L.rooms, label = (o) => kind === 'wing' ? o.def.name : o.name;
  const want = norm(name), o = list.find((x) => norm(label(x)) === want) || list.find((x) => norm(label(x)).includes(want));
  if (!o) return { error: `no ${kind} named "${name}"; have: ${list.map(label).join(', ')}` };
  const c = E.cam, r = E.cv.getBoundingClientRect(), S = E.SAFE;
  const x0 = Math.max(S.l, c.sx(o.x)) + 8, x1 = Math.min(S.r, c.sx(o.x + o.w)) - 8, y0 = Math.max(S.t, c.sy(o.y)) + 8, y1 = Math.min(S.b, c.sy(o.y + o.h)) - 8;
  if (x1 <= x0 || y1 <= y0) return { error: `${kind} "${label(o)}" is off screen` };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, pts = [];
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) pts.push([x0 + (x1 - x0) * i / 24, y0 + (y1 - y0) * j / 24]);
  pts.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  for (const [px, py] of pts) {
    if (E.hitUnder(px, py)) continue;
    const h = E.hitAt(px, py); if (!h) continue;
    const first = h.chain.find((ch) => E.fitOf(ch).k > c.k * 1.12);
    if (!first || first.o !== o) continue;
    return { x: r.left + px / E.FW * r.width, y: r.top + py / E.FH * r.height, matched: label(o), id: o.id };
  }
  return { error: `no clear point on ${kind} "${label(o)}" that flies to it` };
}
"""
# The camera is still (no fly, no wheel smoothing).
STILL_JS = "() => { const E = window.__bp; return !!E && !E.cam.flying && !E.cam.wz; }"
# Forget the pointer, so the hover card is not re-tested under it when the camera settles (Engine: pointerleave).
LEAVE_JS = "() => window.__bp.cv.dispatchEvent(new PointerEvent('pointerleave'))"


def fail(msg):
    print('FAILED: ' + msg, file=sys.stderr)
    sys.stderr.flush()
    os._exit(1)


def wait_still(pg, timeout=6.0):
    t = time.monotonic()
    while time.monotonic() - t < timeout:
        if pg.evaluate(STILL_JS): return True
        time.sleep(0.05)
    return False


def find(pg, st):
    f = pg.evaluate(FIND_JS, {'kind': st['do'][6:], 'name': st['name']})
    if 'error' in f: fail(f['error'])
    return f


def click(pg, f):
    pg.mouse.move(f['x'], f['y'])
    pg.mouse.down(); pg.mouse.up()
    pg.evaluate(LEAVE_JS)  # no hover card under the (invisible) pointer when the camera settles


def drift(pg, st):
    pg.evaluate("""({ zoom, dx, dur }) => { const E = window.__bp, H = E.HOME;
      E.cam.flyTo({ x: H.x + dx / H.k, y: H.y, k: H.k * zoom }, dur * 1000); }""",
                {'zoom': st.get('zoom', 1.05), 'dx': st.get('dx', 40), 'dur': st.get('dur', 8)})


# ------------------------------------------------------------------------------------------------ kind: html
# A page of our own (intro.html), served at <base>/__film/<name> so it can borrow the app's stylesheets. Every animation on
# it is a CSS animation: each frame pauses them all and sets their currentTime, so frame i is exactly t = i / FPS.
SEEK_JS = "(ms) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }"


def shoot(pg, fdir, i):
    pg.screenshot(path=os.path.join(fdir, '%05d.png' % i), caret='hide')


def run_html(b):
    ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, color_scheme='dark')
    html = open(job['html'], encoding='utf-8').read()
    url = job['base'].rstrip('/') + '/__film/' + os.path.basename(job['html'])
    ctx.route(url, lambda r: r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html))
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(url, wait_until='load')
    fonts = pg.evaluate('() => window.__introReady')
    print('intro fonts: ' + ', '.join(sorted(set(fonts))), file=sys.stderr)
    fdir = os.path.join(WORK, 'frames'); os.makedirs(fdir, exist_ok=True)
    n = int(round(float(job['duration']) * FPS))
    for i in range(n):
        pg.evaluate(SEEK_JS, i * 1000 / FPS)
        shoot(pg, fdir, i)
        if i % 60 == 59: print('  frame %d/%d' % (i + 1, n), file=sys.stderr)
    ctx.close()
    return {'frames': os.path.join(fdir, '%05d.png'), 'count': n, 'events': [], 'pageErrors': errors}


# ------------------------------------------------------------------------------------------------ kind: onboard
# A NEW project on the projects page, its "Start onboarding" pressed on cue, then the onboarding screen's build-up drawing
# the tutorial project. Nothing is registered and no model runs: the projects list and the onboard call are answered by
# the capture (Playwright routes), and the build-up is the onboarding screen's own preset replay of Kettle's plan
# (`?preset=demo`, apps/web/src/onboarding/OnboardingScreen.tsx), drawn by the same component a live run draws with.
# Two segments joined by a hard cut 0.3 s after the press (the real page reloads there; a load is never filmed):
#   1. /projects with one project, "Kettle", not onboarded (the built-in sample row is hidden so Kettle shows once)
#   2. /projects/<slug>/onboarding?preset=demo&speed=<s>, from the build-up's first frame until it has settled, + a hold
# On screen the preset's "Replay of the existing plan" note and the closing band (which names the tool) are hidden, and
# the projects page's lead says "Blueprint" where the app says its short name.
NONE = {'rootExists': True, 'map': False, 'mapVersion': None, 'events': False, 'store': False, 'features': 0, 'lenses': 0,
        'measuredFacets': 0, 'proposals': None, 'lastRunAt': None}
STAGE_JS = r"""
(() => {
  const css = document.createElement('style');
  css.textContent = 'li[aria-label="Kettle sample"]{display:none!important} [data-film-hide]{visibility:hidden!important}' +
    '*{cursor:none!important;caret-color:transparent!important}';
  const fix = () => {
    if (!css.isConnected && document.head) document.head.appendChild(css);
    for (const e of document.querySelectorAll('span, div[role=status]')) {
      const t = e.textContent || '';
      if (e.tagName === 'SPAN' && t.startsWith('Replay of the existing plan')) e.dataset.filmHide = 'replay';
      if (e.getAttribute('role') === 'status' && / is in bp/.test(t)) e.dataset.filmHide = 'band';
    }
    const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) if (/\bbp\b/.test(n.nodeValue) && !n.parentElement?.closest('[data-film-hide]'))
      n.nodeValue = n.nodeValue.replace(/\bin bp\b/g, '').replace(/\bbp\b/g, 'Blueprint').replace(/ {2,}/g, ' ');
  };
  new MutationObserver(fix).observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', fix);
})();
"""


def run_onboard(b):
    base, slug, name = job['base'].rstrip('/'), job.get('slug', 'kettle-app'), job.get('name', 'Kettle')
    product = {'slug': slug, 'name': name, 'root': job.get('root', 'C:/code/kettle'), 'live': False, 'readiness': NONE, 'setup': []}
    ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, color_scheme='dark', reduced_motion='no-preference')
    ctx.add_init_script(STAGE_JS)
    ctx.add_init_script("try { localStorage.setItem('bp-theme', 'dark') } catch (e) {}")
    one = '/api/products/' + slug
    ctx.route(base + '/api/products', lambda r: r.fulfill(json=[product]) if r.request.method == 'GET' else r.continue_())
    ctx.route(base + one + '/onboarding', lambda r: r.fulfill(json={'job': None}))
    job_doc = {'id': 'j-' + slug + '-1', 'kind': 'adopt', 'status': 'running', 'adopt_phase': 'check', 'log_tail': '[check] reading the repo'}
    ctx.route(base + one + '/onboard', lambda r: r.fulfill(json={'job': job_doc}))
    # the preset reads the tutorial project's plan under the new slug
    def plan(r):
        res = r.fetch(url=r.request.url.replace(one + '/', '/api/products/' + job.get('plan', 'kettle') + '/'))
        r.fulfill(response=res)
    ctx.route(base + one + '/plan', plan)
    ctx.route(base + one + '/structure', plan)
    # the page's own hop to the onboarding screen after the press: answered 204, so the page stays (an aborted hop would
    # show the browser's white error page); segment 2 is its own page
    ctx.route(base + '/projects/' + slug + '/onboarding?job=*', lambda r: r.fulfill(status=204, body=''))
    errors = []
    fdir = os.path.join(WORK, 'frames'); os.makedirs(fdir, exist_ok=True)
    events, frame = [], 0
    click_at, total = job.get('clickAt'), float(job['duration'])

    # ---- segment 1: the projects page
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install()
    pg.goto(base + '/projects?theme=dark', wait_until='load')
    btn = pg.get_by_role('button', name='Start onboarding')
    btn.wait_for(state='visible', timeout=30000)
    pg.evaluate('() => document.fonts.ready')
    pg.mouse.move(W - 4, H - 4)  # parked in the corner: no hover anywhere
    pg.wait_for_timeout(800)
    pg.clock.pause_at(int(pg.evaluate('Date.now()')) + 50)
    end1 = int(round(((click_at + float(job.get('cut', 0.3))) if click_at is not None else total) * FPS))
    box = btn.bounding_box()
    bx, by = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    hover_f = int(round((click_at - 0.5) * FPS)) if click_at is not None else None
    click_f = int(round(click_at * FPS)) if click_at is not None else None
    for i in range(end1):
        if i == hover_f: pg.mouse.move(bx, by)  # the (invisible) pointer arrives: the button lights as it would
        if i == click_f:
            pg.mouse.down(); pg.mouse.up()
            events.append({'do': 'click-onboard', 'name': 'Start onboarding', 'cue': click_at, 't': round(i / FPS, 3), 'x': round(bx), 'y': round(by)})
            print(json.dumps(events[-1]), file=sys.stderr)
        pg.clock.run_for(round((i + 1) * 1000 / FPS) - round(i * 1000 / FPS))
        shoot(pg, fdir, frame); frame += 1
    pg.close()
    if click_at is None:
        ctx.close()
        return {'frames': os.path.join(fdir, '%05d.png'), 'count': frame, 'events': events, 'pageErrors': errors}
    cut_t = frame / FPS
    events.append({'do': 'cut', 'name': 'to the onboarding screen', 't': round(cut_t, 3)})

    # ---- segment 2: the onboarding screen; the clock is paused before the page runs, so frame one is the start
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.clock.install()
    pg.clock.pause_at(int(time.time() * 1000) + 1000)
    pg.goto(base + '/projects/%s/onboarding?preset=demo&speed=%s&theme=dark' % (slug, job.get('speed', 2.6)), wait_until='load')
    # mounted: the chrome is drawn (the build-up renders it) and the plan is in; its `begin` waits on a (paused) timer
    # The page needs its timers to mount, so the clock is walked in 16 ms steps until the chrome shows; the build-up's
    # start is a 0 ms timer right after the mount, so at most one step of it runs before frame one.
    t = time.monotonic()
    while not pg.evaluate("() => /Onboarding/i.test(document.body.innerText) && !/Reading |Opening/.test(document.body.innerText)"):
        if time.monotonic() - t > 60: fail('the onboarding screen did not mount in 60 s')
        pg.clock.run_for(16)
        pg.wait_for_timeout(30)
    band_f, hold, max_f = None, int(round(float(job.get('hold', 2.0)) * FPS)), int(round(total * FPS))
    while frame < max_f:
        pg.clock.run_for(round((frame + 1) * 1000 / FPS) - round(frame * 1000 / FPS))
        shoot(pg, fdir, frame); frame += 1
        if band_f is None and pg.evaluate("() => !!document.querySelector('[data-film-hide=band]')"):
            band_f = frame
            # the screen raises its closing band 1 s after the build-up's ending has settled (OnboardingScreen handover)
            events.append({'do': 'buildup-settled', 'name': 'the drawing is complete', 't': round(band_f / FPS - 1.0, 3)})
            print(json.dumps(events[-1]), file=sys.stderr)
            max_f = min(max_f, frame + hold) if job.get('trimToEnd') else max_f
        if frame % 60 == 0: print('  frame %d' % frame, file=sys.stderr)
    if band_f is None: errors.append('the build-up did not settle within the clip (raise --duration or the speed)')
    ctx.close()
    return {'frames': os.path.join(fdir, '%05d.png'), 'count': frame, 'events': events, 'pageErrors': errors}


if job.get('kind') in ('html', 'onboard'):
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--hide-scrollbars'])
        res = run_html(b) if job['kind'] == 'html' else run_onboard(b)
        b.close()
    print(json.dumps(res))
    sys.exit(0)

steps = sorted(job['steps'], key=lambda s: s['at'])
for st in steps:
    if st['do'] not in ('click-wing', 'click-room', 'drift'): fail('unknown step ' + st['do'])

with sync_playwright() as p:
    # BP_FILM_ARGS: extra Chromium switches, space-separated; BP_FILM_HEADED=1 a headed window. Both measured worse than
    # the default in realtime mode (GPU switches 10, headed 14 distinct frames per 36 during a flight, default ~21).
    b = p.chromium.launch(args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--hide-scrollbars'] + os.environ.get('BP_FILM_ARGS', '').split(),
                          headless=os.environ.get('BP_FILM_HEADED') != '1')
    rec = {'record_video_dir': WORK, 'record_video_size': {'width': W, 'height': H}} if MODE == 'realtime' else {}
    ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, color_scheme='dark',
                        reduced_motion='no-preference', **rec)
    pg = ctx.new_page()
    t_rec = time.monotonic()  # the webm starts with the page; frames before t0 are the load, cut by `head`
    if MODE == 'stepped': pg.clock.install()  # runs in step with real time until paused
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    # 'load', not 'networkidle': the page holds /api/companion/stream (SSE) open (scripts/perf.py)
    pg.goto(job['url'], wait_until='load')
    pg.wait_for_function('() => !!window.__bp && !!window.__bp.M', timeout=90000)
    pg.evaluate('() => document.fonts.ready')
    # no caret, no text selection, no cursor in case a headed run is ever used
    pg.add_style_tag(content='*{cursor:none!important;caret-color:transparent!important}::selection{background:transparent}')
    wait_still(pg, 10)
    time.sleep(float(job.get('settle', 2.5)))  # the static layer rasters, the agents spread, the toasts (if any) go
    events = []

    if MODE == 'stepped':
        fdir = os.path.join(WORK, 'frames'); os.makedirs(fdir, exist_ok=True)
        pg.clock.pause_at(int(pg.evaluate('Date.now()')) + 50)
        n = int(round(float(job['duration']) * FPS))
        pending, unsettled = list(steps), []
        t_wall = time.monotonic()
        for i in range(n):
            t = i / FPS
            while pending and pending[0]['at'] <= t + 1e-6:
                st = pending.pop(0)
                ev = {'do': st['do'], 'cue': st['at'], 't': round(t, 3)}
                if st['do'] == 'drift': drift(pg, st)
                else:
                    f = find(pg, st); click(pg, f)
                    ev.update(name=f['matched'], id=f['id'], x=round(f['x']), y=round(f['y']),
                              flew=bool(pg.evaluate('() => window.__bp.cam.flying')), settled=None)
                    unsettled.append(ev)
                events.append(ev); print(json.dumps(ev), file=sys.stderr)
            # advance exactly to the next frame's time (33/34 ms alternating, no drift over the clip)
            pg.clock.run_for(round((i + 1) * 1000 / FPS) - round(i * 1000 / FPS))
            pg.screenshot(path=os.path.join(fdir, '%05d.png' % i), caret='hide')
            if unsettled and pg.evaluate(STILL_JS):
                for ev in unsettled: ev['settled'] = round((i + 1) / FPS, 3)
                unsettled = []
            if i % 60 == 59: print('  frame %d/%d (%.0f s wall)' % (i + 1, n, time.monotonic() - t_wall), file=sys.stderr)
        ctx.close(); b.close()
        print(json.dumps({'frames': os.path.join(fdir, '%05d.png'), 'count': n, 'events': events, 'pageErrors': errors}))
        sys.exit(0)

    # realtime: the cues are held against the wall clock
    t0 = time.monotonic()
    head = t0 - t_rec
    for st in steps:
        ev = {'do': st['do'], 'cue': st['at']}
        if st['do'] == 'drift':
            wait = t0 + st['at'] - time.monotonic()
            if wait > 0: time.sleep(wait)
            ev['t'] = round(time.monotonic() - t0, 3); drift(pg, st)
        else:
            # aim 0.4 s ahead (the search costs ~0.1 s); the camera is still then, so the point holds
            wait = t0 + st['at'] - 0.4 - time.monotonic()
            if wait > 0: time.sleep(wait)
            f = find(pg, st)
            wait = t0 + st['at'] - time.monotonic()
            if wait > 0: time.sleep(wait)
            ev['t'] = round(time.monotonic() - t0, 3)
            click(pg, f)
            ev.update(name=f['matched'], id=f['id'], x=round(f['x']), y=round(f['y']),
                      flew=bool(pg.evaluate('() => window.__bp.cam.flying')))
            ok = wait_still(pg, 6)
            ev['settled'] = round(time.monotonic() - t0, 3) if ok else None
        events.append(ev); print(json.dumps(ev), file=sys.stderr)
    wait = t0 + float(job['duration']) + 0.5 - time.monotonic()  # half a second of tail so the trim never runs short
    if wait > 0: time.sleep(wait)
    video = pg.video
    ctx.close()  # finalizes the webm
    webm = str(video.path())
    b.close()
    print(json.dumps({'webm': webm, 'head': round(head, 3), 'events': events, 'pageErrors': errors}))
