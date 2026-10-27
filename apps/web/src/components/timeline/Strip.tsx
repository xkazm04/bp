'use client';
// The collapsed timeline: one thin strip along the bottom that still tells the essentials at a glance -
// where in time the plan is ("now" or the travelled date), a hairline of the revision history (click or
// drag it to travel), and the sim clock (Kettle) or the scan's run status (a live product). Clicking the
// strip anywhere but the hairline expands the full panel; the strip never expands on hover.
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { dnum, fmtD, revAt } from '@bp/core/model';
import { shallowEqual, useBp, useEngine } from '../hooks';
import { simClock, useRunInfo, useSize, useTimeSlider } from './shared';
import { runTitle } from './run';
import { histX, hoverAt, hourX } from './scrub';
import { changeMarks, changeOn, changeWords, weekChanges } from './changes';
import { sliderGeom, transport } from './slider';

/** The sim clock (Kettle) or the latest run (live product), as one line of small text. */
function StripClock() {
  const E = useEngine(), sim = E.M.sim, ri = useRunInfo();
  const s = useBp((s) => ({ playing: s.playing, speed: s.speed, over: s.over, now: s.t === E.M.P.asOf }), shallowEqual);
  const tref = useRef<HTMLSpanElement>(null);
  useEffect(() => (sim.has && !sim.live ? E.onSimTime((t) => { if (tref.current) tref.current.textContent = simClock(sim.at0, t); }) : undefined), [E, sim]);
  if (!sim.has) return null;
  if (sim.live) {
    const run = ri?.run, f = ri?.facts, running = run?.status === 'running';
    return (
      <span className="tl-clk" title={runTitle(run)}>
        <span className="tl-k">SCAN</span><span className={'tl-st ' + (ri?.tone ?? '')}>{ri?.label}</span>
        {f && ri?.p && <span className="tl-dim">{running ? ri.p.done + '/' + ri.p.total + ' · ' + f.time : f.time}</span>}
      </span>
    );
  }
  const tr = transport({ has: sim.has, live: sim.live, ...s });
  return (
    <span className="tl-clk" title="The simulated hour (expand the timeline for speed controls)">
      <span className="tl-hm" ref={tref}>09:00:00</span><span className="tl-dim">UTC</span><span className={'tl-st ' + tr.tone}>{tr.short}</span>
    </span>
  );
}

/** The hairline: revision history (a sparkline of feature counts, a tick per week, a mark per week weighted by its
 *  stage changes) and, for Kettle, the hour ahead. Hover or focus previews a week's changes in the flag before travel. */
