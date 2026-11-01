"""Record the /buildup lab while a live onboarding runs (scripts/buildup/onboard-live.ts): a real-time video at
1600x900 plus a still every --every seconds, until the feed reports done and the animation has had --tail seconds.

  python scripts/buildup/record.py --lab http://127.0.0.1:3200 --variant a --feed http://127.0.0.1:3300 --out <dir>
"""
import argparse, asyncio, json, pathlib, time, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument('--lab', required=True)
ap.add_argument('--variant', required=True)
ap.add_argument('--feed', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--every', type=float, default=30)
ap.add_argument('--tail', type=float, default=45)
ap.add_argument('--max-min', type=float, default=150)
a = ap.parse_args()


def status():
    try:
        with urllib.request.urlopen(a.feed.rstrip('/') + '/status', timeout=5) as r:
            return json.load(r)
    except Exception:
        return None


async def main():
    from playwright.async_api import async_playwright
    out = pathlib.Path(a.out)
    (out / 'stills').mkdir(parents=True, exist_ok=True)
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1600, 'height': 900}, record_video_dir=str(out), record_video_size={'width': 1600, 'height': 900})
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(('pageerror', round(time.time() - t0, 1), str(e)[:300])))
        pg.on('console', lambda c: c.type == 'error' and errors.append(('console', round(time.time() - t0, 1), c.text[:300])))
        t0 = time.time()
        await pg.goto(f"{a.lab}/buildup?v={a.variant}&source=live&feed={a.feed}")
        await asyncio.sleep(2)
        await pg.keyboard.press('h')  # hide the lab bar: the recording shows the variant only
        done_at, next_still = None, 0.0
        while True:
            el = time.time() - t0
            if el >= next_still:
                await pg.screenshot(path=str(out / 'stills' / f'{a.variant}-{int(el):05d}s.png'))
                next_still += a.every
            s = status()
            if s and s.get('done') and done_at is None:
                done_at = el
            if done_at is not None and el - done_at >= a.tail:
                await pg.screenshot(path=str(out / 'stills' / f'{a.variant}-{int(el):05d}s-end.png'))
                break
            if el > a.max_min * 60:
                errors.append(('timeout', round(el, 1), 'max-min reached'))
                break
            await asyncio.sleep(1)
        video = pg.video
        await ctx.close()
        path = await video.path() if video else None
        await b.close()
    if path:
        pathlib.Path(path).rename(out / f'buildup-{a.variant}.webm')
    (out / 'record.json').write_text(json.dumps({'variant': a.variant, 'seconds': round(time.time() - t0, 1), 'done_at': done_at, 'errors': errors}, indent=1))
    print('recorded', a.variant, round(time.time() - t0), 's, errors', len(errors))


asyncio.run(main())
