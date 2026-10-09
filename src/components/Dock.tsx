'use client';
// The right-hand rail: a slim column of counters (decisions waiting, agents, orders, steering, plan,
// find, view). It never changes width; each item opens ITS OWN flyout over the plan to its left, one at
// a time. The same item, Esc, or a click on the plan closes it. Counts tween when they move and the item
// pulses once; nothing opens by itself. `\` hides the whole rail (the plan takes the width back).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { SPEND_CAP, pname, sheetOf } from '@/lib/model';
import type { DockTab } from '@/engine/state';
import { AsksTab, MorningButton } from './Queue';
import { FindPanel, OrdersPanel, PlanPanel, SteerPanel, SwarmPanel, ViewPanel } from './rail/panels';
import { shallowEqual, useBp, useEngine } from './hooks';
import './rail.css';

/** A number that counts to its new value (instant under reduced motion). */
function Count({ n }: { n: number }) {
  const reduce = useReducedMotion();
  const [d, setD] = useState(n);
  const cur = useRef(n);
  useEffect(() => {
    if (cur.current === n) return;
    if (reduce) { cur.current = n; setD(n); return; }
    const from = cur.current;
    const c = animate(from, n, { duration: Math.min(0.7, 0.2 + Math.abs(n - from) * 0.06), ease: 'easeOut', onUpdate: (v) => { cur.current = Math.round(v); setD(cur.current); } });
    return () => c.stop();
  }, [n, reduce]);
  return <>{d}</>;
}

type Tone = 'amber' | 'red' | 'mint' | 'ink';
interface Item {
  k: DockTab;
  label: string;
  /** Full title for the tooltip and the flyout header. */
  title: string;
  glyph: ReactNode;
  /** The main figure (a number tweens; text is shown as is). */
  n: number | string | null;
  /** A second, small figure (e.g. blocked agents, breached orders), shown in red when > 0. */
  n2?: number;
  n2title?: string;
  tone: Tone;
  sub?: string;
}

const G = {
  asks: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="12" cy="16.6" r="1.1" fill="currentColor" /></svg>,
  swarm: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" strokeWidth="1.8" /></svg>,
  orders: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeDasharray="3.2 2.2" /><path d="M8.5 12.5l2.4 2.4 4.6-5.2" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>,
  steer: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M12 4.5v5.5M5.5 15.8l4.8-2.8M18.5 15.8l-4.8-2.8" stroke="currentColor" strokeWidth="1.7" /></svg>,
  plan: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 14.5h17M13 14.5v5M8 4.5v10" stroke="currentColor" strokeWidth="1.4" /></svg>,
  find: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" /></svg>,
  view: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.5" /><circle cx="9" cy="7" r="2.1" fill="var(--card)" stroke="currentColor" strokeWidth="1.6" /><circle cx="15.5" cy="12" r="2.1" fill="var(--card)" stroke="currentColor" strokeWidth="1.6" /><circle cx="7" cy="17" r="2.1" fill="var(--card)" stroke="currentColor" strokeWidth="1.6" /></svg>,
};

function useItems(): Item[] {
  const E = useEngine(), M = E.M, sim = M.sim;
  const s = useBp((s) => ({ simV: s.simV, who: s.who, view: s.view, delta: s.delta, tgt: s.tgt.n }), shallowEqual);
  const out: Item[] = [];
  out.push({ k: 'find', label: 'Find', title: 'Find a feature', glyph: G.find, n: null, tone: 'ink' });
  if (sim.has) {
    const q = sim.queueFor(s.who, s.view), mine = s.who ? q.mine : q.all, hi = mine.filter((d) => d.urg === 'high').length;
    const first = s.who ? pname(M.P, s.who).split(' ')[0] : '';
    out.push({
      k: 'asks', label: sim.live ? 'Review' : 'Asks', title: sim.live ? 'Proposals to review' : s.who ? 'Waiting for ' + first : 'Decisions waiting',
      glyph: G.asks, n: mine.length, n2: hi, n2title: hi + ' urgent', tone: mine.length ? 'amber' : 'ink', sub: s.who ? 'for ' + first : undefined,
    });
    const c = sim.tallyStatus(), bad = c.blocked + c.failed;
    out.push({ k: 'swarm', label: 'Agents', title: 'Agents · ' + c.working + ' working of ' + sim.agents.length, glyph: G.swarm, n: c.working, n2: bad, n2title: c.blocked + ' blocked, ' + c.failed + ' failed', tone: 'mint' });
    if (sim.orders.length || !sim.live) {
      const br = sim.orders.filter((o) => o.vf.length).length;
      out.push({ k: 'orders', label: 'Orders', title: 'Standing orders · ' + br + ' of ' + sim.orders.length + ' breached', glyph: G.orders, n: br, tone: br ? 'red' : 'ink', sub: 'of ' + sim.orders.length });
    }
    if (!sim.live) {
      const pct = Math.round((100 * sim.spend()) / SPEND_CAP);
      out.push({ k: 'steer', label: 'Steer', title: 'Steer the swarm · spend ' + pct + '% of the cap', glyph: G.steer, n: pct + '%', tone: pct >= 100 ? 'red' : pct >= 80 ? 'amber' : 'ink' });
    }
  }
  const sh = sheetOf(M.P, s.view);
  out.push({ k: 'plan', label: 'Plan', title: 'Plan · sheet ' + sh.no, glyph: G.plan, n: sh.no, tone: 'ink' });
  out.push({ k: 'view', label: 'View', title: 'View · window, modes, reader, health', glyph: G.view, n: s.delta === 1 ? '24h' : s.delta + 'd', tone: 'ink', sub: s.who ? pname(M.P, s.who).split(' ')[0] : undefined });
  return out;
}

