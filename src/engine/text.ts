// Canvas text: font strings with the 12 px floor, a width cache (each string measured once) and a
// word-wrap cache. Wrap never truncates: it returns null when the text does not fit.

/** Smallest canvas text size the engine will ever set, in CSS px. */
export const MIN_PX = 12;

export class Text {
  private wc = new Map<string, number>();
  private wr = new Map<string, string[] | null>();
  private m: CanvasRenderingContext2D | null = null;
  /** Smallest font size actually used since the last reset (for the 12 px check). */
  minUsed = Infinity;
  constructor(public sans: string, public mono: string, public u = 1) {}
  setFamilies(sans: string, mono: string) { this.sans = sans; this.mono = mono; this.clear(); }
  setU(u: number) { if (u !== this.u) { this.u = u; this.clear(); } }
  clear() { this.wc.clear(); this.wr.clear(); }
  /** Font string; `sz` is in UI units (scaled by U), never below 12 px on screen. */
  f(sz: number, wt = 500, mono = false): string {
    const px = Math.max(MIN_PX, Math.round(sz * this.u * 10) / 10);
    if (px < this.minUsed) this.minUsed = px;
    return wt + ' ' + px + 'px ' + (mono ? this.mono : this.sans);
  }
  w(t: string, font: string, ls = 0): number {
    const key = font + '|' + t;
    let v = this.wc.get(key);
    if (v == null) {
      this.m ||= document.createElement('canvas').getContext('2d');
      this.m!.font = font;
      v = this.m!.measureText(t).width;
      this.wc.set(key, v);
    }
    return v + ls * t.length;
  }
  wrap(text: string, maxW: number, font: string, maxL: number, ls = 0): string[] | null {
    const key = text + '|' + Math.round(maxW) + '|' + font + '|' + maxL + '|' + ls;
    if (this.wr.has(key)) return this.wr.get(key)!;
    const words = text.split(' '), lines: string[] = [];
    let cur = '', ok = true;
    for (const w of words) {
      if (this.w(w, font, ls) > maxW) ok = false;
      const t = cur ? cur + ' ' + w : w;
      if (!cur || this.w(t, font, ls) <= maxW) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    const r = ok && lines.length <= maxL ? lines : null;
    this.wr.set(key, r);
    return r;
  }
  /** Join parts with " · ", dropping trailing parts until it fits; null if even the first does not. */
  fit(parts: readonly string[], maxW: number, font: string): string | null {
    let n = parts.length;
    while (n > 1 && this.w(parts.slice(0, n).join(' · '), font) > maxW) n--;
    const s = parts.slice(0, n).join(' · ');
    return this.w(s, font) <= maxW ? s : null;
  }
}

/** Draw text with an optional halo; letter spacing in px. */
export function drawText(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, font: string, col: string, halo?: string | null, ls = 0) {
  ctx.font = font;
  if (ls) ctx.letterSpacing = ls + 'px';
  if (halo) { ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = halo; ctx.strokeText(t, x, y); }
  ctx.fillStyle = col; ctx.fillText(t, x, y);
  if (ls) ctx.letterSpacing = '0px';
}
