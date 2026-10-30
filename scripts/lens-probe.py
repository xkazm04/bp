#!/usr/bin/env python3
"""lens-scan's performance probe for bp's UI features (the overlay's `## Probes`, references/metrics.md "Probes").

    python scripts/lens-probe.py --feature <slug> [--serve <port> | --base <url>] [--runs 20] [--passes 5]
                                 [--metrics startupMs,interactionP95Ms,...] [--list]

Prints ONE JSON line per metric on stdout, the raw samples in the metric's unit; lens-scan computes the value (p95 by
nearest rank for a distribution, the median of the passes for a per-pass total), never this script:

    {"metric": "interactionP95Ms", "feature": "ledger-triage-and-waves", "samples": [...], "unit": "ms", "n": 20}

--serve <port> builds this checkout when stale and serves it (`node scripts/lens-serve.mjs start --port <port>`, the
production build, Turbopack, a scratch mirror for a worktree), waits for it, and kills that process tree at the end;
it refuses when the port already answers (another session's server would be measured). --base measures a server you
started yourself (default $BP_BASE). Python Playwright, headless Chromium, 1600x800 (bp's UI scale is 1 there), the
Kettle sample. Every reading is taken in the page, never from Playwright timing:

  startupMs         route features only: a fresh browser context (empty cache) per sample, navigation start to the
                    first animation frame in which the feature's entry screen is ready (its ready predicate below).
                    A feature opened by a click has no cold start of its own (the plan's, plus its interaction).
  interactionP95Ms  the feature's main interaction (below), the input event's timestamp to the first task after the
                    next frame (rAF, then a MessageChannel message: input to next paint, as the Event Timing duration
                    measures it, without its 8 ms rounding and 16 ms floor). 2 warm-ups, then --runs samples.
  frameP95Ms        rAF deltas along the scripted path, for the features that animate or scroll. The display's
                    interval (16.7 ms at 60 Hz) is its floor: a healthy page reads 16.7 and a fix cannot show there,
                    so prefer blockingMs / jankFrames / interactionP95Ms for a proposal.
  blockingMs        per pass: the sum over long tasks (PerformanceObserver 'longtask') in the path of (duration - 50).
  jankFrames        per pass: rAF deltas over 33.3 ms in the path.
  idleWakeups       per pass: after the path, 1.5 s to settle, then the page's own rAF callbacks plus timer firings in
                    one second (requestAnimationFrame / setTimeout / setInterval wrapped before the app's scripts).
                    bp's simulated swarm runs a live clock, so the plan and its panels are never idle by design.
  memoryMb          per pass: JS heap used after the path and a forced GC (CDP HeapProfiler.collectGarbage, then
                    Runtime.getHeapUsage), in MB.
A pass is a fresh context: load, reach the feature, run the path. Exit 0 when every requested metric printed, 1 when
the server or the feature never got ready or a metric read too few samples (named on stderr), 2 on bad input.
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

W, H = 1600, 800
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_METRICS = ('startupMs', 'interactionP95Ms', 'frameP95Ms')
PASS_METRICS = ('blockingMs', 'jankFrames', 'idleWakeups', 'memoryMb')
UNITS = {'startupMs': 'ms', 'interactionP95Ms': 'ms', 'frameP95Ms': 'ms', 'blockingMs': 'ms', 'jankFrames': 'frames',
         'idleWakeups': 'callbacks/s', 'memoryMb': 'MB'}

# Installed before the app's scripts in every page: the counters every metric reads.
INIT = r"""(() => {
  const W = window, ro = W.requestAnimationFrame.bind(W), st = W.setTimeout.bind(W), si = W.setInterval.bind(W);
  const L = W.__lp = { ro, raf: 0, timers: 0, counting: false, long: [], armed: false, ix: [], readyAt: 0, frames: null };
  W.requestAnimationFrame = (cb) => ro((t) => { if (L.counting) L.raf++; cb(t); });
  const wrap = (cb) => typeof cb === 'function' ? (...x) => { if (L.counting) L.timers++; return cb(...x); } : cb;
  W.setTimeout = (cb, ms, ...a) => st(wrap(cb), ms, ...a);
  W.setInterval = (cb, ms, ...a) => si(wrap(cb), ms, ...a);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) L.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const mark = (e) => {
    if (!L.armed) return; L.armed = false; const t0 = e.timeStamp;
    ro(() => { const mc = new MessageChannel(); mc.port1.onmessage = () => L.ix.push(performance.now() - t0); mc.port2.postMessage(0); });
  };
  for (const ty of ['pointerdown', 'mousedown', 'keydown', 'wheel', 'contextmenu']) W.addEventListener(ty, mark, { capture: true, passive: true });
  const ready = __READY__;
  const poll = () => { let ok = false; try { ok = !!ready(); } catch (e) {} if (ok) L.readyAt = performance.now(); else ro(poll); };
  ro(poll);
})();"""

CANVAS_READY = "() => window.__bp && window.__bp.perf && window.__bp.perf.frames > 0 && document.querySelector('#hdr')"
LEDGER_READY = "() => document.querySelector('.lg-tabs') && document.querySelector('[data-fid], .tr-row')"
VIS = "(s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }"


def vis(sel):
    return '() => (' + VIS + ')(' + json.dumps(sel) + ')'


# Per UI feature: route (the entry URL), ready (the entry screen's predicate, polled every frame), open (clicks that
# reach a feature opened from another screen; it then has no startupMs), cold=False (no startupMs either: its cold
# start is the plan's), ix (one measured interaction, by sample index), ix_ready (what the interaction shows),
# reset (unmeasured, after each sample), path (the scripted flow of a pass), frames (animates or scrolls).
ROW_A = 'Show a refused booking in the class sheet with a retry'
ROW_B = 'Say why Join waitlist is unavailable'
FEATURES = {
    'blueprint-canvas': dict(
        route='/?intro=0&scale=4', ready=CANVAS_READY, frames=True,
        ix=lambda pg, i: (pg.mouse.move(W * 0.42, H * 0.5), pg.mouse.wheel(0, -240 if i % 2 == 0 else 240)),
        path='gesture', why='wheel zoom at the plan centre (alternately in and out); path: perf.py\'s gesture at ?scale=4 (1.5 s wheel zoom, 1.5 s drag)'),
    'workspace-and-projects': dict(
        route='/?intro=0', ready=CANVAS_READY, frames=False,
        ix=lambda pg, i: pg.click('button.projsw-btn'), ix_ready=vis('#projsw-menu'),
        reset=lambda pg: pg.keyboard.press('Escape'),
        why='open the project switcher (Escape closes it, unmeasured)'),
    'feature-detail-sheet': dict(
        route='/?intro=0#open=failed-payment-dunning', ready="() => document.querySelector('[id^=pg-tab-]')", frames=True,
        ix=lambda pg, i: pg.locator('[id^=pg-tab-]').nth(1 + i % 3).click(),
        why='switch the open sheet\'s lens tab (Business, Design, Development in turn)'),
    'timeline-replay': dict(
        route='/?intro=0', ready=CANVAS_READY, open=[('click', 'button.tl-exp')], open_ready=vis('#tlpanel'), frames=True,
        pre=lambda pg: pg.focus('.tl-line svg'),
        ix=lambda pg, i: pg.keyboard.press('ArrowLeft' if (i // 4) % 2 == 0 else 'ArrowRight'),
        why='scrub the timeline a week (ArrowLeft x4, ArrowRight x4, from the focused hairline)'),
    'legend-variant-framework': dict(
        route='/v/subtle?intro=0', ready=CANVAS_READY, frames=True,
        ix=lambda pg, i: pg.keyboard.press('4' if i % 2 == 0 else '6'),
        why='switch the lens (4 Development, 6 Security) in the adopted subtle expression: the legend and the plan re-speak'),
    'bold-and-shaped-legends': dict(
        route='/v/bold?intro=0', ready=CANVAS_READY, frames=True,
        ix=lambda pg, i: pg.keyboard.press('4' if i % 2 == 0 else '6'),
        why='switch the lens (4, 6) in the bold expression'),
    'ledger-triage-and-waves': dict(
        route='/?intro=0#page=ledger', ready=LEDGER_READY, frames=True,
        ix=lambda pg, i: pg.locator('.lg-tabs button').nth(1 if i % 2 == 0 else 0).click(),
        why='switch Triage table <-> Feature x lens matrix (the Backlog scope, 68 findings)'),
    'release-train-decisions': dict(
        route='/?intro=0#page=ledger', ready=LEDGER_READY, open=[('text', 'In packs 8')], open_ready=vis('.tr-pt .tr-row'), frames=True,
        ix=lambda pg, i: pg.locator('.tr-pt .tr-row .c-sel input').first.click(),
        why='toggle an item\'s selection in the pack table (the decision bar re-reads it)'),
    'release-item-comparison': dict(
        route='/?intro=0#page=ledger', ready=LEDGER_READY, open=[('text', 'In packs 8'), ('text', ROW_A)], open_ready=vis('[data-role=tr-cmp]'), frames=True,
        ix=lambda pg, i: pg.get_by_text(ROW_B if i % 2 == 0 else ROW_A, exact=True).first.click(),
        why='open another pack item in the compare panel (two items in turn)'),
    'release-packaging': dict(
        route='/?intro=0#page=ledger&lv=release', ready=vis('.tr-rel'), frames=False,
        ix=lambda pg, i: pg.locator('.lg-tabs button').nth(2).click(), ix_ready=vis('.tr-rel'),
        reset=lambda pg: pg.locator('.lg-tabs button').nth(0).click(),
        why='open the Release tab from the Triage table (the release view mounts; back to the table unmeasured)'),
    'scan-launcher': dict(
        route='/?intro=0', ready=CANVAS_READY, frames=False, cold=False,
        ix=lambda pg, i: pg.mouse.click(W * (0.3 + 0.05 * (i % 4)), H * 0.45, button='right'), ix_ready=vis('#scanmenu'),
        reset=lambda pg: pg.keyboard.press('Escape'),
        why='right-click the plan: the scan menu for what is under the pointer (Escape closes it)'),
    'agent-workbench': dict(
        route='/?intro=0', ready=CANVAS_READY, frames=False, cold=False,
        ix=lambda pg, i: pg.click('button.ri[data-k=swarm]'), ix_ready=vis('#flyout'),
        reset=lambda pg: pg.keyboard.press('Escape'),
        why='open the Agents panel from the rail (Escape closes it)'),
}
# The features with no UI of their own, and why the probe metrics do not apply to them.
NO_UI = {
    'domain-model-and-simulation': 'the model and simulators run inside the plan: read through blueprint-canvas and timeline-replay',
    'product-rest-api': 'JSON routes, no frame or paint; request latency is not in the probe catalogue',
    'standalone-server': 'node:http process for the VR client, no page',
    'structure-schema-and-lens-catalog': 'schemas and generated types, nothing runs',
    'kettle-sample-data': 'generators and fixtures, nothing runs in a page',
    'vr-blueprint-link': 'an Unreal module: its frames are the CSV profiler\'s (.claude/spark/config.md Gates), not a browser probe',
    'vr-art-and-lookdev': 'art manifests and images',
    'quality-gate': 'a CLI check runner',
    'visual-fidelity-contracts': 'a CLI that drives the UI, no UI of its own',
}


def log(msg):
    sys.stderr.write('lens-probe: ' + msg + '\n'); sys.stderr.flush()


def answers(url):
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return r.status < 500
    except Exception as e:
        return getattr(e, 'code', None) is not None and e.code < 500


def serve(port):
    base = 'http://127.0.0.1:%d' % port
    if answers(base + '/'):
        log('%s already answers: another server holds the port and would be measured instead of this checkout' % base)
        sys.exit(1)
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    p = subprocess.Popen(['node', os.path.join(ROOT, 'scripts', 'lens-serve.mjs'), 'start', '--port', str(port)], cwd=ROOT,
                         stdout=subprocess.DEVNULL, stderr=sys.stderr, creationflags=flags, start_new_session=os.name != 'nt')
    t0 = time.time()
    while time.time() - t0 < 900:
        if p.poll() is not None:
            log('lens-serve exited %s before the server answered' % p.returncode); sys.exit(1)
        if answers(base + '/'):
            return base, p
        time.sleep(1)
    kill(p); log('the server never answered in 900 s'); sys.exit(1)


def kill(p):
    if p is None or p.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(p.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        import signal
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except Exception:
            p.kill()


def page_for(browser, f, base, wait_ready=True):
    ctx = browser.new_context(viewport={'width': W, 'height': H})
    ctx.add_init_script(INIT.replace('__READY__', f['ready']))
    pg = ctx.new_page()
    pg.goto(base + f['route'], wait_until='load', timeout=60000)
    if wait_ready:
        pg.wait_for_function('() => window.__lp && window.__lp.readyAt > 0', timeout=60000, polling=100)
    return ctx, pg


def reach(pg, f):
    """Clicks that open a feature reached from another screen, then that screen's ready predicate."""
    for kind, arg in f.get('open') or []:
        if kind == 'click':
            pg.click(arg, timeout=15000)
        else:
            pg.get_by_text(arg, exact=True).first.click(timeout=15000)
        time.sleep(0.4)
    if f.get('open_ready'):
        pg.wait_for_function(f['open_ready'], timeout=15000, polling=100)
    time.sleep(1.0)  # entry motion settles
    if f.get('pre'):
        f['pre'](pg)


