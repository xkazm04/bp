// The lens chat's in-progress work, kept per product in this tab's sessionStorage (session-resume/layered-place-restoration,
// the in-progress layer): a reload or a crashed tab gives back the conversation, the CLI session it resumes, the box's text
// and the drafted manifest. Lifetime: the tab (sessionStorage), and New chat forgets it. What is never restored as it was:
// a turn in flight (its answer died with the page, so the message goes back into the box, as a cancelled turn's does), a
// queued message (back into the box, never sent on its own), a draft caught mid-save (`new` again: the card checks the
// product's lenses, so an add that did land is refused as a duplicate id, not added twice).
// Pure: no React, the storage passed in, so scripts/check-lens-chat-keep.ts runs it on Node.
import type { LensManifest } from '@bp/core/standard/types';

export type KeptKind = 'project' | 'temporary';
export type KeptDraftState = 'new' | 'saving' | 'added';
export interface KeptMsg { n: number; who: 'you' | 'claude' | 'note'; text: string; err?: boolean }
/** The part of the chat state a reload can give back. */
export interface Kept {
  kind: KeptKind;
  msgs: KeptMsg[];
  session?: string;
  text: string;
  retry: string | null;
  draft: LensManifest | null;
  dstate: KeptDraftState;
}
/** The state as the store holds it: what keep() reads. */
export interface Live extends Kept { product: string; since: number | null; queued: string | null }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const V = 1;
export const keepKey = (product: string) => 'bp.lens-chat.' + product;
const WHO = new Set(['you', 'claude', 'note']);

/** What to write for this state: a turn in flight and the queue are folded into the box, never kept as sent. */
export function toKept(s: Live): Kept {
  let msgs = s.msgs, text = s.text, retry = s.retry;
  if (s.since !== null) {
    const last = msgs[msgs.length - 1];
    if (last?.who === 'you') { msgs = msgs.slice(0, -1); text = [last.text, text.trim() === last.text ? '' : text].filter(Boolean).join('\n\n'); retry = null; }
  }
  if (s.queued) text = [text, s.queued].filter(Boolean).join('\n\n');
  return { kind: s.kind, msgs, ...(s.session ? { session: s.session } : {}), text, retry, draft: s.draft, dstate: s.dstate === 'saving' ? 'new' : s.dstate };
}

/** Read back what keep() wrote for this product; null when nothing usable is there (absent, another version, malformed). */
export function readKept(store: Store | undefined, product: string): Kept | null {
  let raw: string | null = null;
  try { raw = store?.getItem(keepKey(product)) ?? null; } catch { return null; }
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<Kept> & { v?: number };
    if (j.v !== V || !Array.isArray(j.msgs)) return null;
    const msgs = j.msgs.filter((m): m is KeptMsg => !!m && typeof m.n === 'number' && WHO.has(m.who) && typeof m.text === 'string');
    const draft = j.draft && typeof j.draft === 'object' && typeof (j.draft as LensManifest).id === 'string' ? j.draft : null;
    return {
      kind: j.kind === 'temporary' ? 'temporary' : 'project',
      msgs,
      ...(typeof j.session === 'string' && j.session ? { session: j.session } : {}),
      text: typeof j.text === 'string' ? j.text : '',
      retry: typeof j.retry === 'string' ? j.retry : null,
      draft,
      dstate: draft && (j.dstate === 'added' || j.dstate === 'new') ? j.dstate : 'new',
    };
  } catch { return null; }
}

/** Write the state, or forget it when the chat is empty. Quota or private mode: this visit only. */
export function writeKept(store: Store | undefined, s: Live): void {
  if (!store) return;
  const k = toKept(s);
  try {
    if (!k.msgs.length && !k.draft && !k.text.trim()) store.removeItem(keepKey(s.product));
    else store.setItem(keepKey(s.product), JSON.stringify({ v: V, ...k }));
  } catch { /* this visit only */ }
}

export function forgetKept(store: Store | undefined, product: string): void {
  try { store?.removeItem(keepKey(product)); } catch { /* nothing kept */ }
}

/** The tab's sessionStorage, or undefined where there is none (the server render, a blocked storage). */
export function tabStore(): Store | undefined {
  try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage; } catch { return undefined; }
}