function RailItem({ it, on, idx }: { it: Item; on: boolean; idx: number }) {
  const E = useEngine(), reduce = useReducedMotion();
  // one subtle pulse when the main figure moves (at most every 3 s: a simulated swarm moves all the time)
  const [pulse, setPulse] = useState(0);
  const last = useRef(it.n), lastAt = useRef(0);
  useEffect(() => {
    if (last.current === it.n) return;
    last.current = it.n;
    const now = performance.now();
    if (reduce || now - lastAt.current < 3000) return;
    lastAt.current = now; setPulse((p) => p + 1);
  }, [it.n, reduce]);
  return (
    <button type="button" className={'ri t-' + it.tone + (on ? ' on' : '')} data-k={it.k} data-idx={idx} aria-expanded={on} aria-controls="flyout" title={it.title + (it.k === 'find' ? ' ( / )' : it.k === 'view' ? ' ( P )' : '')}
      onClick={() => E.setDockTab(it.k)}>
      {pulse > 0 && <motion.span key={pulse} className="pl" aria-hidden="true" initial={{ opacity: 0.55, scale: 0.92 }} animate={{ opacity: 0, scale: 1.08 }} transition={{ duration: 0.8, ease: 'easeOut' }} />}
      <span className="g">{it.glyph}{it.n2 ? <b className="n2" title={it.n2title}>{it.n2}</b> : null}</span>
      {it.n !== null ? <span className="n">{typeof it.n === 'number' ? <Count n={it.n} /> : it.n}</span> : <span className="n kb">/</span>}
      <span className="lb">{it.label}</span>
      {it.sub && <span className="sb">{it.sub}</span>}
    </button>
  );
}

const PANEL: Record<DockTab, () => ReactNode> = {
  asks: () => <AsksTab />, swarm: () => <SwarmPanel />, orders: () => <OrdersPanel />, steer: () => <SteerPanel />,
  plan: () => <PlanPanel />, find: () => <FindPanel />, view: () => <ViewPanel />,
};

export function Dock() {
  const E = useEngine(), sim = E.M.sim, reduce = useReducedMotion();
  const s = useBp((s) => ({ dtab: s.dtab, hidden: s.dockHidden }), shallowEqual);
  const items = useItems();
  const nav = useRef<HTMLElement>(null), fly = useRef<HTMLElement>(null);
  const open = s.dtab && items.some((i) => i.k === s.dtab) ? s.dtab : null, it = items.find((i) => i.k === open);

  // `/` opens Find (and shows the rail if it was hidden); a second `/` refocuses the box
  useEffect(() => {
    E.focusSearch = () => {
      if (E.S.dockHidden) E.toggleDock(true);
      if (E.S.dtab !== 'find') E.setDockTab('find');
      else { const q = document.getElementById('q') as HTMLInputElement | null; q?.focus(); q?.select(); }
    };
    return () => { E.focusSearch = () => {}; };
  }, [E]);
  // a click on the plan closes the flyout
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if ((e.target as Element | null)?.closest?.('.bp-map')) E.setDockTab(null); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [E, open]);
  // closing hands focus back to the item that opened it (when focus was inside the flyout)
  const prevOpen = useRef(open);
  useLayoutEffect(() => {
    const was = prevOpen.current; prevOpen.current = open;
    if (was && !open) {
      const a = document.activeElement;
      if (!a || a === document.body || fly.current?.contains(a)) nav.current?.querySelector<HTMLButtonElement>(`[data-k="${was}"]`)?.focus({ preventScroll: true });
    }
  }, [open]);

  const onNavKey = (e: React.KeyboardEvent) => {
    const bs = Array.from(nav.current?.querySelectorAll<HTMLButtonElement>('button.ri') ?? []);
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    let j = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % bs.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (i - 1 + bs.length) % bs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = bs.length - 1;
    if (j < 0) return;
    e.preventDefault(); e.stopPropagation();
    bs[j]?.focus();
  };

  const asks = open === 'asks';
  return (
    <>
      <motion.nav id="rail" ref={nav} aria-label="Rail: decisions, agents, orders, plan, find, view" aria-orientation="vertical" onKeyDown={onNavKey}
        initial={false} animate={s.hidden ? { x: 96, opacity: 0 } : { x: 0, opacity: 1 }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 34 }}
        style={{ pointerEvents: s.hidden ? 'none' : 'auto' }} inert={s.hidden || undefined}>
        {items.map((x, i) => <RailItem key={x.k} it={x} idx={i} on={open === x.k} />)}
        <span className="sp" />
        <button id="dhide" type="button" aria-label="Hide rail" title="Hide / show rail ( \ )" onClick={() => E.toggleDock(false)}>⟩</button>
      </motion.nav>
      {s.hidden && <button id="dshow" type="button" aria-label="Show rail" title="Show rail ( \ )" onClick={() => E.toggleDock(true)}>⟨</button>}
      <AnimatePresence>
        {open && it && !s.hidden && (
          <motion.section id="flyout" key="flyout" ref={fly} role="region" aria-labelledby="flyout-h" data-k={open}
            initial={reduce ? false : { opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: 16, transition: { duration: 0.14 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
            <header className={'fh t-' + it.tone}>
              <span className="g">{it.glyph}</span>
              <h2 id="flyout-h">{it.title}</h2>
              <button type="button" className="x" aria-label="Close panel" title="Close ( Esc )" onClick={() => E.setDockTab(null)}>Esc</button>
              {asks && sim.has && !sim.live && <MorningButton />}
            </header>
            <div className={'fb' + (reduce ? ' still' : '')} key={open} tabIndex={-1}>{PANEL[open]()}</div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
