'use client';
// The timeline. Collapsed (default) it is a thin strip (timeline/Strip.tsx) whose height sets the plan's
// safe area (chrome.baseHeight). Expanded (a click on the strip, or T; again / Esc / T collapses) a panel
// slides up OVER the plan with the full content: key plan, the simulated hour's clock (1x..240x) and the
// revisions chart with the next-hour histogram, entering staggered. The clock text and the hour head are written straight to the DOM from the
// engine's sim-time callback; React only re-renders on discrete changes (speed, play, time travel).
// A live product has no recorded hour: the clock box shows the scan instead, and the strip drops the
// hour ahead (no replay to scrub, no arrivals).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { SWARM } from '@/lib/data';
import { GA_MILESTONE, HOUR, SPEEDS, dnum, fmtD, latestRun, revAt } from '@/lib/model';

const ARRIVALS = SWARM.decisions.filter((d) => d.arrivesAt).map((d) => ({ id: d.id, t: d.arrivesAt! }));
import { shallowEqual, useBp, useEngine, useLive } from './hooks';
import { Strip } from './timeline/Strip';
import './timeline.css';

/** One staggered item of the panel (the panel's variants drive it). */
const ITEM: Variants = { hide: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.2, 0.7, 0.2, 1] } } };
const ITEM_RM: Variants = { hide: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0 } } };
function useItem(): Variants { return useReducedMotion() ? ITEM_RM : ITEM; }

function KeyPlanBox() {
  const E = useEngine();
  const ref = useRef<HTMLCanvasElement>(null), zref = useRef<HTMLSpanElement>(null);
  useEffect(() => { E.setKeyplan(ref.current); return () => E.setKeyplan(null); }, [E]);
  useEffect(() => E.onFrame(() => { const z = '×' + (E.cam.k / E.HOME.k).toFixed(1); if (zref.current && zref.current.textContent !== z) zref.current.textContent = z; }), [E]);
  return (
    <motion.button variants={useItem()} id="keyplan" type="button" title="Key plan: click to move there" onClick={(e) => { const r = ref.current!.getBoundingClientRect(); E.keyplanClick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }}>
      <div className="lab"><span>KEY PLAN</span><span ref={zref} /></div>
      <canvas ref={ref} />
    </motion.button>
  );
}

/** The clock box for a live product: the latest run, its phase and lenses, and its agents. */
function LiveClock() {
  const E = useEngine(), live = useLive(), sim = E.M.sim;
  useBp((s) => s.simV);
  const run = latestRun(live?.product.scan), off = live?.product.status === 'offline';
  const st = !run ? 'NO RUN' : off ? 'OFFLINE' : run.status === 'running' ? '● LIVE · ' + run.phase.toUpperCase() : run.status.toUpperCase();
  return (
    <motion.div variants={useItem()} id="clock" className="live">
      <div className="t"><span>Lens scan</span><span style={{ color: off ? 'var(--amber)' : run?.status === 'running' ? 'var(--mint)' : 'var(--ink)' }}>{st}</span></div>
      <div className="hm" title={run?.id}>{run ? (run.started_at.slice(5, 10) + ' ' + run.started_at.slice(11, 16)) : '—'}<small>{run ? 'UTC START' : ''}</small></div>
      <div className="lv">{run ? run.lenses.join(' · ') + ' · ' + sim.agents.length + ' agent' + (sim.agents.length === 1 ? '' : 's') : 'Waiting for /lens-scan'}</div>
    </motion.div>
  );
}

function Clock() {
  const E = useEngine(), sim = E.M.sim;
  const s = useBp((s) => ({ playing: s.playing, speed: s.speed, over: s.over, t: s.t }), shallowEqual);
  const tref = useRef<HTMLSpanElement>(null), item = useItem();
  useEffect(() => E.onSimTime((t) => { if (tref.current) tref.current.textContent = new Date(sim.at0 + t * 1000).toISOString().slice(11, 19); }), [E, sim]);
  if (!sim.has) return null;
  if (sim.live) return <LiveClock />;
  const hist = s.t !== E.M.P.asOf;
  const status = hist ? 'HISTORY · PAUSED' : s.over ? 'ENDED' : s.playing ? '● LIVE · ×' + s.speed : 'PAUSED';
  return (
    <motion.div variants={item} id="clock">
      <div className="t"><span>Sim hour</span><span style={{ color: hist ? 'var(--amber)' : s.playing && !s.over ? 'var(--mint)' : 'var(--ink)' }}>{status}</span></div>
      <div className="hm"><span ref={tref}>09:00:00</span><small>UTC</small></div>
      <div className="ctl">
        <button type="button" className="pp" aria-label="Play or pause the swarm (Space)" onClick={() => E.togglePlay()}>{s.playing && !hist ? '❚❚' : '▶'}</button>
        {SPEEDS.map((n) => <button key={n} type="button" aria-pressed={s.speed === n} title={'Run at ' + n + '× speed'} onClick={() => E.setSpeed(n)}>{n}×</button>)}
        <button type="button" title="Replay the hour from the start" aria-label="Replay the hour" onClick={() => E.restart()}>↺</button>
      </div>
    </motion.div>
  );
}