def interact(pg, f, i):
    """One measured interaction. Returns the duration in ms, or None."""
    n0 = pg.evaluate('window.__lp.ix.length')
    pg.evaluate('window.__lp.armed = true')
    f['ix'](pg, i)
    if f.get('ix_ready'):
        pg.wait_for_function(f['ix_ready'], timeout=10000, polling=50)
    try:
        pg.wait_for_function('(n) => window.__lp.ix.length > n', arg=n0, timeout=5000, polling=50)
    except Exception:
        return None
    v = pg.evaluate('(n) => window.__lp.ix[n]', n0)
    time.sleep(0.35)
    if f.get('reset'):
        f['reset'](pg); time.sleep(0.45)
    return round(v, 2)


def startup(browser, f, base, runs):
    out = []
    for i in range(runs + 1):
        ctx, pg = page_for(browser, f, base)
        v = pg.evaluate('window.__lp.readyAt')
        ctx.close()
        if i:  # the first load warms the server's own caches
            out.append(round(v, 1))
    return out


def interactions(browser, f, base, runs):
    ctx, pg = page_for(browser, f, base)
    reach(pg, f)
    out = []
    for i in range(runs + 2):
        v = interact(pg, f, i)
        if i >= 2 and v is not None:
            out.append(v)
    ctx.close()
    return out


