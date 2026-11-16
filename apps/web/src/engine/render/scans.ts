// Running scans on the plan: a marching outline in the lens accent around each job's scope, a label
// chip, a sweep on the feature being judged and a tick on the done ones (spark scan-package WP3).
// The views arrive on discrete changes (Engine.setScans); everything a frame needs (world boxes, nesting,
// chip text and widths, the done lists) is worked out there, so a frame allocates nothing: it reads
// preallocated arrays, reuses two rect records and draws, culled to the viewport. A lens accent marks the
// outline, the chip border, the sweep and the ticks; it never fills a tile.
// At L0 a scan also reads per room (`roomScans`): a lit wall, a thin rail and n/m on a room being read, a tick on a read one.
import type { Box, Layout, RoomNode } from '@bp/core/model';
import type { JobStatus } from '@bp/core/scan/jobs';
import type { Engine } from '../Engine';
import { drawText } from '../text';
import { glyph } from './lens-glyph';
import { featRect } from './plan';
import { onView, rs, syv, union, type SRect, type View } from './view';

export interface ScanView {
  id: string;
  lens: string;
  /** The lens accent for the current theme (manifest presentation.accent), else ink. */
  accent: string;
  /** The place the scope names; null = a feature list (outline its bounding box) or everything. */
  place: { t: 'bld' | 'wing' | 'room' | 'bay' | 'tile'; id: string } | null;
  features: string[];
  done: ReadonlySet<string>;
  current?: string;
  n: number;
  m: number;
  /** `stale`: a running job that has shown no sign of life for a while (scan-views STALE_MS); not known to have failed. */
  status: JobStatus | 'stale';
  /** The job this view draws (at `?scale` > 1 every product line's view names the one job); absent: `id` less its `@b`. */
  job?: string;
  /** A running job's last sign of life (ms since the epoch), when known: the chip's card says how long it has been silent. */
  seen?: number;
  /** A failed job's error line, for the chip's card. */
  error?: string;
  /** The job's scope is everything (`features` is empty then, and every tile of the view's line is in scope). */
  all?: true;
}

/** One room's part in the scans on the plan. `done` and `total` count the room's features in the job's scope. */
export interface RoomScan { room: string; lens: string; done: number; total: number; state: 'scanning' | 'scanned' }

/** A room's mark as the layer draws it: which view it came from (the accent), and whether a reader has reached the room yet. */
interface RoomMark extends RoomScan { node: RoomNode; view: number; lit: boolean; text: string }

/**
 * Each room's state, worked out once per view set. Views arrive oldest first (scanViews), so a later view over a room
 * replaces an earlier one: the newest job's lens and counts win. A view counts only the tiles of its own product line,
 * so a `?scale` > 1 job (one view per line) gives each line's rooms their own counts and never adds lines together.
 * A queued job has not reached any room. A stalled or failed job is no longer reading, so it keeps only the rooms it
 * finished: drawing its unfinished ones as lit would say a reader is there.
 */
function roomMarks(views: readonly ScanView[], L: Pick<Layout, 'TILE' | 'tiles'>): RoomMark[] {
  const by = new Map<string, RoomMark>();
  views.forEach((V, view) => {
    if (V.status === 'queued') return;
    const line = V.place?.t === 'bld' ? V.place.id : null;
    const ids = V.all ? L.tiles.filter((T) => !line || T.wing.bld.id === line).map((T) => T.id) : V.features;
    const counts = new Map<RoomNode, { total: number; done: number; lit: boolean }>();
    for (const id of new Set(ids)) {
      const T = L.TILE[id]; if (!T) continue;
      let c = counts.get(T.room);
      if (!c) counts.set(T.room, (c = { total: 0, done: 0, lit: false }));
      c.total++;
      if (V.done.has(id)) c.done++;
      if (V.current === id) c.lit = true;
    }
    for (const [node, c] of counts) {
      const scanned = c.done >= c.total;
      if (!scanned && V.status !== 'running') continue;
      by.set(node.id, { room: node.id, lens: V.lens, done: c.done, total: c.total, state: scanned ? 'scanned' : 'scanning', node, view, lit: c.lit || c.done > 0, text: c.done + '/' + c.total });
    }
  });
  return [...by.values()].sort((a, b) => a.node.ri - b.node.ri);
}

/** Each room's scan state over these views, in plan order; a room with nothing in any job's scope is absent. */
export const roomScans = (views: readonly ScanView[], L: Pick<Layout, 'TILE' | 'tiles'>): RoomScan[] =>
  roomMarks(views, L).map(({ room, lens, done, total, state }) => ({ room, lens, done, total, state }));