const ORDER = ['live', 'flagged', 'in-review', 'in-dev', 'specified', 'idea', 'deprecated'] as const;
const FILLS: Record<(typeof ORDER)[number], number> = { live: 0.62, flagged: 0.44, 'in-review': 0.3, 'in-dev': 0.2, specified: 0.11, idea: 0.06, deprecated: 0.5 };

function Revisions() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ t: s.t, compact: s.compact }), shallowEqual);
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const head = useRef<SVGLineElement>(null), tri = useRef<SVGPathElement>(null), el = useRef<SVGRectElement>(null);
  const [W, setW] = useState(640), [H, setH] = useState(92);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => { if (wrap.current) { setW(wrap.current.clientWidth || 640); setH(wrap.current.clientHeight || 92); } });
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const L = 76, R = W - 6, avail = R - L, hist = Math.round(avail * 0.46), hourW = Math.round(avail * 0.38), g1 = 26;
  const tl = { h0: L, h1: L + hist, o0: L + hist + g1, o1: L + hist + g1 + hourW, R, top: H < 80 ? 21 : 34, bot: H < 80 ? H - 28 : Math.min(H - 28, 66) };
  const asOf = M.P.asOf, now = s.t === asOf, top = tl.top, bot = tl.bot, RD0 = M.P.weeks[0], NW = M.P.weeks.length;
  // `|| 1`: a map without an events log has one week of history (a live product often), not a span
  const hx = (d: string) => tl.h0 + ((dnum(d) - dnum(RD0)) / (dnum(asOf) - dnum(RD0) || 1)) * (tl.h1 - tl.h0);
  const ox = (t: number) => tl.o0 + (Math.max(0, Math.min(HOUR, t)) / HOUR) * (tl.o1 - tl.o0);
  useEffect(() => E.onSimTime((t) => {
    const x = ox(t);
    head.current?.setAttribute('x1', String(x)); head.current?.setAttribute('x2', String(x));
    tri.current?.setAttribute('d', 'M' + x + ' ' + (bot + 3) + ' l-5 7 h10z');
    el.current?.setAttribute('width', String(Math.max(0, x - tl.o0)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [E, W, H]);
  const snaps = M.P.snapshots, max = Math.max(...snaps.map((x) => x.total)) * 1.05 || 1; // a product with no stages has all-zero totals
  const cum = snaps.map(() => 0);
  const polys = ORDER.map((st) => {
    const up: string[] = [], dn: string[] = [];
    snaps.forEach((sn, i) => { const x = hx(sn.week), y0 = bot - (cum[i] / max) * (bot - top); cum[i] += sn.counts[st] || 0; const y1 = bot - (cum[i] / max) * (bot - top); dn.push(x.toFixed(1) + ',' + y0.toFixed(1)); up.push(x.toFixed(1) + ',' + y1.toFixed(1)); });
    return <polygon key={st} points={up.join(' ') + ' ' + dn.reverse().join(' ')} fill={st === 'deprecated' ? 'var(--red)' : 'var(--ink)'} fillOpacity={FILLS[st]} />;
  });
  const bins = new Array(60).fill(0);
  const hour = sim.has && !sim.live;
  if (hour) for (const e of SWARM.replay) bins[Math.min(59, Math.floor(e.t / 60))]++;
  const bw = (tl.o1 - tl.o0) / 60, hxn = hx(s.t), hl = Math.min(hxn, tl.h1);
  const lab = now ? 'NOW · REV ' + NW : 'REV ' + revAt(M.P.weeks, s.t) + ' · ' + fmtD(s.t), pw = 108, px0 = Math.max(tl.h0 - 6, Math.min(hl - pw / 2, tl.h1 - pw + 12));
  const m1 = M.P.milestones.find((m) => m.state === 'done'), m2 = M.P.MS[GA_MILESTONE];
  const drag = useRef<'h' | 'o' | null>(null);
  const apply = (x: number) => {
    if (hour && x >= tl.o0 - 10 && x <= tl.o1 + 6 && drag.current !== 'h') { drag.current = 'o'; E.seek(((x - tl.o0) / (tl.o1 - tl.o0)) * HOUR); return; }
    if (drag.current === 'o') return;
    drag.current = 'h';
    let best = M.P.weeks[0], bd = 1e9;
    for (const w of M.P.weeks) { const d = Math.abs(hx(w) - x); if (d < bd) { bd = d; best = w; } }
    if (x > tl.h1 + 2 && x < tl.o0) best = asOf;
    E.setTime(best);
  };
  const px = (e: React.PointerEvent) => { const r = svg.current!.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  return (
    <motion.div variants={useItem()} id="revs" ref={wrap}>
      <svg id="revsvg" ref={svg} tabIndex={0} role="slider" aria-label="Time: revision history, now, and the simulated hour ahead" aria-valuemin={1} aria-valuemax={NW} aria-valuenow={revAt(M.P.weeks, s.t)} aria-valuetext={'Revision ' + revAt(M.P.weeks, s.t) + ', ' + s.t}
        viewBox={`0 0 ${W} ${H}`} data-keys="own"
        onPointerDown={(e) => { drag.current = null; (e.currentTarget as Element).setPointerCapture(e.pointerId); apply(px(e)); }}
        onPointerMove={(e) => { if (drag.current) apply(px(e)); }} onPointerUp={() => { drag.current = null; }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); E.stepWeek(-1); }
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); E.stepWeek(1); }
          else if (e.key === 'Home') { e.preventDefault(); E.setTime(M.P.weeks[0]); }
          else if (e.key === 'End') { e.preventDefault(); E.setTime(asOf); }
          else if (e.key === 't' || e.key === 'T') { e.preventDefault(); E.setTimeline(); }
          else if (e.key === 'Escape') { e.preventDefault(); E.setTimeline(false); }
        }}>
        <text className="lbl" x="2" y={top + 2}>REVISIONS</text><text x="2" y={top + 18}>{NW} weeks</text>{!s.compact && <text x="2" y={top + 33}>[ ] step</text>}
        {polys}
        <line className="ax" x1={tl.h0} y1={bot} x2={tl.h1} y2={bot} />
        {snaps.map((sn, i) => {
          const x = hx(sn.week);
          return <g key={sn.week}><line className="ax" x1={x} y1={bot} x2={x} y2={bot + 4} opacity={0.6} />{((i % 5 === 0 && i < 25) || i === 26) && Math.abs(x - hxn) > 60 && x < tl.h1 - 40 ? <text x={x} y={bot + 17} textAnchor="middle">{fmtD(sn.week)}</text> : null}</g>;
        })}
        {m1 && m1.date >= RD0 && <g><line x1={hx(m1.date)} y1={top - 16} x2={hx(m1.date)} y2={bot} stroke="var(--ink)" strokeWidth={1.2} /><path d={`M${hx(m1.date)} ${top - 16} h10 l-3 4 l3 4 h-10z`} fill="var(--ink)" /><text x={hx(m1.date) + 13} y={top - 9} style={{ fill: 'var(--ink)' }}>{((m1.code ? m1.code + ' ' : '') + m1.name.split(' ').pop()).toUpperCase()} · DONE</text></g>}
        {sim.live && <text className="lbl" x={tl.o0} y={top - 12} style={{ fill: 'var(--mint)' }}>LIVE SCAN · NO REPLAY HOUR</text>}
        {hour && (
          <g>
            <rect x={tl.o0} y={top - 6} width={tl.o1 - tl.o0} height={bot - top + 6} fill="var(--mint)" fillOpacity={0.05} stroke="var(--mint)" strokeOpacity={0.35} strokeDasharray="3 3" />
            <text className="lbl" x={tl.o0} y={top - 12} style={{ fill: 'var(--mint)' }}>THE NEXT HOUR · SIMULATED</text>
            {bins.map((c, i) => c ? <rect key={i} x={tl.o0 + i * bw + 0.5} y={bot - Math.min(22, c * 3)} width={Math.max(1, bw - 1)} height={Math.min(22, c * 3)} fill="var(--mint)" fillOpacity={0.5} /> : null)}
            <line className="ax" x1={tl.o0} y1={bot} x2={tl.o1} y2={bot} />
            {[0, 15, 30, 45, 60].map((m) => { const xx = tl.o0 + (m / 60) * (tl.o1 - tl.o0); return <g key={m}><line className="ax" x1={xx} y1={bot} x2={xx} y2={bot + 4} />{m === 0 && now ? null : <text x={xx} y={bot + 17} textAnchor={m === 0 ? 'start' : m === 60 ? 'end' : 'middle'}>{m === 60 ? '10:00' : '09:' + (m < 10 ? '0' : '') + m}</text>}</g>; })}
            {ARRIVALS.map((d) => { const xa = ox(d.t); return <g key={d.id}><path d={`M${xa} ${bot} v-14`} stroke="var(--amber)" strokeWidth={1.6} /><path d={`M${xa} ${bot - 14} l8 3 l-8 3z`} fill="var(--amber)"><title>{'A new question arrives: ' + d.id}</title></path></g>; })}
            <rect ref={el} x={tl.o0} y={top - 6} width={0} height={bot - top + 6} fill="var(--mint)" fillOpacity={0.14} />
            <line ref={head} x1={tl.o0} x2={tl.o0} y1={top - 10} y2={bot + 3} stroke="var(--mint)" strokeWidth={2} />
            <path ref={tri} d={`M${tl.o0} ${bot + 3} l-5 7 h10z`} fill="var(--mint)" />
          </g>
        )}
        <line x1={tl.o1} y1={bot} x2={tl.R} y2={bot} stroke="var(--ink)" strokeOpacity={0.4} strokeDasharray="2 4" />
        {m2 && (() => { const xm = tl.R - 14; return <g><line x1={xm} y1={top - 14} x2={xm} y2={bot} stroke="var(--amber)" strokeWidth={1.2} strokeDasharray="4 3" /><path d={`M${xm} ${top - 14} h-10 l3 4 l-3 4 h10z`} fill="var(--amber)" /><text x={xm - 13} y={top - 7} textAnchor="end" style={{ fill: 'var(--amber)' }}>{m2.code || m2.name} · {fmtD(m2.date)}</text>{!s.compact && <><text x={xm - 4} y={bot - 20} textAnchor="end" style={{ fill: 'var(--amber)' }}>{Math.round(dnum(m2.date) - dnum(asOf))} days</text><text x={xm - 4} y={bot - 5} textAnchor="end">M3, M4 ▸</text></>}</g>; })()}
        <g className="handle"><line x1={hl} y1={top - 16} x2={hl} y2={bot + 2} /><rect x={px0} y={bot + 8} width={pw} height={20} rx={2} /><text x={px0 + pw / 2} y={bot + 22.5} textAnchor="middle">{lab}</text><path d={`M${hl - 5} ${bot + 8} l5 -6 l5 6z`} fill="var(--amber)" /></g>
      </svg>
    </motion.div>
  );
}

