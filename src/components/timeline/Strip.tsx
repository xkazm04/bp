'use client';
// The collapsed timeline: one thin strip along the bottom that still tells the essentials at a glance -
// where in time the plan is ("now" or the travelled date), a hairline of the revision history (click or
// drag it to travel), and the sim clock (Kettle) or the scan's run status (a live product). Clicking the
// strip anywhere but the hairline expands the full panel; the strip never expands on hover.
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SWARM } from '@/lib/data';
import { HOUR, dnum, fmtD, latestRun, revAt } from '@/lib/model';
import { shallowEqual, useBp, useEngine, useLive } from '../hooks';

const ARRIVALS = SWARM.decisions.filter((d) => d.arrivesAt).map((d) => d.arrivesAt!);

/** The sim clock (Kettle) or the latest run (live product), as one line of small text. */
function StripClock() {
  const E = useEngine(), sim = E.M.sim, live = useLive();
  const s = useBp((s) => ({ playing: s.playing, speed: s.speed, over: s.over, now: s.t === E.M.P.asOf, v: s.simV }), shallowEqual);
  const tref = useRef<HTMLSpanElement>(null);
  useEffect(() => (sim.has && !sim.live ? E.onSimTime((t) => { if (tref.current) tref.current.textContent = new Date(sim.at0 + t * 1000).toISOString().slice(11, 19); }) : undefined), [E, sim]);
  if (!sim.has) return null;
  if (sim.live) {
    const run = latestRun(live?.product.scan), off = live?.product.status === 'offline';
    const st = !run ? 'NO RUN' : off ? 'OFFLINE' : run.status === 'running' ? '● LIVE · ' + run.phase.toUpperCase() : run.status.toUpperCase();
    const tone = off ? 'warn' : run?.status === 'running' ? 'on' : '';
    return (
      <span className="tl-clk" title={run ? run.id + ' · ' + run.lenses.join(' · ') : 'Waiting for /lens-scan'}>
        <span className="tl-k">SCAN</span><span className={'tl-st ' + tone}>{st}</span>
        {run && <span className="tl-dim">{run.started_at.slice(5, 10) + ' ' + run.started_at.slice(11, 16)} UTC</span>}
      </span>
    );
  }
  const st = !s.now ? 'HISTORY' : s.over ? 'ENDED' : s.playing ? '● ×' + s.speed : 'PAUSED';
  const tone = !s.now ? 'warn' : s.playing && !s.over ? 'on' : '';
  return (
    <span className="tl-clk" title="The simulated hour (expand the timeline for speed controls)">
      <span className="tl-hm" ref={tref}>09:00:00</span><span className="tl-dim">UTC</span><span className={'tl-st ' + tone}>{st}</span>
    </span>
  );
}

