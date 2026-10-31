// The change map's worker: decodes a before/after shot pair, draws both at the before's size on an OffscreenCanvas and
// runs packages/core/src/train/pixels.ts diffPixels over them, so the main thread does no pixel work. A source is a URL (fetched
// and decoded here) or an ImageBitmap the page decoded itself: Chrome cannot decode an SVG inside a worker, so a URL
// that fails to decode answers `decode: true` and useChangeMap.ts sends bitmaps instead.
import { diffPixels, withSizes, type PixGrid } from '@bp/core/train/pixels';

export interface MapRequest { id: number; before: string | ImageBitmap; after: string | ImageBitmap }
export type MapReply = { id: number; grid: PixGrid } | { id: number; error: string; decode?: true };

/** Wider screens are compared at this width: the grid has 32 columns, more pixels change nothing it shows. */
const MAX_W = 1600;

class DecodeError extends Error {}

async function bitmap(src: string | ImageBitmap): Promise<ImageBitmap> {
  if (typeof src !== 'string') return src;
  const r = await fetch(src);
  if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
  const blob = await r.blob();
  try { return await createImageBitmap(blob); } catch (e) { throw new DecodeError(e instanceof Error ? e.message : String(e)); }
}

function pixels(b: ImageBitmap, w: number, h: number): Uint8ClampedArray {
  const g = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d context on an OffscreenCanvas');
  g.drawImage(b, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

self.onmessage = async (e: MessageEvent<MapRequest>) => {
  const { id } = e.data;
  try {
    const [a, b] = await Promise.all([bitmap(e.data.before), bitmap(e.data.after)]);
    const k = Math.min(1, MAX_W / Math.max(1, a.width)), w = Math.max(1, Math.round(a.width * k)), h = Math.max(1, Math.round(a.height * k));
    const reply: MapReply = { id, grid: withSizes(diffPixels(pixels(a, w, h), pixels(b, w, h), w, h), [a.width, a.height], [b.width, b.height]) };
    a.close(); b.close();
    postMessage(reply);
  } catch (err) {
    const reply: MapReply = { id, error: err instanceof Error ? err.message : String(err) };
    if (err instanceof DecodeError) reply.decode = true;
    postMessage(reply);
  }
};
