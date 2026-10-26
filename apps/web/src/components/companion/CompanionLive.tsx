'use client';
// The companion host's body, loaded lazily by CompanionHost: picks the skin (`?lamp=<key>`), builds its LampProps and draws
// it in a layer portalled into the .bp root (fixed and unscaled, so `target` in viewport px is the skin's own px). Two
// paths: `?lamp-fixture=1` plays fixture.ts with no server; otherwise the live path - the stream and turn POST
// (stream.ts) fold into one module store (store.ts) that only this component subscribes to, so a stream event re-renders
// the lamp and nothing else of the chrome. Focus commands run through focus.ts on the Engine; cards show in the slip
// (Cards.tsx) unless the skin owns them. Keys: ' opens the composer from anywhere outside a text field; inside the
// layer (data-keys="own", the plan keys stay off) Esc stops this page's running turn when the composer is empty, else
// closes the composer.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as RKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import type { Card } from '@bp/core/companion/contract';
import { useEngine, useLive } from '../hooks';
import { setLedgerUi, useLedgerUi } from '../ledger/useLedger';
import { projectHref } from '@/lib/scan/projects';
import { frameAt } from './fixture';
import { lampFor, type LampProps, type LampSkin } from './lamps';
import { createStore, deriveLamp, nextDeadline, pendingCards, runningLocal } from './store';
import { answerCard, connect, loadCards, sendTurn, stopTurn } from './stream';
import { planFocus, runFocus, targetRect, type Rect } from './focus';
import { Cards, Notice } from './Cards';
import './companion.css';

/** The global key that opens the composer (not in the Engine's key map, nor the ledger's). */
export const OPEN_KEY = "'";
const AWAY_MS = 10000;

/** One store per page: the stream outlives a remount of the chrome. */
const store = createStore();
const NO_CARDS: Card[] = [];

const isField = (t: EventTarget | null): t is HTMLInputElement | HTMLTextAreaElement =>
  !!t && ((t as HTMLElement).tagName === 'INPUT' || (t as HTMLElement).tagName === 'TEXTAREA');

/** Esc in a field the skin did not handle leaves it (a skin closes its composer on blur when it is empty). */
const blurOnEsc = (e: RKeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && isField(e.target)) e.target.blur(); };

function openComposer(w: HTMLElement | null) {
  const f = w?.querySelector<HTMLElement>('[data-composer]');
  if (f) { f.focus(); return; }
  w?.querySelector<HTMLElement>('[data-lamp-toggle]')?.click();
  requestAnimationFrame(() => w?.querySelector<HTMLElement>('[data-composer]')?.focus());
}

/** Pins the ledger's module store to this page's product before a focus command writes into it (useLedgerUi resets it on
 *  a product change); renders nothing, and only it re-renders on a ledger change. */
function LedgerPin({ product }: { product: string }) { useLedgerUi(product); return null; }

function FixtureLamp({ skin }: { skin: LampSkin }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => setT(performance.now() - t0), 250);
    return () => window.clearInterval(id);
  }, []);
  const props = useMemo((): LampProps => {
    const f = frameAt(t), vw = window.innerWidth, vh = window.innerHeight;
    return {
      state: f.state, caption: f.caption, cards: f.cards ?? NO_CARDS, onSubmit: () => {}, onCard: () => {},
      ...(f.target ? { target: { x: f.target.x * vw, y: f.target.y * vh, w: f.target.w * vw, h: f.target.h * vh } } : {}),
    };
  }, [t]);
  return (
    <>
      <skin.Component {...props} />
      {!skin.ownsCards && <div className="cp-side"><Cards cards={props.cards} onCard={() => {}} /></div>}
    </>
  );
}

