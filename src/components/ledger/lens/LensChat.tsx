'use client';
// The temporary-lens onboarding chat: the person describes the refactor, migration or project; Claude Code
// (POST /api/lens-draft, the real CLI on the server, Kettle included) asks at most 3 questions, then drafts
// a lens manifest the route has already checked. Accept writes it: a live product through POST /lenses
// (the map's `map` event brings the new lens to every client), the Kettle sample into this browser
// (temp-lens.ts; the model rebuilds on that store's subscription). Messages are plain text, never markup.
//
// The chat lives in a module store, not in the component: closing the panel mid-turn neither loses the
// conversation nor cancels Claude (only Cancel does), and reopening shows the answer when it came.
import { useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import type { LensEntry, LensManifest } from '@/lib/standard/types';
import type { LensDraftAnswer } from '@/lib/scan/client';
import { postLens } from '@/lib/scan/client';
import { checkTempManifest } from '@/lib/scan/manifest-check';
import { addTempLens, readTempLenses } from '@/lib/scan/temp-lens';
import { startScan, type ScanCtx } from '@/lib/scan/actions';
import type { ScanScope } from '@/lib/scan/jobs';
import type { Engine } from '@/engine/Engine';
import { useEngine, useScanCtx } from '../../hooks';
import { DraftCard, type DraftState } from './DraftCard';

const MAX = 4000;
export const FIRST_PLACEHOLDER = 'Describe the refactor, migration or project, and what a feature looks like when it is affected.';
const EVERYTHING: ScanScope = { kind: 'all', label: 'Everything', features: [] };

/** Start a measure scan of one lens over every feature; the outcome is a toast (a refusal says why). */
export async function scanNow(E: Engine, ctx: ScanCtx, id: string, name: string): Promise<void> {
  try {
    await startScan(ctx, id, EVERYTHING);
    E.toast(`Scanning ${name}`, 'every feature; readings fill the plan as they come');
  } catch (e) {
    E.toast(`Could not start the ${name} scan:`, (e as Error).message);
  }
}

// -------------------------------------------------------------------------------------- the store
export interface Msg { n: number; who: 'you' | 'claude' | 'note'; text: string; err?: boolean }
export interface ChatState {
  product: string;
  msgs: Msg[];
  /** The CLI session the next turn resumes; absent before the first answer. */
  session?: string;
  /** performance.now() when the turn in flight started; null when idle. */
  since: number | null;
  /** The textarea's text (kept while the panel is closed). */
  text: string;
  /** The text of the turn that failed, for Retry. */
  retry: string | null;
  draft: LensManifest | null;
  dstate: DraftState;
  derr: string | null;
  scanning: boolean;
}

const fresh = (product: string): ChatState => ({ product, msgs: [], since: null, text: '', retry: null, draft: null, dstate: 'new', derr: null, scanning: false });
let S: ChatState = fresh('kettle');
let N = 0, ctl: AbortController | null = null;
const subs = new Set<() => void>();
const put = (p: Partial<ChatState>) => { S = { ...S, ...p }; for (const f of [...subs]) f(); };
const say = (who: Msg['who'], text: string, err?: boolean) => put({ msgs: [...S.msgs, { n: ++N, who, text, ...(err ? { err } : {}) }] });
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const get = () => S;

/** One turn, cancellable (client.ts's postLensDraft takes no signal). Rejects like it: an Error with `status` and `body`. */
async function turn(product: string, message: string, session: string | undefined, signal: AbortSignal): Promise<LensDraftAnswer> {
  const r = await fetch('/api/lens-draft', {
    method: 'POST', cache: 'no-store', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify(session ? { product, message, session } : { product, message }),
  });
  const j = (await r.json().catch(() => null)) as unknown;
  if (!r.ok) throw Object.assign(new Error((j as { error?: string } | null)?.error ?? `HTTP ${r.status}`), { status: r.status, body: j });
  if (!j || typeof j !== 'object' || typeof (j as LensDraftAnswer).reply !== 'string') throw Object.assign(new Error('the server answered no reply'), { status: 502 });
  return j as LensDraftAnswer;
}

/** What a failed turn says, by status (the route: 503 no CLI, 504 after 3 minutes, 502 the CLI failed). */
function failure(e: unknown): string {
  const st = (e as { status?: number }).status, m = (e as Error).message;
  if (st === 503) return `${m}. Install Claude Code on the server (or set BP_CLAUDE_BIN), then retry.`;
  if (st === 504) return 'Claude took longer than 3 minutes and the server stopped it. Retry, or say it in fewer words.';
  if (st === 502) return `${m}. Retry; if it keeps failing, the server log has the rest.`;
  if (st === 404) return `${m}. This product is not on the server's project list.`;
  if (st === 400) return `The server refused the message: ${m}.`;
  if (st === undefined) return `Could not reach the blueprint server (${m}). Retry when it is up.`;
  return `${m} (HTTP ${st}).`;
}

async function send(text: string) {
  const msg = text.trim();
  if (!msg || msg.length > MAX || S.since !== null) return;
  const product = S.product, session = S.session;
  say('you', msg);
  put({ text: S.text.trim() === msg ? '' : S.text, retry: null, since: performance.now() });
  const ac = new AbortController(); ctl = ac;
  try {
    const a = await turn(product, msg, session, ac.signal);
    if (S.product !== product) return; // the chat was reset meanwhile
    // the route checked the draft; check again here so a Kettle draft never reaches the store unchecked
    const bad = a.draft ? checkTempManifest(a.draft) : null;
    put({ session: a.session ?? session, since: null });
    if (a.reply) say('claude', a.reply);
    if (a.draft && !bad) put({ draft: a.draft, dstate: 'new', derr: null });
    else if (a.error || bad) say('note', `The drafted lens was refused: ${a.error ?? bad}. Say what to change, or ask Claude to send the lens again.`, true);
  } catch (e) {
    if (S.product !== product) return;
    const aborted = (e as Error).name === 'AbortError';
    // the message goes back into the box: the server never answered it (Claude's own session may or may not keep it)
    const last = S.msgs[S.msgs.length - 1];
    put({ since: null, msgs: last?.who === 'you' && last.text === msg ? S.msgs.slice(0, -1) : S.msgs, text: S.text || msg, retry: aborted ? null : msg });
    say('note', aborted
      ? `Cancelled. The server stopped Claude Code for this turn; ${session ? "the chat goes on from Claude's last answer" : 'nothing was kept'}, and your message is back in the box.`
      : failure(e), !aborted);
  } finally { if (ctl === ac) ctl = null; }
}

function cancel() { ctl?.abort(); }

/** Start over: a new CLI session (the old one is left alone on the server). Cancels a turn in flight. */
export function resetChat(product?: string) { ctl?.abort(); ctl = null; S = fresh(product ?? S.product); for (const f of [...subs]) f(); }

// ------------------------------------------------------------------------------------- component
function useElapsed(since: number | null): string {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(tick, 1000); // only while a turn is in flight
    return () => clearInterval(t);
  }, [since]);
  if (since === null) return '0:00';
  const s = Math.max(0, Math.floor((performance.now() - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** `slug`: the live product, null for Kettle. `inputRef` lets the panel focus the box. */
export function LensChat({ slug, inputRef }: { slug: string | null; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const E = useEngine(), ctx = useScanCtx(), product = slug ?? 'kettle';
  const s = useSyncExternalStore(subscribe, get, get);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (S.product !== product) resetChat(product); }, [product]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [s.msgs.length, s.draft, s.since]);
  const elapsed = useElapsed(s.since);
  const busy = s.since !== null;

  const accept = async () => {
    const m = S.draft; if (!m || S.dstate !== 'new') return;
    const bad = checkTempManifest(m);
    if (bad) { put({ derr: `This lens cannot be added: ${bad}. Ask Claude to fix it.` }); return; }
    put({ dstate: 'saving', derr: null });
    try {
      if (slug) await postLens(slug, m);
      else {
        if (readTempLenses().some((e) => e.id === m.id) || E.M.P.LENS[m.id]) throw Object.assign(new Error(`A lens with id ${m.id} exists`), { status: 409 });
        const entry: LensEntry = { id: m.id, version: m.version, source: 'project', enabled: true, temporary: true, created_at: new Date().toISOString(), manifest: m };
        addTempLens(entry);
      }
      if (S.draft !== m) return;
      put({ dstate: 'added' });
      E.toast(`Lens ${m.name} added`, 'scan it to measure the features; until then every feature reads ?');
    } catch (e) {
      if (S.draft !== m) return;
      const st = (e as { status?: number }).status, msg = (e as Error).message;
      put({ dstate: 'new', derr: st === 409 ? `${msg}. Ask Claude for another id, or delete the old lens first.` : st === 400 ? `The server refused the lens: ${msg}.` : msg });
    }
  };
  const scan = async () => {
    const m = S.draft; if (!m) return;
    put({ scanning: true });
    await scanNow(E, ctx, m.id, m.name);
    put({ scanning: false });
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(S.text); }
  };
  const first = !s.msgs.some((m) => m.who === 'claude');

  return (
    <div className="tl-chat">
      {s.msgs.length > 0 && (
        <ol className="tl-msgs" aria-label="Conversation with Claude" aria-live="polite">
          {s.msgs.map((m) => (
            <li key={m.n} className={'tl-m ' + m.who + (m.err ? ' err' : '')}>
              {m.who !== 'note' && <span className="who">{m.who === 'you' ? 'You' : 'Claude'}</span>}
              <p>{m.text}</p>
            </li>
          ))}
        </ol>
      )}
      {s.draft && <DraftCard draft={s.draft} state={s.dstate} error={s.derr} onAccept={() => void accept()} onRefine={() => inputRef.current?.focus()} onScan={() => void scan()} scanBusy={s.scanning} />}
      {busy && (
        <div className="tl-wait" role="status">
          <span className="dot" aria-hidden="true" />
          <span>Claude is thinking · <span className="tm">{elapsed}</span></span>
          <button type="button" className="tl-bt" onClick={cancel} title="Stop this turn: the server stops Claude Code">Cancel</button>
        </div>
      )}
      {!busy && s.retry && (
        <div className="tl-wait">
          <span>The last message got no answer.</span>
          <button type="button" className="tl-bt go" onClick={() => { if (S.retry) void send(S.retry); }}>Retry</button>
        </div>
      )}
      <div ref={end} />
      <form className="tl-in" onSubmit={(e) => { e.preventDefault(); void send(S.text); }}>
        <textarea ref={inputRef} value={s.text} rows={first ? 4 : 2} maxLength={MAX} spellCheck
          placeholder={first ? FIRST_PLACEHOLDER : 'Answer Claude, or say what to change in the lens.'} aria-label="Message to Claude"
          onChange={(e) => put({ text: e.target.value })} onKeyDown={onKey} />
        <div className="tl-in-b">
          <span className="hint">Enter sends · Shift+Enter new line</span>
          {s.msgs.length > 0 && <button type="button" className="tl-bt" onClick={() => resetChat()} title="Start a new lens: a new conversation">New chat</button>}
          <button type="submit" className="tl-bt go" disabled={busy || !s.text.trim()}>Send</button>
        </div>
      </form>
    </div>
  );
}
