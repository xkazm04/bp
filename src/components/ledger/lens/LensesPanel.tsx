'use client';
// The Lenses panel on the findings ledger: a button that opens a side panel listing every lens of the product
// (built-in, project and temporary, in the map's order) with what can be done to each, above the onboarding chat
// with Claude (LensChat). The two exports are placed independently (the ledger's slots), so whether the panel is open,
// and which row to bring into view, is a tiny module store here, not either component's state.
//
// A row: glyph and line sample, name and short, the kind (built-in / project / temporary), measured n of m features,
// open findings, and a ring while a measure or execute job is on the lens. Actions: enable / disable (project and
// temporary only: built-ins are set in the map, the PATCH route refuses them), Scan all, Scan selection (the features
// behind the ledger's selection), Execute backlog (n) with an inline confirm, Delete (project and temporary) with an
// inline confirm. An action that cannot run stays in the Tab order and says why when chosen (aria-disabled).
// Rows and counts come from lens-ops.ts; nothing below branches on a lens id or on which product it is, beyond the
// enable and delete writes.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { deleteLens, patchLens } from '@/lib/scan/client';
import { deleteTempLens, setTempLensEnabled } from '@/lib/scan/temp-lens';
import { MAX_SELECTION } from '@/lib/scan/jobs';
import { useBp, useEngine, useLive, useScanCtx, useWritesOn } from '../../hooks';
import { useLedgerSelection } from '../useLedger';
import { LensGlyph, LineSample } from './DraftCard';
import { LensChat, useChatStarted } from './LensChat';
import { executeAsk, executeBacklog, scanBlock, scanNow, scanSelection, useLensRows, useLensStats, type LensRow } from './lens-ops';
import './lens.css';

// ------------------------------------------------------------------------------- open/closed store
let st: { open: boolean; lens: string | null } = { open: false, lens: null };
let opener: HTMLElement | null = null;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const get = () => st;
const CLOSED = { open: false, lens: null };
/** Open or close the panel; `lens` brings that lens's row into view and focuses it. Closing returns focus to whatever
 *  opened it. */
export function setLensesPanelOpen(v: boolean, lens: string | null = null) {
  if (v === st.open && lens === st.lens) return;
  if (v && !st.open) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  st = { open: v, lens: v ? lens : null };
  for (const f of [...subs]) f();
  // a lens-set rebuild (a lens enabled, disabled or deleted) remounts the chrome: the opener may be gone, its button is not
  if (!v) { const o = opener; opener = null; (o?.isConnected ? o : document.querySelector<HTMLElement>('.tl-open'))?.focus(); }
}
const focused = () => { if (!st.lens) return; st = { ...st, lens: null }; for (const f of [...subs]) f(); };
function usePanel() { return useSyncExternalStore(subscribe, get, () => CLOSED); }

/** "Lenses" (+ how many the product has); opens the panel. */
export function LensesButton() {
  const { rows } = useLensRows(), on = usePanel().open;
  return (
    <button type="button" className="tl-open" aria-expanded={on} aria-controls={on ? 'tl-panel' : undefined}
      title="Every lens of the product: enable, scan, execute its backlog, or onboard a new one with Claude" onClick={() => setLensesPanelOpen(!on)}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M9.6 9.6 14 14" stroke="currentColor" strokeWidth="1.6" /></svg>
      Lenses
      <span className="n" aria-label={rows.length + ' lenses'}>{rows.length}</span>
    </button>
  );
}

const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : null);
const KIND_TIP: Record<LensRow['kind'], string> = {
  'built-in': 'built-in lenses are set in the map',
  project: 'a permanent lens of this project (reverse-DNS id)',
  temporary: 'a temporary lens: one refactor, migration or project, then retired',
};

