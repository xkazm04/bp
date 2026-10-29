'use client';
// The Morning Watch on the page: the portfolio standup (GET /api/companion/morning, packages/core/src/companion/morning.ts)
// as a deck over the plan, read one card at a time. Every card about a place publishes it to the shared focus as it is
// shown and flies this page there, so every following surface (a second window, the phone, the VR table) is where the
// owner is reading. Keyboard first: → / Space next, ← back, A approve, D defer, H hold, Esc back to the plan; M opens it
// on a live product (the Kettle sample keeps its own simulated "While you were away"). A card in another product opens
// that product with `?morning=<card id>`, and the deck picks up there; the window it covers is frozen for the tab
// (sessionStorage) so a morning read across reloads is one morning.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MorningCard, MorningDeck, Verdict } from '@bp/core/companion/morning';
import { sharedFocus } from '@/lib/focus/shared';
import { useEngine, useLive } from '../hooks';
import { postHuman } from '../crossing/follow';
import { goToPlace } from './FollowHost';

const SINCE_KEY = 'bp:morning-since';
/** The deck's right edge in UI px (focus.css #mw: 18 + 460, and a margin): the plan frames places to its right. */
const DECK_INSET = 500;
type Deck = MorningDeck & { skipped?: { product: string; why: string }[] };
type Steered = { verdict: Verdict; ok: boolean; text: string };
const VERB: Record<Verdict, string> = { approve: 'Approved', defer: 'Deferred to tomorrow', hold: 'Held' };
const KEYS: Record<string, Verdict> = { a: 'approve', y: 'approve', d: 'defer', n: 'defer', h: 'hold', b: 'hold' };

function readSince(): string | undefined { try { return sessionStorage.getItem(SINCE_KEY) ?? undefined; } catch { return undefined; } }
function keepSince(s: string | null): void { try { if (s) sessionStorage.setItem(SINCE_KEY, s); else sessionStorage.removeItem(SINCE_KEY); } catch { /* this visit only */ } }
function setParam(id: string | null): void {
  const u = new URL(location.href);
  if (id) u.searchParams.set('morning', id); else u.searchParams.delete('morning');
  try { history.replaceState(history.state, '', u.pathname + u.search + location.hash); } catch { /* ignore */ }
}

