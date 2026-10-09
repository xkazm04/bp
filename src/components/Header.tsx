'use client';
import { motion } from 'motion/react';
import { sheetOf, views, type BayNode, type BldNode, type RoomNode, type WingNode } from '@/lib/model';
import { shallowEqual, useBp, useEngine, useVariant } from './hooks';
import { ThemeToggle } from './ThemeToggle';
import type { Crumb } from '@/engine/state';

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
        {fs.length} features · <b>{c.live + c.flagged} live</b> · {c.build} being built · {c.paper + c.dep} promised
        {bad ? <> · <em>{bad} in trouble</em></> : null}
        {asks ? <> · <i>{asks} {asks === 1 ? 'question' : 'questions'} waiting</i></> : null}
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
  return (
    <div id="tabs" role="tablist" aria-label="Sheets (lenses)">
      {views(P).map((k, i) => {
        const sh = sheetOf(P, k);
        const n = k === 'general' ? 0 : open.filter((d) => d.lens === k).length;
        const on = s.view === k;
        const sub = V.ui?.tabLabel?.(k) ?? sh.nm;
        return (
          <button key={k} type="button" role="tab" aria-selected={on} title={sh.title + (sh.sub ? ': ' + sh.sub : '') + (i < 9 ? ' (' + (i + 1) + ')' : '') + (n ? ' · ' + n + ' questions waiting on this sheet' : '')} onClick={() => E.setView(k)}>
            <span className="no">{sh.no}{n ? <b className="ct">{n}</b> : null}</span>
            <span className="nm">{sub}</span>
            {i < 9 ? <span className="kb">{i + 1}</span> : null}
            {on && <motion.span layoutId="lens-uline" className="uline" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
          </button>
        );
      })}
    </div>
  );
}

export function Header() {
  const E = useEngine(), P = E.M.P;
  const view = useBp((s) => s.view);
  const sh = sheetOf(P, view);
  return (
    <header id="hdr">
      <div id="brand">
        <div className="proj">Project {P.name} · drawing set · <b>sheet {sh.no} · {sh.title}</b> · simulated swarm</div>
        <Crumbs />
      </div>
      <div className="hdr-right">
        <LensTabs />
        <ThemeToggle compact />
      </div>
    </header>
  );
}
