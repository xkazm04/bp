'use client';
// The wide flyouts' frame: an optional strip over two panes (a list on the left, the selected item read in full on the
// right). Both panes scroll on their own; the flyout body never scrolls. J/K and the arrows walk the list while
// focus is anywhere in the panel (except a text field), and never reach the engine's document keys.
import { useCallback, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

/** Keys the workbench owns: J/K and up/down move, Home/End jump. */
const MOVE: Record<string, number> = { j: 1, J: 1, ArrowDown: 1, k: -1, K: -1, ArrowUp: -1 };

/** Keys a focused, scrollable detail pane keeps for itself (J/K still walk the list from there). */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End']);

export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
/** Ends a key here: React's root listens on document, as the engine does, so only stopImmediatePropagation keeps the engine from reading it too. */
export function swallow(e: KeyboardEvent) { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }

/**
 * The list's keyboard walk over `ids` (null is a valid entry: the overview row). Focus follows the selection when
 * it was in the list; otherwise the row only scrolls into view.
 */
export function useWalk<T extends string | null>(ids: readonly T[], sel: T, pick: (id: T) => void, list: RefObject<HTMLElement | null>) {
  return useCallback((e: KeyboardEvent) => {
    if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
    // the detail scroller has focus: the keys that scroll a pane belong to it, not to the list walk. They are kept
    // from the engine (which also listens on document) but not preventDefault-ed, so the browser still scrolls.
    if (SCROLL_KEYS.has(e.key) && (e.target as HTMLElement).classList?.contains('wb-body')) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); return; }
    const dir = MOVE[e.key], end = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : -1;
    if (!dir && end < 0) return;
    if (!ids.length) return;
    swallow(e);
    const i = ids.indexOf(sel), j = end >= 0 ? end : i < 0 ? (dir > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + dir));
    const next = ids[j];
    if (next === sel && i >= 0) return;
    const inList = !!list.current?.contains(document.activeElement);
    pick(next);
    requestAnimationFrame(() => {
      const row = list.current?.querySelector<HTMLElement>(`[data-row="${next === null ? '' : CSS.escape(next)}"]`);
      if (!row) return;
      if (inList) row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    });
  }, [ids, sel, pick, list]);
}

/**
 * The frame. `onKey` comes from useWalk; the detail pane's key resets its scroll when the selection changes.
 * The list pane is focusable (tabIndex -1, never a tab stop): it is where a panel hands focus when the row that
 * held it goes and no row can take over, so a write that empties the list cannot drop focus to <body>.
 * The detail is read inside one scroller, .wb-body, which IS a tab stop (tabIndex 0): most details end in a control
 * that focus-scrolling reaches, but a prose-only one (an order's lede, a preset's "What it does") has none, and
 * nothing hands focus to the detail, so -1 would leave it unreachable. The cost is one extra Tab per panel, paid
 * once; the arrows, Home/End and Page keys then scroll it (useWalk yields those four to it).
 */
export function Workbench({ strip, list, listLabel, detail, detailKey, detailLabel, onKey, listRef, cls, bodyRef, onBodyScroll }: {
  strip?: ReactNode; list: ReactNode; listLabel: string; detail: ReactNode; detailKey: string; detailLabel: string;
  onKey: (e: KeyboardEvent) => void; listRef: RefObject<HTMLDivElement | null>; cls?: string;
  /** The detail scroller and its scroll listener, for a panel that follows the reader's scroll (View's section nav). */
  bodyRef?: RefObject<HTMLDivElement | null>; onBodyScroll?: () => void;
}) {
  return (
    <div className={'wb' + (cls ? ' ' + cls : '')} onKeyDown={onKey}>
      {strip && <div className="wb-strip">{strip}</div>}
      <div className="wb-panes">
        <div className="wb-list" ref={listRef} role="region" aria-label={listLabel} tabIndex={-1}>{list}</div>
        <section className="wb-detail" key={detailKey} aria-label={detailLabel}>
          <div className="wb-body" tabIndex={0} ref={bodyRef} onScroll={onBodyScroll}>{detail}</div>
        </section>
      </div>
    </div>
  );
}

/** A selectable list row (an option of the pane's listbox): roving tabindex, Enter/Space select. */
export function Row({ id, on, onPick, cls, children, label, onEnter, onLeave }: {
  id: string | null; on: boolean; onPick: () => void; cls?: string; children: ReactNode; label?: string;
  onEnter?: () => void; onLeave?: () => void;
}) {
  return (
    <li role="option" aria-selected={on} tabIndex={on ? 0 : -1} data-row={id ?? ''} aria-label={label}
      className={'wb-row' + (on ? ' on' : '') + (cls ? ' ' + cls : '')}
      onClick={onPick} onPointerEnter={onEnter} onPointerLeave={onLeave}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { swallow(e); onPick(); } }}>
      {children}
    </li>
  );
}

/** A labelled group of rows inside the list pane. */
export function Group({ head, n, children, label }: { head: ReactNode; n?: ReactNode; children: ReactNode; label: string }) {
  return (
    <div className="wb-grp">
      <h3 className="wb-gh"><span>{head}</span>{n !== undefined && <span>{n}</span>}</h3>
      <ul role="listbox" aria-label={label}>{children}</ul>
    </div>
  );
}

/** A section of the detail pane. */
export function Sec({ head, aside, children, id }: { head: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="wb-sec" id={id}>
      <h4 className="wb-sh"><span>{head}</span>{aside !== undefined && <span>{aside}</span>}</h4>
      {children}
    </section>
  );
}

/** A key figure: big mono number and a label under it. */
export function Fig({ n, label, tone, title }: { n: ReactNode; label: ReactNode; tone?: 'mint' | 'amber' | 'red' | 'ink'; title?: string }) {
  return <div className={'wb-fig' + (tone ? ' t-' + tone : '')} title={title}><b>{n}</b><span>{label}</span></div>;
}

export const useListRef = () => useRef<HTMLDivElement>(null);
