"""Fit a grading LUT from a neutral UE capture to the concept on matching regions (spark vr-fidelity-40 FC2).

Two models, in display (sRGB) values, from region means of the capture to the same regions of the concept:
- curve (the default): a gamma per channel, fitted in log space on the regions whose channel lies between 5 % and 95 %,
  plus a lift of the blacks (half the gap on the darkest region, at most LIFT_MAX). White stays white and the colour
  channels never mix, so skin, amber and white keep their hue (the matrix turned the skin lavender, Lynx 2026-10-24);
- excess (--model excess): only the blue that stands above max(red, green) is scaled, by a factor fitted on the
  regions where that excess is large, plus the same lift. Neutrals, skin and amber are untouched, and the paper's
  over-saturated blue comes down to the concept's (Lynx 2026-10-24: the per-channel curve yellowed the neutrals);
- matrix (--model matrix): a 3x3 matrix plus an offset by least squares, black and white anchored. The
result is written as UE's 256 x 16 colour-grading LUT (16 tiles of blue; red along x and green along y in each), and a
preview of the capture with the grade applied is written beside it.

    python scripts/lookdev/fit_grade_lut.py <capture.png> <regions.json> <out_lut.png> [<preview.png>] [--strength 0.8]
        [--model curve|matrix]

regions.json: [{"name": ..., "capture": [x0, y0, x1, y1], "target": [x0, y0, x1, y1]}, ...], boxes in each image's
own pixels; the target is docs/concepts/vr-light-table/target-light-table.jpg. Pure Python and Pillow (no numpy on Lynx).
"""
import json
import sys

from PIL import Image, ImageStat

TARGET = "docs/concepts/vr-light-table/target-light-table.jpg"
LIFT_MAX = 0.04


def mean(img, box):
    return [v / 255.0 for v in ImageStat.Stat(img.crop(tuple(box))).mean]


def solve(a, b):
    """Gaussian elimination for a small square system a x = b."""
    n = len(a)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] for i in range(n)]


def fit(pairs, weights):
    """Per output channel: out = w . (r, g, b, 1), least squares with weights."""
    rows = []
    for ch in range(3):
        ata = [[0.0] * 4 for _ in range(4)]
        atb = [0.0] * 4
        for (src, dst), w in zip(pairs, weights):
            x = src + [1.0]
            for i in range(4):
                atb[i] += w * x[i] * dst[ch]
                for j in range(4):
                    ata[i][j] += w * x[i] * x[j]
        for i in range(4):
            ata[i][i] += 1e-4  # a little ridge, so a thin region set stays near identity
        atb = [atb[i] + 1e-4 * (1.0 if i == ch else 0.0) for i in range(4)]
        rows.append(solve(ata, atb))
    return rows


def fit_curve(pairs, weights):
    import math
    gammas = []
    for ch in range(3):
        num = den = 0.0
        for (src, dst), w in zip(pairs, weights):
            if 0.05 < src[ch] < 0.95 and 0.01 < dst[ch] < 0.99:
                num += w * math.log(dst[ch]) / math.log(src[ch])
                den += w
        gammas.append(num / den if den else 1.0)
    dark = min(pairs, key=lambda p: sum(p[0]))
    lift = max(0.0, min(LIFT_MAX, 0.5 * (sum(dark[1]) - sum(dark[0])) / 3.0))
    return {"gamma": gammas, "lift": lift}


def fit_excess(pairs, weights):
    num = den = 0.0
    for (src, dst), w in zip(pairs, weights):
        e_src = src[2] - max(src[0], src[1])
        e_dst = dst[2] - max(dst[0], dst[1])
        if e_src > 0.1:
            num += w * e_dst / e_src
            den += w
    dark = min(pairs, key=lambda p: sum(p[0]))
    lift = max(0.0, min(LIFT_MAX, 0.5 * (sum(dark[1]) - sum(dark[0])) / 3.0))
    return {"blue_excess_scale": num / den if den else 1.0, "lift": lift}


def apply(rows, rgb, strength):
    if isinstance(rows, dict) and "blue_excess_scale" in rows:
        m = max(rgb[0], rgb[1])
        out = list(rgb)
        if rgb[2] > m:
            out[2] = m + (rgb[2] - m) * rows["blue_excess_scale"]
        out = [rows["lift"] + (1.0 - rows["lift"]) * v for v in out]
        return [min(1.0, max(0.0, c + strength * (v - c))) for c, v in zip(rgb, out)]
    if isinstance(rows, dict):
        out = []
        for ch in range(3):
            v = rows["lift"] + (1.0 - rows["lift"]) * (max(rgb[ch], 0.0) ** rows["gamma"][ch])
            out.append(min(1.0, max(0.0, rgb[ch] + strength * (v - rgb[ch]))))
        return out
    out = []
    for ch in range(3):
        v = sum(w * x for w, x in zip(rows[ch], rgb + [1.0]))
        v = rgb[ch] + strength * (v - rgb[ch])
        out.append(min(1.0, max(0.0, v)))
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--model" in sys.argv:
        args.remove(sys.argv[sys.argv.index("--model") + 1])
    strength = 1.0
    if "--strength" in sys.argv:
        strength = float(sys.argv[sys.argv.index("--strength") + 1])
        args.remove(sys.argv[sys.argv.index("--strength") + 1])
    capture, regions, out_lut = args[0], args[1], args[2]
    preview = args[3] if len(args) > 3 else None
    cap = Image.open(capture).convert("RGB")
    tgt = Image.open(TARGET).convert("RGB")
    pairs, weights, report = [], [], []
    for r in json.load(open(regions, encoding="utf-8")):
        s, d = mean(cap, r["capture"]), mean(tgt, r["target"])
        pairs.append((s, d))
        weights.append(r.get("weight", 1.0))
        report.append({"name": r["name"], "capture": [round(v * 255) for v in s], "target": [round(v * 255) for v in d]})
    model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "curve"
    if model == "matrix":
        # Anchors: black stays near black and white stays white.
        rows = fit(pairs + [([0.0] * 3, [0.0] * 3), ([1.0] * 3, [1.0] * 3)], weights + [4.0, 4.0])
    elif model == "excess":
        rows = fit_excess(pairs, weights)
    else:
        rows = fit_curve(pairs, weights)
    lut = Image.new("RGB", (256, 16))
    px = lut.load()
    for b in range(16):
        for g in range(16):
            for r in range(16):
                o = apply(rows, [r / 15.0, g / 15.0, b / 15.0], strength)
                px[b * 16 + r, g] = tuple(int(round(v * 255)) for v in o)
    lut.save(out_lut)
    for item, (s, _) in zip(report, pairs):
        item["graded"] = [round(v * 255) for v in apply(rows, s, strength)]
    if preview:
        src = cap.load()
        img = cap.copy()
        dst = img.load()
        cache = {}
        for y in range(img.size[1]):
            for x in range(img.size[0]):
                c = src[x, y]
                if c not in cache:
                    cache[c] = tuple(int(round(v * 255)) for v in apply(rows, [v / 255.0 for v in c], strength))
                dst[x, y] = cache[c]
        img.save(preview)
    fitted = rows if isinstance(rows, dict) else {"matrix": [[round(v, 4) for v in row] for row in rows]}
    print(json.dumps({"model": model, "fit": fitted, "strength": strength, "regions": report}))


if __name__ == "__main__":
    main()