function Row({ r, slug, sel }: { r: LensRow; slug: string | null; sel: readonly string[] }) {
  const E = useEngine(), ctx = useScanCtx(), stat = useLensStats().get(r.id), writes = useWritesOn();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ask, setAsk] = useState<'delete' | 'execute' | null>(null);
  // a live write's answer is the truth until the map that carries it arrives (then the map is)
  const rev = useLive()?.product.structureRev ?? 0;
  const [over, setOver] = useState<{ rev: number; enabled: boolean } | null>(null);
  const enabled = over && over.rev === rev ? over.enabled : r.enabled;
  const m = r.manifest, d = r.def, name = m.name;
  useBp((s) => s.simV); // a Kettle scan moves the counts
  const all = E.M.P.base.features.length;
  let measured = 0, na = 0;
  if (d) for (const f of E.M.P.base.features) { const h = f.lens[r.id]?.h; if (h === 'na') na++; else if (h && h !== 'unmeasured') measured++; }

  const run = async (what: string, fn: () => Promise<unknown> | void) => {
    setBusy(what); setErr(null); setNote(null);
    try { await fn(); } catch (x) { setErr((x as Error).message); } finally { setBusy(null); }
  };
  const temp = r.kind === 'temporary', builtin = r.kind === 'built-in';
  const writable = !builtin && (slug !== null || r.stored);
  const toggle = () => run(enabled ? 'off' : 'on', async () => {
    if (slug) { const x = await patchLens(slug, r.id, !enabled); setOver({ rev, enabled: x.enabled }); }
    else setTempLensEnabled(r.id, !enabled);
    E.toast(`${name} ${enabled ? (temp ? 'retired' : 'disabled') : (temp ? 'restored' : 'enabled')}`, enabled ? 'its tab goes away; its readings are kept' : 'its tab is back with the readings it had');
  });
  const remove = () => run('delete', async () => {
    if (slug) await deleteLens(slug, r.id); else deleteTempLens(r.id);
    E.toast(`${name} deleted`, 'its readings stay in the store');
  });
  // an action that cannot run says why (it stays in the Tab order)
  const act = (key: string, label: string, why: string | null, go: () => void, cls = '', busyText = 'Starting…') => (
    <button type="button" className={'tl-bt' + (cls ? ' ' + cls : '')} disabled={!!busy} aria-disabled={why ? true : undefined} title={why ?? undefined}
      onClick={() => { if (why) { setErr(null); setNote(why); } else go(); }}>{busy === key ? busyText : label}</button>
  );
  const block = scanBlock({ ...r, enabled }, !!ctx.sim);
  const n = stat.backlog, j = stat.job;

  return (
    <li className={'tl-row' + (enabled ? '' : ' off')} data-lens={r.id} tabIndex={-1} aria-label={name}>
      <div className="tl-row-h">
        <span className="tl-look"><LensGlyph g={m.presentation.glyph} size={18} /><LineSample line={m.presentation.line} w={28} h={8} /></span>
        <div className="tl-row-t">
          <b>{name}</b>{m.short ? <span className="tl-short">{m.short}</span> : null}
          <span className={'tl-kind k-' + r.kind.replace('-', '')} title={KIND_TIP[r.kind]}>{r.kind}</span>
          {j ? <i className={'tl-job ' + j.status} role="img" aria-label={(j.kind === 'measure' ? 'A scan' : 'An execute job') + ' is ' + j.status} title={(j.kind === 'measure' ? 'Scan ' : 'Execute ') + j.id + ' ' + j.status} /> : null}
          <small>
            <span className={'st ' + (enabled ? 'on' : 'off')}>{enabled ? 'enabled' : temp ? 'retired' : 'disabled'}</span>
            {' · '}{!d ? (enabled ? 'not on the plan yet' : 'off the plan') : `measured ${measured} of ${all}` + (na ? ` · ${na} no impact` : '')}
            {' · '}{stat.open ? `${stat.open} open ${stat.open === 1 ? 'finding' : 'findings'}` : 'no open findings'}
            {day(r.created_at) ? ' · created ' + day(r.created_at) : ''}
          </small>
        </div>
      </div>
      {m.description ? <p className="tl-row-d">{m.description}</p> : null}
      {ask === 'delete' ? (
        <div className="tl-acts tl-ask" role="group" aria-label={'Delete ' + name}>
          <span>Delete {name}? Readings stay in the store.</span>
          <button type="button" className="tl-bt bad" disabled={!!busy} onClick={() => void remove()} autoFocus>{busy === 'delete' ? 'Deleting…' : 'Delete'}</button>
          <button type="button" className="tl-bt" disabled={!!busy} onClick={() => setAsk(null)}>Keep</button>
        </div>
      ) : ask === 'execute' ? (
        <div className="tl-acts tl-ask" role="group" aria-label={'Execute the ' + name + ' backlog'}>
          <span>{executeAsk(n)}</span>
          <button type="button" className="tl-bt go" disabled={!!busy} autoFocus onClick={() => void run('execute', async () => { if (await executeBacklog(E, ctx, r.id, name)) setAsk(null); })}>{busy === 'execute' ? 'Starting…' : 'Build ' + n}</button>
          <button type="button" className="tl-bt" disabled={!!busy} onClick={() => setAsk(null)}>Keep</button>
        </div>
      ) : (
        <div className="tl-acts">
          {act('scan', 'Scan all', block, () => void run('scan', () => scanNow(E, ctx, r.id, name)), 'go')}
          {act('sel', sel.length ? `Scan selection (${Math.min(sel.length, MAX_SELECTION)})` : 'Scan selection', block ?? (sel.length ? null : 'Select findings in the ledger first'),
            () => void run('sel', () => scanSelection(E, ctx, [{ id: r.id, name }], sel)))}
          {writes ? act('execute', `Execute backlog (${n})`, n ? null : 'Nothing to build: no proposed or approved finding without a job', () => setAsk('execute')) : null}
          {builtin ? null : act(enabled ? 'off' : 'on', enabled ? (temp ? 'Retire' : 'Disable') : (temp ? 'Restore' : 'Enable'),
            writable ? null : 'This lens is in the sample map; it cannot be changed here', () => void toggle(), '', enabled ? 'Disabling…' : 'Enabling…')}
          {builtin ? null : act('delete', 'Delete', writable ? null : 'This lens is in the sample map; it cannot be changed here', () => setAsk('delete'))}
        </div>
      )}
      {sel.length > MAX_SELECTION && !ask ? <p className="tl-note in">A selection scan takes the first {MAX_SELECTION} of the {sel.length} selected features.</p> : null}
      {note && <p className="tl-note in" role="status">{note}</p>}
      {err && <p className="tl-err" role="alert">{err}</p>}
    </li>
  );
}

