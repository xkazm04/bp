// The companion's tool door, server half (spark companion-upgrade, P3): the human token, cards, policy grants and
// recommendations, all under companionHome() ($BP_HOME/companion). The routes in this folder are thin over it.
//
// Gate (registry hitl-approval/gate-state-machines): a GATED tool never runs on the agent's say-so. The MCP process files a
// card (pending, `cards.jsonl`, append-only; a card's state is its last row); only a HUMAN path moves it on, and a human path
// is a request carrying `x-bp-human: <token>`. The token is minted with randomBytes once per server process and handed out
// only by GET /api/companion/human-token to a request whose `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: cors` say a
// browser sent it from bp's own page. What that proves, and what it does not: browsers own the Sec-Fetch-* headers, so no
// page on another origin can read the token, and the MCP process never receives it (it is in no env, file or argument the
// CLI sees, and the CLI has no shell or file tools to fetch it with). A local program can still send the two headers by hand:
// the server is loopback-only, so this is a guard against the agent, not against an attacker already on this machine.
// A grant (policies.json, written only by the human path) covers a card when its product matches (or `*`), the tool is in
// its tools, it has not expired and, with minTier, every finding the args name that carries a tier has tier >= minTier (that severe or milder); a
// covered card runs at once and records `decidedBy: 'policy'` and the grant's id. No grant may cover policy.propose.
// Execution: one fetch to this server's own origin, the request tool-call.ts builds; the human token rides along only on a
// human approval (so policy.propose can reach POST /policies when, and only when, a person approved it). Every card state
// change is published to the bus. One server process serves the companion (apps/server canonical): two processes writing
// the same cards.jsonl could each move one card, and that is not guarded here.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { companionHome } from '../../../companion/home.server.ts';
import { publish } from '../../../companion/bus.server.ts';
import { HUMAN_HEADER, type Card, type PolicyGrant, type Verdict } from '../../../companion/contract.ts';
import type { ToolSpec } from '../../../companion/catalog.ts';
import { bounded, isGated, productOf, toolOf, toolRequest } from './tool-call.ts';
import { findProduct, hasStore, storeFile, writeAtomic } from '../../products.server.ts';
import { snapshotOf } from '../../store.server.ts';
import { listWaves } from '../../waves.server.ts';

if (typeof window !== 'undefined') throw new Error('door.server.ts is server-only');

// ------------------------------------------------------------------------------------------------ human token
const g = globalThis as unknown as { __bpHumanToken?: string; __bpCardSeq?: number };
/** Minted once per process (globalThis: Next bundles each route apart, and they must agree). */
export const humanToken = (): string => (g.__bpHumanToken ??= randomBytes(32).toString('hex'));
/** The request carries the human token (constant-time compare). */
export function isHuman(req: Request): boolean {
  const got = Buffer.from(req.headers.get(HUMAN_HEADER) ?? ''), want = Buffer.from(humanToken());
  return got.length === want.length && timingSafeEqual(got, want);
}
/** Only a browser on bp's own page sends both; neither can be set by a page on another origin. */
export const fromOwnPage = (req: Request): boolean => req.headers.get('sec-fetch-site') === 'same-origin' && req.headers.get('sec-fetch-mode') === 'cors';
export const notHuman = (): Response => Response.json({ error: `a person's answer: needs the ${HUMAN_HEADER} token from bp's own page` }, { status: 403 });

// ------------------------------------------------------------------------------------------------ files
const file = (name: string): string => path.join(companionHome(), name);
function readJson<T>(name: string, empty: T): T {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')) as T; } catch { return empty; }
}
function writeJson(name: string, v: unknown): void {
  fs.mkdirSync(companionHome(), { recursive: true });
  writeAtomic(file(name), JSON.stringify(v, null, 2) + '\n');
}
/** A time-sortable id: prefix, ms in base36 (fixed width), a per-process counter, 4 random hex. */
export const sortableId = (prefix: string): string =>
  `${prefix}${Date.now().toString(36).padStart(9, '0')}${((g.__bpCardSeq = ((g.__bpCardSeq ?? 0) + 1) % 1296)).toString(36).padStart(2, '0')}${randomBytes(2).toString('hex')}`;

