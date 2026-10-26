// The companion runtime's files under companionHome(): one JSON file per conversation (conversations/<id>.json, written
// atomically: a temp file then a rename) and the leg ledger (ledger.jsonl, one row per turn and per leg, appended). A
// conversation keeps the CLI's session id and the hash of the static prompt half it was opened with, so a changed static
// half opens a new session instead of resuming one that was told an older law. Cost is `null` when the CLI did not report
// it (a known unknown), never 0.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LegKind } from '../contract.ts';
import { companionHome } from '../home.server.ts';
import type { ConversationInfo } from './turn.server.ts';

if (typeof window !== 'undefined') throw new Error('store.server.ts is server-only');

/** A conversation id is a file name: a slug of at most 64 characters. */
export const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface Conversation extends ConversationInfo { createdAt: string; sessionId?: string; promptHash?: string }

export interface LedgerRow {
  at: string;
  kind: LegKind;
  model: string;
  conversationId?: string;
  ms: number;
  costUsd: number | null;
  outcome: 'done' | 'interrupted' | 'failed';
  failure?: string;
}

const convDir = () => path.join(companionHome(), 'conversations');
const convFile = (id: string) => path.join(convDir(), `${id}.json`);

export function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 5 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1)); // Windows: a reader holds the target
    }
  }
}

export function newConversationId(): string { return `c-${randomUUID()}`; }

export function readConversation(id: string): Conversation | null {
  if (!CONVERSATION_ID.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(convFile(id), 'utf8')) as Conversation; } catch { return null; }
}

export function saveConversation(c: Conversation): void { writeAtomic(convFile(c.id), JSON.stringify(c, null, 2) + '\n'); }

/** Re-read, change and write one conversation (a title written after its turn released the lock must not undo the next turn). */
export function patchConversation(id: string, f: (c: Conversation) => void): void {
  const c = readConversation(id);
  if (c) { f(c); saveConversation(c); }
}

/** Every conversation, newest first. An unreadable file is skipped. */
export function listStored(): ConversationInfo[] {
  let names: string[];
  try { names = fs.readdirSync(convDir()).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out: ConversationInfo[] = [];
  for (const n of names) {
    const c = readConversation(n.slice(0, -5));
    if (c) out.push({ id: c.id, ...(c.product ? { product: c.product } : {}), title: c.title, updatedAt: c.updatedAt, turns: c.turns });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export const ledgerFile = () => path.join(companionHome(), 'ledger.jsonl');

/** One row per turn and per leg. A ledger that cannot be written is logged, never a failed turn. */
export function appendLedger(row: Omit<LedgerRow, 'at'>): void {
  try {
    fs.mkdirSync(companionHome(), { recursive: true });
    fs.appendFileSync(ledgerFile(), JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n', 'utf8');
  } catch (e) { console.warn(`companion: ledger row not written (${(e as Error).message})`); }
}
