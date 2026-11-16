"""Render docs/img/src/*.html to docs/img/<name>.png at 2x (Playwright, Chromium).

    python docs/img/src/render.py [name ...]     # default: every .html here
"""

import pathlib
import sys

from playwright.sync_api import sync_playwright

SRC = pathlib.Path(__file__).resolve().parent
OUT = SRC.parent

names = sys.argv[1:] or [p.stem for p in sorted(SRC.glob("*.html"))]
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 960}, device_scale_factor=2)
    for name in names:
        page.goto((SRC / f"{name}.html").as_uri())
        page.evaluate("document.fonts.ready")
        page.locator("#sheet").screenshot(path=str(OUT / f"{name}.png"))
        print(f"wrote docs/img/{name}.png")
    browser.close()