function Hairline() {
  const E = useEngine(), M = E.M, sim = M.sim;
  const t = useBp((s) => s.t);
  const wrap = useRef<HTMLDivElement>(null);
  const [W, H] = useSize(wrap, 600, 26);
  const hour = sim.has && !sim.live, asOf = M.P.asOf, weeks = M.P.weeks, RD0 = weeks[0];
  const L = 4, R = W - 4, gap = hour ? 14 : 0, hourW = hour ? Math.round((R - L) * 0.24) : 0;
  const h0 = L, h1 = R - hourW - gap, o0 = h1 + gap, o1 = R, top = 4, bot = H - 6;
  const g = sliderGeom(weeks, asOf, hour, { h0, h1, o0, o1 });
  const hx = (d: string) => histX(g, dnum(d)), ox = (v: number) => hourX(g, v);
  // the week digest, once per product (changes.ts); hovering re-renders only when the hovered week changes
  const changes = useMemo(() => weekChanges(M.P.features, weeks, asOf), [M, weeks, asOf]);
  const [hov, setHov] = useState<string | null>(null), [foc, setFoc] = useState(false);
  const { svgProps, refs, model } = useTimeSlider(E, {
    kind: 'strip', g, W, H, t, changes, ariaLabel: 'Time: drag along the revision history to travel; the right end is now',
    onHover: (x) => setHov(x === null ? null : hoverAt(g, x)),
  });
  const now = model.now;
  const snaps = M.P.snapshots, max = Math.max(...snaps.map((x) => x.total)) || 1;
  const pts = snaps.map((sn) => hx(sn.week).toFixed(1) + ',' + (bot - (sn.total / max) * (bot - top)).toFixed(1));
  const line = pts.length > 1 ? 'M' + pts.join(' L') : '';
  const area = line ? line + ` L${hx(snaps[snaps.length - 1].week).toFixed(1)},${bot} L${hx(snaps[0].week).toFixed(1)},${bot}Z` : '';
  const m1 = M.P.milestones.find((m) => m.state === 'done'), xt = Math.min(hx(t), h1);
  const cbot = bot - 1, chH = Math.max(3, (bot - top) * 0.45), marks = changeMarks(changes);
  // the flag: the hovered week, else (travelled or focused) the shown week - date, revision and what changed there
  const fw = hov ?? (!now || foc ? t : null), fc = fw ? changeOn(changes, fw) : undefined;
  const flag = fw ? (fw === asOf ? 'NOW' : fmtD(fw)) + ' · REV ' + revAt(weeks, fw) + (fc ? ' · ' + changeWords(fc).toUpperCase() : '') : '';
  const fx = fw ? Math.min(hx(fw), h1) : 0, fW = flag.length * 8 + 14;
  return (
    <div className="tl-line" ref={wrap}>
      {/* Esc here collapses the panel, else returns to now, else leaves the hairline (slider.ts SLIDERS.strip) */}
      <svg viewBox={`0 0 ${W} ${H}`} {...svgProps} onFocus={() => setFoc(true)} onBlur={() => setFoc(false)}>
        {model.stillTitle && <title>{model.stillTitle}</title>}
        <rect className="tl-hit" x={0} y={0} width={W} height={H} />
        {area && <path className="tl-area" d={area} />}
        {marks.map((c) => { const x = hx(c.week); return <line key={c.week} className="tl-chg" x1={x} y1={cbot} x2={x} y2={cbot - Math.max(2, c.w * chH)} />; })}
        {line && <path className="tl-spark" d={line} />}
        <line className="tl-base" x1={h0} y1={bot} x2={h1} y2={bot} />
        {weeks.map((w) => { const x = hx(w); return <line key={w} className="tl-tick" x1={x} y1={bot} x2={x} y2={bot + 3} />; })}
        {m1 && m1.date >= RD0 && <line className="tl-ms" x1={hx(m1.date)} y1={top - 2} x2={hx(m1.date)} y2={bot}><title>{m1.name + ' · done'}</title></line>}
        {hour && (
          <g className="tl-hour">
            <line className="tl-hbase" x1={o0} y1={bot} x2={o1} y2={bot} />
            <rect ref={refs.el} className="tl-hel" x={o0} y={top} width={0} height={bot - top} />
            {sim.arrivals.map((a) => <line key={a.id} className="tl-arr" x1={ox(a.t)} y1={bot - 7} x2={ox(a.t)} y2={bot} />)}
            <line ref={refs.head} className="tl-hhead" x1={o0} x2={o0} y1={top - 2} y2={bot + 3} />
          </g>
        )}
        <g className={'tl-handle' + (now ? ' now' : '')}>
          <line x1={xt} y1={1} x2={xt} y2={H - 1} />
          <path d={`M${xt - 4} ${H} l4 -5 l4 5z`} />
        </g>
      </svg>
      {flag && <span className={'tl-flag' + (hov && hov !== t ? ' peek' : '')} style={{ left: Math.min(Math.max(0, fx - 40), W - fW) }}>{flag}</span>}
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
        ? <span className="tl-pos" role="status"><b>NOW</b><span className="tl-dim">REV {rev} · {fmtD(t)}</span></span>
        : (
          <span className="tl-pos" role="status">
            <b>VIEWING {fmtD(t)}</b><span className="tl-dim">REV {rev} of {M.P.weeks.length}</span>
            <button type="button" className="tl-back" onClick={(e) => { e.stopPropagation(); E.setTime(M.P.asOf); }} title="Back to now (Esc on the hairline)">BACK TO NOW ▸</button>
          </span>
        )}
      <StripClock />
      <Hairline />
    </div>
  );
});
