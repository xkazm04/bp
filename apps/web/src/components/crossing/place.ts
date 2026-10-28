// Where the person is on the desk, as the crossing carries it: the page's own hash (the web's place currency, written by
// Engine.hashOf) plus the explicit target the companion's focus already uses, and the room the table opens at. The table
// maps L3 (a bay) and L4 (a feature) to their room, as the design says; L0 and L1 open the site.
import type { Engine } from '@/engine/Engine';
import type { BayNode, RoomNode, TileNode, WingNode } from '@bp/core/model';

export interface CrossPlace {
  /** 0 site, 1 wing, 2 room, 3 bay, 4 feature. */
  level: 0 | 1 | 2 | 3 | 4;
  /** The page's hash at the moment it armed the baton. */
  hash: string;
  /** The target the baton names, in the companion's focus kinds. */
  target: { kind: 'feature' | 'room' | 'wing' | 'site'; id: string };
  wing: WingNode | null; room: RoomNode | null; bay: BayNode | null; tile: TileNode | null;
  /** The crumbs as the header reads them. */
  crumbs: string[];
  /** What the lamp says when it names the place. */
  name: string;
  lens: string;
  product: string;
  /** When the page armed the baton (ISO). */
  at: string;
}

/** Where the table leads next in the demo (the person dives one place deeper on the table; the page follows). */
export interface NextPlace { hash: string; name: string; bay: BayNode | null; room: RoomNode | null; level: 2 | 3 }

