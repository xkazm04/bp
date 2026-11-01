// Maths for the bubble diagram, ported from the contest prototype (blueprint-buildup, E1 "Pencil first"): easing,
// seeded randomness, front-chain circle packing (after Wang et al.) and the smallest enclosing circle.

export const TAU = Math.PI * 2;
export const clamp = (x: number, a = 0, b = 1): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sstep = (x: number): number => { x = clamp(x); return x * x * (3 - 2 * x); };
export const eOut = (x: number): number => { x = clamp(x); const u = 1 - x; return 1 - u * u * u; };
export const eInOut = (x: number): number => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const eBack = (x: number): number => { x = clamp(x); const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
/** Progress of an interval that starts at `a` and lasts `d`. An unscheduled start (Infinity) or NaN reads as 0. */
export const seg = (t: number, a: number, d: number): number => { const x = (t - a) / d; return x > 0 ? (x < 1 ? x : 1) : 0; };

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

export interface Circle { x: number; y: number; r: number }

function place(b: Circle, a: Circle, c: Circle): void {
  const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
  if (d2) {
    let a2 = a.r + c.r; a2 *= a2;
    let b2 = b.r + c.r; b2 *= b2;
    if (a2 > b2) {
      const x = (d2 + b2 - a2) / (2 * d2), y = Math.sqrt(Math.max(0, b2 / d2 - x * x));
      c.x = b.x - x * dx - y * dy; c.y = b.y - x * dy + y * dx;
    } else {
      const x = (d2 + a2 - b2) / (2 * d2), y = Math.sqrt(Math.max(0, a2 / d2 - x * x));
      c.x = a.x + x * dx - y * dy; c.y = a.y + x * dy + y * dx;
    }
  } else { c.x = a.x + c.r; c.y = a.y; }
}
function intersects(a: Circle, b: Circle): boolean { const dr = a.r + b.r - 1e-6, dx = b.x - a.x, dy = b.y - a.y; return dr > 0 && dr * dr > dx * dx + dy * dy; }

interface PNode { _: Circle; next: PNode; previous: PNode }
function pnode(c: Circle): PNode { const n = { _: c } as PNode; n.next = n; n.previous = n; return n; }
function pscore(node: PNode): number { const a = node._, b = node.next._, ab = a.r + b.r, dx = (a.x * b.r + b.x * a.r) / ab, dy = (a.y * b.r + b.y * a.r) / ab; return dx * dx + dy * dy; }

/** Packs circles in order, each tangent to the front chain. Circle i depends only on circles before it. */
export function packSiblings(circles: Circle[]): void {
  const n = circles.length;
  if (!n) return;
  const c0 = circles[0];
  c0.x = 0; c0.y = 0;
  if (n < 2) return;
  const c1 = circles[1]; c0.x = -c1.r; c1.x = c0.r; c1.y = 0;
  if (n < 3) return;
  place(c1, c0, circles[2]);
  let a = pnode(c0), b = pnode(c1), c = pnode(circles[2]);
  a.next = c.previous = b; b.next = a.previous = c; c.next = b.previous = a;
  pack: for (let i = 3; i < n; ++i) {
    place(a._, b._, circles[i]); c = pnode(circles[i]);
    let j = b.next, k = a.previous, sj = b._.r, sk = a._.r;
    do {
      if (sj <= sk) {
        if (intersects(j._, c._)) { b = j; a.next = b; b.previous = a; --i; continue pack; }
        sj += j._.r; j = j.next;
      } else {
        if (intersects(k._, c._)) { a = k; a.next = b; b.previous = a; --i; continue pack; }
        sk += k._.r; k = k.previous;
      }
    } while (j !== k.next);
    c.previous = a; c.next = b; a.next = b.previous = b = c;
    let aa = pscore(a), ca: number;
    while ((c = c.next) !== b) { if ((ca = pscore(c)) < aa) { a = c; aa = ca; } }
    b = a.next;
  }
}

/** Smallest circle enclosing circles (diminishing-step subgradient descent; n is tiny). */
export function enclose(cs: Circle[]): Circle {
  const n = cs.length;
  if (!n) return { x: 0, y: 0, r: 0 };
  if (n === 1) return { x: cs[0].x, y: cs[0].y, r: cs[0].r };
  let x = 0, y = 0;
  for (const c of cs) { x += c.x; y += c.y; }
  x /= n; y /= n;
  let R0 = 0;
  for (const c of cs) R0 = Math.max(R0, Math.hypot(c.x - x, c.y - y) + c.r);
  let step = R0 * 0.5;
  for (let it = 0; it < 2200; it++) {
    let far = cs[0], fd = -1;
    for (const c of cs) { const d = Math.hypot(c.x - x, c.y - y) + c.r; if (d > fd) { fd = d; far = c; } }
    const dx = far.x - x, dy = far.y - y, dl = Math.hypot(dx, dy);
    if (dl > 1e-9) { x += dx / dl * Math.min(step, dl); y += dy / dl * Math.min(step, dl); }
    step *= 0.9965;
  }
  let R = 0;
  for (const c of cs) R = Math.max(R, Math.hypot(c.x - x, c.y - y) + c.r);
  return { x, y, r: R };
}

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const dayOf = (s: string | null): number | null => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; };
export function fmtTime(t: number): string { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; }
export function fmtDay(d: number): string { const dt = new Date(d * 86400000); return MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate(); }
export function fmtDate(s: string | null): string { const d = dayOf(s); return d == null ? '' : fmtDay(d) + ' ' + new Date(d * 86400000).getUTCFullYear(); }
