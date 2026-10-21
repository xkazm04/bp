'use client';
// The ledger's keys as people read them, from the one table the handler uses (keymap.ts), so a key shown is a key bound:
// the `?` sheet (contest A/1's `.keys`: every binding of the scope in focus, then the compare panel's while it is open)
// and the footer's short reminder line (SHORT). The sheet closes on Esc or ? (LedgerPage's handler) or a click outside.
import { useEffect, useRef } from 'react';
import { KEYMAP, SHORT, keyName, type KeyAction, type KeyBinding, type KeyScope } from './keymap';
import './DecisionBar.css';

const TITLE: Record<KeyScope, string> = { packs: 'In packs', backlog: 'Backlog', compare: 'Compare panel', release: 'Release' };
const keysOf = (b: KeyBinding) => b.keys.map(keyName).join(' ');

/** Bindings with the same label folded (J K ↓ ↑ read as one line: next and previous). */
function lines(scope: KeyScope): { keys: string; label: string }[] {
  const out: { keys: string; label: string }[] = [], bs = KEYMAP[scope];
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i], nx = bs[i + 1];
    if (b.action === 'next' && nx?.action === 'prev') { out.push({ keys: [b.keys[0], nx.keys[0], b.keys[1], nx.keys[1]].filter(Boolean).map(keyName).join(' '), label: 'move through items' }); i++; continue; }
    if (b.action === 'view1' && bs[i + 2]?.action === 'view3') { const v = [b, nx, bs[i + 2]]; out.push({ keys: v.map((x) => keyName(x.keys[0])).join(' '), label: v.map((x) => x.label).join(' · ') }); i += 2; continue; }
    out.push({ keys: keysOf(b), label: b.label });
  }
  return out;
}

export function KeysSheet({ scopes, onClose }: { scopes: readonly KeyScope[]; onClose(): void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    return () => { back?.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className="tr-keys" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label="Keyboard" tabIndex={-1}>
        <h3>Keyboard · the ledger owns these keys</h3>
        {scopes.map((s, i) => (
          <section key={s}>
            {i ? <h4>{TITLE[s]}</h4> : null}
            <dl>{lines(s).map((l) => <div key={l.keys} style={{ display: 'contents' }}><dt>{l.keys}</dt><dd>{l.label}</dd></div>)}</dl>
          </section>
        ))}
        <p>Esc or ? to close.</p>
      </div>
    </div>
  );
}

const WORD: Partial<Record<KeyAction, string>> = { next: 'move', select: 'select', open: 'open', accept: 'accept', rework: 'rework', descope: 'descope', undo: 'undo', help: 'keys', dispatch: 'dispatch', dispatchFocused: 'dispatch this', build: 'build', finish: 'finish', theme: 'theme', mode: 'mode', wide: 'wide' };

/** The footer's reminder: the scope's few keys, "J/K move · X select · Enter compare · A accept · ? keys". */
export function KeyLine({ scope }: { scope: KeyScope }) {
  return (
    <span className="tr-hint">
      {SHORT[scope].map((a, i) => {
        const b = KEYMAP[scope].find((x) => x.action === a);
        if (!b) return null;
        const prev = a === 'next' ? KEYMAP[scope].find((x) => x.action === 'prev') : undefined;
        const k = prev ? keyName(b.keys[0]) + '/' + keyName(prev.keys[0]) : keyName(b.keys[0]);
        const w = a === 'open' && scope === 'packs' ? 'compare' : WORD[a] ?? b.label;
        return <span key={a}>{i ? ' · ' : ''}<kbd>{k}</kbd>{w}</span>;
      })}
    </span>
  );
}
