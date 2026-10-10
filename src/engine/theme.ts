// Canvas colours come from the CSS tokens in src/app/globals.css, read with getComputedStyle on mount
// and whenever <html data-theme> changes, so the map and the DOM never disagree.

export type RGB = readonly [number, number, number];
export type PatternKind = 'diag' | 'back' | 'cross' | 'dots' | 'grid' | 'hlines' | 'vlines';
export interface PatternSpec { kind: PatternKind; size: number; color: string; lw?: number; bg?: string }

export interface Theme {
  mode: 'dark' | 'light';
  paper: string; ink: string; inkHi: string; ink2: string; ink3: string; ink4: string; line: string; grid: string;
  halo: string; accent: string; mint: string; amber: string; amberText: string; mintText: string; red: string; red2: string; delta: string;
  glyphEdge: string; labelBg: string; tileBase: string; poche: string; chipBg: string; onInk: string; panel: string;
  inkRGB: RGB;
  /** Ink at alpha `a` (cached string). */
  inkA(a: number): string;
  /** Any colour at alpha `a` (cached string). */
  alpha(color: string, a: number): string;
  /** A cached, world-anchored hatch pattern. */
  pattern(spec: PatternSpec): CanvasPattern | null;
  sans: string; mono: string; hand: string;
}

export function parseColor(c: string): [number, number, number, number] {
  c = c.trim();
  if (c[0] === '#') {
    const h = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p[3] ?? 1]; }
  return [223, 240, 255, 1];
}

/** Pattern bookkeeping shared by every pattern this theme hands out. */
class Patterns {
  private map = new Map<string, { p: CanvasPattern; s: number; r: number }>();
  private ctx: CanvasRenderingContext2D | null = null;
  private res: number;
  // Plain field, not a parameter property: Node's type stripping (how scripts/*.ts run) cannot load those.
  constructor(res: number) { this.res = res; }
  get(spec: PatternSpec): CanvasPattern | null {
    const key = spec.kind + '|' + spec.size + '|' + spec.color + '|' + (spec.lw ?? 1) + '|' + (spec.bg ?? '');
    const hit = this.map.get(key);
    if (hit) return hit.p;
    if (typeof document === 'undefined') return null;
    const s = spec.size, r = this.res, c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(s * r)); c.height = c.width;
    const g = c.getContext('2d')!;
    g.scale(c.width / s, c.width / s);
    if (spec.bg) { g.fillStyle = spec.bg; g.fillRect(0, 0, s, s); }
    g.strokeStyle = spec.color; g.fillStyle = spec.color; g.lineWidth = spec.lw ?? 1;
    const diag = (dir: number) => {
      g.beginPath();
      if (dir < 0) { g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(-1, s - 1); g.lineTo(1, s + 1); g.moveTo(s - 1, -1); g.lineTo(s + 1, 1); }
      else { g.moveTo(0, s); g.lineTo(s, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(s - 1, s + 1); g.lineTo(s + 1, s - 1); }
      g.stroke();
    };
    if (spec.kind === 'diag') diag(1);
    else if (spec.kind === 'back') diag(-1);
    else if (spec.kind === 'cross') { diag(1); diag(-1); }
    else if (spec.kind === 'dots') { g.beginPath(); g.arc(s / 2, s / 2, (spec.lw ?? 1) * 0.9, 0, 7); g.fill(); }
    else if (spec.kind === 'grid') { g.beginPath(); g.moveTo(0, 0.5); g.lineTo(s, 0.5); g.moveTo(0.5, 0); g.lineTo(0.5, s); g.stroke(); }
    else if (spec.kind === 'hlines') { g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke(); }
    else if (spec.kind === 'vlines') { g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke(); }
    this.ctx ||= document.createElement('canvas').getContext('2d');
    const p = this.ctx!.createPattern(c, 'repeat');
    if (!p) return null;
    this.map.set(key, { p, s, r: c.width / s });
    return p;
  }
  /** Anchor every pattern to the screen position of the world origin (ox, oy). */
  anchor(ox: number, oy: number) {
    for (const v of this.map.values()) {
      const s = v.s;
      v.p.setTransform?.(new DOMMatrix([1 / v.r, 0, 0, 1 / v.r, ((ox % s) + s) % s, ((oy % s) + s) % s]));
    }
  }
}

