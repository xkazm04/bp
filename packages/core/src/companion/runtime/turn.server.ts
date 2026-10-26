// STUB (P0, spark companion-upgrade): P1 replaces the bodies; the signatures are the contract other packages build against.
// A turn is a function: (conversation, input) -> a stream of typed events. One lock per conversation; cancel is an outcome.
import type { TurnEvent, TurnRequest, LegKind } from '../contract.ts';

if (typeof window !== 'undefined') throw new Error('turn.server.ts is server-only');

export class ThreadBusy extends Error { constructor(readonly conversationId: string) { super('thread_busy'); } }

/** Runs one turn. Throws ThreadBusy synchronously-before-first-event when the conversation already has a turn. */
export async function* runTurn(req: TurnRequest): AsyncGenerator<TurnEvent> {
  void req;
  throw new Error('runTurn: not built yet (P1)');
}

/** Cancels a running turn; false when none runs under that id. */
export function cancelTurn(turnId: string): boolean { void turnId; return false; }

export interface LegRequest { kind: LegKind; prompt: string; system?: string; maxMs?: number }
export interface LegResult { ok: boolean; text: string; costUsd: number | null; failure?: string }
/** The one model door: every non-turn leg (utility, sleep) goes through it, and its kind is required. */
export async function runLeg(req: LegRequest): Promise<LegResult> { void req; throw new Error('runLeg: not built yet (P1)'); }

export interface ConversationInfo { id: string; product?: string; title: string; updatedAt: string; turns: number }
export function listConversations(): ConversationInfo[] { return []; }
