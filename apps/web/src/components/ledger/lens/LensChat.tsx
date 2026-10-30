'use client';
// The lens onboarding chat: the person picks Permanent (a project lens, reverse-DNS id; the default) or Temporary
// (a tmp.* lens for one refactor, migration or project), then describes what to measure; Claude Code
// (POST /api/lens-draft with that `kind`: the server runs `/lens-scan onboard --draft-only`, Kettle included) asks
// at most 3 questions, then drafts a lens manifest the route has already checked. The card checks it again with
// checkLensManifest in the chosen mode against the looks (glyph + line) of the product's other enabled lenses.
// Add lens is addProjectLens(ctx, manifest, temporary): a live product through POST /lenses (the map's `map` event
// brings the new lens to every client), the Kettle sample into this browser. Messages are plain text, never markup.
//
// The chat lives in a module store, not in the component: closing the panel mid-turn neither loses the
// conversation nor cancels Claude (only Cancel does), and reopening shows the answer when it came.
//
// A message sent while Claude answers is never dropped (chat-transcript/composer-turn-queue): it becomes a queued row
// at once and is sent when the turn settles; a second one joins it (one follow-up turn, not two). Edit takes it back
// into the box. A turn that fails or is cancelled does not send it: it goes back into the box with the failed text.
import { useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import type { LensManifest } from '@bp/core/standard/types';
import { postLensDraft } from '@/lib/scan/client';
import { checkLensManifest, type TakenLook } from '@bp/core/scan/manifest-check';
import { addProjectLens } from '@/lib/scan/actions';
import { takenLooks } from '@bp/core/scan/jobs';
import { useEngine, useScanCtx } from '../../hooks';
import { DraftCard, type DraftState } from './DraftCard';
import { scanNow } from './lens-ops';

const MAX = 4000;
/** Permanent: a project lens kept with the product. Temporary: one refactor, migration or project, then retired. */
export type LensKind = 'project' | 'temporary';
export const FIRST_PLACEHOLDER: Record<LensKind, string> = {
  project: 'Describe what this lens should measure across the product, and what a feature looks like when it does well or badly.',
  temporary: 'Describe the refactor, migration or project, and what a feature looks like when it is affected.',
};

// -------------------------------------------------------------------------------------- the store
export interface Msg { n: number; who: 'you' | 'claude' | 'note'; text: string; err?: boolean }
export interface ChatState {
  product: string;
  /** What the chat drafts; fixed once the first message is sent (New chat changes it). */
  kind: LensKind;
  msgs: Msg[];
  /** The CLI session the next turn resumes; absent before the first answer. */
  session?: string;
  /** performance.now() when the turn in flight started; null when idle. */
  since: number | null;
  /** The textarea's text (kept while the panel is closed). */
  text: string;
  /** The text of the turn that failed, for Retry. */
  retry: string | null;
  /** A message sent while a turn was in flight: sent as the next turn once this one answers. */
  queued: string | null;
  draft: LensManifest | null;
  dstate: DraftState;
  derr: string | null;
  scanning: boolean;
}

const fresh = (product: string): ChatState => ({ product, kind: 'project', msgs: [], since: null, text: '', retry: null, queued: null, draft: null, dstate: 'new', derr: null, scanning: false });
let S: ChatState = fresh('kettle');
let N = 0, ctl: AbortController | null = null;
const subs = new Set<() => void>();
const put = (p: Partial<ChatState>) => { S = { ...S, ...p }; for (const f of [...subs]) f(); };
const say = (who: Msg['who'], text: string, err?: boolean) => put({ msgs: [...S.msgs, { n: ++N, who, text, ...(err ? { err } : {}) }] });
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const get = () => S;
const isStarted = () => S.msgs.length > 0 || S.draft !== null;
/** Whether the chat has a conversation (the panel then shows it open). */
export function useChatStarted(): boolean { return useSyncExternalStore(subscribe, isStarted, () => false); }

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
  if (!msg || msg.length > MAX) return;
  if (S.since !== null) { // busy: queue it, never drop it
    const q = S.queued ? S.queued + '\n\n' + msg : msg;
    if (q.length > MAX) return;
    put({ queued: q, text: S.text.trim() === msg ? '' : S.text });
    return;
  }
  const product = S.product, session = S.session, kind = S.kind;
  say('you', msg);
  put({ text: S.text.trim() === msg ? '' : S.text, retry: null, since: performance.now() });
  const ac = new AbortController(); ctl = ac;
  try {
    const a = await postLensDraft(product, msg, session, kind, ac.signal);
    if (S.product !== product) return; // the chat was reset meanwhile
    // the route checked the draft; check its shape again here (the card adds the looks the product already draws)
    const bad = a.draft ? checkLensManifest(a.draft, { mode: kind }) : null;
    put({ session: a.session ?? session, since: null });
    if (a.reply) say('claude', a.reply);
    if (a.draft && !bad) put({ draft: a.draft, dstate: 'new', derr: null });
    else if (a.error || bad) say('note', `The drafted lens was refused: ${a.error ?? bad}. Say what to change, or ask Claude to send the lens again.`, true);
    const q = S.queued; // the follow-up written during this turn goes now, as its own turn
    if (q !== null) { put({ queued: null }); void send(q); }
  } catch (e) {
    if (S.product !== product) return;
    const aborted = (e as Error).name === 'AbortError';
    // the message goes back into the box: the server never answered it (Claude's own session may or may not keep it)
    const last = S.msgs[S.msgs.length - 1];
    // a queued follow-up was written for a turn that did not answer: back into the box with it, never sent on its own
    const back = [S.text || msg, S.queued].filter(Boolean).join('\n\n');
    put({ since: null, msgs: last?.who === 'you' && last.text === msg ? S.msgs.slice(0, -1) : S.msgs, text: back, retry: aborted ? null : msg, queued: null });
    say('note', aborted
      ? `Cancelled. The server stopped Claude Code for this turn; ${session ? "the chat goes on from Claude's last answer" : 'nothing was kept'}, and your message is back in the box.`
      : failure(e), !aborted);
  } finally { if (ctl === ac) ctl = null; }
}

