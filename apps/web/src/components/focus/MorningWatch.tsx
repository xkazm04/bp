'use client';
// The Morning Watch on the page: the portfolio standup (GET /api/companion/morning, packages/core/src/companion/morning.ts)
// as a deck over the plan, read one card at a time. Every card about a place publishes it to the shared focus as it is
// shown and flies this page there, so every following surface (a second window, the phone, the VR table) is where the
// owner is reading. Keyboard first: → / Space next, ← back, A approve, D defer, H hold, Esc back to the plan; M opens it
// wherever live products are registered (the sample's simulated "While you were away" keeps M only when none are). A card in another product opens
// that product with `?morning=<card id>`, and the deck picks up there; the window it covers is frozen for the tab
// (sessionStorage) so a morning read across reloads is one morning.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { MorningCard, MorningDeck, Verdict } from '@bp/core/companion/morning';
import { sharedFocus } from '@/lib/focus/shared';
import { useEngine, useLive } from '../hooks';
import { postHuman } from '../crossing/follow';
import { goToPlace } from './FollowHost';
import { refreshProjects, useProjects } from '@/lib/scan/projects';

const SINCE_KEY = 'bp:morning-since', VOICE_KEY = 'bp:morning-voice';
let kept: MorningDeck | null = null;
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

export function MorningWatch({ phone = false }: { phone?: boolean }) {
  const E = useEngine(), live = useLive(), fx = sharedFocus(), here = live?.slug ?? null;
  const st = useSyncExternalStore(fx.subscribe, fx.get, fx.get), calm = useReducedMotion();
  const [open, setOpen] = useState(false);
  // the deck outlives an in-place product switch (this component mounts again on the new engine): no re-read flash
  const [deck, setDeck] = useState<Deck | null>(() => kept);
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
      kept = d;
      setDeck(d);
      return d;
    } catch { return null; }
  }, []);

  const start = useCallback((at: string | null) => { want.current = at; setOpen(true); void load(); }, [load]);
  const close = useCallback(() => { setOpen(false); setDeck(null); kept = null; setI(0); shown.current = null; keepSince(null); setParam(null); fx.pause(false); }, [fx]);

  // on a phone the deck is the clicker: it leads the shared focus and the desk follows (a phone has no plan of its own to fly)
  useEffect(() => { if (phone) fx.start({ surface: 'phone', label: 'Phone' }); }, [phone, fx]);
  // the Kettle sample's page opens the deck too when live products are registered (M stays the sample's own overlay there)
  const projects = useProjects(), anyLive = (projects.list ?? []).some((p) => p.live);
  useEffect(() => { if (!projects.list && !projects.loading) void refreshProjects(); }, [projects.list, projects.loading]);
  // read aloud: this browser's own speech voice (free, offline; not the lamp's voice), off unless asked, kept for the tab
  const [voice, setVoice] = useState(() => { try { return sessionStorage.getItem(VOICE_KEY) === '1'; } catch { return false; } });
  useEffect(() => { try { sessionStorage.setItem(VOICE_KEY, voice ? '1' : '0'); } catch { /* this visit only */ } if (!voice) speechSynthesis?.cancel(); }, [voice]);
  // ?morning=<card id>: this page was opened by the deck (a card in this product); pick up there
  useEffect(() => { const at = new URLSearchParams(location.search).get('morning'); if (at && here) start(at); }, [here, start]);
  useEffect(() => { if (!deck || !want.current) return; const k = deck.cards.findIndex((c) => c.id === want.current); want.current = null; if (k >= 0) setI(k); }, [deck]);
  useEffect(() => {
    fx.pause(open);
    if (!phone) E.setInsetLeft(open ? DECK_INSET : 0);
    if (open) ref.current?.focus({ preventScroll: true });
  }, [open, fx, E, phone]);

  const card: MorningCard | undefined = open && deck ? deck.cards[Math.min(i, deck.cards.length - 1)] : undefined;

  // show the card: publish its place, then fly there (or open its product, which picks the deck up at this card)
  useEffect(() => {
    if (!card || shown.current === card.id) return;
    shown.current = card.id;
    setParam(card.id);
    if (card.kind === 'close') void load();
    const p = card.place;
    if (!p) { if ((card.kind === 'open' || card.kind === 'close') && !phone) E.goHome(); return; }
    void fx.publishNow(p).then(() => {
      if (phone) return;
      fx.hush(4000);
      const why = goToPlace(E, p, { morning: card.id });
      if (why) setSteered((s) => ({ ...s, [card.id + ':where']: { verdict: 'hold', ok: false, text: why } }));
    });
  }, [card, E, fx, load, phone]);

  useEffect(() => {
    if (!card || !voice || typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance([card.kind === 'decision' ? card.productName : '', card.headline, ...card.lines.slice(0, card.kind === 'open' ? 3 : 0).map((l) => l.text)].filter(Boolean).join('. '));
    u.rate = 1.04;
    speechSynthesis.speak(u);
  }, [card, voice]);

  const go = useCallback((d: number) => { if (!deck) return; setI((k) => Math.max(0, Math.min(deck.cards.length - 1, k + d))); }, [deck]);

  const steer = useCallback(async (v: Verdict) => {
    if (!card?.decision || !card.product || busy || (steered[card.id] ?? fromDeck(card, deck))?.ok) return;
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
  }, [card, busy, steered, go, deck]);

  // keys: capture phase, ahead of the plan's own (M is the sample's overlay there)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null, tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!open) {
        if (k === 'm' && (here || phone || anyLive) && !E.S.open && E.S.page === 'plan') { e.preventDefault(); e.stopImmediatePropagation(); start(null); }
        return;
      }
      let hit = true;
      if (k === 'ArrowRight' || k === ' ' || k === 'j' || k === 'PageDown') go(1);
      else if (k === 'ArrowLeft' || k === 'k' || k === 'PageUp') go(-1);
      else if (k === 'Escape' || k === 'm') close();
      else if (k === 'v') setVoice((x) => !x);
      else if (KEYS[k]) void steer(KEYS[k]);
      else hit = false;
      if (hit) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    addEventListener('keydown', on, true);
    return () => removeEventListener('keydown', on, true);
  }, [open, here, E, go, close, steer, start, phone, anyLive]);

  if (!open) {
    return here || phone || anyLive ? <button type="button" id="mw-launch" onClick={() => start(null)} title="The Morning Watch across every live product (M)"><i aria-hidden="true" />Morning Watch<kbd>M</kbd></button> : null;
  }
  const n = deck?.cards.length ?? 0, k = Math.min(i, Math.max(0, n - 1));
  const others = (st.view?.readers ?? []).filter((x) => x.id !== fx.me && x.live && x.follows);
  const s = card ? steered[card.id] ?? fromDeck(card, deck) : undefined, where = card ? steered[card.id + ':where'] : undefined;
  return (
    <section id="mw" ref={ref} tabIndex={-1} role="dialog" aria-modal="false" aria-label="Morning Watch" data-keys="own">
      <div className="mw-top">
        <span className="kk">Morning Watch · {deck ? `${k + 1} of ${n}` : 'reading the stores…'}</span>
        <span className="who">{others.length ? <>Following: <b>{others.map((x) => x.label).join(', ')}</b></> : 'No other screen follows'}</span>
      </div>
      <div className="bar" role="tablist" aria-label="Cards">
        {deck?.cards.map((c, j) => (
          <button key={c.id} type="button" role="tab" aria-selected={j === k} aria-label={`${j + 1}: ${c.headline}`} title={c.headline} onClick={() => setI(j)}
            className={[j === k ? 'cur' : j < k ? 'done' : '', c.kind === 'decision' ? 'd' : '', (steered[c.id] ?? fromDeck(c, deck))?.ok ? 'ok' : ''].filter(Boolean).join(' ')} />
        ))}
      </div>
      {deck && deck.products.length > 0 && (
        <div className="prod">{deck.products.map((p) => <span key={p.slug} className={p.slug === card?.product ? 'here' : ''}>{p.name}{p.waiting ? ` · ${p.waiting}` : ''}</span>)}</div>
      )}
      {card ? (
        <motion.div key={card.id} className="card" aria-live="polite" initial={calm ? false : { opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
          <span className={'tag ' + card.tone}>{TAG[card.kind]}{card.productName ? ' · ' + card.productName : ''}</span>
          <h2>{card.headline}</h2>
          {card.lines.length > 0 && <ul>{card.lines.map((l, j) => <li key={j} className={l.tone ?? ''}>{l.text}</li>)}</ul>}
          {card.place && <div className="where">{phone ? (others.length ? 'On ' + others.map((x) => x.label).join(', ') + ' now' : 'No screen follows yet: open bp with ?follow=1') : card.place.product === here ? 'On the plan behind this card' : 'Opening ' + (card.productName ?? card.place.product) + '…'}</div>}
          {where && <div className="steered err">{where.text}</div>}
          {s && <div className={'steered' + (s.ok ? '' : ' err')}>{s.text}</div>}
          {(card.kind === 'open' || card.kind === 'close') && deck && deck.products.length > 0 && <Portfolio deck={deck} jump={(slug) => { const j = deck.cards.findIndex((c) => c.product === slug); if (j >= 0) setI(j); }} />}
          {deck?.skipped?.length ? card.kind === 'open' && <div className="where">Not read: {deck.skipped.map((x) => x.product + ' (' + x.why + ')').join('; ')}</div> : null}
        </motion.div>
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
      <div className="keys"><span><b>→</b> next · <b>←</b> back · <b>A</b> approve · <b>D</b> defer · <b>H</b> hold · <b>Esc</b> close</span>
        <button type="button" className={'mw-voice' + (voice ? ' on' : '')} aria-pressed={voice} onClick={() => setVoice((x) => !x)} title="Read each card aloud with this browser's own voice (V)">{voice ? 'Voice on' : 'Voice'} <b>V</b></button></div>
    </section>
  );
}

/** A verdict given this morning, as the deck reports it after a reload (a hold from an earlier morning is still open). */
function fromDeck(c: MorningCard, d: Deck | null): Steered | undefined {
  const r = c.decision?.steered;
  if (!r || !d || r.at < d.since) return undefined;
  return { verdict: r.verdict, ok: true, text: `${VERB[r.verdict]} at ${new Date(r.at).toTimeString().slice(0, 5)}. Logged.` };
}

/** The opening card's portfolio: one row per product, what moved overnight and what waits. A row opens that product's cards. */
function Portfolio({ deck, jump }: { deck: Deck; jump: (slug: string) => void }) {
  return (
    <table className="pf">
      <thead><tr><th>Product</th><th>Built</th><th>Failed</th><th>Release</th><th>Waiting</th></tr></thead>
      <tbody>
        {deck.products.map((p) => (
          <tr key={p.slug} onClick={() => jump(p.slug)} title={'Go to ' + p.name}>
            <td><button type="button" onClick={(e) => { e.stopPropagation(); jump(p.slug); }}>{p.name}</button></td>
            <td className={p.built ? 'good' : ''}>{p.built || '·'}</td>
            <td className={p.failed ? 'bad' : ''}>{p.failed || '·'}</td>
            <td className={p.short ? 'bad' : p.confirmed ? 'good' : ''}>{p.releases ? (p.short ? `${p.short} short` : `${p.confirmed} confirmed`) : '·'}</td>
            <td className={p.waiting ? 'warn' : ''}>{p.waiting || '·'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TAG: Record<MorningCard['kind'], string> = { open: 'This morning', built: 'Built overnight', release: 'Release', quiet: 'Quiet night', decision: 'Decision', close: 'Done' };
