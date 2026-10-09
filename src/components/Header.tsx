'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { latestRun, sheetOf, views, type BayNode, type BldNode, type RoomNode, type WingNode } from '@/lib/model';
import { shallowEqual, useBp, useEngine, useLive, useVariant } from './hooks';
import { ThemeToggle } from './ThemeToggle';
import type { Crumb } from '@/engine/state';
import type { LiveProduct } from '@/lib/scan/client';

function crumbLabel(E: ReturnType<typeof useEngine>, c: Crumb, short: boolean): string {
  const o = E.placeById(c.t, c.id);
  if (!o) return c.id;
  if (c.t === 'bld') return short ? (o as BldNode).b.short : (o as BldNode).name;
  if (c.t === 'wing') { const w = o as WingNode; return short ? w.def.letter : w.def.letter + ' · ' + w.def.name; }
  if (c.t === 'room') { const r = o as RoomNode; return short ? r.d.code || r.d.name : r.d.name; }
  return (o as BayNode).cap.name;
}

function Crumbs() {
  const E = useEngine();
  const s = useBp((s) => ({ place: s.place, open: s.open, t: s.t, delta: s.delta, simV: s.simV, who: s.who, view: s.view }), shallowEqual);
  const M = E.M;
  // short labels for the parents only when the full chain would crowd the header
  const fullLen = s.place.reduce((n, c) => n + crumbLabel(E, c, false).length + 3, 6);
  const room = (typeof window !== 'undefined' ? window.innerWidth / (E.U || 1) : 1280) - 760 - (s.open ? 0 : 420);
  const short = fullLen * 12.5 > room;
  const cur = s.place.length ? E.placeById(s.place[s.place.length - 1].t, s.place[s.place.length - 1].id) : null;
  const fs = s.open ? null : cur ? cur.feats : M.P.features;
  let sum: React.ReactNode = null;
  if (fs) {
    const id = cur ? cur.id : 'ALL';
    const c = M.agg.countsOf(id, fs, s.t, s.delta), now = s.t === M.P.asOf;
    const bad = now ? M.agg.healthOf(id, fs, 'general').bad : 0;
    const asks = M.sim.has && now ? M.sim.stats(fs, s.who, s.view).asks : 0;
    sum = (
      <span className="sum">
        <span className="st">{fs.length} features · <b>{c.live + c.flagged} live</b> · {c.build} being built · {c.paper + c.dep} promised</span>
        {bad || asks ? (
          <span className="att">
            {bad ? <> · <em>{bad} in trouble</em></> : null}
            {asks ? <> · <i>{asks} {asks === 1 ? 'question' : 'questions'} waiting</i></> : null}
          </span>
        ) : null}
      </span>
    );
  }
  const items = [{ key: 'home', label: M.P.scale > 1 ? M.P.name + ' campus' : M.P.name, depth: 0 }].concat(
    s.place.map((c, i) => ({ key: c.id, label: crumbLabel(E, c, short && i < s.place.length - 1), depth: i + 1 })),
  );
  return (
    <nav id="crumbs" aria-label="Where you are">
      {items.map((it, i) => (
        <span key={it.key} style={{ display: 'contents' }}>
          {i > 0 && <span className="sep">›</span>}
          <button type="button" className={i === items.length - 1 ? 'cur' : ''} aria-current={i === items.length - 1 ? 'location' : undefined} onClick={() => E.crumb(it.depth)} title={it.label}>
            {it.label}
          </button>
        </span>
      ))}
      {sum}
    </nav>
  );
}

/** One tab per view: General, then every enabled lens in file order (name, short and question count from the data). */
function LensTabs() {
  const E = useEngine(), V = useVariant(), P = E.M.P;
  const s = useBp((s) => ({ view: s.view, simV: s.simV }), shallowEqual);
  const open = E.M.sim.has ? E.M.sim.openDecs() : [];
  const reduce = useReducedMotion();
  const strip = useRef<HTMLDivElement>(null);
  const vs = views(P);
  // roving focus (the rail's pattern): arrows/Home/End move between tabs and select, and never reach the engine's walk
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = Math.max(0, vs.indexOf(s.view)), n = vs.length;
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation(); // React listens on `document` (App Router), where the engine's handler also sits
    E.setView(vs[j]);
    strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[j]?.focus();
  };
  return (
    <div id="tabs" role="tablist" aria-label="Sheets (lenses)" ref={strip} onKeyDown={onTabKey}>
      {vs.map((k, i) => {
        const sh = sheetOf(P, k);
        const n = k === 'general' ? 0 : open.filter((d) => d.lens === k).length;
        const on = s.view === k;
        const sub = V.ui?.tabLabel?.(k) ?? sh.nm;
        return (
          <button key={k} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} title={sh.title + (sh.sub ? ': ' + sh.sub : '') + (i < 9 ? ' (' + (i + 1) + ')' : '') + (n ? ' · ' + n + ' questions waiting on this sheet' : '')} onClick={() => E.setView(k)}>
            <span className="no">{sh.no}{n ? <b className="ct">{n}</b> : null}</span>
            <span className="nm">{sub}</span>
            {i < 9 ? <span className="kb">{i + 1}</span> : null}
            {on && <motion.span layoutId="lens-uline" className="uline" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }} />}
          </button>
        );
      })}
    </div>
  );
}

/** "3 min ago", "2 h ago", "4 d ago". */
export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
}

/**
 * A live product's scan status: `Live · <phase>` while its latest run is running, `Last scan <age>`
 * otherwise, `Offline` while the stream reconnects, `No scan store` before the skill wrote one. Kettle
 * (no live product) shows nothing.
 */
function LivePill() {
  const live = useLive();
  return live ? <LivePillOn L={live.product} /> : null;
}
function LivePillOn({ L }: { L: LiveProduct }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  const run = latestRun(L.scan);
  let cls = '', text: string, title: string;
  if (L.status === 'offline') { cls = 'off'; text = 'Offline'; title = 'The scan stream dropped; reconnecting (backoff up to 10 s)'; }
  else if (L.status === 'missing' || !run) { cls = 'idle'; text = L.status === 'missing' ? 'No scan store' : 'No scan yet'; title = 'Every feature reads unmeasured until /lens-scan writes a run'; }
  else if (run.status === 'running') { cls = 'on'; text = 'Live · ' + run.phase; title = 'Run ' + run.id + ' is running: phase ' + run.phase + ', lenses ' + run.lenses.join(', '); }
  else { text = 'Last scan ' + ago(Date.now() - Date.parse(run.ended_at ?? run.updated_at)); title = 'Run ' + run.id + ' ' + run.status + (run.note ? ': ' + run.note : ''); }
  return <span className={'livepill ' + cls} role="status" title={title}><i />{text}</span>;
}

export function Header() {
  const E = useEngine(), P = E.M.P;
  const view = useBp((s) => s.view);
  const sh = sheetOf(P, view);
  return (
    <header id="hdr">
      <div id="brand">
        <div className="proj">Project {P.name} · drawing set · <b>sheet {sh.no} · {sh.title}</b> · {E.M.live ? 'live lens scan' : 'simulated swarm'}</div>
        <Crumbs />
      </div>
      <div className="hdr-right">
        <LivePill />
        <LensTabs />
        <ThemeToggle compact />
      </div>
    </header>
  );
}