export function MorningWatch() {
  const E = useEngine(), live = useLive(), fx = sharedFocus(), here = live?.slug ?? null;
  const st = useSyncExternalStore(fx.subscribe, fx.get, fx.get);
  const [open, setOpen] = useState(false);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [i, setI] = useState(0);
  const [steered, setSteered] = useState<Record<string, Steered>>({});
  const [busy, setBusy] = useState(false);
  const want = useRef<string | null>(null), ref = useRef<HTMLElement>(null), shown = useRef<string | null>(null);

  const load = useCallback(async (): Promise<Deck | null> => {
    const since = readSince();
    try {
      const r = await fetch('/api/companion/morning' + (since ? '?since=' + encodeURIComponent(since) : ''), { cache: 'no-store' });
      if (!r.ok) return null;
      const d = (await r.json()) as Deck;
      if (!since) keepSince(d.since);
      setDeck(d);
      return d;
    } catch { return null; }
  }, []);

  const start = useCallback((at: string | null) => { want.current = at; setOpen(true); void load(); }, [load]);
  const close = useCallback(() => { setOpen(false); setDeck(null); setI(0); shown.current = null; keepSince(null); setParam(null); fx.pause(false); }, [fx]);

  // ?morning=<card id>: this page was opened by the deck (a card in this product); pick up there
  useEffect(() => { const at = new URLSearchParams(location.search).get('morning'); if (at && here) start(at); }, [here, start]);
  useEffect(() => { if (!deck || !want.current) return; const k = deck.cards.findIndex((c) => c.id === want.current); want.current = null; if (k >= 0) setI(k); }, [deck]);
  useEffect(() => {
    fx.pause(open);
    E.setInsetLeft(open ? DECK_INSET : 0);
    if (open) ref.current?.focus({ preventScroll: true });
  }, [open, fx, E]);

  const card: MorningCard | undefined = open && deck ? deck.cards[Math.min(i, deck.cards.length - 1)] : undefined;

  // show the card: publish its place, then fly there (or open its product, which picks the deck up at this card)
  useEffect(() => {
    if (!card || shown.current === card.id) return;
    shown.current = card.id;
    setParam(card.id);
    if (card.kind === 'close') void load();
    const p = card.place;
    if (!p) return;
    void fx.publishNow(p).then(() => {
      fx.hush(4000);
      const why = goToPlace(E, p, { morning: card.id });
      if (why) setSteered((s) => ({ ...s, [card.id + ':where']: { verdict: 'hold', ok: false, text: why } }));
    });
  }, [card, E, fx, load]);

  const go = useCallback((d: number) => { if (!deck) return; setI((k) => Math.max(0, Math.min(deck.cards.length - 1, k + d))); }, [deck]);

  const steer = useCallback(async (v: Verdict) => {
    if (!card?.decision || !card.product || busy || steered[card.id]?.ok) return;
    setBusy(true);
    try {
      const r = await postHuman('/api/companion/morning', { product: card.product, proposal: card.decision.proposal, verdict: v });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      const ok = r.ok;
      const text = ok ? `${VERB[v]}${v === 'approve' ? `: moved to approved in ${card.productName ?? card.product}'s store` : ''}. Logged.` : j.error ?? `HTTP ${r.status}`;
      setSteered((s) => ({ ...s, [card.id]: { verdict: v, ok, text } }));
      if (ok) setTimeout(() => go(1), 900);
    } catch (e) {
      setSteered((s) => ({ ...s, [card.id]: { verdict: v, ok: false, text: (e as Error).message } }));
    } finally { setBusy(false); }
  }, [card, busy, steered, go]);

  // keys: capture phase, ahead of the plan's own (M is the sample's overlay there)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null, tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!open) {
        if (k === 'm' && here && !E.S.open && E.S.page === 'plan') { e.preventDefault(); e.stopImmediatePropagation(); start(null); }
        return;
      }
      let hit = true;
      if (k === 'ArrowRight' || k === ' ' || k === 'j' || k === 'PageDown') go(1);
      else if (k === 'ArrowLeft' || k === 'k' || k === 'PageUp') go(-1);
      else if (k === 'Escape' || k === 'm') close();
      else if (KEYS[k]) void steer(KEYS[k]);
      else hit = false;
      if (hit) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    addEventListener('keydown', on, true);
    return () => removeEventListener('keydown', on, true);
  }, [open, here, E, go, close, steer, start]);

  if (!open) {
    return here ? <button type="button" id="mw-launch" className="bt" onClick={() => start(null)} title="The Morning Watch across every live product (M)">Morning Watch <kbd>M</kbd></button> : null;
  }
  const n = deck?.cards.length ?? 0, k = Math.min(i, Math.max(0, n - 1));
  const others = (st.view?.readers ?? []).filter((x) => x.id !== fx.me && x.live && x.follows);
  const s = card ? steered[card.id] : undefined, where = card ? steered[card.id + ':where'] : undefined;
  return (
    <section id="mw" ref={ref} tabIndex={-1} role="dialog" aria-modal="false" aria-label="Morning Watch" data-keys="own">
      <div className="mw-top">
        <span className="kk">Morning Watch · {deck ? `${k + 1} of ${n}` : 'reading the stores…'}</span>
        <span className="who">{others.length ? <>Following you: <b>{others.map((x) => x.label).join(', ')}</b></> : 'No other screen follows'}</span>
      </div>
      <div className="bar" role="tablist" aria-label="Cards">
        {deck?.cards.map((c, j) => (
          <button key={c.id} type="button" role="tab" aria-selected={j === k} aria-label={`${j + 1}: ${c.headline}`} title={c.headline} onClick={() => setI(j)}
            className={[j === k ? 'cur' : j < k ? 'done' : '', c.kind === 'decision' ? 'd' : '', steered[c.id]?.ok ? 'ok' : ''].filter(Boolean).join(' ')} />
        ))}
      </div>
      {deck && deck.products.length > 0 && (
        <div className="prod">{deck.products.map((p) => <span key={p.slug} className={p.slug === card?.product ? 'here' : ''}>{p.name}{p.waiting ? ` · ${p.waiting}` : ''}</span>)}</div>
      )}
      {card ? (
        <div className="card" aria-live="polite">
          <span className={'tag ' + card.tone}>{TAG[card.kind]}{card.productName ? ' · ' + card.productName : ''}</span>
          <h2>{card.headline}</h2>
          {card.lines.length > 0 && <ul>{card.lines.map((l, j) => <li key={j} className={l.tone ?? ''}>{l.text}</li>)}</ul>}
          {card.place && <div className="where">{card.place.product === here ? 'On the plan behind this card' : 'Opening ' + (card.productName ?? card.place.product) + '…'}</div>}
          {where && <div className="steered err">{where.text}</div>}
          {s && <div className={'steered' + (s.ok ? '' : ' err')}>{s.text}</div>}
          {deck?.skipped?.length ? card.kind === 'open' && <div className="where">Not read: {deck.skipped.map((x) => x.product + ' (' + x.why + ')').join('; ')}</div> : null}
        </div>
      ) : <div className="card"><h2>{deck ? 'Nothing to brief.' : 'Reading every product…'}</h2></div>}
      {card?.kind === 'decision' ? (
        <div className="act">
          <button type="button" className="bt go" disabled={busy || !!s?.ok} onClick={() => void steer('approve')}><kbd>A</kbd> Approve</button>
          <button type="button" className="bt" disabled={busy || !!s?.ok} onClick={() => void steer('defer')}><kbd>D</kbd> Defer</button>
          <button type="button" className="bt" disabled={busy || !!s?.ok} onClick={() => void steer('hold')}><kbd>H</kbd> Hold</button>
        </div>
      ) : (
        <div className="act">
          <button type="button" className="bt" disabled={k === 0} onClick={() => go(-1)}><kbd>←</kbd> Back</button>
          {card?.kind === 'close'
            ? <button type="button" className="bt go" onClick={close}><kbd>Esc</kbd> Back to the plan</button>
            : <button type="button" className="bt go" onClick={() => go(1)}><kbd>→</kbd> Next</button>}
        </div>
      )}
      <div className="keys"><b>→</b> next · <b>←</b> back · <b>A</b> approve · <b>D</b> defer · <b>H</b> hold · <b>Esc</b> close</div>
    </section>
  );
}

const TAG: Record<MorningCard['kind'], string> = { open: 'This morning', built: 'Built overnight', release: 'Release', quiet: 'Quiet night', decision: 'Decision', close: 'Done' };
