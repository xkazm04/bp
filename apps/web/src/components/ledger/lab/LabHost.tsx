'use client';
// The lab's page: the same store, the same Ledger, the same writes as the shipping Backlog; only the surface differs, and the
// design direction is a switch away. It owns what stays constant across the directions: the frame, the bench (autosave and
// undo), the keys and the brief. In packs and Release keep the current design for now: their buttons leave the lab scope.
// The keys here read the DOM for the order (J/K walk `[data-fid]` as drawn), because each direction lays findings out its own way.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useProductName } from '@/lib/scan/projects';
import { useEngine, useLive } from '../../hooks';
import { BriefDrawer } from '../BriefDrawer';
import { useOnMain } from '../train/onMain';
import { setLedgerUi, useLedger, type LedgerUi } from '../useLedger';
import { useWaveBench } from './bench';
import type { LabChoice } from './choice';
import { LineBoard } from './LineBoard';
import { Lab, TopBar, type LabCtx } from './parts';
import { Schedule } from './Schedule';
import { SitePlan } from './SitePlan';
import './lab.css';

const isTyping = (t: HTMLElement) => (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;

export function LabHost({ choice, ui, lensButton, lensPanel }: { choice: Exclude<LabChoice, 'current'>; ui: LedgerUi; lensButton: ReactNode; lensPanel: ReactNode }) {
  const E = useEngine(), main = useOnMain(), L = useLedger(ui, setLedgerUi, main.outcome), B = useWaveBench(L), live = useLive();
  const name = useProductName(E.M.live?.slug ?? null, E.M.P.name);
  const root = useRef<HTMLElement>(null), filter = useRef<HTMLInputElement>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  // the wave tab is the old strip's filter; the lab shows every wave at once
  useEffect(() => { if (ui.wave || ui.composer) setLedgerUi((u) => ({ ...u, wave: null, composer: null })); }, [ui.wave, ui.composer]);

  // the chrome behind stays inert, as the current page's (LedgerPage Body)
  useLayoutEffect(() => {
    const page = root.current, host = page?.closest('.bp');
    const held: HTMLElement[] = [];
    host?.querySelectorAll<HTMLElement>('.bp-map, .bp-ui > *').forEach((el) => {
      if (el === page || el.contains(page!) || el.id === 'hdr' || el.id === 'toast' || el.classList.contains('toast-live')) return;
      if (!el.inert) { el.inert = true; held.push(el); }
    });
    page?.focus({ preventScroll: true });
    return () => { for (const el of held) el.inert = false; };
  }, []);

  const focusId = ui.focus && L.byId.has(ui.focus) ? ui.focus : L.rows[0]?.p.id ?? null;
  useEffect(() => {
    const page = root.current, at = document.activeElement as HTMLElement | null;
    if (!page || !ui.focus || (at && at !== document.body && at !== page && !at.hasAttribute('data-fid'))) return;
    const el = page.querySelector<HTMLElement>('[data-fid="' + CSS.escape(ui.focus) + '"]');
    if (el && el !== at) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }, [ui.focus]);

  const maxScore = useMemo(() => L.all.reduce((m, f) => Math.max(m, f.w.value ?? 0), 0), [L.all]);
  const ctx: LabCtx = useMemo(() => ({ L, B, focusId, maxScore, openBrief: (id: string) => { L.setFocus(id); setDrawer(true); } }), [L, B, focusId, maxScore]);

  const step = (d: number) => {
    const els = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-fid]') ?? []), ord = [...new Set(els.map((e) => e.dataset.fid!))];
    if (!ord.length) return;
    const i = focusId ? ord.indexOf(focusId) : -1;
    L.setFocus(ord[i < 0 ? 0 : Math.max(0, Math.min(ord.length - 1, i + d))]);
  };
  /** What a key acts on: the selection, else the focused finding. */
  const targets = (): string[] => (ui.sel.size ? [...ui.sel] : focusId ? [focusId] : []);

  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement, k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z' && !isTyping(t)) { e.preventDefault(); B.undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(t)) { if (k === 'Escape') { e.preventDefault(); if (ui.q && t === filter.current) L.set((u) => ({ ...u, q: '' })); else root.current?.focus(); } return; }
    if (t.closest('.lg-side, .lg-pop, .lg-trust')) return;
    const low = k.toLowerCase();
    if (/^[1-9]$/.test(k)) { e.preventDefault(); const ids = targets(); if (ids.length) B.placeAt(ids, +k - 1); return; }
    switch (low) {
      case 'j': case 'arrowdown': e.preventDefault(); step(1); return;
      case 'k': case 'arrowup': e.preventDefault(); step(-1); return;
      case 'x': e.preventDefault(); if (focusId) L.toggle(focusId); return;
      case ' ': if (t.closest('button, a, input')) return; e.preventDefault(); if (focusId) L.toggle(focusId); return;
      case 'w': e.preventDefault(); { const ids = targets(); if (ids.length) B.place(ids, { wave: 'new' }); } return;
      case '0': e.preventDefault(); { const ids = targets(); if (ids.length) B.place(ids, { wave: null }); } return;
      case 'z': e.preventDefault(); B.undo(); return;
      case '/': e.preventDefault(); filter.current?.focus(); return;
      case 'y': e.preventDefault(); if (L.writes && focusId && L.byId.get(focusId)?.status === 'proposed') void L.decideOne(focusId, 'approve'); return;
      case 'n': e.preventDefault(); if (L.writes && focusId && L.byId.get(focusId)?.status === 'proposed') { setDrawer(true); setDeclining(focusId); } return;
      case 'enter': { if (t.closest('button, a')) return; e.preventDefault(); if (choice === 'line') setDrawer((o) => !o); else { const f = focusId ? L.byId.get(focusId) : null; if (f) L.openFeature(f); } return; }
      case 'escape':
        e.preventDefault();
        if (declining) setDeclining(null);
        else if (choice === 'line' && drawer) setDrawer(false);
        else if (ui.sel.size) L.clear();
        else E.setPage('plan');
        return;
    }
  };

  const brief = focusId ? (
    <BriefDrawer id={focusId} decide={L.writes ? {
      status: L.byId.get(focusId)?.status ?? 'proposed', declining: declining === focusId,
      approve: () => void L.decideOne(focusId, 'approve'), startDecline: () => setDeclining(focusId),
      decline: (r) => { void L.decideOne(focusId, 'decline', r).then((ok) => { if (ok) setDeclining(null); }); },
      cancel: () => { setDeclining(null); root.current?.focus({ preventScroll: true }); },
    } : undefined} />
  ) : null;

  return (
    <motion.section ref={root} className={'lx-page v-' + choice + (B.drag ? ' carrying' : '')} aria-label="Findings ledger" tabIndex={-1} data-keys="own" onKeyDown={onKey}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}>
      <Lab.Provider value={ctx}>
        <TopBar filter={filter} name={name + (live ? '' : ' · sample') + ' · ' + L.all.length + ' findings'} slots={lensButton ? <div className="lx-slotb">{lensButton}</div> : null} />
        <div className="lx-main">
          <div className="lx-view">
            {choice === 'schedule' ? <Schedule brief={brief} /> : choice === 'site' ? <SitePlan brief={brief} /> : <LineBoard brief={drawer ? brief : null} />}
          </div>
          {lensPanel ? <aside className="lg-side" aria-label="Lenses">{lensPanel}</aside> : null}
        </div>
      </Lab.Provider>
    </motion.section>
  );
}
