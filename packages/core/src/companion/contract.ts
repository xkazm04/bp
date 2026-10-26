// The companion's wire contract (spark companion-upgrade, .spark/Spark/ideas/companion-upgrade.md "Data & API"): every type
// that crosses a process or a package line - the turn stream, cards, focus commands, policy grants, the cross-product inbox
// and coverage gaps. Pure TypeScript, no Node or DOM, so the web client, the server runtime and the MCP door all read it.
// Absent values: an optional field is omitted; `null` only for a known unknown (a cost the CLI did not report).

/** Why a turn failed, read off the CLI's stderr and result record (athena's six classes). */
export type FailureClass = 'gone' | 'poisoned' | 'auth' | 'limit' | 'transient' | 'unknown';

export type TurnEvent =
  | { type: 'start'; turnId: string; conversationId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; args: unknown; callId: string }
  | { type: 'tool_result'; callId: string; ok: boolean; summary: string }
  | { type: 'card'; card: Card }
  | { type: 'focus'; focus: FocusCommand }
  | { type: 'end'; outcome: 'done' | 'interrupted' | 'failed'; failure?: FailureClass; costUsd: number | null };

/** POST /api/companion/turn body. `conversationId` omitted starts a new conversation; `product` scopes memory and tools. */
export interface TurnRequest { conversationId?: string; product?: string; text: string }

/** What the lamp is doing; the web host derives it, a skin only draws it. */
export type LampState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'asking' | 'pointing' | 'working';

export type FocusKind = 'feature' | 'room' | 'wing' | 'decision' | 'wave' | 'release' | 'ledger-row' | 'lens';
/** Show the person a place. The target is always explicit (never "the current selection"). */
export interface FocusCommand { id: string; product: string; target: { kind: FocusKind; id: string }; say?: string }

export type CardState = 'pending' | 'approved' | 'declined' | 'expired' | 'done' | 'failed';
/** A GATED tool call waiting for a person (or a policy). Only a human path may move it out of `pending`. */
export interface Card {
  id: string;
  tool: string;
  args: unknown;
  summary: string;
  product?: string;
  state: CardState;
  createdAt: string;
  decidedBy?: 'human' | 'policy';
  policy?: string;
  result?: string;
}
/** POST /api/companion/cards/[id] body (human token required). */
export interface CardAnswer { decision: 'approve' | 'decline' }

/** A scoped, expiring grant a person writes; a GATED tool it covers runs without a card and is recorded as by policy. */
export interface PolicyGrant { id: string; product: string | '*'; tools: string[]; maxTier?: 0 | 1 | 2 | 3; expiresAt: string; createdAt: string }

export type Verdict = 'approve' | 'decline' | 'rework' | 'descope';
export interface InboxItem {
  product: string;
  id: string;
  kind: 'proposal' | 'triage' | 'question';
  title: string;
  tier?: 0 | 1 | 2 | 3;
  ageMs: number;
  rank: number;
  recommendation?: { verdict: Verdict; why: string };
}

export type GapReason = 'unmeasured' | 'stale' | 'unknown' | 'deviation';
export interface Gap { product: string; feature: string; lens: string; reason: GapReason; score: number }

/** One server-sent event on GET /api/companion/stream (`event: <type>`, `data: <json>`). */
export type CompanionEvent =
  | { type: 'turn'; conversationId: string; event: TurnEvent }
  | { type: 'card'; card: Card }
  | { type: 'focus'; focus: FocusCommand }
  | { type: 'status'; busy: string[]; sleeping: boolean };

/** The header a human path carries; the token is minted per server boot and never given to the MCP process. */
export const HUMAN_HEADER = 'x-bp-human';
/** The MCP server's file, relative to the repo root (the runtime writes it into the CLI's --mcp-config). */
export const MCP_SERVER_PATH = 'apps/mcp/bp-mcp.mjs';
/** The MCP server's name in --mcp-config, so the CLI names its tools mcp__bp__<wire name>. */
export const MCP_SERVER_NAME = 'bp';
/** Models per leg kind (decision 7). */
export const LEG_MODELS = { turn: 'claude-opus-5-5', utility: 'claude-haiku-5-5', sleep: 'claude-haiku-5-5' } as const;
export type LegKind = keyof typeof LEG_MODELS;
