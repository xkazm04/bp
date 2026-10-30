'use client';
// The plan's right-click menu: run a lens scan on what is under the pointer, at the feature, bay, room, wing or
// everything (narrowest first). In a lens view it offers that lens per scope; in General, per scope, "Scan all
// lenses" and a compact row of lens buttons (glyph + short). A lens without a scan method (live products: no
// built-in and no manifest `scan` block) is shown disabled. When the findings ledger holds a selection, a last group,
// "Ledger selection (n features)", offers the same items over exactly the features behind it (a `selection` scope,
// capped at MAX_SELECTION). Before the click each item states what the scan would repeat (scopeFacts over
// useScanJobs, live and Kettle alike): the job of that lens already on the place, the last read, the queue room; a
// full queue disables every item with the server's words as its description, a duplicate is only shown. The engine opens it (`contextmenu` -> `S.menu`, canvas
// CSS px); it closes on a choice, Esc, Tab, a click elsewhere, a pan or a wheel. Keys are its own (data-keys="own"):
// arrows / Home / End move through the items (ProjectSwitcher's roving focus), Enter or Space chooses.
// A live lens its repo cannot measure yet (ProductInfo.setup: the lens-scan overlay names no probes, scan/lens-setup.ts) is not
// a dead end: its button reads "prepare" and queues a prepare job that adjusts the repo, "Scan all lenses" leaves it out, and in
// its own lens view the scope items stay as "Scan anyway" under a "Prepare repo" item (the menu re-reads the list on opening).
// "Scan all lenses" over Everything on a live product, with no lens left out, is ONE every-lens job (oneJobForAll): one queue
// slot and one read of each feature, not a job per lens; narrower scopes and the Kettle sim keep one job per lens.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { overlayRight } from '@/engine/chrome';
import type { ScanMenuState } from '@/engine/state';
import { glyph, type GlyphSpec } from '@/engine/render/lens-glyph';
import { prepareLens, refusalText, startAllLenses, startScan, startSelectionScan } from '@/lib/scan/actions';
import { MAX_RUNNING, MAX_SELECTION, scannable, type ScanScope } from '@bp/core/scan/jobs';
import { factsWords, queueRoom, scopeFacts } from '@bp/core/scan/views';
import { refreshProjects, useProjects } from '@/lib/scan/projects';
import { oneJobForAll, scopesAt } from '@/lib/scan/scan-views';
import { shallowEqual, useBp, useEngine, useScanCtx } from './hooks';
import { useScanJobs } from './rail/panels';
import { useLedgerSelection } from './ledger/useLedger';
import { useTheme } from './ThemeToggle';
import './scan.css';
import { GENERAL } from '@bp/core/data/types';

const URLS = new Map<string, string>();
/** A lens glyph drawn by the canvas's own `glyph()` into an image (cached by glyph, colour, size and resolution). */
export function ScanGlyph({ g, px = 14 }: { g: GlyphSpec; px?: number }) {
  const mode = useTheme();
  const src = useMemo(() => {
    if (typeof document === 'undefined') return '';
    const col = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#dff0ff';
    const dpr = Math.min(2, window.devicePixelRatio || 1), key = JSON.stringify(g) + '|' + col + '|' + px + '|' + dpr;
    let u = URLS.get(key);
    if (u === undefined) {
      const cv = document.createElement('canvas'), n = Math.ceil(px * dpr), ctx = cv.getContext('2d');
      cv.width = cv.height = n;
      if (ctx) { ctx.scale(dpr, dpr); glyph(ctx, g, 1.5, 1.5, px - 3, col); }
      u = ctx ? cv.toDataURL() : '';
      URLS.set(key, u);
    }
    return u;
    // the theme changes the ink
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, px, mode]);
  return src ? <img className="sm-gl" src={src} width={px} height={px} alt="" aria-hidden="true" /> : null;
}

export function ScanMenu() {
  const s = useBp((s) => ({ menu: s.menu, view: s.view }), shallowEqual);
  // a fresh body per opening (the menu record is new each time): focus and placement start over
  return s.menu ? <MenuBody key={s.menu.x + ',' + s.menu.y + ',' + (s.menu.tile ?? '') + s.menu.chain.map((c) => c.id).join('/')} m={s.menu} view={s.view} /> : null;
}

