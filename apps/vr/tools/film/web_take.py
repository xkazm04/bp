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
