// Canvas colours come from the CSS tokens in src/app/globals.css, read with getComputedStyle on mount
// and whenever <html data-theme> changes, so the map and the DOM never disagree.

export type RGB = readonly [number, number, number];
export type PatternKind = 'diag' | 'back' | 'cross' | 'dots' | 'grid' | 'hlines' | 'vlines';
export interface PatternSpec { kind: PatternKind; size: number; color: string; lw?: number; bg?: string }

export interface Theme {
  mode: 'dark' | 'light';
  paper: string; ink: string; inkHi: string;
  halo: string; accent: string; mint: string; amber: string; amberText: string; mintText: string; red: string; red2: string; delta: string;
  glyphEdge: string; labelBg: string; tileBase: string; poche: string; chipBg: string; panel: string;
  inkRGB: RGB;
  /** Ink at alpha `a` (cached string). */
  inkA(a: number): string;
  /** Any colour at alpha `a` (cached string). */
  alpha(color: string, a: number): string;
  /** A cached, world-anchored hatch pattern. */
  pattern(spec: PatternSpec): CanvasPattern | null;
  sans: string; mono: string;
}

/** The dark theme's ink: what an unreadable colour falls back to, so the canvas draws *something*. */
const PARSE_FALLBACK: [number, number, number, number] = [223, 240, 255, 1];
/**
 * Colour strings parseColor could not read, each kept once. A design token is a CSS *custom property*, so
 * getPropertyValue hands back the authored text and never a normalised `rgb()`: a token written in a format
 * this function does not know is drawn as the dark ink in both themes, which on paper is invisible. That used
 * to be silent (and `#rgba` came back with a NaN channel, which canvas ignores outright, leaving the previous
 * fill in place). It is reported once per distinct string now, and scripts/check-theme-colors.ts reads every
 * token of both themes back through here so a new one in an unreadable format fails the gate instead.
 */
const unreadable = new Set<string>();
/** The colour strings parseColor fell back on, in first-seen order (the gate and the console both read this). */
export function unreadableColors(): readonly string[] { return [...unreadable]; }
/** Only for tests and gates that want a clean slate between cases. */
export function resetUnreadableColors() { unreadable.clear(); }

const FN = /^(rgba?|hsla?)\(([^)]*)\)$/i;
/** `1`, `0.5`, `50%` -> 0..1. */
const alphaOf = (s: string | undefined) => (s === undefined ? 1 : s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s));
/** `255`, `100%` -> 0..255. */
const chanOf = (s: string) => (s.endsWith('%') ? (parseFloat(s) * 255) / 100 : parseFloat(s));

/** Parse any colour a design token may legally be authored in, to [r, g, b, a] with r/g/b 0..255 and a 0..1. */
export function parseColor(c: string): [number, number, number, number] {
  c = c.trim();
  if (c[0] === '#') {
    const n = c.length - 1;
    // 3 and 4 nibbles double each one (#abc -> #aabbcc, #abcd -> #aabbccdd); 6 and 8 are already bytes
    if (n === 3 || n === 4 || n === 6 || n === 8) {
      const h = n <= 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
    }
  }
  const m = FN.exec(c);
  if (m) {
    // the legacy comma form and the modern space form (with `/ alpha`) are both one split
    const p = m[2].trim().split(/\s*[,/]\s*|\s+/).filter((x) => x.length > 0);
    if (p.length >= 3) {
      const a = alphaOf(p[3]);
      if (m[1].toLowerCase().startsWith('rgb')) {
        const r = chanOf(p[0]), g = chanOf(p[1]), b = chanOf(p[2]);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && Number.isFinite(a)) return [r, g, b, a];
      } else {
        const rgb = hslToRgb(parseFloat(p[0]), parseFloat(p[1]) / 100, parseFloat(p[2]) / 100);
        if (rgb && Number.isFinite(a)) return [rgb[0], rgb[1], rgb[2], a];
      }
    }
  }
  if (!unreadable.has(c)) {
    unreadable.add(c);
    console.error(`[theme] colour "${c}" is in a format the canvas reader does not know: drawn as the dark ink`);
  }
  return [...PARSE_FALLBACK] as [number, number, number, number];
}

/** h in degrees, s and l in 0..1 -> [r, g, b] 0..255; null when any part is not a number. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] | null {
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
  const hh = ((h % 360) + 360) % 360, c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - c / 2;
  const i = Math.floor(hh / 60);
  const [r, g, b] = i === 0 ? [c, x, 0] : i === 1 ? [x, c, 0] : i === 2 ? [0, c, x] : i === 3 ? [0, x, c] : i === 4 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
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
  private mtx: DOMMatrix | null = null;
  anchor(ox: number, oy: number) {
    if (!this.map.size) return;
    const M = (this.mtx ||= new DOMMatrix());
    for (const v of this.map.values()) {
      const s = v.s;
      M.a = M.d = 1 / v.r; M.e = ((ox % s) + s) % s; M.f = ((oy % s) + s) % s;
      v.p.setTransform?.(M);
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
  const anyCache = new Map<string, Map<number, string>>();
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
    paper: v('--paper', '#071a33'), ink, inkHi: v('--ink-hi', '#ffffff'),
    halo: v('--halo', 'rgba(7,26,51,.92)'), accent: v('--accent', '#7fe0ff'),
    mint: mintMark, amber: amberMark, amberText: textGrade('--amber-2', amberMark), mintText: textGrade('--mint-2', mintMark), red: v('--red', '#ff6a58'), red2: v('--red-2', '#ff9a8c'),
    delta: v('--delta', '#9fe8ff'), glyphEdge: v('--glyph-edge', '#04223a'), labelBg: v('--label-bg', '#0b2c52'),
    tileBase: v('--tile-base', 'rgba(3,18,40,.30)'), poche: v('--poche', '#0c2f57'), chipBg: v('--chip-bg', 'rgba(5,26,50,.95)'),
    panel: v('--panel-solid', '#0a2342'),
    inkRGB: [ir, ig, ib],
    inkA(a) {
      const k = Math.round(a * 1000);
      let s = inkCache.get(k);
      if (!s) { s = `rgba(${ir},${ig},${ib},${(k / 1000).toFixed(3)})`; inkCache.set(k, s); }
      return s;
    },
    alpha(color, a) {
      // colour -> alpha(per mille) -> string: no key concatenation per call; one theme object, so it dies with the theme
      let byA = anyCache.get(color);
      if (!byA) { byA = new Map(); anyCache.set(color, byA); }
      const k = Math.round(a * 1000);
      let s = byA.get(k);
      if (!s) { const [r, g, b, a0] = parseColor(color); s = `rgba(${r},${g},${b},${(a0 * a).toFixed(3)})`; byA.set(k, s); }
      return s;
    },
    pattern: (spec) => pats.get(spec),
    sans: fam('--font-sans', '"IBM Plex Sans Condensed","Arial Narrow",system-ui,sans-serif'),
    mono: fam('--font-mono', '"IBM Plex Mono",Consolas,monospace'),
  };
  return { theme, anchor: (ox, oy) => pats.anchor(ox, oy) };
}
