'use client';
// The card that starts a directed scan: one lens, a scope fixed by where it was opened from, and a note saying what to look for
// (scan/focus.ts is the note's one door; actions.ts startDirectedScan its one way out). The plan's right-click, the ledger's lens
// menu and a Lenses row all open it through openDirectedScan, a tiny module store like the Lenses panel's, because those entries
// sit in unrelated subtrees and the card has to outlive the menu that opened it.
//
// A modal over either surface (registry modal-stack/focus-and-scroll-containment): focus enters the note, Tab cycles inside, Esc
// closes, and the chrome behind is inert while it shows. The host's id is `directed` because the ledger's own inert sweep skips it
// by that id. The toast stays out of the sweep and above the card, since a failed save speaks through it. The invoker is captured
// at open, and one effect cleanup both releases the chrome and returns focus, so a flag flip and a teardown (a lens-set rebuild
// remounts the chrome) each deliver exactly one restore; an invoker that went away falls back to the ledger page or the plan.
// While a start is in flight the card holds (client.ts bounds every request), since closing would read as cancelling a scan that
// has already been asked for.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FOCUS_NOTE_MAX, FOCUS_NOTE_MIN, checkFocusNote, type SavedFocus } from '@bp/core/scan/focus';
import type { ScanScope } from '@bp/core/scan/jobs';
import { queueRoom } from '@bp/core/scan/views';
import { deleteFocus, listFocuses, refusalText, saveFocus, startDirectedScan } from '@/lib/scan/actions';
import { useEngine, useScanCtx } from './hooks';
import { scanBlock, useLensRows } from './ledger/lens/lens-ops';
import { useScanJobs } from './rail/panels';
import './directed-scan.css';

/** What the lens menus' whole-product entry scans. */
export const EVERYTHING_SCOPE: ScanScope = { kind: 'all', label: 'Everything', features: [] };

export interface DirectedAsk { lens?: string; scope: ScanScope }

let st: (DirectedAsk & { seq: number }) | null = null, seq = 0;
let opener: HTMLElement | null = null;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const get = () => st, none = () => null;
const emit = () => { for (const f of [...subs]) f(); };

/** Open the card for this scope, with the lens already chosen when the entry was a lens's. */
export function openDirectedScan(ask: DirectedAsk) {
  if (!st) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  st = { ...ask, seq: ++seq };
  emit();
}
function closeDirectedScan() { st = null; emit(); }

export function DirectedScan() {
  const a = useSyncExternalStore(subscribe, get, none);
  return a ? <Card key={a.seq} ask={a} /> : null;
}

const landmark = () => document.querySelector<HTMLElement>('.lg-page') ?? document.querySelector<HTMLElement>('.bp-map');
const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]';