/** The hairline: revision history (a sparkline of feature counts, a tick per week) and, for Kettle, the hour ahead. */
function Hairline() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const t = useBp((s) => s.t);
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const head = useRef<SVGLineElement>(null), el = useRef<SVGRectElement>(null);
  const [W, setW] = useState(600), [H, setH] = useState(26);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => { if (wrap.current) { setW(wrap.current.clientWidth || 600); setH(wrap.current.clientHeight || 26); } });
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const hour = sim.has && !sim.live, asOf = M.P.asOf, weeks = M.P.weeks, RD0 = weeks[0], now = t === asOf;
  const L = 4, R = W - 4, gap = hour ? 14 : 0, hourW = hour ? Math.round((R - L) * 0.24) : 0;
  const h0 = L, h1 = R - hourW - gap, o0 = h1 + gap, o1 = R, top = 4, bot = H - 6;
  // a map with one week of history has no span: everything sits at "now", the right end
  const span = dnum(asOf) - dnum(RD0), hx = (d: string) => (span > 0 ? h0 + ((dnum(d) - dnum(RD0)) / span) * (h1 - h0) : h1);
  const ox = (s: number) => o0 + (Math.max(0, Math.min(HOUR, s)) / HOUR) * (o1 - o0);
  useEffect(() => (hour ? E.onSimTime((s) => {
    const x = ox(s);
    head.current?.setAttribute('x1', String(x)); head.current?.setAttribute('x2', String(x));
    el.current?.setAttribute('width', String(Math.max(0, x - o0)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }) : undefined), [E, W, H, hour]);
  const snaps = M.P.snapshots, max = Math.max(...snaps.map((x) => x.total)) || 1;
  const pts = snaps.map((sn) => hx(sn.week).toFixed(1) + ',' + (bot - (sn.total / max) * (bot - top)).toFixed(1));
  const line = pts.length > 1 ? 'M' + pts.join(' L') : '';
  const area = line ? line + ` L${hx(snaps[snaps.length - 1].week).toFixed(1)},${bot} L${hx(snaps[0].week).toFixed(1)},${bot}Z` : '';
  const m1 = M.P.milestones.find((m) => m.state === 'done'), xt = Math.min(hx(t), h1);
  const drag = useRef<'h' | 'o' | null>(null);
  const apply = (x: number) => {
    if (hour && x >= o0 - 4 && drag.current !== 'h') { drag.current = 'o'; E.seek(((x - o0) / (o1 - o0)) * HOUR); return; }
    if (drag.current === 'o') return;
    drag.current = 'h';
    let best = weeks[0], bd = 1e9;
    for (const w of weeks) { const d = Math.abs(hx(w) - x); if (d < bd) { bd = d; best = w; } }
    if (x > h1 - 3) best = asOf;
    E.setTime(best);
  };
  const px = (e: React.PointerEvent) => { const r = svg.current!.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  const rev = revAt(weeks, t);
  return (
    <div className="tl-line" ref={wrap}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} tabIndex={0} role="slider" data-keys="own"
        aria-label="Time: drag along the revision history to travel; the right end is now" aria-valuemin={1} aria-valuemax={weeks.length} aria-valuenow={rev} aria-valuetext={now ? 'Now, revision ' + rev : 'Revision ' + rev + ', ' + t}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => { e.stopPropagation(); drag.current = null; (e.currentTarget as Element).setPointerCapture(e.pointerId); apply(px(e)); }}
        onPointerMove={(e) => { if (drag.current) apply(px(e)); }} onPointerUp={() => { drag.current = null; }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); E.stepWeek(-1); }
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); E.stepWeek(1); }
          else if (e.key === 'Home') { e.preventDefault(); E.setTime(weeks[0]); }
          else if (e.key === 'End') { e.preventDefault(); E.setTime(asOf); }
          else if (e.key === 't' || e.key === 'T') { e.preventDefault(); E.setTimeline(); }
          else if (e.key === 'Escape') { e.preventDefault(); if (E.store.get().tl) E.setTimeline(false); else if (!now) E.setTime(asOf); else (e.currentTarget as SVGSVGElement).blur(); }
        }}>
        <rect className="tl-hit" x={0} y={0} width={W} height={H} />
        {area && <path className="tl-area" d={area} />}
        {line && <path className="tl-spark" d={line} />}
        <line className="tl-base" x1={h0} y1={bot} x2={h1} y2={bot} />
        {weeks.map((w) => { const x = hx(w); return <line key={w} className="tl-tick" x1={x} y1={bot} x2={x} y2={bot + 3} />; })}
        {m1 && m1.date >= RD0 && <line className="tl-ms" x1={hx(m1.date)} y1={top - 2} x2={hx(m1.date)} y2={bot}><title>{m1.name + ' · done'}</title></line>}
        {hour && (
          <g className="tl-hour">
            <line className="tl-hbase" x1={o0} y1={bot} x2={o1} y2={bot} />
            <rect ref={el} className="tl-hel" x={o0} y={top} width={0} height={bot - top} />
            {ARRIVALS.map((a, i) => <line key={i} className="tl-arr" x1={ox(a)} y1={bot - 7} x2={ox(a)} y2={bot} />)}
            <line ref={head} className="tl-hhead" x1={o0} x2={o0} y1={top - 2} y2={bot + 3} />
          </g>
        )}
        <g className={'tl-handle' + (now ? ' now' : '')}>
          <line x1={xt} y1={1} x2={xt} y2={H - 1} />
          <path d={`M${xt - 4} ${H} l4 -5 l4 5z`} />
        </g>
      </svg>
      {!now && <span className="tl-flag" style={{ left: Math.max(0, Math.min(xt - 40, W - 84)) }}>{fmtD(t)}</span>}
    </div>
  );
}

/** The strip itself. `open` = the panel is expanded above it. */
export const Strip = forwardRef<HTMLButtonElement, { open: boolean }>(function Strip({ open }, toggleRef) {
  const E = useEngine(), M = E.M;
  const t = useBp((s) => s.t), now = t === M.P.asOf, rev = revAt(M.P.weeks, t);
  return (
    <div id="base" className={'tl-strip' + (now ? '' : ' travel') + (open ? ' open' : '')} onClick={() => E.setTimeline()}>
      <button ref={toggleRef} type="button" className="tl-exp" aria-expanded={open} aria-controls="tlpanel" title={(open ? 'Collapse' : 'Expand') + ' the timeline (T)'}
        onClick={(e) => { e.stopPropagation(); E.setTimeline(); }}>
        <span className="tl-chev" aria-hidden>{open ? '▾' : '▴'}</span>TIMELINE<kbd>T</kbd>
      </button>
      {now
        ? <span className="tl-pos"><b>NOW</b><span className="tl-dim">REV {rev} · {fmtD(t)}</span></span>
        : (
          <span className="tl-pos" role="status">
            <b>VIEWING {t}</b><span className="tl-dim">REV {rev} of {M.P.weeks.length}</span>
            <button type="button" className="tl-back" onClick={(e) => { e.stopPropagation(); E.setTime(M.P.asOf); }} title="Back to now (Esc on the hairline)">BACK TO NOW ▸</button>
          </span>
        )}
      <StripClock />
      <Hairline />
    </div>
  );
});
