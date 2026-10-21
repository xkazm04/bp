"""The ledger port's fidelity contract, scene by scene, through the contest's own instrument.

    python scripts/fidelity/contract.py capture            # the winner -> contract*.json (only when the winner changes)
    python scripts/fidelity/contract.py check [--port 3321] # bp's ledger against them; exit 1 on any deviation

The instrument is the contest skill's style-contract.py (ai-registry skills/contest/scripts; CONTEST_SCRIPTS overrides
the folder): its roles, measured properties, tolerances and report are used unchanged. One thing differs for bp: the
instrument waits for `networkidle`, which bp never reaches (the live stream is a held EventSource), so a bp page is
loaded to `domcontentloaded` and measured once the ledger's rows are on screen. The winner (a file) loads as before.

Scenes (each its own contract, every one measured at 1600x800, where bp's UI scale U is 1: Engine.fit takes
U = 1 + 0.5 * (clamp(min(w / 1280, h / 800), 1, 2) - 1), so 1600x900 renders 1.0625x and every width would read 6% wide):
  item        dark; Athena; p-c02a61 open in compare (the winner opens it first; the port is driven to it)
  item-light  the same in the light theme (the winner's Light button; bp's ?theme=light)
  table       dark; Athena; compare closed (Esc): the In packs table at full width, every column; roles-table.json
  perf        dark; a performance item open: the winner's sample-perf-1 (#item=) against Kettle's k-perf-1 pack item
              (Athena has no performance pack); roles-perf.json
"""
import argparse
import importlib.util
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BP = HERE.parent.parent
WINNER = BP / '.contest/arena/release-manager/entries/claude-claude-opus-5-5_high/variant-1/index.html'
SIZE = '1600x800'
READY = '[data-role=tr-row]'

# scene: (roles file, contract file, winner hash, winner drive, port path, port drive)
SCENES = {
    'item': ('roles.json', 'contract.json', '', [],
             '/?product=athena#page=ledger', ['click:[data-fid=p-c02a61]', 'wait:2500']),
    'item-light': ('roles.json', 'contract-light.json', '', ['click:#themeBtn'],
                   '/?product=athena&theme=light#page=ledger', ['click:[data-fid=p-c02a61]', 'wait:2500']),
    'table': ('roles-table.json', 'contract-table.json', '', ['press:Escape'],
              '/?product=athena#page=ledger', ['press:Escape', 'wait:800']),
    'perf': ('roles-perf.json', 'contract-perf.json', '#item=sample-perf-1&wide', [],
             '/#page=ledger', ['wait:4000', 'click:[data-pack=k-perf-1] + [data-role=tr-row]', 'click:[data-role=tr-nav-wide]', 'wait:1500']),
}


def instrument():
    folder = Path(os.environ.get('CONTEST_SCRIPTS', BP.parent / 'ai-registry/skills/contest/scripts'))
    spec = importlib.util.spec_from_file_location('style_contract', folder / 'style-contract.py')
    sc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sc)
    def measure(target, roles_for_page, width, steps=None):
        live = target.startswith('http')
        from playwright.sync_api import sync_playwright
        w, h = (int(x) for x in width.split('x'))
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': w, 'height': h})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
            pg.goto(target, wait_until='domcontentloaded' if live else 'networkidle')
            if live:
                pg.wait_for_selector(READY, timeout=120000)
            pg.wait_for_timeout(2500)
            sc.drive(pg, steps)
            data = pg.evaluate(sc.MEASURE_JS, {'roles': roles_for_page, 'props': sc.PROPS})
            b.close()
        return data, errs

    sc.measure = measure
    return sc


def run(sc, argv):
    sys.argv = ['style-contract.py'] + argv
    try:
        sc.main()
        return 0
    except SystemExit as e:
        # SystemExit.code is None, an int, or a message (sys.exit('text') means print it and exit 1)
        if e.code is None or isinstance(e.code, int):
            return int(e.code or 0)
        print(e.code, file=sys.stderr)
        return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['capture', 'check'])
    ap.add_argument('--port', type=int, default=3321)
    ap.add_argument('--scene', action='append', choices=list(SCENES), help='one scene (repeatable); default all')
    a = ap.parse_args()
    # capture REPLACES contract*.json, and the instrument writes the file whatever it measured: against a
    # winner that is not here it would write 61 null roles over the winner's measurements and exit 0. The
    # winner is git-ignored (a local checkout of .contest/, see README.md), so refuse before measuring.
    if a.mode == 'capture' and not WINNER.is_file():
        print(f'no winner at {WINNER}\n'
              'capture replaces the contract files, so it refuses to run without it. Check out the contest\n'
              'entry under .contest/ (git-ignored; scripts/fidelity/README.md), or run `check` instead.',
              file=sys.stderr)
        sys.exit(2)
    sc, bad = instrument(), 0
    for name in a.scene or list(SCENES):
        roles, contract, hash_, wdrive, path, pdrive = SCENES[name]
        print(f'== {name} ({contract})', flush=True)
        if a.mode == 'capture':
            target, drive = WINNER.as_uri() + hash_, wdrive
        else:
            target, drive = f'http://localhost:{a.port}{path}', pdrive
        argv = [a.mode, target, str(HERE / roles), str(HERE / contract), '--width', SIZE]
        for d in drive:
            argv += ['--drive', d]
        bad |= run(sc, argv)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