// -------------------------------------------------------------------------------------- the panel
/** The side panel over the ledger: every lens of the product, then the chat that onboards a new one. */
export function LensesPanel() {
  const on = usePanel().open;
  return <AnimatePresence>{on && <Panel key="tl" />}</AnimatePresence>;
}

function Panel() {
  const { slug, rows } = useLensRows(), want = usePanel().lens, sel = useLedgerSelection().features;
  const started = useChatStarted();
  const [chat, setChat] = useState(started);
  const box = useRef<HTMLElement>(null), input = useRef<HTMLTextAreaElement>(null);
  // first focus: the panel itself (Tab walks from there); a lens asked for (a chip's "Open in Lenses panel"): its row
  useEffect(() => {
    const row = want ? box.current?.querySelector<HTMLElement>('[data-lens="' + CSS.escape(want) + '"]') : null;
    if (row) { row.scrollIntoView({ block: 'nearest' }); row.focus({ preventScroll: true }); focused(); }
    else if (!box.current?.contains(document.activeElement)) box.current?.focus({ preventScroll: true });
  }, [want]);
  useEffect(() => { if (chat && !started) input.current?.focus({ preventScroll: true }); }, [chat]); // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setLensesPanelOpen(false); return; }
    if (e.key !== 'Tab') return;
    // Tab stays in the panel while focus is in it; a click outside still goes where it lands (polite, not modal)
    const els = Array.from(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]') ?? []);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || at === box.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  const count = (k: LensRow['kind']) => rows.filter((r) => r.kind === k).length;
  return (
    <motion.aside id="tl-panel" ref={box} className="tl-panel" role="dialog" aria-modal="false" aria-labelledby="tl-title" tabIndex={-1} data-keys="own" onKeyDown={onKey}
      initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}>
      <header className="tl-h">
        <h2 id="tl-title">Lenses</h2>
        <button type="button" className="tl-bt" onClick={() => setLensesPanelOpen(false)}>Close · Esc</button>
      </header>
      <div className="tl-b">
        <section aria-labelledby="tl-all">
          <h3 className="tl-sec" id="tl-all"><span>Every lens</span><span>{count('built-in')} built-in · {count('project')} project · {count('temporary')} temporary</span></h3>
          {rows.length ? <ul className="tl-list">{rows.map((r) => <Row key={r.id} r={r} slug={slug} sel={sel} />)}</ul>
            : <p className="tl-note">This product has no lenses yet.</p>}
          {count('project') + count('temporary') === 0 ? <p className="tl-note">Only the built-in lenses so far. Onboard a lens to measure something of this project’s own.</p> : null}
        </section>
        <section aria-labelledby="tl-new">
          <h3 className="tl-sec" id="tl-new"><span>Onboard a lens · with Claude</span><span>up to 3 questions</span></h3>
          {chat ? <LensChat slug={slug} inputRef={input} />
            : <div className="tl-chat"><button type="button" className="tl-bt go" onClick={() => setChat(true)}>Onboard a lens</button></div>}
        </section>
      </div>
    </motion.aside>
  );
}