export interface ThemeHandle { theme: Theme; anchor(ox: number, oy: number): void }

export function readTheme(res: number): ThemeHandle {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  const mode = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const ink = v('--ink', '#dff0ff');
  const [ir, ig, ib] = parseColor(ink);
  const inkCache = new Map<number, string>();
  const anyCache = new Map<string, string>();
  const pats = new Patterns(res);
  // Text-grade status colours: --amber-2/--mint-2 when the CSS defines them, else dark = the mark colour and
  // light = the mark colour mixed 30% toward ink (marks keep 3:1, text needs 4.5:1).
  const textGrade = (name: string, mark: string) => {
    const t = v(name, '');
    if (t) return t;
    if (mode === 'dark') return mark;
    const [mr, mg, mb] = parseColor(mark);
    const m = (a: number, b: number) => Math.round(a * 0.7 + b * 0.3);
    return `rgb(${m(mr, ir)},${m(mg, ig)},${m(mb, ib)})`;
  };
  const amberMark = v('--amber', '#ffc35a'), mintMark = v('--mint', '#6ff2c8');
  const fam = (n: string, fb: string) => {
    const s = v(n, '');
    return s ? s + ', ' + fb : fb;
  };
  const theme: Theme = {
    mode,
    paper: v('--paper', '#071a33'), ink, inkHi: v('--ink-hi', '#ffffff'), ink2: v('--ink-2', 'rgba(223,240,255,.74)'),
    ink3: v('--ink-3', 'rgba(223,240,255,.38)'), ink4: v('--ink-4', 'rgba(223,240,255,.16)'), line: v('--line', 'rgba(223,240,255,.55)'),
    grid: v('--grid', 'rgba(127,224,255,.07)'), halo: v('--halo', 'rgba(7,26,51,.92)'), accent: v('--accent', '#7fe0ff'),
    mint: mintMark, amber: amberMark, amberText: textGrade('--amber-2', amberMark), mintText: textGrade('--mint-2', mintMark), red: v('--red', '#ff6a58'), red2: v('--red-2', '#ff9a8c'),
    delta: v('--delta', '#9fe8ff'), glyphEdge: v('--glyph-edge', '#04223a'), labelBg: v('--label-bg', '#0b2c52'),
    tileBase: v('--tile-base', 'rgba(3,18,40,.30)'), poche: v('--poche', '#0c2f57'), chipBg: v('--chip-bg', 'rgba(5,26,50,.95)'),
    onInk: v('--on-ink', '#061b38'), panel: v('--panel-solid', '#0a2342'),
    inkRGB: [ir, ig, ib],
    inkA(a) {
      const k = Math.round(a * 1000);
      let s = inkCache.get(k);
      if (!s) { s = `rgba(${ir},${ig},${ib},${(k / 1000).toFixed(3)})`; inkCache.set(k, s); }
      return s;
    },
    alpha(color, a) {
      const key = color + '|' + Math.round(a * 1000);
      let s = anyCache.get(key);
      if (!s) { const [r, g, b, a0] = parseColor(color); s = `rgba(${r},${g},${b},${(a0 * a).toFixed(3)})`; anyCache.set(key, s); }
      return s;
    },
    pattern: (spec) => pats.get(spec),
    sans: fam('--font-sans', '"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif'),
    mono: fam('--font-mono', '"IBM Plex Mono",Consolas,monospace'),
    hand: fam('--font-hand', 'cursive'),
  };
  return { theme, anchor: (ox, oy) => pats.anchor(ox, oy) };
}