// ------------------------------------------------------------------------------------------------ recommendations
export interface Recommendation { verdict: Verdict; why: string; at: string }
export const readRecommendations = (): Record<string, Recommendation> => readJson('recommendations.json', {});
/** Last writer wins per `slug:id`. */
export function recommend(slug: string, id: string, r: Omit<Recommendation, 'at'>): Recommendation {
  const all = readRecommendations(), rec = { ...r, at: new Date().toISOString() };
  all[`${slug}:${id}`] = rec;
  writeJson('recommendations.json', all);
  return rec;
}

// ------------------------------------------------------------------------------------------------ policies
export const POLICY_MAX_HOURS = 720;
export const listPolicies = (): PolicyGrant[] => {
  const d = readJson<{ policies?: PolicyGrant[] }>('policies.json', {});
  return Array.isArray(d.policies) ? d.policies : [];
};
export function addPolicy(p: Omit<PolicyGrant, 'id' | 'createdAt' | 'expiresAt'> & { hours: number }): PolicyGrant {
  const now = Date.now();
  const grant: PolicyGrant = { id: sortableId('pol_'), product: p.product, tools: p.tools, ...(p.minTier !== undefined ? { minTier: p.minTier } : {}), expiresAt: new Date(now + p.hours * 3600000).toISOString(), createdAt: new Date(now).toISOString() };
  writeJson('policies.json', { policies: [grant, ...listPolicies()] });
  return grant;
}
export function removePolicy(id: string): boolean {
  const all = listPolicies(), rest = all.filter((p) => p.id !== id);
  if (rest.length === all.length) return false;
  writeJson('policies.json', { policies: rest });
  return true;
}

/** The tiers of the findings `args` name (id, ids, or a wave's packages); null when one cannot be read. Untiered ones are left out. */
function namedTiers(t: ToolSpec, args: Record<string, unknown>, slug: string | undefined): number[] | null {
  let ids: string[] = [];
  if (typeof args.id === 'string' && /proposals/.test(t.route.path)) ids = [args.id];
  else if (Array.isArray(args.ids)) ids = args.ids.filter((x): x is string => typeof x === 'string');
  const p = slug ? findProduct(slug) : null;
  if (t.name === 'wave.dispatch') {
    if (!p) return null;
    const w = listWaves(p.root).find((x) => x.id === args.wave);
    if (!w) return null;
    const pk = Array.isArray(args.packages) ? new Set(args.packages) : null;
    ids = w.packages.filter((k) => !pk || pk.has(k.id)).flatMap((k) => k.ids);
  }
  if (!ids.length) return [];
  if (!p || !hasStore(p)) return null;
  try {
    const by = new Map(snapshotOf(storeFile(p)).proposals.map((x) => [x.id, x.tier]));
    return ids.map((id) => by.get(id)).filter((x): x is NonNullable<typeof x> => x !== undefined);
  } catch { return null; }
}

