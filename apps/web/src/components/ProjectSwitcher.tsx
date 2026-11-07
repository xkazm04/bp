'use client';
// The header's project control: the current project's name, and a popover that lists the Kettle sample
// plus every product in bp.products.local.json with its readiness (an icon and a word, never colour
// alone), its open proposals and last scan ("3 proposals · scanned 2 h ago"), and "Manage projects…" (a link to
// the /projects page). The closed trigger badges the proposals waiting in the other projects. Choosing one opens
// it in place (switchProduct: `?product=<slug>` is pushed, or dropped for Kettle, keeping the route and the other
// query parameters; BlueprintApp rebuilds the engine with no reload, so a reload or deep link lands on the same
// product). What the rows say and what a choice does live in lib/scan/switcher.ts. The control lives in the chrome
// and holds its own state; opening it re-renders only itself, never the canvas.
import { useEffect, useRef, useState } from 'react';
import { readinessLevel, type ReadinessLevel } from '@bp/core/scan/readiness';
import { refreshProjects, switchProduct, useProductName, useProjects } from '@/lib/scan/projects';
import { attentionWords, switchPlan, switcherItems, triggerAttention, type SwitcherItem } from '@/lib/scan/switcher';
import './projects.css';

/** The readiness level as a shape (outline, half, full; dashed = cannot be drawn). `sample` = the built-in Kettle. */
export function LevelIcon({ level }: { level: ReadinessLevel | 'sample' }) {
  return (
    <svg className="lvl-ic" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      {level === 'sample' ? <path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" fill="currentColor" />
        : level === 'missing' ? <rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.6" />
        : <>
            <rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4" />
            {level === 'measured' && <rect x="2" y="7" width="10" height="5" fill="currentColor" />}
            {level === 'full' && <rect x="2" y="2" width="10" height="10" fill="currentColor" />}
          </>}
    </svg>
  );
}

/** Waiting review work: a small stack of cards plus the count (the shape carries it, never colour alone). */
function WaitIcon() {
  return (
    <svg className="wait-ic" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M3.5 1.5h7v7" fill="none" stroke="currentColor" strokeWidth="1.2" /><rect x="1.5" y="3.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function ProjectSwitcher({ current, fallbackName }: { current: string | null; fallbackName?: string }) {
  const { list, loading, error, stale } = useProjects();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  useEffect(() => { void refreshProjects(); }, []);

  // the scan ages are read against the clock when the list (or the current product) changes, which openMenu re-reads
  const items: SwitcherItem[] = switcherItems(list, current, Date.now());
  const attn = triggerAttention(list, current);
  const cur = current ? list?.find((p) => p.slug === current) : null;
  const regName = useProductName(current, fallbackName || current || '');
  const curName = current ? regName : 'Kettle (sample)';
  const nItems = items.length + 1; // + Manage projects…

  const focusItem = (i: number) => pop.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]')[i]?.focus();
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const openMenu = (at: number | 'current') => {
    setOpen(true);
    void refreshProjects();
    // focus once the popover is in the DOM: the current project by default
    requestAnimationFrame(() => {
      const i = at === 'current' ? Math.max(0, items.findIndex((x) => x.slug === current)) : at;
      focusItem(i < 0 ? nItems - 1 : i);
    });
  };
  const choose = (it: SwitcherItem) => {
    const plan = switchPlan(it, current);
    if (plan === 'close') { close(); return; }
    if (plan === 'none') return; // cannot be drawn: the menu says why
    close(); // focus back on the trigger, which stays in the header across the switch
    switchProduct(plan.go);
  };

  // a click outside closes it (without stealing focus back from what was clicked)
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); openMenu('current'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(nItems - 1); }
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement), n = els.length;
    let j = -1;
    if (e.key === 'ArrowDown') j = (i + 1) % n;
    else if (e.key === 'ArrowUp') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    else if (e.key === 'Tab') { setOpen(false); return; }
    else return;
    e.preventDefault();
    els[j]?.focus();
  };

  return (
    <div className="projsw" data-keys="own">
      <button ref={trigger} type="button" className="projsw-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'projsw-menu' : undefined}
        title={'Project: ' + curName + (attn ? '; ' + attentionWords(attn) : '') + ' (switch or manage projects)'}
        aria-label={'Project: ' + curName + (attn ? ', ' + attentionWords(attn) : '')} onClick={() => (open ? close(false) : openMenu('current'))} onKeyDown={onTriggerKey}>
        {(!current || cur) && <LevelIcon level={cur ? readinessLevel(cur.readiness) : 'sample'} />}
        <span className="nm">{curName}</span>
        {attn && <span className="projsw-wait" aria-hidden="true"><WaitIcon />{attn.n}</span>}
        <svg className="car" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1 5 5 9 1" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </button>
      {open && (
        <div ref={pop} id="projsw-menu" className="projsw-pop" role="menu" aria-label="Projects" onKeyDown={onMenuKey}>
          <div className="projsw-h"><span>Projects</span><span>{loading && !list ? 'reading…' : (list?.length ?? 0) + ' registered'}</span></div>
          {items.map((it) => {
            const on = it.slug === current;
            return (
              <button key={it.slug ?? '-kettle'} type="button" role="menuitemradio" aria-checked={on} aria-disabled={it.off && !on ? true : undefined} tabIndex={-1} className={'projsw-it' + (on ? ' on' : '') + (it.off && !on ? ' off' : '')}
                title={it.title} aria-label={it.aria} onClick={() => choose(it)}>
                <span className="nm">{it.name}{it.off && !on ? <span className="why">{it.title}</span>
                  : it.facts ? <span className="fx">{it.waiting ? <WaitIcon /> : null}{it.facts}</span> : null}</span>
                <span className="lv"><LevelIcon level={it.level} />{it.label}</span>
              </button>
            );
          })}
          {stale && <div className="projsw-err" role="status">{stale === 'removed' ? 'This project was removed from the list.' : 'This project’s root changed.'} <button type="button" className="projsw-rl" onClick={() => location.reload()}>Reload</button></div>}
          {error && <div className="projsw-err" role="alert">{error}</div>}
          <a role="menuitem" tabIndex={-1} className="projsw-it mg" href={'/projects' + (current ? '?product=' + encodeURIComponent(current) : '')}>Manage projects…</a>
        </div>
      )}
    </div>
  );
}
