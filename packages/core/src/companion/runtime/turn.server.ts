// The companion's turn engine (spark companion-upgrade P1; registry companion-runtime/headless-turn-stream and
// metered-llm-seam). A turn is a function: (conversation, input) -> a stream of typed events ending in exactly one `end`.
//   lock     one turn per conversation (locks.server.ts); a second one throws ThreadBusy on the generator's first next(),
//            before any event, so the route answers 409 before an SSE header.
//   events   start, the CLI's decoded text / tool / tool_result, then one end. Every event also goes to the bus as
//            { type: 'turn', conversationId, event }, and a status event (the busy conversations) at start and end.
//   stop     cancelTurn(turnId) kills the CLI and ends `interrupted`; a consumer that leaves (the route's client went away)
//            is a cancel too, and its end still reaches the bus and the ledger. The wall is 10 minutes (BP_COMPANION_WALL_MS),
//            past it the turn ends failed/unknown.
//   reseed   a resumed session that fails gone or poisoned is dropped and the turn asked once more, unresumed (static half
//            as the system prompt, the frame with its recall as the reseed); the second answer is final.
//   after    an episode for the brain (done turns), a title from a utility leg after the first turn, and sleepIfDue (also on
//            a 10-minute unref'd interval, started once per process).
// runLeg is the one door for every other model call; its kind is required. Every turn and every leg appends one ledger
// row (store.server.ts). Runtime state (locks, running turns, sessions in flight) is per process: apps/server (:3100) is
// the companion's canonical host; a `next dev` process has its own.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LEG_MODELS, MCP_SERVER_NAME, MCP_SERVER_PATH, type FailureClass, type TurnEvent, type TurnRequest, type LegKind } from '../contract.ts';
import { publish } from '../bus.server.ts';
import { companionHome, repoRoot } from '../home.server.ts';
import { appendEpisode, recallBlock, sleepIfDue } from '../brain/brain.server.ts';
import { childEnv, classify, decodeLine, legArgs, transport, turnArgs, type CliRun, type ResultRecord } from './cli.server.ts';
import { heldKeys, tryAcquire } from './locks.server.ts';
import { dynamicFrame, fence, promptHash, staticHalf, writeStaticHalf } from './prompt.server.ts';
import { CONVERSATION_ID, appendLedger, listStored, newConversationId, patchConversation, readConversation, saveConversation, type Conversation } from './store.server.ts';

if (typeof window !== 'undefined') throw new Error('turn.server.ts is server-only');

export class ThreadBusy extends Error {
  readonly conversationId: string;
  constructor(conversationId: string) { super('thread_busy'); this.conversationId = conversationId; }
}

/** What a transport adds to a turn: the origin the MCP server calls back (the turn request's), default apps/server. */
export interface TurnOptions { origin?: string }

export const DEFAULT_ORIGIN = 'http://127.0.0.1:3100';
const WALL_MS = 10 * 60_000, SLEEP_EVERY_MS = 10 * 60_000, LEG_MS = 120_000, TITLE_MAX = 60;
const wallMs = () => Number(process.env.BP_COMPANION_WALL_MS) || WALL_MS;

type Running = { conversationId: string; halt: (why: 'cancel' | 'wall') => void };
const g = globalThis as unknown as { __bpCompanionTurns?: Map<string, Running>; __bpCompanionSleep?: ReturnType<typeof setInterval>; __bpCompanionWarned?: Set<string> };
const running = (g.__bpCompanionTurns ??= new Map());
const warned = (g.__bpCompanionWarned ??= new Set());
const warnOnce = (key: string, e: unknown) => { if (!warned.has(key)) { warned.add(key); console.warn(`companion: ${key}: ${(e as Error)?.message ?? e}`); } };

function home(): string { const h = companionHome(); fs.mkdirSync(h, { recursive: true }); return h; }

/** The --mcp-config of one conversation: only the bp door, told where bp answers and whose conversation calls it. One file
 *  per conversation, so two conversations' turns never race on one file. */
