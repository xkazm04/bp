'use client';
// Remove a project: a real modal dialog (focus kept inside, Esc closes, focus returns to what opened it). It names the
// project, offers the two deletions the server can make (both off by default) and says what always stays.
import { useEffect, useRef, useState } from 'react';
import type { ProductInfo } from '@bp/core/scan/types';
import type { PurgeWord } from './api';
import s from './projects.module.css';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled])';

export function RemoveDialog({ p, onRemove, onClose }: { p: ProductInfo; onRemove: (purge: PurgeWord[]) => Promise<void>; onClose: () => void }) {
  const [store, setStore] = useState(false), [companion, setCompanion] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('[data-first]')?.focus();
    return () => { back?.focus?.(); };
  }, []);
  const close = () => { if (!busy) onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const els = Array.from(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const go = async () => {
    setBusy(true); setErr(null);
    const purge: PurgeWord[] = [...(store ? ['store' as const] : []), ...(companion ? ['companion' as const] : [])];
    try { await onRemove(purge); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const root = p.root.replace(/\\/g, '/').replace(/\/+$/, '');
  return (
    <div className={s.scrim} onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={box} className={s.dlg} role="dialog" aria-modal="true" aria-labelledby="rm-title" aria-describedby="rm-what" onKeyDown={onKey}>
        <h2 id="rm-title">Remove {p.name}?</h2>
        <p id="rm-what">{p.name} (<span className={s.code}>{p.slug}</span>) leaves the project list.</p>
        <label className={s.check}>
          <input type="checkbox" data-first checked={store} disabled={busy} onChange={(e) => setStore(e.target.checked)} />
          <span>Delete the scan data in the repo<small>{root}/.ai/lens-scan: map, history, scores, work files</small></span>
        </label>
        <label className={s.check}>
          <input type="checkbox" checked={companion} disabled={busy} onChange={(e) => setCompanion(e.target.checked)} />
          <span>Delete the companion’s notes about this project<small>Including its conversations and its brain notes, plus its recommendations, cards and permissions. Notes shared with other projects keep their part.</small></span>
        </label>
        <p className={s.stays}>The repo and its code are never touched.</p>
        {err && <p className={s.err} role="alert">{err}</p>}
        <div className={s.dlgActs}>
          <button type="button" className={s.bt} disabled={busy} onClick={close}>Keep it</button>
          <button type="button" className={`${s.bt} ${s.danger}`} disabled={busy} onClick={() => void go()}>{busy ? 'Removing…' : 'Remove ' + p.name}</button>
        </div>
      </div>
    </div>
  );
}
