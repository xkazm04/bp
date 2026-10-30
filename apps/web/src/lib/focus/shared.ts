// The shared focus on a page (packages/core/src/session/focus.ts): this tab is one reader. It says hello every 15 s,
// publishes where it is looking (coalesced: the last place of a 250 ms burst goes out), follows when asked, and hears every
// change on its own EventSource (GET /api/companion/stream, `event: shared`), with one GET on (re)connect so a reader that
// opens late starts from the record. The page's own echo is suppressed three ways: the server makes no rev for the place
// that is already shared, `toApply` skips this reader's own writes, and a place this tab just flew to because it follows
// is not published back (APPLY_HUSH_MS). The store is module-level: one reader per tab, whatever mounts it.
import { followingWords, sameSpot, toApply, type FocusPlace, type SharedView, type Surface } from '@bp/core/session/focus';

export const FOCUS_URL = '/api/session/focus';
/** The lamp's stream hands `event: shared` on as this window event (companion/CompanionLive.tsx), so a desktop page holds
 *  one companion EventSource, not two: a browser keeps six connections per host, and every live page already streams its product. */
export const SHARED_EVENT = 'bp:shared';
const STREAM_URL = '/api/companion/stream';
const HELLO_MS = 15_000, COALESCE_MS = 250, APPLY_HUSH_MS = 2_500;

export interface SharedState {
  view: SharedView | null;
  /** Whom this reader follows ('*' = whoever moves), or undefined. */
  follows?: string;
  online: boolean;
}
type Listener = () => void;
type Apply = (p: FocusPlace, from: { label: string; surface: Surface }) => void;

const readerKey = 'bp:focus-reader';
function newId(prefix: string): string { return prefix + '-' + Math.random().toString(36).slice(2, 8); }

class SharedFocus {
  readonly me: string;
  surface: Surface = 'web';
  label = 'Web';
  /** A local follower (a stage frame) reads the stream but never writes the record. */
  local = false;
  private state: SharedState = { view: null, online: false };
  private listeners = new Set<Listener>();
  private appliers = new Set<Apply>();
  private applied = 0;
  private hushUntil = 0;
  private lastApplied: FocusPlace | undefined;
  private pending: FocusPlace | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private es: EventSource | null = null;
  private started = false;
  private paused = false;

  constructor() {
    let id = '';
    try { id = sessionStorage.getItem(readerKey) ?? ''; } catch { /* private mode */ }
    if (!/^[\w.:-]{1,80}$/.test(id)) { id = newId('web'); try { sessionStorage.setItem(readerKey, id); } catch { /* this visit only */ } }
    this.me = id;
  }

  /** Stable functions, for useSyncExternalStore. */
  get = (): SharedState => this.state;
  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  /** Publish nothing for `ms`: this page is arriving at a place it was sent to, and where it lands is not news. */
  hush(ms: number): void { this.hushUntil = Date.now() + ms; }
  private landing: FocusPlace | null = null;
  /** A followed place in another product: kept while the product opens in place, for the page's next engine to land on. */
  arrive(p: FocusPlace): void { this.landing = p; }
  takeArrival(product: string): FocusPlace | null { const p = this.landing; if (!p || p.product !== product) return null; this.landing = null; return p; }
  /** While a deck leads (the Morning Watch), the page's own resting places are not published: the deck publishes its cards. */
  pause(on: boolean): void { this.paused = on; }
  /** Called with every place this reader should go to (following, not its own, not seen before). */
  onApply(a: Apply): () => void {
    this.appliers.add(a);
    // a page that mounts again (an in-place product switch) re-reads the record: a move made meanwhile is not lost
    if (this.started) void this.read();
    return () => { this.appliers.delete(a); };
  }
  private set(s: Partial<SharedState>) { this.state = { ...this.state, ...s }; for (const l of this.listeners) l(); }

  /** Start once per tab: the stream, the first read and the heartbeat. */
  start(o: { surface?: Surface; label?: string; local?: boolean; follow?: boolean; viaLamp?: boolean } = {}): void {
    if (o.surface) this.surface = o.surface;
    if (o.label) this.label = o.label;
    if (o.local) { this.local = true; this.state = { ...this.state, follows: '*' }; }
    if (this.started) return;
    this.started = true;
    const open = () => {
      const es = (this.es = new EventSource(STREAM_URL));
      es.addEventListener('shared', (ev) => { try { const e = JSON.parse((ev as MessageEvent<string>).data) as { shared?: SharedView }; if (e.shared) this.take(e.shared); } catch { /* malformed: skipped */ } });
      es.onopen = () => { this.set({ online: true }); void this.read(); };
      es.onerror = () => { this.set({ online: false }); es.close(); if (this.es === es) this.es = null; setTimeout(open, 2000); };
    };
    if (o.viaLamp) {
      addEventListener(SHARED_EVENT, (ev) => { const v = (ev as CustomEvent<SharedView>).detail; if (v) { this.set({ online: true }); this.take(v); } });
      void this.read();
    } else open();
    if (!this.local) {
      void this.post({ op: 'hello' }).then(() => (o.follow ? this.follow('*') : undefined));
      setInterval(() => { if (document.visibilityState !== 'hidden') void this.post({ op: 'hello' }); }, HELLO_MS);
    }
  }