function LiveLamp({ skin, product }: { skin: LampSkin; product: string }) {
  const E = useEngine(), wrap = useRef<HTMLDivElement>(null);
  const s = useSyncExternalStore(store.subscribe, store.get, store.get);
  const jobsRunning = useLive()?.product.jobs.some((j) => j.status === 'running') ?? false;
  const [composer, setComposer] = useState({ focused: false, empty: true });
  const [target, setTarget] = useState<Rect | null>(null);
  const [away, setAway] = useState<{ text: string; href: string; n: number } | null>(null);
  const [ticks, tick] = useState(0);

  useEffect(() => connect(store, { onOpen: () => void loadCards(store) }), []);
  // the derived state moves on its own when a pointing window ends or a card or notice expires
  useEffect(() => {
    const d = nextDeadline(s, Date.now()); if (d === null) return;
    const t = setTimeout(() => { store.dispatch({ type: 'prune' }); tick((n) => n + 1); }, Math.max(0, d - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [s, ticks]);
  useEffect(() => { if (!away) return; const t = setTimeout(() => setAway(null), AWAY_MS); return () => clearTimeout(t); }, [away]);

  // a focus command: once per id (the store already drops a repeat; `seen` keeps a dev double-effect from running it twice)
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const f = s.lastFocus?.focus; if (!f) return;
    const plan = planFocus(f, product, seen.current);
    seen.current.add(f.id);
    if (plan.kind === 'skip') return;
    if (plan.kind === 'elsewhere') { setAway((a) => ({ text: plan.text, href: projectHref(plan.product), n: (a?.n ?? 0) + 1 })); return; }
    setTarget(null);
    const why = runFocus(E, plan.steps, setLedgerUi);
    if (why) { store.dispatch({ type: 'notice', text: why }); return; }
    void targetRect(E, plan.rect).then((r) => { if (store.get().lastFocus?.focus.id === f.id) setTarget(r); });
  }, [s.lastFocus, E, product]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== OPEN_KEY || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (isField(t) || t?.tagName === 'SELECT' || t?.isContentEditable || E.S.phone) return;
      e.preventDefault();
      openComposer(wrap.current);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [E]);

  const sync = useCallback(() => {
    const a = document.activeElement, inside = isField(a) && !!wrap.current?.contains(a);
    const n = { focused: inside, empty: !inside || !(a as HTMLInputElement).value.trim() };
    setComposer((c) => (c.focused === n.focused && c.empty === n.empty ? c : n));
  }, []);
  // first Esc in an empty composer while this page's turn runs stops it; the next one closes the composer (the skin's)
  const onKeyCapture = (e: RKeyboardEvent) => {
    if (e.key !== 'Escape' || !isField(e.target) || e.target.value.trim() || !runningLocal(store.get())) return;
    if (stopTurn(store)) { e.preventDefault(); e.stopPropagation(); }
  };

  const lamp = deriveLamp(s, { now: Date.now(), composerFocused: composer.focused, composerEmpty: composer.empty, jobsRunning, product });
  const pending = useMemo(() => pendingCards(s), [s]);
  const cards = pending.length ? pending : NO_CARDS;
  const onSubmit = useCallback((text: string) => { void sendTurn(store, text, product); }, [product]);
  const onCard = useCallback((id: string, d: 'approve' | 'decline') => { void answerCard(store, id, d); }, []);
  const props: LampProps = {
    state: lamp.state, cards, onSubmit, onCard,
    ...(lamp.caption ? { caption: lamp.caption } : {}),
    ...(lamp.state === 'pointing' && target ? { target } : {}),
  };
  return (
    <div ref={wrap} className="cp-host" data-keys="own" data-lamp={skin.key} onKeyDown={blurOnEsc} onKeyDownCapture={onKeyCapture}
      onFocus={sync} onBlur={() => requestAnimationFrame(sync)} onInput={sync}>
      <LedgerPin product={product} />
      <skin.Component {...props} />
      <div className="cp-side">
        <AnimatePresence>{away && <Notice key={away.n} text={away.text} href={away.href} onClose={() => setAway(null)} />}</AnimatePresence>
        {!skin.ownsCards && <Cards cards={s.cards} onCard={onCard} />}
      </div>
    </div>
  );
}

export default function CompanionLive() {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const skin = lampFor(q.get('lamp')), fixture = q.get('lamp-fixture') === '1', product = q.get('product') || 'kettle';
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const anchor = useCallback((el: HTMLSpanElement | null) => setRoot((el?.closest('.bp') as HTMLElement | null) ?? null), []);
  if (!skin) return null;
  return (
    <>
      <span hidden ref={anchor} />
      {root && createPortal(
        fixture
          ? <div className="cp-host" data-keys="own" data-lamp={skin.key} onKeyDown={blurOnEsc}><FixtureLamp skin={skin} /></div>
          : <LiveLamp skin={skin} product={product} />,
        root,
      )}
    </>
  );
}