GESTURE = 'gesture'


def run_path(pg, f):
    if f.get('path') == GESTURE:  # scripts/perf.py's gesture
        t0 = time.time(); pg.mouse.move(W * 0.4, H * 0.45)
        while time.time() - t0 < 1.5:
            pg.mouse.wheel(0, -110); time.sleep(0.05)
        pg.mouse.move(W * 0.45, H * 0.5); pg.mouse.down(); t1 = time.time(); i = 0
        while time.time() - t1 < 1.5:
            i += 1; pg.mouse.move(W * 0.45 - (i % 60) * 9 + (30 if (i // 60) % 2 else 0), H * 0.5 - (i % 40) * 4); time.sleep(0.016)
        pg.mouse.up()
        return
    for i in range(6):
        f['ix'](pg, i)
        time.sleep(0.4)
        if f.get('reset'):
            f['reset'](pg); time.sleep(0.3)
    if f.get('frames'):  # scroll what the feature shows, where it scrolls
        pg.mouse.move(W * 0.5, H * 0.6)
        for d in (400, 400, -400, -400):
            pg.mouse.wheel(0, d); time.sleep(0.25)


def passes(browser, f, base, n, cdp_ok=True):
    res = {'frames': [], 'blockingMs': [], 'jankFrames': [], 'idleWakeups': [], 'memoryMb': []}
    for _ in range(n):
        ctx, pg = page_for(browser, f, base)
        reach(pg, f)
        t0 = pg.evaluate("""() => { const L = window.__lp; L.frames = []; let last = performance.now();
          const tick = (t) => { if (!L.frames) return; L.frames.push(t - last); last = t; L.ro(tick); }; L.ro(tick); return performance.now(); }""")
        run_path(pg, f)
        time.sleep(0.3)
        d = pg.evaluate("""(t0) => { const L = window.__lp, fr = L.frames.slice(2); L.frames = null; const t1 = performance.now();
          const block = L.long.filter(([s]) => s >= t0 && s <= t1).reduce((a, [, du]) => a + Math.max(0, du - 50), 0);
          return { fr, block }; }""", t0)
        res['frames'] += [round(x, 2) for x in d['fr']]
        res['blockingMs'].append(round(d['block'], 1))
        res['jankFrames'].append(sum(1 for x in d['fr'] if x > 33.3))
        time.sleep(1.5)  # the motion the path started ends
        pg.evaluate('() => { const L = window.__lp; L.raf = 0; L.timers = 0; L.counting = true; }')
        time.sleep(1.0)
        w = pg.evaluate('() => { const L = window.__lp; L.counting = false; return L.raf + L.timers; }')
        res['idleWakeups'].append(w)
        cdp = ctx.new_cdp_session(pg)
        cdp.send('HeapProfiler.collectGarbage')
        res['memoryMb'].append(round(cdp.send('Runtime.getHeapUsage')['usedSize'] / 1048576, 2))
        ctx.close()
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--feature')
    ap.add_argument('--serve', type=int, help='build if stale and serve this checkout on 127.0.0.1:<port>, killed at the end')
    ap.add_argument('--base', default=os.environ.get('BP_BASE') or 'http://127.0.0.1:3010')
    ap.add_argument('--runs', type=int, default=20, help='samples per distribution metric (lens-scan needs 20+)')
    ap.add_argument('--passes', type=int, default=5, help='passes per per-pass metric (lens-scan needs 3+)')
    ap.add_argument('--metrics', default='', help='comma-separated subset; default every metric that applies')
    ap.add_argument('--list', action='store_true', help='print the features, their interaction and the metrics that apply')
    a = ap.parse_args()
    if a.list:
        for k, f in FEATURES.items():
            print(json.dumps({'feature': k, 'metrics': applicable(f), 'interaction': f['why'], 'route': f['route']}))
        for k, why in NO_UI.items():
            print(json.dumps({'feature': k, 'metrics': [], 'n/a': why}))
        return 0
    if a.feature in NO_UI:
        log('%s: no probe metric applies (%s)' % (a.feature, NO_UI[a.feature])); return 2
    if a.feature not in FEATURES:
        log('unknown feature %r (--list names them)' % a.feature); return 2
    f = FEATURES[a.feature]
    want = applicable(f)
    if a.metrics:
        asked = [m.strip() for m in a.metrics.split(',') if m.strip()]
        bad = [m for m in asked if m not in want]
        if bad:
            log('%s does not apply to %s (applies: %s)' % (','.join(bad), a.feature, ','.join(want))); return 2
        want = asked
    from playwright.sync_api import sync_playwright
    proc, base, rc = None, a.base.rstrip('/'), 0
    try:
        if a.serve:
            base, proc = serve(a.serve)
        with sync_playwright() as p:
            b = p.chromium.launch(args=['--enable-gpu-rasterization', '--ignore-gpu-blocklist'])
            out = {}
            if 'startupMs' in want:
                out['startupMs'] = startup(b, f, base, a.runs)
            if 'interactionP95Ms' in want:
                out['interactionP95Ms'] = interactions(b, f, base, a.runs)
            if any(m in want for m in PASS_METRICS + ('frameP95Ms',)):
                r = passes(b, f, base, a.passes)
                out['frameP95Ms'] = r['frames']
                for m in PASS_METRICS:
                    out[m] = r[m]
            b.close()
        for m in want:
            s = out.get(m, [])
            need = 20 if m in DIST_METRICS else 3
            if len(s) < need:
                log('%s %s: %d samples, %d needed: unmeasured' % (a.feature, m, len(s), need)); rc = 1
            print(json.dumps({'metric': m, 'feature': a.feature, 'samples': s, 'unit': UNITS[m], 'n': len(s)}))
            sys.stdout.flush()
    finally:
        kill(proc)
    return rc


def applicable(f):
    m = []
    if not f.get('open') and f.get('cold', True):
        m.append('startupMs')
    m.append('interactionP95Ms')
    if f.get('frames'):
        m.append('frameP95Ms')
    return m + list(PASS_METRICS)


if __name__ == '__main__':
    sys.exit(main())
