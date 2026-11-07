'use client';
// Direction B, the Site plan: the findings pinned on the building itself. The same walls, wings and rooms as the drawing set
// (the real layout, M.L, scaled to the sheet), the same markers. You choose by where: lasso across rooms, press a room's name
// for all of it, or carry one pin down to the tray. Hovering a wave draws its route through the building, so a wave that
// sprawls or collides is visible as a shape before it is dispatched. The strongest kinship with the plan: the bet is that
// "where does this wave touch" is the question that matters. Rooms flow their pins rather than place them per tile: a tile
// is a thumbnail at this scale, and a pin has to stay big enough to press.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEngine } from '../../hooks';
import type { Finding } from '../useLedger';
import { setLabChoice } from './choice';
import { Line, NewWave, Pin, WaveCard, useCarry, useLab } from './parts';

/** A pin and its gap, and the room's name and padding: how many pins a room can show before it says +n. */
const PIN_BOX = 33, ROOM_HEAD = 30, ROOM_PAD = 16;

function PlanPin({ f, onHover }: { f: Finding; onHover(f: Finding | null, el: HTMLElement | null): void }) {
  const { L, B, focusId } = useLab(), carry = useCarry(), at = B.spot.get(f.p.id), on = L.ui.sel.has(f.p.id);
  return (
    <button type="button" className={'lx-ppin' + (on ? ' on' : '') + (focusId === f.p.id ? ' focus' : '') + (at?.draft ? ' placed' : '')} data-fid={f.p.id} tabIndex={focusId === f.p.id ? 0 : -1} aria-pressed={on} aria-label={f.p.title + ', ' + f.fname} {...carry(f.p.id)}
      onMouseEnter={(e) => onHover(f, e.currentTarget)} onMouseLeave={() => onHover(null, null)}
      onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) L.toggle(f.p.id); else L.setFocus(f.p.id); }}>
      <Pin f={f} px={16} n={at?.draft ? at.n : undefined} mvp={L.mvps.some((m) => m.f.p.id === f.p.id)} />
    </button>
  );
}