/** The live grant that covers this call, or null. */
export function policyFor(t: ToolSpec, args: Record<string, unknown>, now = Date.now()): PolicyGrant | null {
  if (t.name === 'policy.propose') return null;
  const slug = productOf(args);
  for (const p of listPolicies()) {
    if (Date.parse(p.expiresAt) <= now || !p.tools.includes(t.name)) continue;
    if (p.product !== '*' && p.product !== slug) continue;
    if (p.minTier !== undefined) {
      const tiers = namedTiers(t, args, slug);
      if (!tiers || tiers.some((x) => x < p.minTier!)) continue;
    }
    return p;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ cards
export const CARD_TTL_MS = 24 * 3600000;
export const CARD_LIST_MAX = 50;
const CARDS = 'cards.jsonl';

function readCards(): Map<string, Card> {
  const out = new Map<string, Card>();
  let text = '';
  try { text = fs.readFileSync(file(CARDS), 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const c = JSON.parse(line) as Card; if (c && typeof c.id === 'string') out.set(c.id, c); } catch { /* a torn last line */ }
  }
  return out;
}
/** Append a row (the card's new state) and publish it. */
function put(c: Card): Card {
  fs.mkdirSync(companionHome(), { recursive: true });
  fs.appendFileSync(file(CARDS), JSON.stringify(c) + '\n');
  publish({ type: 'card', card: c });
  return c;
}
/** Every card, pending ones past CARD_TTL_MS moved to `expired` first (once: the expiry is a row like any other). */
function current(now = Date.now()): Map<string, Card> {
  const all = readCards();
  for (const c of all.values()) if (c.state === 'pending' && now - Date.parse(c.createdAt) > CARD_TTL_MS) all.set(c.id, put({ ...c, state: 'expired' }));
  return all;
}
/** Newest first, at most CARD_LIST_MAX. */
export const listCards = (): Card[] => [...current().values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1)).slice(0, CARD_LIST_MAX);
export const getCard = (id: string): Card | undefined => current().get(id);

const summaryOf = (t: ToolSpec, args: Record<string, unknown>): string => {
  const shown = Object.entries(args).filter(([k]) => k !== 'slug' && k !== 'product').map(([k, v]) => `${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
  const product = productOf(args);
  return bounded(`${t.description.replace(/\.$/, '')}${product ? ` (${product})` : ''}${shown ? `: ${shown}` : ''}`).slice(0, 300);
};

export interface Origin { origin: string; conversation?: string }
/** Where to send a card's request: this server, as the incoming request reached it. */
export const originOf = (req: Request): Origin => {
  const u = new URL(req.url);
  if (u.hostname === 'localhost') u.hostname = '127.0.0.1'; // the servers bind 127.0.0.1; `localhost` may resolve to ::1 first
  const conversation = req.headers.get('x-bp-conversation');
  return { origin: u.origin, ...(conversation ? { conversation } : {}) };
};

/** Run the card's tool once against this server and record done or failed. */
async function execute(c: Card, t: ToolSpec, o: Origin, human: boolean): Promise<Card> {
  const r = toolRequest(t, c.args);
  if ('error' in r) return put({ ...c, state: 'failed', result: r.error });
  try {
    const res = await fetch(o.origin + r.path, {
      method: r.method,
      headers: { 'content-type': 'application/json', ...(o.conversation ? { 'x-bp-conversation': o.conversation } : {}), ...(human ? { [HUMAN_HEADER]: humanToken() } : {}) },
      ...(r.body ? { body: JSON.stringify(r.body) } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    return put({ ...c, state: res.ok ? 'done' : 'failed', result: bounded(`${res.status} ${text}`) });
  } catch (e) {
    return put({ ...c, state: 'failed', result: bounded(`unreachable: ${(e as Error).message}`) });
  }
}

export type FileResult = { ok: true; card: Card } | { ok: false; status: 400; error: string };
/** The agent's path (POST /cards): a GATED call becomes a pending card, or runs at once under a live grant. */
export async function fileCard(tool: unknown, args: unknown, o: Origin): Promise<FileResult> {
  const t = toolOf(tool);
  if (!t) return { ok: false, status: 400, error: `no tool ${String(tool)}` };
  if (!isGated(t)) return { ok: false, status: 400, error: `${t.name} is AUTO: call its route, it needs no card` };
  const a = (args ?? {}) as Record<string, unknown>;
  const req = toolRequest(t, a);
  if ('error' in req) return { ok: false, status: 400, error: req.error };
  const product = productOf(a);
  const card: Card = { id: sortableId('card_'), tool: t.name, args: a, summary: summaryOf(t, a), ...(product ? { product } : {}), state: 'pending', createdAt: new Date().toISOString() };
  const grant = policyFor(t, a);
  if (!grant) return { ok: true, card: put(card) };
  const approved = put({ ...card, state: 'approved', decidedBy: 'policy', policy: grant.id });
  return { ok: true, card: await execute(approved, t, o, false) };
}

export type AnswerResult = { ok: true; card: Card } | { ok: false; status: 404 | 409; error: string; card?: Card };
/** The human path (POST /cards/[id]): approve runs the tool once, decline runs nothing; any other state is a 409.
 *  The `approved` row is written before the first await, so a second answer racing this one already sees it. */
export async function answerCard(id: string, decision: 'approve' | 'decline', o: Origin): Promise<AnswerResult> {
  const c = current().get(id);
  if (!c) return { ok: false, status: 404, error: `no card ${id}` };
  if (c.state !== 'pending') return { ok: false, status: 409, error: `card ${id} is ${c.state}, not pending`, card: c };
  if (decision === 'decline') return { ok: true, card: put({ ...c, state: 'declined', decidedBy: 'human' }) };
  const t = toolOf(c.tool);
  if (!t) return { ok: true, card: put({ ...c, state: 'failed', decidedBy: 'human', result: `no tool ${c.tool}` }) };
  return { ok: true, card: await execute(put({ ...c, state: 'approved', decidedBy: 'human' }), t, o, true) };
}
