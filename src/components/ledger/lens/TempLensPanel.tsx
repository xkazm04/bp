'use client';
// Temporary lenses on the findings ledger: a button that opens a side panel listing the product's
// temporary lenses (retire, restore, delete, scan) above the onboarding chat with Claude (LensChat).
// The two exports are placed independently (the ledger's slots), so whether the panel is open is a tiny
// module store here, not either component's state.
//
// Where the list comes from, with no branch below on which product it is:
//   live product: the map's `lenses[]` entries marked `temporary` (useLive().product.structure: the stream's
//                 `map` event refreshes it after every lens route write, from this tab or another);
//   Kettle:       this browser's store (src/lib/scan/temp-lens.ts), through its subscription.
// Counts of measured / no-impact features come from the model (E.M.P.base.features[].lens[id].h), which has
// the lens once the app rebuilt it for the new lens set; until then the row says so.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { LensEntry } from '@/lib/standard/types';
import { deleteLens, patchLens } from '@/lib/scan/client';
import { deleteTempLens, readTempLenses, setTempLensEnabled, subscribeTempLenses } from '@/lib/scan/temp-lens';
import { useBp, useEngine, useLive, useScanCtx } from '../../hooks';
import { LensGlyph } from './DraftCard';
import { LensChat, scanNow } from './LensChat';
import './lens.css';

// ------------------------------------------------------------------------------- open/closed store
let open = false;
let opener: HTMLElement | null = null;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const isOpen = () => open;
/** Open or close the panel; closing returns focus to whatever opened it. */
export function setTempLensPanelOpen(v: boolean) {
  if (v === open) return;
  if (v) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  open = v;
  for (const f of [...subs]) f();
  if (!v) { const o = opener; opener = null; if (o?.isConnected) o.focus(); }
}
export function useTempLensPanelOpen(): boolean { return useSyncExternalStore(subscribe, isOpen, () => false); }

// ------------------------------------------------------------------------------------- the lenses
const NONE: LensEntry[] = [];
const noStore = () => NONE;

/** The product's temporary lenses (enabled and retired), and its live slug (null = Kettle). */
function useTempLenses(): { slug: string | null; list: readonly LensEntry[] } {
  const live = useLive(), slug = live?.slug ?? null;
  const stored = useSyncExternalStore(subscribeTempLenses, slug ? noStore : readTempLenses, noStore);
  const lenses = live?.product.structure?.lenses;
  const fromMap = useMemo(() => (lenses ?? NONE).filter((e) => e.temporary === true), [lenses]);
  return { slug, list: slug ? fromMap : stored };
}

/** "New temporary lens" (+ how many the product has); opens the panel. */
export function TempLensButton() {
  const { list } = useTempLenses(), on = useTempLensPanelOpen();
  return (
    <button type="button" className="tl-open" aria-expanded={on} aria-controls={on ? 'tl-panel' : undefined}
      title="Make a lens for one refactor, migration or project, with Claude" onClick={() => setTempLensPanelOpen(!on)}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" /></svg>
      New temporary lens
      {list.length > 0 && <span className="n" aria-label={list.length + ' temporary lenses'}>{list.length}</span>}
    </button>
  );
}

const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : 'date unknown');