export function writeMcpConfig(conversationId: string, origin = DEFAULT_ORIGIN): string {
  const f = path.join(home(), 'mcp', `${conversationId}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const cfg = { mcpServers: { [MCP_SERVER_NAME]: { command: process.execPath, args: [path.join(repoRoot(), MCP_SERVER_PATH)], env: { BP_URL: origin, BP_CONVERSATION: conversationId } } } };
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return f;
}

function ensureSleepTimer(): void {
  if (g.__bpCompanionSleep) return;
  g.__bpCompanionSleep = setInterval(() => { void sleepIfDue().catch((e) => warnOnce('sleep', e)); }, SLEEP_EVERY_MS);
  g.__bpCompanionSleep.unref?.();
}

const publishStatus = () => publish({ type: 'status', busy: heldKeys(), sleeping: false });
const addCost = (sum: number | null, c: number | null, last: boolean): number | null => (c === null ? (last ? null : sum) : (sum ?? 0) + c);

/** Runs one turn. Throws ThreadBusy synchronously-before-first-event when the conversation already has a turn. */
export async function* runTurn(req: TurnRequest, opts: TurnOptions = {}): AsyncGenerator<TurnEvent> {
  const text = typeof req?.text === 'string' ? req.text.trim() : '';
  if (!text) throw new Error('text is required');
  if (req.conversationId !== undefined && !CONVERSATION_ID.test(req.conversationId)) throw new Error('conversationId is not a conversation id');
  const id = req.conversationId ?? newConversationId();
  const release = tryAcquire(id);
  if (!release) throw new ThreadBusy(id);

  ensureSleepTimer();
  const now = new Date().toISOString();
  const conv: Conversation = readConversation(id) ?? { id, ...(req.product ? { product: req.product } : {}), title: text.slice(0, TITLE_MAX), createdAt: now, updatedAt: now, turns: 0 };
  const space = conv.product ?? 'core';
  const turnId = randomUUID(), t0 = Date.now();
  let stop: 'cancel' | 'wall' | null = null, run: CliRun | null = null;
  running.set(turnId, { conversationId: id, halt: (why: 'cancel' | 'wall') => { if (!stop) { stop = why; run?.kill(); } } });
  const wall = setTimeout(() => running.get(turnId)?.halt('wall'), wallMs());
  const emit = (e: TurnEvent): TurnEvent => { publish({ type: 'turn', conversationId: id, event: e }); return e; };
  let ended: Extract<TurnEvent, { type: 'end' }> | null = null, cost: number | null = null, reply = '';
  const tools: string[] = [];
  const end = (outcome: 'done' | 'interrupted' | 'failed', failure?: FailureClass) =>
    (ended = { type: 'end', outcome, ...(failure ? { failure } : {}), costUsd: cost });

  try {
    publishStatus();
    yield emit({ type: 'start', turnId, conversationId: id });
    const staticText = staticHalf(), hash = promptHash(staticText);
    if (conv.promptHash !== hash) delete conv.sessionId; // a session keeps the law it was opened with: a new law, a new session
    const mcpConfig = writeMcpConfig(id, opts.origin);
    let recall = '';
    try { recall = recallBlock(space, text); } catch (e) { warnOnce('recall', e); }
    const frame = dynamicFrame(recall, text);
    let failure: FailureClass | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const resume = conv.sessionId;
      const promptFile = resume ? undefined : writeStaticHalf(id, staticText);
      if (!resume) conv.promptHash = hash;
      const calls = new Set<string>();
      let result: ResultRecord | null = null;
      run = transport()({ args: turnArgs({ model: LEG_MODELS.turn, mcpConfig, resume, promptFile }), stdin: frame, cwd: home(), env: childEnv() });
      if (stop) run.kill();
      for await (const line of run.lines) {
        for (const d of decodeLine(line, calls)) {
          if (d.kind === 'session') conv.sessionId = d.id;
          else if (d.kind === 'result') { if (!result?.isError) result = d.result; }
          else if (!stop) {
            if (d.event.type === 'text') reply += d.event.delta;
            if (d.event.type === 'tool') tools.push(d.event.name);
            yield emit(d.event);
          }
        }
      }
      const exit = await run.exit;
      failure = stop ? null : classify(exit, result);
      const reseed = !!failure && !!resume && (failure === 'gone' || failure === 'poisoned') && attempt === 0;
      cost = addCost(cost, result?.costUsd ?? null, !reseed);
      if (reseed) { delete conv.sessionId; continue; }
      break;
    }
    yield emit(stop === 'cancel' ? end('interrupted') : stop === 'wall' ? end('failed', 'unknown') : failure ? end('failed', failure) : end('done'));
  } catch (e) {
    warnOnce(`turn ${id}`, e);
    if (!ended) yield emit(end('failed', 'unknown'));
  } finally {
    clearTimeout(wall);
    running.delete(turnId);
    (run as CliRun | null)?.kill();
    if (!ended) emit(end('interrupted')); // the consumer left before the end: that is a cancel, and the bus still hears it
    const outcome = (ended as Extract<TurnEvent, { type: 'end' }> | null)!;
    conv.turns += 1;
    conv.updatedAt = new Date().toISOString();
    try { saveConversation(conv); } catch (e) { warnOnce(`conversation ${id} not saved`, e); }
    appendLedger({ kind: 'turn', model: LEG_MODELS.turn, conversationId: id, ms: Date.now() - t0, costUsd: outcome.costUsd, outcome: outcome.outcome, ...(outcome.failure ? { failure: outcome.failure } : {}) });
    release();
    publishStatus();
    if (outcome.outcome === 'done') {
      try { appendEpisode({ space, conversationId: id, input: text, reply, tools }); } catch (e) { warnOnce('episode', e); }
      if (conv.turns === 1) void titleConversation(id, text, reply);
    }
    void sleepIfDue().catch((e) => warnOnce('sleep', e));
  }
}

async function titleConversation(id: string, input: string, reply: string): Promise<void> {
  try {
    const r = await runLeg({
      kind: 'utility', maxMs: 60_000,
      system: 'You title conversations by their subject (what the person asked about), in at most six words, no quotes and no full stop. Answer with the title and nothing else.',
      prompt: `${fence(`The person: ${input.slice(0, 2000)}\nThe companion: ${reply.slice(0, 2000)}`)}\nWhat is this conversation about? Answer with its title only.`,
    });
    const t = r.ok ? r.text.trim().split(/\r?\n/)[0].replace(/^["'`]+|["'`.]+$/g, '').trim().slice(0, TITLE_MAX) : '';
    if (t) patchConversation(id, (c) => { c.title = t; });
  } catch (e) { warnOnce('title', e); }
}

