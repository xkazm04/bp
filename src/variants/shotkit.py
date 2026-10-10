# Shared by the variants' screenshot and frame-time scripts (bold/, shaped/, subtle/tools/).
# Import it with the variants folder on sys.path:
#   sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))   # '../..' from subtle/tools
import os, sys

DEFAULT_BASE = 'http://localhost:3000'


def base(arg: str = '') -> str:
    """The server to drive: the argument when given, else $BP_BASE, else the one `npm run dev` / `npm start` serves.

    Same rule as scripts/shots.py: Next allows one `next dev` per directory, so the variants share it
    rather than each keeping a port and a `.next-<id>` build of its own.
    """
    return (arg or os.environ.get('BP_BASE') or DEFAULT_BASE).rstrip('/')


# ---------------------------------------------------------------------------------------- text floor
# The same check scripts/shots.py runs (keep the two in step): the smallest rendered text on the page,
# every visible element with its own text, in the chrome (.bp-ui, scaled by the engine's U) and outside
# it (the phone view, overlays). Returns [px, where, elements measured]; 0 measured means the floor was
# not checked at all on that page, which is a problem, not a pass.
FLOOR = 12  # px, docs/blueprint-ui.md text floor
MINFONT = """(() => { const U = window.__bp ? window.__bp.U : 1; let min = 99, where = '', n = 0; for (const el of document.body.querySelectorAll('*')) { if (el.closest('script, style, noscript, template')) continue; let txt = false; for (const c of el.childNodes) if (c.nodeType === 3 && c.textContent.trim()) txt = true; if (!txt) continue; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (!r.width) continue; n++; const px = parseFloat(cs.fontSize) * (el.closest('.bp-ui') ? U : 1); if (px < min) { min = px; where = el.tagName + '.' + el.className + ' ' + el.textContent.trim().slice(0, 30); } } return [Math.round(min * 10) / 10, where, n]; })()"""


def floor_check(pg, name, logs, problems):
    """Print the page's DOM and canvas text minimums and record what breaks the floor or logged an error."""
    mf = pg.evaluate(MINFONT)
    cmin = pg.evaluate("window.__bp ? window.__bp.tx.minUsed : null")
    print(name, 'DOM min px', mf, 'canvas min px', cmin, ('LOGS ' + ' | '.join(logs)) if logs else '')
    if mf[2] == 0: problems.append(f'{name}: no text measured, the floor was not checked')
    elif mf[0] < FLOOR: problems.append(f'{name}: DOM text at {mf[0]} px < {FLOOR} ({mf[1]})')
    if cmin is not None and cmin < FLOOR: problems.append(f'{name}: canvas text at {cmin} px < {FLOOR}')
    problems.extend(f'{name}: {l}' for l in logs if not l.startswith('warning: '))
    sys.stdout.flush()


def finish(problems):
    """Exit 1 when any page broke the floor or logged an error, so a run stands as a check."""
    if problems:
        print(f'\n{len(problems)} problem(s):')
        for pr in problems: print('  ' + pr)
    else:
        print('\nno problems: text floor held on every page and no page errors')
    sys.exit(1 if problems else 0)