function cancel() { ctl?.abort(); }
/** Take the queued message back into the box to change it (it is not sent until submitted again). */
function unqueue() { const q = S.queued; if (q === null) return; put({ queued: null, text: S.text.trim() ? q + '\n\n' + S.text : q }); }

/** Start over: a new CLI session (the old one is left alone on the server). Cancels a turn in flight. */
export function resetChat(product?: string) { const kind = S.kind; ctl?.abort(); ctl = null; S = { ...fresh(product ?? S.product), kind }; for (const f of [...subs]) f(); }

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
  // the looks the product's other enabled lenses draw: a draft with the same glyph AND line is refused
  const P = E.M.P;
  const taken = useMemo<TakenLook[]>(() => takenLooks(P.lenses.map((d) => ({ id: d.id, enabled: true, manifest: d.manifest })), s.draft?.id ?? ''), [P, s.draft]);
  const refusal = useMemo(() => (s.draft && s.dstate !== 'added' ? checkLensManifest(s.draft, { mode: s.kind, taken }) : null), [s.draft, s.dstate, s.kind, taken]);

  const accept = async () => {
    const m = S.draft; if (!m || S.dstate !== 'new') return;
    const bad = checkLensManifest(m, { mode: S.kind, taken });
    if (bad) { put({ derr: `This lens cannot be added: ${bad}. Ask Claude to fix it.` }); return; }
    put({ dstate: 'saving', derr: null });
    try {
      if (P.LENS[m.id]) throw Object.assign(new Error(`A lens with id ${m.id} exists`), { status: 409 });
      await addProjectLens(ctx, m, S.kind === 'temporary');
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
  const first = !s.msgs.some((m) => m.who === 'claude'), fixed = s.msgs.length > 0 || busy;

  return (
    <div className="tl-chat">
      <fieldset className="tl-kind-pick" disabled={fixed}>
        <legend>Kind of lens{fixed ? ' · New chat to change' : ''}</legend>
        {(['project', 'temporary'] as const).map((k) => (
          <label key={k}>
            <input type="radio" name="tl-kind" value={k} checked={s.kind === k} onChange={() => put({ kind: k })} />
            <span><b>{k === 'project' ? 'Permanent' : 'Temporary'}</b>{k === 'project' ? 'kept with the project, reverse-DNS id' : 'one refactor or migration, tmp.* id'}</span>
          </label>
        ))}
      </fieldset>
      {s.msgs.length > 0 && (
        <ol className="tl-msgs" aria-label="Conversation with Claude" aria-live="polite">
          {s.msgs.map((m) => (
            <li key={m.n} className={'tl-m ' + m.who + (m.err ? ' err' : '')}>
              {m.who !== 'note' && <span className="who">{m.who === 'you' ? 'You' : 'Claude'}</span>}
              <p>{m.text}</p>
            </li>
          ))}
          {s.queued !== null && (
            <li className="tl-m you queued">
              <span className="who">You · queued, sends when Claude answers</span>
              <p>{s.queued}</p>
              <button type="button" className="tl-bt" onClick={() => { unqueue(); inputRef.current?.focus(); }} title="Take it back into the box to change it">Edit</button>
            </li>
          )}
        </ol>
      )}
      {s.draft && <DraftCard draft={s.draft} kind={s.kind} state={s.dstate} error={s.derr ?? (refusal ? `This lens cannot be added: ${refusal}. Ask Claude to fix it.` : null)} blocked={!!refusal} onAccept={() => void accept()} onRefine={() => inputRef.current?.focus()} onScan={() => void scan()} scanBusy={s.scanning} />}
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
          placeholder={first ? FIRST_PLACEHOLDER[s.kind] : 'Answer Claude, or say what to change in the lens.'} aria-label="Message to Claude"
          onChange={(e) => put({ text: e.target.value })} onKeyDown={onKey} />
        <div className="tl-in-b">
          <span className="hint">{busy ? 'Enter queues it for after this answer' : 'Enter sends'} · Shift+Enter new line</span>
          {s.msgs.length > 0 && <button type="button" className="tl-bt" onClick={() => resetChat()} title="Start a new lens: a new conversation">New chat</button>}
          <button type="submit" className="tl-bt go" disabled={!s.text.trim()} title={busy ? 'Claude is still answering: this goes as the next message' : undefined}>{busy ? 'Queue' : 'Send'}</button>
        </div>
      </form>
    </div>
  );
}
