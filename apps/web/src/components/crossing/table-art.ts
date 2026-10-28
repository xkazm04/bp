// The table's plan of a place, drawn in this page the way the VR table draws it (UE, its own renderer, the same plan data):
// ultramarine glass with a ruled grid, rooms and bays as lit glass walls, features as desks with a lamp light over the
// ones in trouble, the title block, the crumb along the near edge and the key plan. It is a web mock of the table's
// look, from the real layout of the place (the same boxes the web plan draws), so the place lands where it was.
import type { Box, RoomNode } from '@bp/core/model';
import type { CrossPlace, NextPlace } from './place';
import type { Engine } from '@/engine/Engine';

export const ART_W = 1600, ART_H = 900;

/** A glass box that rises out of the table (art px); `walls` = only its four walls (a bay), else a slab with a lid (a room). */
export interface Rise { x: number; y: number; w: number; h: number; z: number; walls: boolean; hot: boolean; next: boolean }
/** A lamp light over a feature in trouble (art px). */
export interface Light { x: number; y: number; bad: boolean }
export interface TableArt { canvas: HTMLCanvasElement; rises: Rise[]; lights: Light[]; title: string; sub: string }

const FONT = '"IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif';
const CYAN = '#7fe6ff', EDGE = '#c9f4ff', AMBER = '#ffc35a', RED = '#ff8a78';

function glass(g: CanvasRenderingContext2D) {
  const bg = g.createRadialGradient(ART_W * 0.5, ART_H * 0.42, 40, ART_W * 0.5, ART_H * 0.5, ART_W * 0.62);
  bg.addColorStop(0, '#2a62b4'); bg.addColorStop(0.5, '#1a4790'); bg.addColorStop(1, '#0d2759');
  g.fillStyle = bg; g.fillRect(0, 0, ART_W, ART_H);
  for (const [step, a] of [[20, 0.07], [100, 0.16]] as const) {
    g.strokeStyle = `rgba(214,240,255,${a})`; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x <= ART_W; x += step) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, ART_H); }
    for (let y = 0; y <= ART_H; y += step) { g.moveTo(0, y + 0.5); g.lineTo(ART_W, y + 0.5); }
    g.stroke();
  }
}

/** A lit glass line: a wide bloom, a narrower one, the bright core. */
function litRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, core: number, hot = false) {
  g.save(); g.lineJoin = 'round';
  g.strokeStyle = hot ? 'rgba(255,214,140,0.16)' : 'rgba(79,210,255,0.14)'; g.lineWidth = core + 16; g.strokeRect(x, y, w, h);
  g.strokeStyle = hot ? 'rgba(255,214,140,0.34)' : 'rgba(79,210,255,0.32)'; g.lineWidth = core + 6; g.strokeRect(x, y, w, h);
  g.strokeStyle = hot ? '#ffe6b8' : EDGE; g.lineWidth = core; g.strokeRect(x, y, w, h);
  g.restore();
}

function wrap(g: CanvasRenderingContext2D, s: string, maxW: number, lines: number): string[] {
  const words = s.split(' '), out: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width <= maxW || !cur) cur = t;
    else { out.push(cur); cur = w; if (out.length === lines - 1) break; }
  }
  const used = out.join(' ').split(' ').length + (cur ? cur.split(' ').length : 0);
  if (cur) out.push(used < words.length ? cur + '…' : cur);
  return out.slice(0, lines);
}

/** The desk glyph the table draws for a feature: a table top and two chairs, seen from above at a slant. */
function desk(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.save();
  g.fillStyle = 'rgba(230,246,255,0.9)'; g.strokeStyle = 'rgba(30,70,130,0.9)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(cx - 34 * s, cy - 6 * s); g.lineTo(cx + 34 * s, cy - 6 * s); g.lineTo(cx + 40 * s, cy + 6 * s); g.lineTo(cx - 40 * s, cy + 6 * s); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = 'rgba(200,232,250,0.85)';
  for (const dx of [-18, 18]) { g.fillRect(cx + dx * s - 7 * s, cy + 9 * s, 14 * s, 9 * s); g.strokeRect(cx + dx * s - 7 * s, cy + 9 * s, 14 * s, 9 * s); }
  g.restore();
}

function fit(box: Box, area: Box): { s: number; ox: number; oy: number } {
  const s = Math.min(area.w / box.w, area.h / box.h);
  return { s, ox: area.x + (area.w - box.w * s) / 2 - box.x * s, oy: area.y + (area.h - box.h * s) / 2 - box.y * s };
}