/** The job a view stands for: `job`, else its id without the product-line suffix (`j1@2` -> `j1`). */
export const viewJob = (V: Pick<ScanView, 'id' | 'job'>): string => V.job ?? V.id.replace(/@\d+$/, '');

/** The sweep's period across the feature being judged. */
const BEAM_MS = 1200;
/** Below this the plan is at its room level (L0): the condition the room pins and tracked counts already use. */
const L0 = 0.995;
/** The narrowest room that carries n/m: its width beside the bottom-right "N tracked" count, in px before UI scale. */
const ROOM_TEXT_W = 156;
const DASH = [8, 5], NO_DASH: number[] = [];
const r1: SRect = { x: 0, y: 0, w: 0, h: 0 }, r2: SRect = { x: 0, y: 0, w: 0, h: 0 };

export class ScanLayer {
  private views: ScanView[] = [];
  /** Per view, by index: world box, nesting depth on a shared place, chip text, done tiles, accent. */
  private box: Box[] = [];
  private depth: number[] = [];
  /** The first view drawn on the same place (its chips line up after that one's). */
  private lead: number[] = [];
  private text: string[] = [];
  private done: string[][] = [];
  private col: string[] = [];
  private chipW: number[] = []; private chipX: number[] = [];
  private jobs: string[] = [];
  /** The rooms' scan marks: recomputed here on a view change, only read per frame. */
  private rooms: RoomMark[] = [];
  private font = ''; private th: unknown = null;
  /** True while any view runs: the engine keeps its loop alive for the marching dashes and the sweep. */
  animating = false;
  /** Tile ids with dispatched work pending on them (queued or running execute jobs): a pulsing dot each. */
  private busy: string[] = [];

  get size(): number { return this.views.length; }
  private drawBusy(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number): void {
    drawBusyDots(this.busy, E, ctx, v, lod, now);
  }
  /** Take the tiles with pending work (a discrete change). */
  setBusy(ids: readonly string[]): void {
    this.busy = ids.slice();
    this.animating = this.busy.length > 0 || this.views.some((V) => V.status === 'running');
  }
  /** The first view of job `job` (the chip's hover card reads it), or null. */
  viewOf(job: string): ScanView | null { const i = this.jobs.indexOf(job); return i < 0 ? null : this.views[i]; }

  /** Take a new set of views (a discrete change): resolve boxes and nesting once, here, not per frame. */
  set(views: readonly ScanView[], E: Engine): void {
    const L = E.M.L, n = views.length;
    this.views = views.slice();
    this.box.length = this.depth.length = this.lead.length = this.text.length = this.done.length = this.col.length = this.jobs.length = 0;
    const keys: string[] = [];
    for (let i = 0; i < n; i++) {
      const V = views[i];
      const node = V.place ? (V.place.t === 'tile' ? L.TILE[V.place.id] ?? null : E.placeById(V.place.t, V.place.id)) : null;
      let b: Box | null = node ? { x: node.x, y: node.y, w: node.w, h: node.h } : null;
      if (!b && V.features.length) b = union(V.features.map((id) => L.TILE[id]).filter((t): t is NonNullable<typeof t> => !!t));
      if (!b) b = union(L.blds);
      this.box.push(b ?? { x: 0, y: 0, w: 0, h: 0 });
      const key = V.place ? V.place.t + ':' + V.place.id : b ? b.x + ',' + b.y + ',' + b.w + ',' + b.h : '';
      let d = 0, lead = i;
      for (let j = 0; j < i; j++) if (keys[j] === key) { if (!d) lead = j; d++; }
      keys.push(key); this.depth.push(d); this.lead.push(lead);
      const short = E.M.P.LENS[V.lens]?.short ?? V.lens;
      this.text.push(short + ' ' + (V.status === 'queued' ? 'queued' : V.status === 'failed' ? 'failed' : V.status === 'stale' ? 'stalled ' + V.n + '/' + V.m : V.status === 'done' ? V.m + '/' + V.m + ' done' : V.n + '/' + V.m));
      this.done.push([...V.done]);
      this.col.push(V.accent);
      this.jobs.push(viewJob(V));
    }
    this.rooms = roomMarks(this.views, L);
    this.animating = this.busy.length > 0 || views.some((V) => V.status === 'running');
    this.font = ''; this.th = E.th;
  }

