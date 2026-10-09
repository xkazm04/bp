# grid.py out.png x y w h scale prefix name1 name2 ... : crops the same region from several shots, 2 columns
import sys
from PIL import Image
a = sys.argv; out = a[1]; x, y, w, h = map(int, a[2:6]); s = float(a[6]); pre = a[7]; names = a[8:]
tiles = [Image.open(f'docs/shots/subtle/{pre}-{n}.png').crop((x, y, x + w, y + h)) for n in names]
cols = 2 if len(tiles) > 1 else 1; rows = (len(tiles) + cols - 1) // cols
im = Image.new('RGB', (w * cols, h * rows))
for i, t in enumerate(tiles): im.paste(t, ((i % cols) * w, (i // cols) * h))
im.resize((int(w * cols * s), int(h * rows * s)), Image.LANCZOS).save(out)