export function SitePlan({ brief }: { brief: ReactNode }) {
  const { L, B } = useLab(), M = useEngine().M, G = M.L;
  const box = useRef<HTMLDivElement>(null), [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverWave, setHoverWave] = useState<string | null>(null);
  const [tip, setTip] = useState<{ f: Finding; x: number; y: number } | null>(null);
  const [lasso, setLasso] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [route, setRoute] = useState<{ pts: string; n: number } | null>(null);

  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the plan fitted to the sheet; its wing heads sit in the room above the walls
  const W = G.world, top = 44, s = size.w ? Math.min((size.w - 32) / W.w, (size.h - top - 14) / W.h) : 0;
  const ox = (size.w - W.w * s) / 2 - W.x * s, oy = top + Math.min(24, (size.h - top - W.h * s) / 4) - W.y * s;
  const r = (b: { x: number; y: number; w: number; h: number }) => ({ left: ox + b.x * s, top: oy + b.y * s, width: b.w * s, height: b.h * s });

  // findings by room: the rows the filters keep, and every placed one, so a wave never loses a pin to a filter
  const { byRoom, off } = useMemo(() => {
    const m = new Map<string, Finding[]>(), o: Finding[] = [], seen = new Set<string>();
    const add = (f: Finding) => {
      if (seen.has(f.p.id)) return; seen.add(f.p.id);
      const T = f.fid ? G.TILE[f.fid] : undefined;
      if (!T) { o.push(f); return; }
      const a = m.get(T.room.id); if (a) a.push(f); else m.set(T.room.id, [f]);
    };
    for (const f of L.rows) add(f);
    for (const [id, at] of B.spot) if (at.draft) { const f = L.byId.get(id); if (f) add(f); }
    return { byRoom: m, off: o };
  }, [L.rows, L.byId, B.spot, G]);
  const tiles = useMemo(() => G.tiles.map((t) => 'M' + t.x + ' ' + t.y + 'h' + t.w + 'v' + t.h + 'h' + -t.w + 'z').join(''), [G]);

  // the hovered (or only) wave's route through the building, read off the pins where they actually landed
  const showWave = hoverWave ?? null;
  useLayoutEffect(() => {
    const el = box.current, w = B.waves.find((x) => x.id === showWave);
    if (!el || !w) { setRoute(null); return; }
    const o = el.getBoundingClientRect(), pts: string[] = [];
    const ids = w.packages.flatMap((p) => p.ids);
    const at = ids.flatMap((id) => { const b = el.querySelector('[data-fid="' + CSS.escape(id) + '"]')?.getBoundingClientRect(); return b ? [{ x: b.left - o.left + b.width / 2, y: b.top - o.top + b.height / 2 }] : []; }).sort((a, b) => a.x - b.x);
    for (const p of at) pts.push(Math.round(p.x) + ',' + Math.round(p.y));
    setRoute({ pts: pts.join(' '), n: at.length });
  }, [showWave, B.waves, size]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const o = e.currentTarget.getBoundingClientRect(), x = e.clientX - o.left, y = e.clientY - o.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    setLasso({ x0: x, y0: y, x1: x, y1: y });
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lasso) return;
    const o = e.currentTarget.getBoundingClientRect();
    setLasso({ ...lasso, x1: e.clientX - o.left, y1: e.clientY - o.top });
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lasso) return;
    const o = e.currentTarget.getBoundingClientRect();
    const a = { l: Math.min(lasso.x0, lasso.x1) + o.left, r: Math.max(lasso.x0, lasso.x1) + o.left, t: Math.min(lasso.y0, lasso.y1) + o.top, b: Math.max(lasso.y0, lasso.y1) + o.top };
    setLasso(null);
    if (a.r - a.l < 6 && a.b - a.t < 6) { if (!e.shiftKey) L.clear(); return; }
    const ids: string[] = [];
    e.currentTarget.querySelectorAll<HTMLElement>('[data-fid]').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.right > a.l && b.left < a.r && b.bottom > a.t && b.top < a.b) ids.push(el.dataset.fid!);
    });
    const free = ids.filter((id) => L.byId.get(id)?.can && !B.spot.get(id)?.draft);
    if (free.length) L.select(free, true);
  };

  const hoverPin = (f: Finding | null, el: HTMLElement | null) => {
    const o = box.current?.getBoundingClientRect();
    setTip(f && el && o ? { f, x: el.getBoundingClientRect().left - o.left + 14, y: el.getBoundingClientRect().top - o.top } : null);
  };
  const shown = s > 0;
  return (
    <div className="lx-b">
      <div ref={box} className="lx-plan" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} role="application" aria-label="Findings on the plan. Drag across rooms to select.">
        {shown ? (
          <>
            <svg className="lx-tiles" width={size.w} height={size.h} aria-hidden="true"><path d={tiles} transform={`translate(${ox} ${oy}) scale(${s})`} /></svg>
            {G.wings.map((w) => {
              const n = w.rooms.reduce((k, x) => k + (byRoom.get(x.id)?.length ?? 0), 0), b = r(w);
              return (
                <div key={w.id} className="lx-wing" style={{ left: b.left, top: b.top - 30, width: b.width }}>
                  <span className="lx-letter">{w.def.letter}</span><h3 title={w.def.name}>{w.def.name}</h3>{n ? <b>{n}</b> : null}
                </div>
              );
            })}
            {G.rooms.map((room) => {
              const fs = byRoom.get(room.id) ?? [], can = fs.filter((f) => f.can && !B.spot.get(f.p.id)?.draft).map((f) => f.p.id), b = r(room);
              const fit = Math.max(1, Math.floor((b.width - ROOM_PAD) / PIN_BOX)) * Math.max(1, Math.floor((b.height - ROOM_HEAD) / PIN_BOX));
              const cap = fs.length > fit ? fit - 1 : fit, shownF = fs.slice(0, cap);
              return (
                <section key={room.id} className={'lx-room' + (fs.length ? '' : ' quiet')} style={b} aria-label={room.name}>
                  <button type="button" className="lx-room-h" disabled={!can.length} tabIndex={-1} title={can.length ? 'Select the ' + can.length + ' that can go in ' + room.name : room.name} onClick={() => L.select(can)}>{room.name}</button>
                  <div className="lx-room-p">
                    {shownF.map((f) => <PlanPin key={f.p.id} f={f} onHover={hoverPin} />)}
                    {fs.length > cap ? <button type="button" className="lx-more" tabIndex={-1} title={fs.length - cap + ' more: the Schedule lists them all'} onClick={() => setLabChoice('schedule')}>+{fs.length - cap}</button> : null}
                  </div>
                </section>
              );
            })}
            {off.length ? (
              <section className="lx-off" aria-label="Not on the plan"><span>Off the plan</span>{off.slice(0, 18).map((f) => <PlanPin key={f.p.id} f={f} onHover={hoverPin} />)}</section>
            ) : null}
            {route && route.n > 1 ? <svg className="lx-route" width={size.w} height={size.h} aria-hidden="true"><polyline points={route.pts} /></svg> : null}
            {lasso ? <div className="lx-lasso" style={{ left: Math.min(lasso.x0, lasso.x1), top: Math.min(lasso.y0, lasso.y1), width: Math.abs(lasso.x1 - lasso.x0), height: Math.abs(lasso.y1 - lasso.y0) }} /> : null}
            {tip ? (
              <div className="lx-tip" style={{ left: Math.min(tip.x, size.w - 340), top: Math.max(4, tip.y - 76) }}>
                <b>{tip.f.p.title}</b><span>{tip.f.fname}{L.move(tip.f.p) ? ' · ' + L.move(tip.f.p) : ''}</span>
              </div>
            ) : null}
          </>
        ) : null}
        {L.ui.sel.size ? (
          <div className="lx-selbar" role="status"><b>{L.ui.sel.size}</b> selected <span>carry one to a wave, or press 1-9</span><button type="button" onClick={L.clear}>Clear</button></div>
        ) : null}
      </div>
      <div className="lx-tray">
        <div className="lx-tray-w" aria-label="Waves">
          {B.waves.map((w) => <WaveCard key={w.id} w={w} n={B.drafts.indexOf(w) + 1} form="tray" onHover={setHoverWave} active={hoverWave === w.id} renderItem={(id, p) => <Line key={id} id={id} p={p} />} />)}
          <NewWave form="tray" />
        </div>
        <div className="lx-brief">{brief}</div>
      </div>
    </div>
  );
}