  /**
   * L0, per room: a scanning room's wall in the lens accent, a rail along its bottom edge filled done/total from the left and
   * n/m above that; a scanned room keeps a quiet wall with a tick and m/m. They fade in as the room pins do. A room the job has
   * not reached draws nothing: a lit wall says a reader is there, and at `?scale=4` a faint wall on every unreached room is noise.
   * The rail's paper trough is a mark's casing (the tick's halo), not a tile wash, and the accent stays a 2 px line and a 3 px bar.
   * n/m and the tick stand in the room's bottom-left corner, clear of its label, its question pin (top right) and tracked count (bottom right).
   */
  private drawRooms(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, font: string): void {
    const ms = this.rooms;
    if (!ms.length || lod >= L0) return;
    const th = E.th, u = E.U;
    ctx.globalAlpha = 1 - lod;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i], r = rs(v, m.node, r1), col = this.col[m.view];
      if (r.w < 20 * u || r.h < 12 * u || !onView(v, r, 8 * u)) continue;
      const scanned = m.state === 'scanned', bottom = r.y + r.h;
      if (!scanned) {
        if (!m.lit) continue;
        ctx.strokeStyle = col; ctx.lineWidth = 2 * u;
        ctx.strokeRect(r.x + u, r.y + u, r.w - 2 * u, r.h - 2 * u);
        const rx = r.x + 4 * u, rw = r.w - 8 * u, ry = bottom - 7 * u;
        ctx.fillStyle = th.paper; ctx.fillRect(rx - u, ry - u, rw + 2 * u, 5 * u);
        if (m.done) { ctx.fillStyle = col; ctx.fillRect(rx, ry, Math.max(2 * u, (rw * m.done) / m.total), 3 * u); }
      }
      // the bottom-left slot: never over a label that reaches down this far
      const lb = m.node.labelBox;
      if (lb && syv(v, lb.y + lb.h) > bottom - 22 * u) continue;
      const x = r.x + 8 * u;
      if (scanned) tick(ctx, x, bottom - 20 * u, 10 * u, col, th.paper, u);
      if (r.w >= ROOM_TEXT_W * u) drawText(ctx, m.text, scanned ? x + 14 * u : x, bottom - 10 * u, font, th.inkHi, th.halo);
    }
    ctx.globalAlpha = 1;
  }

  /** Chip widths and their offsets along a shared place's top edge: once per font (UI scale, families) or view set. */
  private measure(E: Engine, font: string) {
    const u = E.U, n = this.views.length;
    this.font = font; this.chipW.length = this.chipX.length = 0;
    for (let i = 0; i < n; i++) {
      this.chipW.push(Math.ceil(6 * u + 12 * u + 5 * u + E.tx.w(this.text[i], font) + 7 * u));
      let x = 0;
      for (let j = this.lead[i]; j < i; j++) if (this.depth[j] < this.depth[i] && this.lead[j] === this.lead[i]) x += this.chipW[j] + 4 * u;
      this.chipX.push(x);
    }
  }

  /** Draw every live view at the live camera (after the swarm layers, before the trouble flags); each drawn chip registers
   *  into the frame's hit list (render/hits.ts) as a `scan` target for its job. */
  draw(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number): void {
    const n = this.views.length;
    if (!E.isNow) return;
    this.drawBusy(E, ctx, v, lod, now);
    if (!n) return;
    const th = E.th, u = E.U, reduced = E.cam.reduced, font = E.tx.f(12, 600, true);
    if (font !== this.font) this.measure(E, font);
    if (th !== this.th) { this.th = th; for (let i = 0; i < n; i++) this.col[i] = E.lensAccent(this.views[i].lens); }
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    this.drawRooms(E, ctx, v, lod, font);
    for (let i = 0; i < n; i++) {
      const V = this.views[i], col = V.status === 'failed' ? th.red : V.status === 'stale' ? th.amber : this.col[i], running = V.status === 'running';
      const r = rs(v, this.box[i], r1);
      // the first outline stands just outside its place; each further one on the same place nests 6 px further in
      const off = -3 * u + 6 * u * this.depth[i];
      const x = r.x + off, y = r.y + off, w = r.w - 2 * off, h = r.h - 2 * off;
      if (w <= 2 || h <= 2 || !onView(v, r, 24 * u)) continue;
      // at L0 the rooms speak for a job over everything, so its site-wide outline fades out as they fade in; a queued, stalled or
      // failed one has no rooms saying so and keeps it. The chip stays either way: it is the only place that names the lens
      const lineA = V.all && lod < L0 && (running || V.status === 'done') ? lod : 1;
      if (lineA > 0) {
        ctx.globalAlpha = lineA;
        ctx.strokeStyle = col; ctx.lineWidth = 2 * u;
        ctx.setLineDash(DASH); ctx.lineDashOffset = running && !reduced ? -E.dashT * 1.2 : 0;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash(NO_DASH); ctx.lineDashOffset = 0;
        ctx.globalAlpha = 1;
      }
      // the sweep across the feature being judged (reduced motion: none)
      if (running && V.current && !reduced) {
        const f = featRect(E, v, V.current, lod, r2);
        if (f && f.w >= 6 && f.h >= 4 && onView(v, f, 0)) {
          const p = (now % BEAM_MS) / BEAM_MS, bw = Math.max(8 * u, f.w * 0.28), bx = f.x - bw + p * (f.w + bw);
          ctx.save(); ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip();
          ctx.fillStyle = th.alpha(col, 0.08); ctx.fillRect(bx - bw * 0.6, f.y, bw * 2.2, f.h);
          ctx.fillStyle = th.alpha(col, 0.16); ctx.fillRect(bx, f.y, bw, f.h);
          ctx.fillStyle = th.alpha(col, 0.55); ctx.fillRect(bx + bw - 1.5 * u, f.y, 1.5 * u, f.h);
          ctx.restore();
        }
      }
      // ticks on the done features: only where a tile is big enough to carry one, culled to the viewport
      const dn = this.done[i];
      for (let j = 0; j < dn.length; j++) {
        const f = featRect(E, v, dn[j], lod, r2);
        if (!f || f.w < 24 * u || f.h < 24 * u || !onView(v, f, 0)) continue;
        tick(ctx, f.x + 4 * u, f.y + 4 * u, 10 * u, col, th.paper, u);
      }
      // the chip: glyph, lens short, n/m (or queued / failed), on paper with an accent border
      // it stays on screen while its outline does: zoomed into the scope, it rides the safe area's top-left
      const S = E.SAFE, cw = this.chipW[i], ch = 20 * u;
      const cx = Math.min(Math.max(x + 8 * u, S.l + 4 * u) + this.chipX[i], x + w - cw - 4 * u);
      const cy = Math.min(Math.max(y - ch - 2 * u, S.t + 4 * u), y + h - ch - 4 * u); // above the outline: the place's own label stays readable
      ctx.fillStyle = th.paper; ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeStyle = col; ctx.lineWidth = 1.5 * u; ctx.strokeRect(cx + 0.75 * u, cy + 0.75 * u, cw - 1.5 * u, ch - 1.5 * u);
      glyph(ctx, E.M.P.LENS[V.lens]?.glyph ?? null, cx + 6 * u, cy + 4 * u, 12 * u, col);
      drawText(ctx, this.text[i], cx + 6 * u + 12 * u + 5 * u, cy + 14.2 * u, font, th.inkHi);
      E.hits.add('scan', this.jobs[i], i, V, cx, cy, cw, ch);
    }
    ctx.restore();
  }
}

