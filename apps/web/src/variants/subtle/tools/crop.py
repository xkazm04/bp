# crop a region of a screenshot and upscale it: crop.py in.png out.png x y w h [scale]
import sys
from PIL import Image
a = sys.argv; x, y, w, h = map(int, a[3:7]); s = float(a[7]) if len(a) > 7 else 2
im = Image.open(a[1]).crop((x, y, x + w, y + h)); im = im.resize((int(w * s), int(h * s)), Image.LANCZOS); im.save(a[2])