export function placeOf(E: Engine): CrossPlace {
  const S = E.S, L = E.M.L;
  let wing: WingNode | null = null, room: RoomNode | null = null, bay: BayNode | null = null, tile: TileNode | null = null;
  if (S.open && L.TILE[S.open]) { tile = L.TILE[S.open]; bay = tile.bay; room = tile.room; wing = tile.wing; }
  else for (const c of S.place) {
    if (c.t === 'wing') wing = L.WING[c.id] ?? wing;
    else if (c.t === 'room') { room = L.ROOM[c.id] ?? room; if (room) wing = room.wing; }
    else if (c.t === 'bay') { bay = L.BAY[c.id] ?? bay; if (bay) { room = bay.room; wing = room.wing; } }
  }
  const level = tile ? 4 : bay ? 3 : room ? 2 : wing ? 1 : 0;
  const crumbs = [E.M.P.name];
  if (wing) crumbs.push(wing.def.letter + ' ' + wing.def.name);
  if (room) crumbs.push(room.name);
  if (bay) crumbs.push(bay.name);
  if (tile) crumbs.push(tile.f.name);
  const name = tile ? tile.f.name : bay ? bay.name + ' · ' + room!.name : room ? room.name : wing ? wing.def.name : E.M.P.name + ' · the whole site';
  const target: CrossPlace['target'] = tile ? { kind: 'feature', id: tile.f.id } : room ? { kind: 'room', id: room.id } : wing ? { kind: 'wing', id: wing.id } : { kind: 'site', id: E.M.P.name.toLowerCase() };
  return { level, hash: location.hash || '#', target, wing, room, bay, tile, crumbs, name, lens: S.view, product: E.M.live?.slug ?? 'kettle', at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
}

/** The next place the table goes to: another bay of the same room (most flags first), or at the site the room in most trouble. */
export function nextOf(E: Engine, p: CrossPlace): NextPlace | null {
  const flagged = (fs: readonly { trouble: readonly unknown[] }[]) => fs.reduce((n, f) => n + f.trouble.length, 0);
  const keep = (id: string) => {
    const h = new URLSearchParams(location.hash.slice(1));
    h.delete('open'); h.set('at', id);
    return '#' + h.toString().replace(/%3A/g, ':');
  };
  if (p.room) {
    const others = p.room.bays.filter((b) => b !== p.bay);
    const b = others.sort((a, c) => flagged(c.feats) - flagged(a.feats))[0];
    if (!b) return null;
    return { hash: keep(b.id), name: b.name + ' · ' + p.room.name, bay: b, room: p.room, level: 3 };
  }
  const rooms = (p.wing ? p.wing.rooms : E.M.L.rooms).slice().sort((a, c) => flagged(c.feats) - flagged(a.feats));
  const r = rooms[0];
  return r ? { hash: keep(r.id), name: r.name, bay: null, room: r, level: 2 } : null;
}

/**
 * The page as the person sees it, from the live canvas: the paper the CSS draws under it, the plan the engine drew, and the
 * header's crumbs (the chrome is DOM, so it is drawn here as a sketch of itself). 1600 x 900, cover-fitted.
 */
export function capturePage(crumbs: readonly string[], sub: string, sheet?: { code: string; name: string; stage: string; lines: readonly string[] }): HTMLCanvasElement {
  const W = 1600, H = 900, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const cs = getComputedStyle(document.documentElement), v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  const bg = g.createRadialGradient(W * 0.42, H * 0.5, 0, W * 0.42, H * 0.5, W * 0.62);
  bg.addColorStop(0, v('--paper-core', '#2162ad')); bg.addColorStop(0.35, v('--paper-hi', '#1a4c8f')); bg.addColorStop(0.7, v('--paper', '#0a2149')); bg.addColorStop(1, v('--paper-lo', '#06142e'));
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const src = document.querySelector<HTMLCanvasElement>('canvas.bp-map');
  if (src && src.width && src.height) {
    const s = Math.max(W / src.width, H / src.height), dw = src.width * s, dh = src.height * s;
    g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  // the chrome, sketched: the header scrim and crumbs, the rail, the bottom bars, the frame
  const ink = v('--ink', '#dff0ff');
  const scrim = v('--scrim', 'rgba(5,22,46,0.97)'), card = v('--card', 'rgba(6,24,48,0.96)');
  const sg = g.createLinearGradient(0, 0, 0, 96);
  sg.addColorStop(0, scrim); sg.addColorStop(0.65, scrim); sg.addColorStop(1, 'transparent');
  g.fillStyle = sg; g.fillRect(0, 0, W, 96);
  g.fillStyle = ink; g.font = '600 26px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
  g.fillText(crumbs.map((x) => x.toUpperCase()).join('  ›  '), 22, 52);
  g.globalAlpha = 0.75; g.font = '500 17px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif'; g.fillText(sub, 22, 80); g.globalAlpha = 1;
  g.fillStyle = card; g.fillRect(W - 82, 86, 70, H - 160); g.fillRect(14, H - 64, W - 28, 50);
  // at L4 the person reads the feature sheet, a DOM page over the plan: sketched here as the document it is
  if (sheet) {
    const x = 120, y = 110, w = W - 300, h = H - 200;
    g.fillStyle = v('--sheet-b', '#082246'); g.fillRect(x, y, w, h);
    g.strokeStyle = v('--ink-3', 'rgba(223,240,255,0.38)'); g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.fillStyle = v('--ink-2', 'rgba(223,240,255,0.74)'); g.font = '500 20px "IBM Plex Mono", Consolas, monospace'; g.fillText(sheet.code + '  ·  ' + sheet.stage.toUpperCase(), x + 36, y + 56);
    g.fillStyle = v('--ink-hi', '#ffffff'); g.font = '600 46px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif'; g.fillText(sheet.name, x + 36, y + 116);
    g.fillStyle = v('--ink-2', 'rgba(223,240,255,0.74)'); g.font = '400 22px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
    sheet.lines.forEach((l, i) => g.fillText(l, x + 36, y + 176 + i * 36));
    g.fillStyle = v('--ink-4', 'rgba(223,240,255,0.16)');
    for (let i = 0; i < 6; i++) g.fillRect(x + 36, y + 176 + sheet.lines.length * 36 + 30 + i * 34, (w - 72) * (0.55 + ((i * 37) % 40) / 100), 12);
  }
  g.strokeStyle = v('--rim', '#e6fbff'); g.globalAlpha = 0.6; g.lineWidth = 2; g.strokeRect(5, 5, W - 10, H - 10); g.globalAlpha = 1;
  return c;
}

/** Wait for the engine's camera to arrive after a hash route (or give up after `max` ms). */
export function arrived(E: Engine, max = 2500): Promise<void> {
  const t0 = performance.now();
  return new Promise((res) => {
    const step = () => {
      if ((!E.cam.flying && performance.now() - t0 > 250) || performance.now() - t0 > max) { setTimeout(res, 180); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