function LensRow({ e, slug }: { e: LensEntry; slug: string | null }) {
  const E = useEngine(), ctx = useScanCtx();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  // a live write's answer is the truth until the map that carries it arrives (then the map is)
  const rev = useLive()?.product.structureRev ?? 0;
  const [over, setOver] = useState<{ rev: number; enabled: boolean } | null>(null);
  const enabled = over && over.rev === rev ? over.enabled : e.enabled;
  const m = e.manifest, d = E.M.P.LENS[e.id];
  useBp((s) => s.simV); // a Kettle scan moves the counts
  let measured = 0, na = 0;
  if (d) for (const f of E.M.P.base.features) { const h = f.lens[e.id]?.h; if (h === 'na') na++; else if (h && h !== 'unmeasured') measured++; }

  const run = async (what: string, fn: () => Promise<void> | void) => {
    setBusy(what); setErr(null);
    try { await fn(); } catch (x) { setErr((x as Error).message); } finally { setBusy(null); }
  };
  const toggle = () => run(enabled ? 'retire' : 'restore', async () => {
    if (slug) { const r = await patchLens(slug, e.id, !enabled); setOver({ rev, enabled: r.enabled }); }
    else setTempLensEnabled(e.id, !enabled);
    E.toast(`${m.name} ${enabled ? 'retired' : 'restored'}`, enabled ? 'its tab goes away; its readings are kept' : 'its tab is back with the readings it had');
  });
  const remove = () => run('delete', async () => {
    if (slug) await deleteLens(slug, e.id); else deleteTempLens(e.id);
    E.toast(`${m.name} deleted`, 'its readings stay in the store');
  });

  return (
    <li className={'tl-row' + (enabled ? '' : ' off')}>
      <div className="tl-row-h">
        <LensGlyph g={m.presentation.glyph} size={18} />
        <div className="tl-row-t">
          <b>{m.name}</b>{m.short ? <span className="tl-short">{m.short}</span> : null}
          <small>
            created {day(e.created_at)} · <span className={'st ' + (enabled ? 'on' : 'off')}>{enabled ? 'enabled' : 'retired'}</span>
            {' · '}{!d ? (enabled ? 'not on the plan yet' : 'off the plan') : measured || na ? `${measured} measured · ${na} no impact` : 'not scanned yet'}
          </small>
        </div>
      </div>
      {m.description ? <p className="tl-row-d">{m.description}</p> : null}
      {ask ? (
        <div className="tl-acts tl-ask" role="group" aria-label={'Delete ' + m.name}>
          <span>Delete {m.name}? Readings stay in the store.</span>
          <button type="button" className="tl-bt bad" disabled={!!busy} onClick={() => void remove()} autoFocus>{busy === 'delete' ? 'Deleting…' : 'Delete'}</button>
          <button type="button" className="tl-bt" disabled={!!busy} onClick={() => setAsk(false)}>Keep</button>
        </div>
      ) : (
        <div className="tl-acts">
          {enabled && <button type="button" className="tl-bt go" disabled={!!busy || !d} title={d ? 'Measure every feature under this lens' : 'The plan does not have this lens yet'} onClick={() => void run('scan', () => scanNow(E, ctx, e.id, m.name))}>{busy === 'scan' ? 'Starting…' : 'Scan now'}</button>}
          <button type="button" className="tl-bt" disabled={!!busy} onClick={() => void toggle()}>{busy === 'retire' ? 'Retiring…' : busy === 'restore' ? 'Restoring…' : enabled ? 'Retire' : 'Restore'}</button>
          <button type="button" className="tl-bt" disabled={!!busy} onClick={() => setAsk(true)}>Delete</button>
        </div>
      )}
      {err && <p className="tl-err" role="alert">{err}</p>}
    </li>
  );
}

// -------------------------------------------------------------------------------------- the panel
/** The side panel over the ledger: the product's temporary lenses, then the chat that makes a new one. */
export function TempLensPanel() {
  const on = useTempLensPanelOpen();
  return <AnimatePresence>{on && <Panel key="tl" />}</AnimatePresence>;
}

function Panel() {
  const { slug, list } = useTempLenses();
  const box = useRef<HTMLElement>(null), input = useRef<HTMLTextAreaElement>(null);
  // first focus: the chat when there is nothing to manage yet, else the panel itself (Tab walks from there)
  useEffect(() => { (list.length ? box.current : input.current)?.focus({ preventScroll: true }); /* on open only */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setTempLensPanelOpen(false); return; }
    if (e.key !== 'Tab') return;
    // Tab stays in the panel while focus is in it; a click outside still goes where it lands (polite, not modal)
    const els = Array.from(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') ?? []);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || at === box.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  const enabled = list.filter((e) => e.enabled).length;
  return (
    <motion.aside id="tl-panel" ref={box} className="tl-panel" role="dialog" aria-modal="false" aria-labelledby="tl-title" tabIndex={-1} data-keys="own" onKeyDown={onKey}
      initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}>
      <header className="tl-h">
        <h2 id="tl-title">Temporary lenses</h2>
        <button type="button" className="tl-bt" onClick={() => setTempLensPanelOpen(false)}>Close · Esc</button>
      </header>
      <div className="tl-b">
        <section aria-labelledby="tl-yours">
          <h3 className="tl-sec" id="tl-yours"><span>Your temporary lenses</span><span>{list.length ? `${enabled} enabled · ${list.length - enabled} retired` : 'none yet'}</span></h3>
          {list.length ? <ul className="tl-list">{list.map((e) => <LensRow key={e.id} e={e} slug={slug} />)}</ul>
            : <p className="tl-note">A temporary lens measures one refactor, migration or project across the product, then is retired. {slug ? 'It is written into this product’s map.' : 'Kettle keeps it in this browser.'}</p>}
        </section>
        <section aria-labelledby="tl-new">
          <h3 className="tl-sec" id="tl-new"><span>New lens · with Claude</span><span>up to 3 questions</span></h3>
          <LensChat slug={slug} inputRef={input} />
        </section>
      </div>
    </motion.aside>
  );
}