const PANEL: Variants = {
  hide: { opacity: 0, y: 22, transition: { duration: 0.16, ease: 'easeIn' } },
  show: { opacity: 1, y: 0, transition: { duration: 0.26, ease: [0.2, 0.7, 0.2, 1], when: 'beforeChildren', staggerChildren: 0.07 } },
};
const BOX: Variants = { hide: {}, show: { transition: { staggerChildren: 0.08 } } };
const INSTANT: Variants = { hide: { opacity: 0, transition: { duration: 0 } }, show: { opacity: 1, transition: { duration: 0 } } };

export function BaseBar() {
  const open = useBp((s) => s.tl), rm = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null);
  // collapsing with the focus inside the panel hands it back to the strip's toggle
  useEffect(() => { if (!open && panel.current?.contains(document.activeElement)) toggle.current?.focus(); }, [open]);
  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.section key="tl" id="tlpanel" ref={panel} aria-label="Timeline" variants={rm ? INSTANT : PANEL} initial="hide" animate="show" exit="hide">
            <KeyPlanBox />
            <motion.div id="timebox" variants={rm ? INSTANT : BOX}><Clock /><Revisions /></motion.div>
          </motion.section>
        )}
      </AnimatePresence>
      <Strip ref={toggle} open={open} />
    </>
  );
}