  private async read(): Promise<void> {
    try { const r = await fetch(FOCUS_URL, { cache: 'no-store' }); if (r.ok) { this.set({ online: true }); this.take((await r.json()) as SharedView); } } catch { /* the stream's state says whether the server is there */ }
  }

  private take(v: SharedView): void {
    const mine = v.readers.find((x) => x.id === this.me);
    const follows = this.local ? '*' : mine ? mine.follows : this.state.follows;
    this.set({ view: v, follows });
    const p = toApply(v, this.me, follows, this.applied);
    // only a following reader moves its mark: turning Follow on then goes to where the shared focus is now
    // ...and only while something can apply it: during an in-place switch nothing is mounted, and the move must wait
    if (!this.appliers.size) return;
    if (follows && v.rev > this.applied) this.applied = v.rev;
    if (!p || !v.shared) return;
    this.hushUntil = Date.now() + APPLY_HUSH_MS; this.lastApplied = p;
    for (const a of this.appliers) a(p, { label: v.shared.label, surface: v.shared.surface });
  }

  private async post(body: Record<string, unknown>): Promise<Response | null> {
    if (this.local) return null;
    try {
      const r = await fetch(FOCUS_URL, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reader: this.me, surface: this.surface, label: this.label, ...body }) });
      if (r.ok) { const j = (await r.json()) as { view?: SharedView }; if (j.view) { if (!this.state.online) this.set({ online: true }); this.take(j.view); } }
      return r;
    } catch { return null; }
  }

  /** Where this tab is looking now. Coalesced; skipped while it is arriving at a place it was sent to. */
  publish(p: FocusPlace): void {
    if (this.local || this.paused) return;
    if (Date.now() < this.hushUntil || (sameSpot(p, this.lastApplied) && sameSpot(p, this.state.view?.shared?.place))) return;
    this.pending = p;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { const q = this.pending; this.pending = null; if (q) void this.post({ op: 'publish', place: q }); }, COALESCE_MS);
  }
  /** Publish at once (a deck card: no burst to wait out). */
  publishNow(p: FocusPlace): Promise<Response | null> { clearTimeout(this.timer); this.pending = null; return this.post({ op: 'publish', place: p }); }
  /** Back or forward through the record's history: a publish of a remembered place (one rev; every follower flies). The
   *  place, for this page to go to itself (a reader never applies its own write), or null when there is none that way. */
  async step(dir: 'back' | 'forward'): Promise<FocusPlace | null> {
    const r = await this.post({ op: dir });
    if (!r?.ok) return null;
    const p = this.state.view?.shared?.reader === this.me ? this.state.view.shared.place : null;
    if (p) { this.hushUntil = Date.now() + APPLY_HUSH_MS; this.lastApplied = p; }
    return p;
  }
  follow(of = '*'): Promise<Response | null> { this.set({ follows: of }); return this.post({ op: 'follow', of }); }
  unfollow(): Promise<Response | null> { this.set({ follows: undefined }); return this.post({ op: 'unfollow' }); }
  words(now = Date.now()): string | null {
    const v = this.state.view;
    // this screen put the shared place there itself (a step back or forward): it leads until someone else moves
    if (v?.shared?.reader === this.me && this.state.follows) return 'Shared from this screen';
    return v ? followingWords(v, this.state.follows, now) : this.state.follows ? 'Following' : null;
  }
  /** The other live readers that follow (whoever moves, or this reader). */
  followers(): { id: string; label: string; surface: Surface }[] {
    const v = this.state.view;
    return v ? v.readers.filter((x) => x.id !== this.me && x.live && (x.follows === '*' || x.follows === this.me)).map((x) => ({ id: x.id, label: x.label, surface: x.surface })) : [];
  }
}

let one: SharedFocus | null = null;
/** This tab's reader (created on first use, in the browser only). */
export function sharedFocus(): SharedFocus { return (one ??= new SharedFocus()); }
export type { SharedFocus };