const focusPlan = () => (document.querySelector('.bp-map') as HTMLElement | null)?.focus({ preventScroll: true });

function MenuBody({ m, view }: { m: ScanMenuState; view: string }) {
  const E = useEngine(), ctx = useScanCtx(), P = E.M.P, { list, error: listError } = useProjects();
  const ref = useRef<HTMLDivElement>(null);
  const sel = useLedgerSelection().features;
  // the ledger's selection, when it has one, as a last scope (the first MAX_SELECTION features in map order)
  const opts = useMemo(() => {
    const at = scopesAt(E.M, m.chain, m.tile);
    if (!sel.length) return at;
    const fs = sel.slice(0, MAX_SELECTION);
    return [...at, { kind: 'selection' as const, title: 'Ledger selection', scope: { kind: 'selection' as const, label: 'Selection (' + fs.length + ')', features: fs } }];
  }, [E, m, sel]);
  const lenses = useMemo(() => P.lenses.map((d) => ({ id: d.id, name: d.name, short: d.short, glyph: d.glyph, ok: scannable({ id: d.id, manifest: d.manifest }, !!ctx.sim) })), [P, ctx.sim]);
  const lensView = view !== GENERAL ? lenses.find((l) => l.id === view) : undefined;
  // what each live lens lacks in the repo; Kettle's sample needs nothing
  const needs = useMemo(() => new Map((ctx.slug ? list?.find((p) => p.slug === ctx.slug)?.setup ?? [] : []).map((n) => [n.lens, n])), [ctx.slug, list]);
  // a live product before the list has ever answered: what each lens needs is not known yet (still reading, or the read
  // failed), which is not the same as "needs nothing". The items stay usable; the footer says the setup is unknown.
  const setupUnknown = !!ctx.slug && list === null ? (listError ? 'error' : 'checking') : null;
  const scanOk = lenses.filter((l) => l.ok && !needs.has(l.id)), off = lenses.filter((l) => !l.ok);
  const needy = lenses.filter((l) => l.ok && needs.has(l.id));
  const viewNeed = lensView ? needs.get(lensView.id) : undefined;
  const T = m.tile ? E.M.L.TILE[m.tile] : undefined, last = m.chain[m.chain.length - 1];
  const at = last ? E.placeById(last.t, last.id) : null;
  const what = T ? T.f.name : opts.find((o) => o.kind !== 'feature' && o.kind !== 'all' && o.kind !== 'selection')?.scope.label ?? (at ? 'this place' : 'the whole plan');
  // the product's checkout, when the project list has answered. Never the slug: the warning below names a
  // directory a scan is about to be let loose in, and a slug is not one.
  const root = ctx.slug ? list?.find((p) => p.slug === ctx.slug)?.root ?? null : null;

  const count = (sc: ScanScope) => (sc.kind === 'all' ? P.base.features.length : sc.features.length);
  // what each (lens, scope) scan would repeat, read once per jobs / rows change
  const { jobs, scan } = useScanJobs(false, true);
  const queue = useMemo(() => queueRoom(jobs), [jobs]);
  const facts = useMemo(() => {
    const now = Date.now(), all = P.base.features.map((f) => f.id), out = new Map<string, ReturnType<typeof factsWords>>();
    for (const o of opts) for (const l of lenses) out.set(l.id + '|' + o.kind, factsWords(scopeFacts({ jobs, scan, lens: l.id, features: o.scope.kind === 'all' ? all : o.scope.features, now }), now));
    return out;
  }, [jobs, scan, opts, lenses, P]);
  const fact = (lens: string, kind: string) => facts.get(lens + '|' + kind)!;
  const qd = queue.full ? 'sm-q' : undefined;
  const close = (refocus = true) => { E.patch({ menu: null }); if (refocus) focusPlan(); };
  const run = (ids: string[], scope: ScanScope) => {
    close();
    const name = (id: string) => P.LENS[id]?.name ?? id;
    if (oneJobForAll(!!ctx.slug, scope, ids, lenses.filter((l) => l.ok).map((l) => l.id))) {
      startAllLenses(ctx, 'measure').then(() => E.toast('Scanning every lens', scope.label + ' · ' + count(scope) + ' features · one job'),
        (e) => E.toast('Scan not started', refusalText(e), undefined, undefined, 'bad'));
      return;
    }
    void Promise.allSettled(ids.map((id) => (scope.kind === 'selection' ? startSelectionScan(ctx, id, scope.features) : startScan(ctx, id, scope)))).then((rs) => {
      const bad = rs.map((r, i) => (r.status === 'rejected' ? name(ids[i]) + ': ' + refusalText(r.reason) : null)).filter((x): x is string => !!x);
      const n = rs.length - bad.length;
      if (bad.length) E.toast(n ? 'Some scans did not start' : 'Scan not started', bad.join('; '), undefined, undefined, n ? 'warn' : 'bad');
      else E.toast(n === 1 ? 'Scanning ' + name(ids[0]) : 'Scanning ' + n + ' lenses', scope.label + ' · ' + count(scope) + ' features');
    });
  };

  const prepare = (id: string) => {
    close();
    const name = P.LENS[id]?.name ?? id;
    prepareLens(ctx, id).then(() => E.toast('Preparing the repo for ' + name, 'Claude Code adds what lens-scan needs to measure it' + (root ? ' in ' + root : '') + '; scan it when the job is done'))
      .catch((e) => E.toast('Repo preparation not started', name + ': ' + refusalText(e), undefined, undefined, 'bad'));
  };
  // the setup verdict comes with the project list: read it again, since a prepare job or a hand edit may have changed the overlay
  useEffect(() => { if (ctx.slug) void refreshProjects(); }, [ctx.slug]);

  // placement: at the pointer, flipped and clamped into the safe area, clear of an open rail flyout
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const u = E.U, S = E.SAFE, R = Math.min(S.r, E.FW - overlayRight(E.S) * u), w = el.offsetWidth * u, h = el.offsetHeight * u;
    let x = m.x + 4 * u, y = m.y + 4 * u;
    if (x + w > R) x = Math.max(S.l, m.x - w - 4 * u);
    if (y + h > S.b) y = Math.max(S.t, S.b - h);
    el.style.transform = `translate(${x / u}px, ${y / u}px)`;
    el.style.maxHeight = (S.b - S.t) / u + 'px';
    el.style.visibility = 'visible';
  }, [E, m]);
  // focus the first item that can run; a click outside closes (without stealing focus from what was clicked)
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? ref.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(false); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement), n = els.length;
    let j = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    // Tab leaves the menu from the plan it was summoned on: focus goes back there first, so the browser's own Tab
    // moves on from the plan, never from <body> (the focused item unmounts with the menu)
    else if (e.key === 'Tab') { close(); return; }
    else return;
    e.preventDefault(); e.stopPropagation();
    els[j]?.focus();
  };

  return (
    <div ref={ref} id="scanmenu" className="sm" role="menu" aria-label={'Scan ' + what} data-keys="own" onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()} style={{ visibility: 'hidden' }}>
      <div className="sm-h"><span>Scan</span><b title={what}>{what}</b></div>
      {queue.running + queue.queued > 0 && <div id="sm-q" className={'sm-q' + (queue.full ? ' warn' : '')}>{queue.full ? queue.why : queue.running + ' of ' + MAX_RUNNING + ' running · ' + queue.queued + ' queued'}</div>}
      {lensView && viewNeed && (
        <button type="button" role="menuitem" tabIndex={-1} className={'sm-it need' + (queue.full ? ' off' : '')} aria-disabled={queue.full ? true : undefined} aria-describedby={qd} title={viewNeed.why} onClick={() => !queue.full && prepare(lensView.id)}>
          <ScanGlyph g={lensView.glyph} />
          <span className="t">Prepare repo for {lensView.name}</span>
          <span className="n">needs setup</span>
        </button>
      )}
      {opts.map((o) => lensView ? (
        <button key={o.kind} type="button" role="menuitem" tabIndex={-1} className={'sm-it' + (lensView.ok && !queue.full ? '' : ' off')} aria-disabled={lensView.ok && !queue.full ? undefined : true} aria-describedby={qd}
          title={lensView.ok ? fact(lensView.id, o.kind).say : undefined} onClick={() => lensView.ok && !queue.full && run([lensView.id], o.scope)}>
          <ScanGlyph g={lensView.glyph} />
          <span className="t">{viewNeed ? 'Scan anyway' : 'Scan ' + lensView.name} · <i>{o.title}</i> {o.kind === 'all' || o.kind === 'selection' ? '' : o.scope.label}</span>
          <span className="n">{lensView.ok ? fact(lensView.id, o.kind).n : 'no scan method'}</span>
        </button>
      ) : (
        <div key={o.kind} className="sm-g" role="group" aria-label={o.kind === 'selection' ? 'Ledger selection (' + count(o.scope) + ' features)' : o.title + ': ' + o.scope.label}>
          {o.kind === 'selection' ? <div className="sm-h"><span>Ledger selection</span><b>{count(o.scope)} features{sel.length > MAX_SELECTION ? ' of ' + sel.length + ' selected' : ''}</b></div> : null}
          <button type="button" role="menuitem" tabIndex={-1} className={'sm-it' + (scanOk.length && !queue.full ? '' : ' off')} aria-disabled={scanOk.length && !queue.full ? undefined : true} aria-describedby={qd}
            onClick={() => scanOk.length && !queue.full && run(scanOk.map((l) => l.id), o.scope)}>
            <span className="t">Scan all lenses · <i>{o.title}</i> {o.kind === 'all' || o.kind === 'selection' ? '' : o.scope.label}</span>
            <span className="n">{count(o.scope)}</span>
          </button>
          <div className="sm-ls">
            {lenses.map((l) => {
              const need = l.ok ? needs.get(l.id) : undefined;
              if (need) return (
                <button key={l.id} type="button" role="menuitem" tabIndex={-1} className={'sm-l need' + (queue.full ? ' off' : '')} aria-disabled={queue.full ? true : undefined} aria-describedby={qd}
                  aria-label={'Prepare the repo for ' + l.name + ': ' + need.why} title={l.name + ' needs repo setup: ' + need.why} onClick={() => !queue.full && prepare(l.id)}>
                  <ScanGlyph g={l.glyph} px={12} />{l.short}<span className="bz"> · prepare</span>
                </button>
              );
              const f = l.ok ? fact(l.id, o.kind) : null, why = f ? ': ' + f.say : ': no scan method';
              return (
                <button key={l.id} type="button" role="menuitem" tabIndex={-1} className={'sm-l' + (l.ok && !queue.full ? '' : ' off')} aria-disabled={l.ok && !queue.full ? undefined : true} aria-describedby={qd}
                  aria-label={'Scan ' + l.name + ', ' + o.title.toLowerCase() + why} title={l.name + why}
                  onClick={() => l.ok && !queue.full && run([l.id], o.scope)}>
                  <ScanGlyph g={l.glyph} px={12} />{l.short}{f?.tag ? <span className="bz"> · {f.tag}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {(lensView ? !!viewNeed : needy.length > 0) && <div className="sm-f need">{lensView ? viewNeed!.why : needy.map((l) => l.name + ': ' + needs.get(l.id)!.why).join('; ')}. Prepare queues Claude Code to add it to the repo.</div>}
      {(lensView ? !lensView.ok : off.length > 0) && <div className="sm-f">No scan method: {(lensView ? [lensView] : off).map((l) => l.name).join(', ')}. Add a manifest <code>scan</code> block to scan it.</div>}
      {setupUnknown === 'checking' && <div className="sm-f" role="status">Checking which lenses need repo setup…</div>}
      {setupUnknown === 'error' && (
        // no Try again item: the menu reads the list again on every opening (below), so reopening it is the retry
        <div className="sm-f need" role="status">{listError} - setup unknown: a lens may need repo setup this menu cannot see. Reopen the menu to read the list again.</div>
      )}
      {ctx.slug && <div className="sm-f warn">Runs Claude Code {root ? <>in <code>{root}</code></> : 'in this product’s checkout'} with permissions skipped</div>}
    </div>
  );
}