function keyPlan(g: CanvasRenderingContext2D, E: Engine, room: RoomNode | null, wingId: string | null) {
  const L = E.M.L, area = { x: ART_W - 270, y: ART_H - 190, w: 220, h: 120 }, f = fit(L.world, area);
  g.save();
  g.font = `500 15px ${FONT}`; g.fillStyle = 'rgba(214,240,255,0.7)'; g.fillText('KEY PLAN', area.x, area.y - 10);
  for (const r of L.rooms) {
    const x = r.x * f.s + f.ox, y = r.y * f.s + f.oy, w = r.w * f.s, h = r.h * f.s, on = r === room || (!room && r.wing.id === wingId);
    g.fillStyle = on ? 'rgba(255,214,140,0.85)' : 'rgba(127,230,255,0.08)'; g.fillRect(x, y, w, h);
    g.strokeStyle = on ? '#ffe6b8' : 'rgba(201,244,255,0.55)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  g.restore();
}

function titleBlock(g: CanvasRenderingContext2D, title: string, sub: string) {
  g.save();
  g.font = `italic 600 30px ${FONT}`; const tw = g.measureText(title).width;
  g.font = `italic 500 17px ${FONT}`; const sw = g.measureText(sub).width;
  const w = Math.max(tw, sw) + 40, x = 40, y = ART_H - 168;
  g.strokeStyle = 'rgba(201,244,255,0.6)'; g.lineWidth = 1.5; g.strokeRect(x, y, w, 76);
  g.fillStyle = 'rgba(10,30,70,0.35)'; g.fillRect(x, y, w, 76);
  g.fillStyle = '#eaf8ff'; g.font = `italic 600 30px ${FONT}`; g.fillText(title, x + 20, y + 38);
  g.fillStyle = 'rgba(214,240,255,0.8)'; g.font = `italic 500 17px ${FONT}`; g.fillText(sub, x + 20, y + 63);
  g.restore();
}

function crumbLine(g: CanvasRenderingContext2D, crumbs: readonly string[]) {
  g.save();
  g.font = `500 34px ${FONT}`; g.fillStyle = 'rgba(234,248,255,0.92)'; g.textAlign = 'center';
  g.fillText(crumbs.join('  ›  '), ART_W / 2, ART_H - 34);
  g.restore();
}

/** The room plan: the room's bays as lit zones, its features as desks, at the room's own layout. */
function roomArt(g: CanvasRenderingContext2D, E: Engine, p: CrossPlace, next: NextPlace | null, rises: Rise[], lights: Light[]) {
  const R = p.room!, area = { x: 70, y: 70, w: ART_W - 140, h: ART_H - 300 };
  const f = fit({ x: R.x, y: R.y + 30, w: R.w, h: R.h - 30 }, area), s = f.s;
  const X = (x: number) => x * s + f.ox, Y = (y: number) => y * s + f.oy;
  for (const B of R.bays) {
    const x = X(B.x) + 6, y = Y(B.y) + 4, w = B.w * s - 12, h = B.h * s - 8;
    const hot = B === p.bay && !p.tile, nx = !!next && next.bay === B;
    g.fillStyle = hot ? 'rgba(255,214,140,0.06)' : 'rgba(127,230,255,0.04)'; g.fillRect(x, y, w, h);
    litRect(g, x, y, w, h, 2.4, hot);
    g.save(); g.font = `italic 600 22px ${FONT}`; g.fillStyle = hot ? '#ffe6b8' : 'rgba(234,248,255,0.92)';
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '3px';
    g.fillText(B.name.toUpperCase(), x + 14, y + 30); g.restore();
    rises.push({ x, y, w, h, z: 18, walls: true, hot, next: nx });
    for (const T of B.tiles) {
      // a desk, its name and its flags, kept inside the tile: the desk in the upper third, the name under it in as many
      // lines as the tile has room for, the flag count last
      const tx = X(T.x), ty = Y(T.y), tw = T.w * s, th = T.h * s, tr = T.f.trouble.length, bad = T.f.trouble.some((t) => t.h === 'bad');
      const here = p.tile === T, ds = Math.max(0.5, Math.min(1.15, th / 120));
      const cx = tx + tw / 2, cy = ty + Math.max(18 * ds, th * 0.26);
      if (here) { litRect(g, tx + 4, ty + 4, tw - 8, th - 8, 2, true); rises.push({ x: tx + 4, y: ty + 4, w: tw - 8, h: th - 8, z: 10, walls: true, hot: true, next: false }); }
      desk(g, cx, cy, ds);
      if (tr) lights.push({ x: cx, y: cy - 4 * ds, bad });
      const fs = Math.round(Math.max(14, Math.min(23, th * 0.19))), fl = tr ? Math.max(13, fs - 6) : 0;
      const top = cy + 24 * ds, room = ty + th - 6 - top - (tr ? fl + 4 : 0);
      g.save(); g.textAlign = 'center';
      g.font = `italic 500 ${fs}px ${FONT}`; g.fillStyle = '#eef9ff';
      const lines = wrap(g, T.f.name, tw - 20, Math.max(1, Math.floor(room / (fs * 1.08))));
      lines.forEach((l, i) => g.fillText(l, cx, top + fs * 0.9 + i * fs * 1.08));
      if (tr) { g.font = `600 ${fl}px ${FONT}`; g.fillStyle = bad ? RED : AMBER; g.fillText(tr + ' FLAGGED', cx, top + fs * 0.9 + (lines.length - 1) * fs * 1.08 + fl + 4); }
      g.restore();
    }
  }
}

/** The site plan: every room a glass slab at the web plan's own layout, the wings named over them. */
function siteArt(g: CanvasRenderingContext2D, E: Engine, p: CrossPlace, next: NextPlace | null, rises: Rise[], lights: Light[]) {
  const L = E.M.L, area = { x: 80, y: 120, w: ART_W - 160, h: ART_H - 330 };
  const f = fit(L.world, area), s = f.s;
  const X = (x: number) => x * s + f.ox, Y = (y: number) => y * s + f.oy;
  g.save(); g.font = `italic 600 20px ${FONT}`; g.fillStyle = 'rgba(234,248,255,0.92)';
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '2px';
  for (const W of L.wings) g.fillText(W.def.letter + '  ' + W.def.name.toUpperCase(), X(W.x) + 4, Y(W.y) - 14);
  g.restore();
  for (const R of L.rooms) {
    const x = X(R.x) + 5, y = Y(R.y) + 5, w = R.w * s - 10, h = R.h * s - 10;
    const hot = !!p.wing && R.wing === p.wing, nx = !!next && next.room === R;
    litRect(g, x, y, w, h, 1.8, hot);
    g.save(); g.font = `italic 500 16px ${FONT}`; g.fillStyle = 'rgba(234,248,255,0.85)';
    wrap(g, R.name, w - 16, 2).forEach((l, i) => g.fillText(l, x + 8, y + 22 + i * 18)); g.restore();
    rises.push({ x, y, w, h, z: 14 + Math.min(16, R.feats.length * 1.4), walls: false, hot, next: nx });
    const tr = R.feats.filter((ft) => ft.trouble.length), bad = tr.some((ft) => ft.trouble.some((t) => t.h === 'bad'));
    if (tr.length) lights.push({ x: x + w - 18, y: y + 18, bad });
  }
}

export function drawTable(E: Engine, p: CrossPlace, next: NextPlace | null): TableArt {
  const c = document.createElement('canvas');
  c.width = ART_W; c.height = ART_H;
  const g = c.getContext('2d')!, rises: Rise[] = [], lights: Light[] = [];
  glass(g);
  let title: string, sub: string;
  const flagged = (fs: readonly { trouble: readonly unknown[] }[]) => fs.filter((f) => f.trouble.length).length;
  if (p.room) {
    roomArt(g, E, p, next, rises, lights);
    title = 'ROOM PLAN — ' + p.room.name.toUpperCase();
    sub = 'WING ' + p.room.wing.def.letter + ' · ' + p.room.bays.length + ' BAYS · ' + p.room.feats.length + ' FEATURES · ' + flagged(p.room.feats) + ' FLAGGED';
  } else {
    siteArt(g, E, p, next, rises, lights);
    title = 'SITE PLAN — LEVEL 0';
    sub = E.M.L.wings.length + ' WINGS · ' + E.M.L.rooms.length + ' ROOMS · ' + E.M.P.features.length + ' FEATURES';
  }
  titleBlock(g, title, sub);
  crumbLine(g, p.crumbs.slice(0, p.room ? 3 : 2));
  keyPlan(g, E, p.room, p.wing?.id ?? null);
  // the scale bar, as the table draws it
  g.save(); g.strokeStyle = 'rgba(214,240,255,0.7)'; g.fillStyle = 'rgba(214,240,255,0.7)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(ART_W - 520, ART_H - 120); g.lineTo(ART_W - 330, ART_H - 120); g.stroke();
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(ART_W - 520 + i * 47.5, ART_H - 128); g.lineTo(ART_W - 520 + i * 47.5, ART_H - 112); g.stroke(); }
  g.restore();
  return { canvas: c, rises, lights, title, sub };
}
