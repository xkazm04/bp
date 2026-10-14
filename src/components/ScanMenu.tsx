'use client';
// The plan's right-click menu: run a lens scan on what is under the pointer, at the feature, bay, room, wing or
// everything (narrowest first). In a lens view it offers that lens per scope; in General, per scope, "Scan all
// lenses" and a compact row of lens buttons (glyph + short). A lens without a scan method (live products: no
// built-in and no manifest `scan` block) is shown disabled. When the findings ledger holds a selection, a last group,
// "Ledger selection (n features)", offers the same items over exactly the features behind it (a `selection` scope,
// capped at MAX_SELECTION). The engine opens it (`contextmenu` -> `S.menu`, canvas
// CSS px); it closes on a choice, Esc, Tab, a click elsewhere, a pan or a wheel. Keys are its own (data-keys="own"):
// arrows / Home / End move through the items (ProjectSwitcher's roving focus), Enter or Space chooses.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { overlayRight } from '@/engine/chrome';
import type { ScanMenuState } from '@/engine/state';
import { glyph, type GlyphSpec } from '@/engine/render/lens-glyph';
import { refusalText, startScan, startSelectionScan } from '@/lib/scan/actions';
import { MAX_SELECTION, scannable, type ScanScope } from '@/lib/scan/jobs';
import { useProjects } from '@/lib/scan/projects';
import { scopesAt } from '@/lib/scan/scan-views';
import { shallowEqual, useBp, useEngine, useScanCtx } from './hooks';
import { useLedgerSelection } from './ledger/useLedger';
import { useTheme } from './ThemeToggle';
import './scan.css';

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
  const E = useEngine(), ctx = useScanCtx(), P = E.M.P, { list } = useProjects();
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
  const lensView = view !== 'general' ? lenses.find((l) => l.id === view) : undefined;
  const scanOk = lenses.filter((l) => l.ok), off = lenses.filter((l) => !l.ok);
  const T = m.tile ? E.M.L.TILE[m.tile] : undefined, last = m.chain[m.chain.length - 1];
  const at = last ? E.placeById(last.t, last.id) : null;
  const what = T ? T.f.name : opts.find((o) => o.kind !== 'feature' && o.kind !== 'all' && o.kind !== 'selection')?.scope.label ?? (at ? 'this place' : 'the whole plan');
  const root = ctx.slug ? list?.find((p) => p.slug === ctx.slug)?.root ?? ctx.slug : null;

  const close = (refocus = true) => { E.patch({ menu: null }); if (refocus) focusPlan(); };
  const run = (ids: string[], scope: ScanScope) => {
    close();
    const name = (id: string) => P.LENS[id]?.name ?? id;
    void Promise.allSettled(ids.map((id) => (scope.kind === 'selection' ? startSelectionScan(ctx, id, scope.features) : startScan(ctx, id, scope)))).then((rs) => {
      const bad = rs.map((r, i) => (r.status === 'rejected' ? name(ids[i]) + ': ' + refusalText(r.reason) : null)).filter((x): x is string => !!x);
      const n = rs.length - bad.length;
      if (bad.length) E.toast(n ? 'Some scans did not start' : 'Scan not started', bad.join('; '));
      else E.toast(n === 1 ? 'Scanning ' + name(ids[0]) : 'Scanning ' + n + ' lenses', scope.label + ' · ' + (scope.kind === 'all' ? P.base.features.length : scope.features.length) + ' features');
    });
  };

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
    else if (e.key === 'Tab') { close(false); return; }
    else return;
    e.preventDefault(); e.stopPropagation();
    els[j]?.focus();
  };
  const count = (sc: ScanScope) => (sc.kind === 'all' ? P.base.features.length : sc.features.length);

  return (
    <div ref={ref} id="scanmenu" className="sm" role="menu" aria-label={'Scan ' + what} data-keys="own" onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()} style={{ visibility: 'hidden' }}>
      <div className="sm-h"><span>Scan</span><b title={what}>{what}</b></div>
      {opts.map((o) => lensView ? (
        <button key={o.kind} type="button" role="menuitem" tabIndex={-1} className={'sm-it' + (lensView.ok ? '' : ' off')} aria-disabled={lensView.ok ? undefined : true}
          onClick={() => lensView.ok && run([lensView.id], o.scope)}>
          <ScanGlyph g={lensView.glyph} />
          <span className="t">Scan {lensView.name} · <i>{o.title}</i> {o.kind === 'all' || o.kind === 'selection' ? '' : o.scope.label}</span>
          <span className="n">{lensView.ok ? count(o.scope) : 'no scan method'}</span>
        </button>
      ) : (
        <div key={o.kind} className="sm-g" role="group" aria-label={o.kind === 'selection' ? 'Ledger selection (' + count(o.scope) + ' features)' : o.title + ': ' + o.scope.label}>
          {o.kind === 'selection' ? <div className="sm-h"><span>Ledger selection</span><b>{count(o.scope)} features{sel.length > MAX_SELECTION ? ' of ' + sel.length + ' selected' : ''}</b></div> : null}
          <button type="button" role="menuitem" tabIndex={-1} className={'sm-it' + (scanOk.length ? '' : ' off')} aria-disabled={scanOk.length ? undefined : true}
            onClick={() => scanOk.length && run(scanOk.map((l) => l.id), o.scope)}>
            <span className="t">Scan all lenses · <i>{o.title}</i> {o.kind === 'all' || o.kind === 'selection' ? '' : o.scope.label}</span>
            <span className="n">{count(o.scope)}</span>
          </button>
          <div className="sm-ls">
            {lenses.map((l) => (
              <button key={l.id} type="button" role="menuitem" tabIndex={-1} className={'sm-l' + (l.ok ? '' : ' off')} aria-disabled={l.ok ? undefined : true}
                aria-label={'Scan ' + l.name + ', ' + o.title.toLowerCase() + (l.ok ? '' : ': no scan method')} title={l.name + (l.ok ? '' : ': no scan method')}
                onClick={() => l.ok && run([l.id], o.scope)}>
                <ScanGlyph g={l.glyph} px={12} />{l.short}
              </button>
            ))}
          </div>
        </div>
      ))}
      {(lensView ? !lensView.ok : off.length > 0) && <div className="sm-f">No scan method: {(lensView ? [lensView] : off).map((l) => l.name).join(', ')}. Add a manifest <code>scan</code> block to scan it.</div>}
      {root && <div className="sm-f warn">Runs Claude Code in <code>{root}</code> with permissions skipped</div>}
    </div>
  );
}
