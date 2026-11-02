// The layers that keep the bubble diagram alive before the plan exists and while it is judged (the anti-stale events):
// pure layout for the site survey (code areas as pencil lots, grouped, sized by lines) and for the outline (decided
// domains as bubbles holding their capabilities, before any box is known). The engine draws them; nothing here touches
// the canvas. Both layouts come out in unit space and are placed on the sheet by the engine, so the same cluster can sit
// centre stage while it is all there is, then recede into the sheet's key plan.
import type { OutlineDomain, SurveyArea } from '../contract';
import { clamp, packSiblings, enclose, type Circle } from './pack';

/** A code area placed in the survey cluster: unit space, cluster bbox is [-A, A] x [-1, 1]. */
export interface LotUnit { x: number; y: number; r: number }
export interface GroupUnit { key: string; x: number; y: number; r: number }
export interface SurveyLayout { lots: Map<string, LotUnit>; groups: GroupUnit[]; A: number }

const groupKey = (a: SurveyArea): string => a.group ?? a.id.split(/[-/:]/)[0] ?? a.id;

/** Pull a packed cluster sideways until it is about `want` times wider than tall (the sheet is wide), keeping circles apart. */
function widen<T extends Circle>(cs: T[], want: number) {
  if (cs.length < 3) return;
  const bb = bboxOf(cs), asp = (bb.x1 - bb.x0) / Math.max(1e-6, bb.y1 - bb.y0), fx = clamp(want / asp, 1, 2.2);
  for (const c of cs) c.x *= fx;
  for (let it = 0; it < 300; it++) {
    let moved = false;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const p = cs[i], q = cs[j], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy), min = p.r + q.r;
      if (d < min) { const push = (min - d) / 2 + 1e-3, ux = d ? dx / d : 1, uy = d ? dy / d : 0; p.x -= ux * push; p.y -= uy * push; q.x += ux * push; q.y += uy * push; moved = true; }
    }
    if (!moved) break;
  }
}
function bboxOf(cs: Circle[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of cs) { x0 = Math.min(x0, c.x - c.r); x1 = Math.max(x1, c.x + c.r); y0 = Math.min(y0, c.y - c.r); y1 = Math.max(y1, c.y + c.r); }
  return { x0, x1, y0, y1 };
}

/**
 * Lots sized by what the survey knows: lines once the inventory has counted them, files until then (an area the
 * inventory missed borrows the average lines per file). Areas pack inside their group, groups pack into a wide cluster.
 */
export function layoutSurvey(areas: readonly SurveyArea[]): SurveyLayout {
  const lots = new Map<string, LotUnit>();
  if (!areas.length) return { lots, groups: [], A: 1 };
  let sl = 0, sf = 0;
  for (const a of areas) if (a.lines != null && a.lines > 0 && a.files > 0) { sl += a.lines; sf += a.files; }
  const hasLines = sl > 0, lpf = sf > 0 ? sl / sf : 1;
  const size = (a: SurveyArea) => hasLines ? (a.lines != null && a.lines > 0 ? a.lines : a.files * lpf) : a.files;
  const raw = areas.map((a) => Math.sqrt(Math.max(size(a), 0)));
  const rMax = Math.max(1e-6, ...raw), rMin = rMax * 0.2;
  const byGroup = new Map<string, { a: SurveyArea; r: number }[]>();
  areas.forEach((a, i) => { const k = groupKey(a); const l = byGroup.get(k) ?? []; l.push({ a, r: Math.max(rMin, raw[i]) }); byGroup.set(k, l); });
  const pad = rMax * 0.1;
  const gcs: (Circle & { key: string; kids: (Circle & { id: string })[] })[] = [];
  for (const [key, list] of byGroup) {
    list.sort((p, q) => q.r - p.r || (p.a.id < q.a.id ? -1 : 1));
    const kids = list.map((m) => ({ id: m.a.id, x: 0, y: 0, r: m.r + pad * 0.35 }));
    packSiblings(kids);
    const e = enclose(kids);
    for (const k of kids) { k.x -= e.x; k.y -= e.y; k.r -= pad * 0.35; }
    gcs.push({ key, x: 0, y: 0, r: e.r + pad, kids });
  }
  gcs.sort((p, q) => q.r - p.r || (p.key < q.key ? -1 : 1));
  const outer = gcs.map((g) => ({ x: 0, y: 0, r: g.r + pad, g }));
  packSiblings(outer);
  widen(outer, 2.6);
  const bb = bboxOf(outer), mx = (bb.x0 + bb.x1) / 2, my = (bb.y0 + bb.y1) / 2, k = 2 / Math.max(1e-6, bb.y1 - bb.y0);
  const groups: GroupUnit[] = [];
  for (const o of outer) {
    const gx = (o.x - mx) * k, gy = (o.y - my) * k;
    groups.push({ key: o.g.key, x: gx, y: gy, r: o.g.r * k });
    for (const kid of o.g.kids) lots.set(kid.id, { x: gx + kid.x * k, y: gy + kid.y * k, r: kid.r * k });
  }
  return { lots, groups, A: (bb.x1 - bb.x0) * k / 2 };
}

/** A decided domain as a bubble: unit space (a capability is radius 1), cluster centred on 0. Caps are local to the domain. */
export interface DomainUnit { x: number; y: number; R: number; caps: Map<string, { x: number; y: number; R: number }> }

export function layoutOutline(domains: readonly OutlineDomain[]): { doms: Map<string, DomainUnit>; w: number; h: number } {
  const doms = new Map<string, DomainUnit>();
  const cs: (Circle & { id: string; u: DomainUnit })[] = [];
  for (const d of [...domains].sort((a, b) => a.order - b.order)) {
    const kids = d.capabilities.map((c) => ({ id: c.id, x: 0, y: 0, r: 1 + 0.55 }));
    let R = 1.6;
    const caps = new Map<string, { x: number; y: number; R: number }>();
    if (kids.length) {
      packSiblings(kids);
      const e = enclose(kids);
      R = Math.max(2, e.r + 0.45);
      for (const k of kids) caps.set(k.id, { x: k.x - e.x, y: k.y - e.y, R: 1 });
    }
    const u: DomainUnit = { x: 0, y: 0, R, caps };
    doms.set(d.id, u);
    cs.push({ id: d.id, x: 0, y: 0, r: R + 1.5, u });
  }
  if (!cs.length) return { doms, w: 0, h: 0 };
  packSiblings(cs);
  widen(cs, 2.05);
  const bb = bboxOf(cs), mx = (bb.x0 + bb.x1) / 2, my = (bb.y0 + bb.y1) / 2;
  for (const c of cs) { c.u.x = c.x - mx; c.u.y = c.y - my; }
  return { doms, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 };
}