/** Cancels a running turn; false when none runs under that id. */
export function cancelTurn(turnId: string): boolean {
  const r = running.get(turnId);
  if (!r) return false;
  r.halt('cancel');
  return true;
}

export interface LegRequest { kind: LegKind; prompt: string; system?: string; maxMs?: number }
export interface LegResult { ok: boolean; text: string; costUsd: number | null; failure?: string }
/** The one model door: every non-turn leg (utility, sleep) goes through it, and its kind is required. */
export async function runLeg(req: LegRequest): Promise<LegResult> {
  if (!req || !Object.hasOwn(LEG_MODELS, req.kind)) throw new Error(`runLeg: kind is required (${Object.keys(LEG_MODELS).join(' | ')})`);
  const model = LEG_MODELS[req.kind], t0 = Date.now();
  let promptFile: string | undefined, run: CliRun | null = null, timedOut = false, text = '', result: ResultRecord | null = null, failure: string | null = null;
  try {
    if (req.system) {
      promptFile = path.join(home(), 'prompts', `leg-${randomUUID()}.md`);
      fs.mkdirSync(path.dirname(promptFile), { recursive: true });
      fs.writeFileSync(promptFile, req.system, 'utf8');
    }
    run = transport()({ args: legArgs({ model, promptFile }), stdin: req.prompt, cwd: home(), env: childEnv() });
    const timer = setTimeout(() => { timedOut = true; run?.kill(); }, req.maxMs ?? LEG_MS);
    try {
      const none = new Set<string>();
      for await (const line of run.lines) for (const d of decodeLine(line, none)) {
        if (d.kind === 'event' && d.event.type === 'text') text += d.event.delta;
        else if (d.kind === 'result' && !result?.isError) result = d.result;
      }
      const exit = await run.exit;
      failure = timedOut ? 'timeout' : classify(exit, result);
    } finally { clearTimeout(timer); }
  } catch (e) {
    failure = 'unknown';
    warnOnce(`${req.kind} leg`, e);
  } finally {
    run?.kill();
    if (promptFile) try { fs.unlinkSync(promptFile); } catch { /* gone */ }
  }
  const costUsd = result?.costUsd ?? null;
  appendLedger({ kind: req.kind, model, ms: Date.now() - t0, costUsd, outcome: failure ? 'failed' : 'done', ...(failure ? { failure } : {}) });
  return { ok: !failure, text, costUsd, ...(failure ? { failure } : {}) };
}

export interface ConversationInfo { id: string; product?: string; title: string; updatedAt: string; turns: number }
export function listConversations(): ConversationInfo[] { return listStored(); }