/** A pulsing dot on the corner of each tile with dispatched work pending (reduced motion: a still dot, no ring). */
function drawBusyDots(ids: readonly string[], E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number) {
  if (!ids.length) return;
  const th = E.th, u = E.U, reduced = E.cam.reduced, col = th.amber, p = (now % 1400) / 1400;
  ctx.save();
  for (let i = 0; i < ids.length; i++) {
    const f = featRect(E, v, ids[i], lod, r2);
    if (!f || !onView(v, f, 12 * u)) continue;
    const r = Math.min(5 * u, Math.max(2.5 * u, Math.min(f.w, f.h) * 0.3)), cx = f.x + f.w - r - 1.5 * u, cy = f.y + r + 1.5 * u;
    if (!reduced) {
      ctx.strokeStyle = th.alpha(col, 0.7 * (1 - p)); ctx.lineWidth = 1.5 * u;
      ctx.beginPath(); ctx.arc(cx, cy, r * (1 + 1.8 * p), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = th.paper; ctx.beginPath(); ctx.arc(cx, cy, r + 1.2 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** A check mark with a paper halo, so it reads on any stage fill. */
function tick(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: string, halo: string, u: number) {
  ctx.beginPath(); ctx.moveTo(x, y + s * 0.55); ctx.lineTo(x + s * 0.38, y + s * 0.92); ctx.lineTo(x + s, y + s * 0.08);
  ctx.strokeStyle = halo; ctx.lineWidth = 4.5 * u; ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 2 * u; ctx.stroke();
}