function Card({ ask }: { ask: DirectedAsk }) {
  const E = useEngine(), ctx = useScanCtx(), { rows } = useLensRows(), { jobs } = useScanJobs(false, true);
  const host = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null), area = useRef<HTMLTextAreaElement>(null), alive = useRef(true);
  const [lens, setLens] = useState(ask.lens ?? ''), [note, setNote] = useState(''), [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<readonly SavedFocus[] | null>(null), [listErr, setListErr] = useState<string | null>(null);

  const ok = useMemo(() => rows.filter((r) => !scanBlock(r, !!ctx.sim)), [rows, ctx.sim]);
  const queue = useMemo(() => queueRoom(jobs), [jobs]);
  const chosen = ok.find((r) => r.id === lens);
  const n = note.replace(/\r\n/g, '\n').trim().length, valid = checkFocusNote(note);
  const noteWhy = valid ? null : !n ? 'Say what this scan should look for.'
    : n < FOCUS_NOTE_MIN ? `A note takes at least ${FOCUS_NOTE_MIN} characters.`
      : n > FOCUS_NOTE_MAX ? `The note is ${n - FOCUS_NOTE_MAX} over the limit.` : 'The note holds a control character.';
  const why = queue.full ? queue.why ?? 'The queue is full.' : !ok.length ? 'No lens here can be scanned.' : !chosen ? 'Choose a lens.' : noteWhy;
  const count = ask.scope.kind === 'all' ? E.M.P.base.features.length : ask.scope.features.length;

  useLayoutEffect(() => {
    const me = host.current, held: HTMLElement[] = [];
    me?.closest('.bp')?.querySelectorAll<HTMLElement>('.bp-map, .bp-ui > *').forEach((el) => {
      if (el === me || el.inert || el.id === 'toast' || el.classList.contains('toast-live')) return;
      el.inert = true; held.push(el);
    });
    area.current?.focus({ preventScroll: true });
    alive.current = true;
    return () => {
      alive.current = false;
      for (const el of held) el.inert = false; // first: focus cannot land on an element that is still inert
      const o = opener;
      if (!st) opener = null;
      (o?.isConnected ? o : landmark())?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let live = true;
    listFocuses(ctx).then((l) => { if (live) setSaved(l); }, (e) => { if (live) { setSaved([]); setListErr(refusalText(e)); } });
    return () => { live = false; };
    // the product, not the context object's identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.slug, ctx.sim]);

  const forLens = useMemo(() => (saved ?? []).filter((s) => s.lens === lens), [saved, lens]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); if (!busy) closeDirectedScan(); return; }
    if (e.key !== 'Tab') return;
    const els = Array.from(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || at === box.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };

  const start = async () => {
    if (busy || why || !valid || !chosen) return;
    setBusy(true); setErr(null);
    const name = chosen.manifest.name;
    if (save) {
      try { await saveFocus(ctx, chosen.id, valid); }
      catch (e) { E.toast('Focus not saved', refusalText(e) + ' · the scan still starts', undefined, undefined, 'warn'); }
    }
    try {
      await startDirectedScan(ctx, chosen.id, ask.scope, valid);
    } catch (e) {
      // the card stays with the note intact; if it went away meanwhile, the toast is the only place left to say why
      if (alive.current) { setErr(refusalText(e)); setBusy(false); }
      else E.toast('Scan not started', name + ': ' + refusalText(e), undefined, undefined, 'bad');
      return;
    }
    if (alive.current) closeDirectedScan();
    E.toast('Scanning ' + name, ask.scope.label + ' · ' + count + (count === 1 ? ' feature' : ' features') + ' · directed');
  };

  const fill = (s: SavedFocus) => { setNote(s.note); area.current?.focus({ preventScroll: true }); };
  const forget = (s: SavedFocus) => {
    setSaved((l) => (l ?? []).filter((x) => x.id !== s.id));
    area.current?.focus({ preventScroll: true }); // the button that had focus is about to go
    deleteFocus(ctx, s.id).catch((e) => {
      if (alive.current) setSaved((l) => [s, ...(l ?? [])]);
      E.toast('Focus not deleted', refusalText(e), undefined, undefined, 'bad');
    });
  };

  return (
    // a press on the dimmed page beneath keeps focus where it is
    <div id="directed" ref={host} className="ds-host" onMouseDown={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}>
      <div ref={box} className="ds-card" role="dialog" aria-modal="true" aria-labelledby="ds-title" tabIndex={-1} data-keys="own" onKeyDown={onKey}>
        <h2 id="ds-title">Directed scan</h2>
        <label className="ds-f">
          <span>Lens</span>
          <select value={chosen ? lens : ''} disabled={busy} onChange={(e) => setLens(e.target.value)}>
            {chosen ? null : <option value="">Choose a lens</option>}
            {ok.map((r) => <option key={r.id} value={r.id}>{r.manifest.name}</option>)}
          </select>
        </label>
        <p className="ds-f ds-scope"><span>Scope</span><b title={ask.scope.label}>{ask.scope.label}</b><i>{count} {count === 1 ? 'feature' : 'features'}</i></p>
        <label className="ds-f ds-note">
          <span>What to look for</span>
          <textarea ref={area} rows={4} value={note} readOnly={busy} aria-describedby="ds-n" placeholder="Coverage of framer motion transitions on pages and large sections" onChange={(e) => setNote(e.target.value)} />
        </label>
        <p id="ds-n" className={'ds-n' + (n > FOCUS_NOTE_MAX ? ' over' : '')}>{n}/{FOCUS_NOTE_MAX}</p>
        <section className="ds-saved" aria-label="Saved focuses">
          <h3>Saved focuses</h3>
          {listErr ? <p className="ds-q">The saved focuses could not be read: {listErr}</p>
            : saved === null ? <p className="ds-q" role="status">Reading saved focuses…</p>
              : !chosen ? <p className="ds-q">Choose a lens to see its saved focuses.</p>
                : !forLens.length ? <p className="ds-q">None saved for {chosen.manifest.name} yet.</p>
                  : (
                    <ul>
                      {forLens.map((s) => (
                        <li key={s.id}>
                          <button type="button" className="ds-sv" title={s.note} disabled={busy} onClick={() => fill(s)}>{s.note}</button>
                          <button type="button" className="ds-x" aria-label={'Delete saved focus: ' + s.note.slice(0, 60)} title="Delete this saved focus" disabled={busy} onClick={() => forget(s)}>×</button>
                        </li>
                      ))}
                    </ul>
                  )}
        </section>
        <label className="ds-save"><input type="checkbox" checked={save} disabled={busy} onChange={(e) => setSave(e.target.checked)} /> Save this focus for {chosen ? chosen.manifest.name : 'the lens'}</label>
        {err ? <p className="ds-err" role="alert">{err}</p> : null}
        {why ? <p className="ds-why" role="status">{why}</p> : null}
        <div className="ds-a">
          <button type="button" className="ds-bt go" aria-disabled={why || busy ? true : undefined} title={why ?? undefined} onClick={() => void start()}>{busy ? 'Starting…' : 'Start scan'}</button>
          <button type="button" className="ds-bt" disabled={busy} onClick={closeDirectedScan}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
