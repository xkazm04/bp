// The S8 LAN door (docs/concepts/vr-light-table/standalone-plan.md S8; docs/concepts/desk-to-table/plan.md D1): a second
// listener, opt-in with `--lan`, through which a paired headset reaches this server from the home network. It is a separate
// door, not a looser guard: the loopback mount (mount.ts) still refuses every non-loopback socket peer, and the door hands
// each request it allows to that mount's dispatch IN-PROCESS, rewritten as a loopback call, so every handler guard runs on
// it unchanged. Governed by the registry's device-pairing subject; the layers, in the order a request meets them:
//
// 1. Admission (admission-scoping). The socket peer must be a private-range IPv4 address (10/8, 172.16/12, 192.168/16,
//    100.64/10 for Tailscale; IPv4-mapped IPv6 unwrapped first). Anything else, loopback included (loopback callers use the
//    loopback port), gets the bare 403 at once: no body read, no token parsed, no registry read.
//    The listener exists only while trust can exist: during a pairing window (2 min, opened by `--lan` when nothing is
//    paired, and by `pair open`), while an approved pairing waits to be claimed, or while a live pairing is on file.
//    Otherwise the port is closed (re-evaluated on every change and every 15 s).
// 2. The ceremony (pairing-ceremony, token-binding-and-transport). POST /pair { nonce, device, scopes? } makes a pending
//    record (2 min TTL, at most MAX_PENDING) keyed by the device's own nonce (>= 22 base64url chars, about 128 bits) and
//    bound to the socket's peer address, never one from the body. It answers a 6-character code that the device shows on
//    the lamp's tag. Only the owner mints: `npm run server -- pair approve <code>` (lan-pair.ts) types that code into the
//    loopback-only admin routes below, a surface the LAN cannot reach, and may narrow the scopes and the lifetime there.
//    POST /pair/claim { nonce } from the same peer answers 202 while pending and the token exactly once after approval
//    (minted at that moment, so the plaintext never rests here); a second claim is 410 `claimed` - the theft alarm.
//    $BP_HOME/lan/paired.json keeps the SHA-256 fingerprint, the device, the scopes and the expiry (30 days by default,
//    at most 30), never the token. `pair revoke <id>` removes a row.
// 3. Authentication (timing-defenses, revocation-and-expiry). Every other request carries `Authorization: Bearer <token>`.
//    The registry is checked on every request (a stat; parsed again whenever the file changed: a revoke reaches the next request; an unreadable file
//    authenticates nobody), every row's fingerprint is compared in constant time over its full length, and every
//    refusal past admission waits REFUSAL_DELAY_MS before it answers.
// 4. Scope (verb-allowlists). VERBS below is the whole remote vocabulary, a closed grammar: a method plus an anchored path
//    pattern, no percent-escapes, no query except the baton's `claim=1`. `read`: the plan reads; `standup`: read plus the
//    companion turn, focus and cards GETs; `place`: the three baton verbs; `focus`: the shared focus's GET and POST (a
//    headset follows and publishes without `read`; the route pins its reader to the paired device); `decide`: three verbs, the
//    headset's pinch on a card: a REPEAT declined (ROADMAP F8: .../proposals/<id>/decline, which refuses any card that is
//    not the same idea declined before) and the card's decision approved (D12: .../proposals/<id>/approve, the Morning
//    Watch's Approve: proposed -> approved, no job queued), and the same for several findings at once (D15: .../proposals/approve
//    with { ids }, 1..50). `scan`: POST .../scans, a scan or directed scan started from the table. `decide` and `scan` have
//    their own ceremony: a device may ask for them, but
//    only the owner's approve that names them (`--scope ...,decide`) grants them; a plain approve drops them. Never the plan's
//    free decide (proposals/<id>), human-token, dispatch, build
//    or finish, and none of this server's own /lan or /athena routes.
//    Table link v2 (owner, 2026-11-09; docs/concepts/vr-light-table/table-link-v2.md section 5): `decide` adds a person's
//    decisions from the table (the Morning Watch verdict, a card's answer, a policy grant and its revoke: the routes take
//    them only with the decider seal, which this door adds for a pairing that holds `decide`, device-auth.ts), `standup`
//    adds the morning deck, the inbox, the policy list and the voice routes, `scan` adds the cancel, `read` adds the product
//    list and the shots, and `any` live pairing reaches the liveness probe (/api/health) and GET /pair/me.
//    Onboarding from the table (owner, 2026-11-10; table-link-v2.md section 14): `read` adds GET /api/onboarding and the
//    build-up feed with exactly the VR app's query (FEED_QUERY); `onboard`, named-only like decide and scan, adds the PC's
//    candidate list and the start (a paid agent run, no click at the PC: the route's bounds are onboard-start.server.ts's).
//    The routes know the scope by the onboard seal the device overlay adds for a pairing that holds it (device-auth.ts).
// 5. The rewrite. Only Content-Type and Accept are copied from the device (FORWARDED), and on POST /api/companion/listen
//    alone also x-bp-speech-consent and Content-Length (LISTEN_FORWARDED; S3 finding 2); Host becomes this server's loopback address,
//    X-Forwarded-For the door itself, and `x-bp-device` the paired device's id (`<device>:<pairing id>`), so whatever
//    `x-bp-device` or `x-bp-human` the device sent is dropped (W1's rule, baton.server.ts).
//
// Every refusal, whatever its cause, is the same bare 403 (no body, `cache-control: no-store`, `connection: close`). The
// cause goes to $BP_HOME/lan/ledger.jsonl (with grants, claims, denials and revocations), rate-capped. Two answers are
// deliberately not that 403, both only to a holder of the nonce: 202 `pending`, and 410 `claimed`.
// Recorded deviations (plan.md D1): the token travels in cleartext HTTP (S8; TLS is the follow-up); the binding is the
// token plus the private-range class, not a device key. The approval surfaces are the CLI (these loopback routes, no human
// token: a terminal on the PC) and bp's Headsets page (headsets.ts: the page's human token; table-link-v2.md section 13).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { jsonOnly, localHost, localOnly } from '@bp/core/scan/local-only';
import { dispatch, type Route } from './mount.ts';
import { deviceOverlay } from './device-auth.ts';

// ------------------------------------------------------------------------------------------------ the numbers (a contract)
export const LAN_PORT = 3101;
export const PAIR_TTL_MS = 120_000;
export const WINDOW_MS = 120_000;
/** How long an approved pairing waits for its claim. */
export const CLAIM_TTL_MS = 120_000;
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 30;
/** Every refusal past admission waits this long: online guessing becomes glacial, with no lockout state to abuse. */
export const REFUSAL_DELAY_MS = 250;
export const MAX_PENDING = 4;
export const MAX_PAIRED = 8;
/** Wrong codes typed at the owner's approve (the CLI or the Headsets page, one count) before every open request is cancelled
 *  and the window shuts: a guesser on this PC gets 5 tries out of 32^6 codes, then must wait for the owner to open a new
 *  window, which the owner sees. A right code resets the count. */
export const MAX_WRONG_CODES = 5;
/** Event-loop pressure from peers that hold sockets (S3 finding 7): at most this many sockets on the door at once, and this
 *  many requests in flight from one peer (past it: the bare 403 at once, no delay held). A headset polls health, reads a
 *  plan, talks and keeps one 600 s companion turn open: 8 is above that, 32 above a household. */
export const MAX_CONNECTIONS = 32;
export const MAX_PEER_INFLIGHT = 8;
/** The whole request head must arrive within HEADERS_TIMEOUT_MS and the whole request (head and body: a listen upload is at
 *  most 3 MB) within REQUEST_TIMEOUT_MS. Neither bounds the ANSWER: a 600 s companion turn streams its response long after
 *  its small request was read, so it is never cut by these. */
export const HEADERS_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 60_000;
const MAX_PAIR_BODY = 2048;
const DAY_MS = 86_400_000;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const DEVICE = /^[A-Za-z0-9_.-]{1,40}$/;
const TOKEN = /^Bearer ([A-Za-z0-9_-]{43})$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: read off a headset, typed on a keyboard

export const SCOPES = ['read', 'standup', 'place', 'focus', 'decide', 'scan', 'onboard'] as const;
/** Granted only when the owner's approve names it (never by a device's request alone). `onboard` (owner, 2026-11-10): the
 *  headset may start reading a project the PC offers, a paid agent run with no click at the PC (table-link-v2.md section 14). */
export const NAMED_ONLY: readonly Scope[] = ['decide', 'scan', 'onboard'];
export type Scope = (typeof SCOPES)[number];
export const isScopes = (v: unknown): v is Scope[] =>
  Array.isArray(v) && v.length > 0 && v.length <= SCOPES.length && v.every((s) => (SCOPES as readonly string[]).includes(s)) && new Set(v).size === v.length;

// ------------------------------------------------------------------------------------------------ admission
/** The socket peer is a private-range IPv4 address: 10/8, 172.16/12, 192.168/16, 100.64/10 (Tailscale). An IPv4-mapped
 *  IPv6 address is unwrapped first; every other IPv6 address, loopback, a name and undefined are not admitted. */
export function privatePeer(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = /^::ffff:/i.test(addr) ? addr.slice(7) : addr;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  if ([x, y, Number(m[3]), Number(m[4])].some((o) => o > 255)) return false;
  return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127);
}

/** The address `--lan` binds when no --lan-host is given: the first private-range IPv4 interface, a home-network one
 *  (10/8, 172.16/12, 192.168/16) before a tailnet one (100.64/10), since the headset is on the home Wi-Fi. */
/** Whether a pairing request's peer is this PC itself: the cable's `loopback`, a loopback address, or one of this PC's own
 *  interface addresses (a local program reaching the Wi-Fi listener at the PC's own address). Such a request may be a local
 *  program's own, so approving it does not reset the wrong-code count (S4, 2026-11-10). */
export function peerIsThisPc(peer: string): boolean {
  const a = peer.trim().replace(/^::ffff:/i, '');
  if (a === 'loopback' || /^(127(?:\.\d{1,3}){3}|::1|localhost)$/i.test(a)) return true;
  return Object.values(os.networkInterfaces()).flatMap((l) => l ?? []).some((i) => i.address.replace(/^::ffff:/i, '') === a);
}
export function lanAddress(): string | null {
  const found = Object.values(os.networkInterfaces()).flatMap((l) => l ?? []).filter((i) => i.family === 'IPv4' && !i.internal && privatePeer(i.address)).map((i) => i.address);
  return found.find((a) => !a.startsWith('100.')) ?? found[0] ?? null;
}

// ------------------------------------------------------------------------------------------------ the verbs
/** `scope: 'any'`: any live pairing. `query`: the exact query, or a pattern the whole query must match (absent: none).
 *  `forward`: the headers this verb copies from the device beyond FORWARDED (S3 finding 2: listen needs its consent and its
 *  length; no other verb copies anything more). */
interface Verb { scope: Scope | 'any'; method: 'GET' | 'POST' | 'DELETE'; path: RegExp; query?: string | RegExp; forward?: readonly string[] }
/** The headers every verb copies from the device. Everything else it sends is dropped (the door sets Host, X-Forwarded-For
 *  and x-bp-device itself). */
export const FORWARDED: readonly string[] = ['content-type', 'accept'];
/** The listen verb's own two: the wearer's opt-in to cloud transcription and the declared length (voice-link.md). */
export const LISTEN_FORWARDED: readonly string[] = ['x-bp-speech-consent', 'content-length'];
const ISO = '[0-9TZ:.-]{10,40}';
/** The morning deck's window: since and/or opened, each an ISO time (no `+`: send UTC with Z). */
const MORNING_QUERY = new RegExp(`^(?:since|opened)=${ISO}(?:&(?:since|opened)=${ISO})?$`);
// SLUG: the registry's own rule (registry.server.ts SLUG_RE, focus.ts), so the door never forwards a slug no product can have (E6, D3)
const SLUG = '[a-z0-9][a-z0-9-]{0,62}', ID = '[A-Za-z0-9_.-]{1,80}';
const products = (rest: string) => new RegExp(`^/api/products/${SLUG}/${rest}$`);
/** The onboarding feed's query, exactly as the VR app sends it (BpLink.cpp: `after=<n>&job=<id>`, and the build-up's
 *  `&layout=islands`): nothing wider, no other order, no other key. */
export const FEED_QUERY = new RegExp(`^after=\\d{1,9}&job=${ID}(?:&layout=islands)?$`);
/** The whole remote vocabulary. A request that matches no row is refused; nothing else is reachable through the door. */
export const VERBS: readonly Verb[] = [
  { scope: 'read', method: 'GET', path: products('structure') },
  { scope: 'read', method: 'GET', path: products('plan') },
  // the table's own layout (night two W2b): exactly this query, nothing wider, so Wi-Fi draws the islands the cable draws
  { scope: 'read', method: 'GET', path: products('plan'), query: 'layout=islands' },
  { scope: 'read', method: 'GET', path: products('scans') },
  { scope: 'read', method: 'GET', path: products(`scans/${ID}`) },
  { scope: 'read', method: 'GET', path: products('scan') },
  { scope: 'read', method: 'GET', path: products('waves') },
  { scope: 'read', method: 'GET', path: products('focuses') },
  { scope: 'read', method: 'GET', path: products(`proposals/${ID}/brief`) },
  { scope: 'standup', method: 'POST', path: /^\/api\/companion\/turn$/ },
  { scope: 'standup', method: 'GET', path: /^\/api\/companion\/focus$/ },
  { scope: 'standup', method: 'GET', path: /^\/api\/companion\/cards$/ },
  { scope: 'place', method: 'GET', path: /^\/api\/session\/place$/, query: 'claim=1' },
  { scope: 'place', method: 'POST', path: /^\/api\/session\/place$/ },
  { scope: 'place', method: 'POST', path: /^\/api\/session\/place\/return$/ },
  { scope: 'focus', method: 'GET', path: /^\/api\/session\/focus$/ },
  { scope: 'focus', method: 'POST', path: /^\/api\/session\/focus$/ },
  { scope: 'decide', method: 'POST', path: products(`proposals/${ID}/decline`) },
  { scope: 'decide', method: 'POST', path: products(`proposals/${ID}/approve`) },
  { scope: 'decide', method: 'POST', path: products('proposals/approve') },
  { scope: 'scan', method: 'POST', path: products('scans') },
  // table link v2 (owner, 2026-11-09)
  { scope: 'any', method: 'GET', path: /^\/api\/health$/ },
  { scope: 'read', method: 'GET', path: /^\/api\/products$/ },
  { scope: 'read', method: 'GET', path: products(`shots/(?:${ID}/){0,4}${ID}`) },
  { scope: 'standup', method: 'GET', path: /^\/api\/companion\/morning$/ },
  { scope: 'standup', method: 'GET', path: /^\/api\/companion\/morning$/, query: MORNING_QUERY },
  { scope: 'standup', method: 'GET', path: /^\/api\/companion\/inbox$/ },
  { scope: 'standup', method: 'GET', path: /^\/api\/companion\/inbox$/, query: /^limit=\d{1,3}$/ },
  { scope: 'standup', method: 'GET', path: /^\/api\/companion\/policies$/ },
  // the voice routes (voice-link.md): listen reads the consent header and the declared length, so the door copies those two
  { scope: 'standup', method: 'POST', path: /^\/api\/companion\/listen$/, forward: LISTEN_FORWARDED },
  { scope: 'standup', method: 'POST', path: /^\/api\/companion\/say$/ },
  { scope: 'decide', method: 'POST', path: /^\/api\/companion\/morning$/ },
  { scope: 'decide', method: 'POST', path: new RegExp(`^/api/companion/cards/${ID}$`) },
  { scope: 'decide', method: 'POST', path: /^\/api\/companion\/policies$/ },
  { scope: 'decide', method: 'DELETE', path: new RegExp(`^/api/companion/policies/${ID}$`) },
  { scope: 'scan', method: 'DELETE', path: products(`scans/${ID}`) },
  // onboarding from the table (owner, 2026-11-10; table-link-v2.md section 14): watching under read, starting under onboard
  { scope: 'read', method: 'GET', path: /^\/api\/onboarding$/ },
  { scope: 'read', method: 'GET', path: products('onboarding/feed'), query: FEED_QUERY },
  { scope: 'onboard', method: 'GET', path: /^\/api\/onboarding\/candidates$/ },
  { scope: 'onboard', method: 'POST', path: /^\/api\/onboarding\/start$/ },
  // a headset's start is an ask the owner confirms at the PC (owner, 2026-11-10): what became of it, no query
  { scope: 'onboard', method: 'GET', path: /^\/api\/onboarding\/requests\/[0-9a-f]{24}$/ },
];
/** The verb a request names, or null. `standup` includes `read`. The raw request target is parsed here, strictly: printable
 *  ASCII, no percent-escape, no dot segment, no empty segment, and a query only where the verb names it exactly. */
export function verbOf(scopes: readonly Scope[], method: string, target: string): { path: string; query: string; forward: readonly string[] } | null {
  if (!/^\/[\x21-\x7e]*$/.test(target) || /%|\/\/|\/\.\.?(\/|\?|$)/.test(target)) return null;
  const q = target.indexOf('?');
  const p = q < 0 ? target : target.slice(0, q), query = q < 0 ? '' : target.slice(q + 1);
  const has = (s: Scope | 'any') => s === 'any' || scopes.includes(s) || (s === 'read' && scopes.includes('standup'));
  const queryOk = (x: Verb) => (x.query instanceof RegExp ? x.query.test(query) : (x.query ?? '') === query);
  const v = VERBS.find((x) => x.method === method && x.path.test(p) && queryOk(x) && has(x.scope));
  return v ? { path: p, query, forward: [...FORWARDED, ...(v.forward ?? [])] } : null;
}

// ------------------------------------------------------------------------------------------------ the registry
export interface Pairing {
  id: string;
  device: string;
  /** SHA-256 of the token, hex. The token itself is never stored. */
  fingerprint: string;
  scopes: Scope[];
  createdAt: string;
  expiresAt: string;
}
export const lanHome = (): string => path.join(process.env.BP_HOME ? path.resolve(process.env.BP_HOME) : path.join(process.cwd(), '.bp'), 'lan');
export const registryFile = (home = lanHome()): string => path.join(home, 'paired.json');
const isPairing = (r: unknown): r is Pairing => {
  const p = r as Pairing;
  return !!p && typeof p === 'object' && /^[0-9a-f]{8}$/.test(p.id) && DEVICE.test(p.device) && /^[0-9a-f]{64}$/.test(p.fingerprint)
    && isScopes(p.scopes) && !Number.isNaN(Date.parse(p.createdAt)) && !Number.isNaN(Date.parse(p.expiresAt));
};
/** The pairings on file. Fail closed: a missing file is none, and so is an unreadable or malformed one (with a loud line),
 *  never "whatever was there before". */
const registryCache = new Map<string, { key: string; rows: Pairing[] }>();
export function readRegistry(home = lanHome(), warn: (s: string) => void = console.error): Pairing[] {
  // parsed once per version of the file (S3 finding 7): a stat per request, a read and a parse only when the file changed
  // (every write is a rename to a new file: writeRegistry), so a revoke still reaches the very next request
  const file = registryFile(home);
  let key = '';
  try { const st = fs.statSync(file); key = `${st.ino}:${st.size}:${st.mtimeMs}`; } catch { /* missing: read below says so */ }
  const hit = registryCache.get(file);
  if (key && hit && hit.key === key) return hit.rows;
  const rows = readRegistryFile(home, warn);
  if (key) registryCache.set(file, { key, rows }); else registryCache.delete(file);
  return rows;
}
function readRegistryFile(home: string, warn: (s: string) => void): Pairing[] {
  let text: string;
  try { text = fs.readFileSync(registryFile(home), 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn(`lan door: cannot read ${registryFile(home)} (${(e as Error).message}); no device is admitted`);
    return [];
  }
  try {
    const doc = JSON.parse(text) as { version?: unknown; pairings?: unknown };
    if (doc.version !== 1 || !Array.isArray(doc.pairings) || !doc.pairings.every(isPairing)) throw new Error('not a version 1 registry');
    return doc.pairings;
  } catch (e) {
    warn(`lan door: ${registryFile(home)} is malformed (${(e as Error).message}); no device is admitted`);
    return [];
  }
}
export function writeRegistry(rows: Pairing[], home = lanHome()): void {
  fs.mkdirSync(home, { recursive: true });
  const file = registryFile(home), tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, pairings: rows }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}
export const fingerprintOf = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();
/** The id the baton and every route see for a pairing: `<device>:<pairing id>`. */
export const deviceId = (p: Pick<Pairing, 'device' | 'id'>): string => `${p.device}:${p.id}`;
/** The pairings as the Headsets page lists them: never the fingerprint. */
export const pairedView = (rows: Pairing[], t: number, lastSeen: (deviceId: string) => string | undefined = () => undefined) =>
  rows.map((r) => {
    const seen = lastSeen(deviceId(r));
    return { id: r.id, device: deviceId(r), name: r.device, scopes: r.scopes, createdAt: r.createdAt, expiresAt: r.expiresAt, expired: Date.parse(r.expiresAt) <= t, ...(seen ? { lastSeen: seen } : {}) };
  });

/** One ledger row ($BP_HOME/lan/ledger.jsonl). A record, never a reason to fail a request. Shared by the door and the Headsets
 *  page's routes (headsets.ts), which also write while no door is attached (a revoke, a door switched on). */
export function appendLedger(home: string, row: Record<string, unknown>, at = Date.now()): void {
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.appendFileSync(path.join(home, 'ledger.jsonl'), JSON.stringify({ at: new Date(at).toISOString(), ...row }) + '\n');
  } catch { /* the ledger is a record, never a reason to fail a request */ }
}

/** Remove a pairing from the registry on disk; false when no row has that id. The door's revoke also cuts what is in flight. */
export function removePairing(id: string, home = lanHome()): boolean {
  const rows = readRegistry(home);
  if (!rows.some((r) => r.id === id)) return false;
  writeRegistry(rows.filter((r) => r.id !== id), home);
  return true;
}

// ------------------------------------------------------------------------------------------------ the door
interface Pending {
  /** An opaque handle the Headsets page names a request by (to deny it): never the code, never the nonce. */
  id: string;
  /** When the request arrived. */
  at: number;
  nonceHash: Buffer;
  code: string;
  device: string;
  peer: string;
  requested: Scope[];
  state: 'pending' | 'approved' | 'denied' | 'claimed';
  /** pending/denied: the request's TTL; approved/claimed: the claim deadline. */
  until: number;
  granted?: Scope[];
  days?: number;
  pairingId?: string;
}

export interface DoorOptions {
  /** The loopback mount's routes (the same array, so routes added later are seen). */
  routes: Route[];
  /** The loopback mount's port: forwarded requests carry it in their Host. */
  loopbackPort: number;
  /** The address and port the door binds. */
  host: string;
  port: number;
  /** $BP_HOME/lan by default. */
  home?: string;
  /** The clock (tests move it). */
  now?: () => number;
  /** The door's timeouts (a check shortens them; the server uses HEADERS_TIMEOUT_MS and REQUEST_TIMEOUT_MS). */
  timeouts?: { headersMs: number; requestMs: number; checkMs?: number };
  /** Where the peer address is read: the socket. A check's harness substitutes it; nothing in this server does. */
  peerOf?: (req: IncomingMessage) => string | undefined;
  log?: (line: string) => void;
  /** false: the ceremony and the loopback routes only, never a LAN listener (`--pair`, a tethered headset). Default true. */
  lan?: boolean;
}

/** What the ceremony answers, transport-free: a JSON answer, or a refusal cause (the LAN door's bare 403, the tether's 403). */
type Answer = { status: number; body: Record<string, unknown> } | { refuse: string };

const bare = (res: ServerResponse): void => {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(403, { 'content-length': '0', 'cache-control': 'no-store', connection: 'close' });
  res.end();
};
const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)), 'cache-control': 'no-store' });
  res.end(text);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A small JSON body, or null (too large, not JSON, not an object, the client left). */
function readSmallJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') return Promise.resolve(null);
  if (Number(req.headers['content-length']) > MAX_PAIR_BODY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (b: Buffer) => { size += b.length; if (size > MAX_PAIR_BODY) { req.pause(); resolve(null); } else parts.push(b); });
    req.on('end', () => {
      try { const v = JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown; resolve(v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

export class LanDoor {
  private readonly o: DoorOptions;
  private readonly home: string;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly peerOf: (req: IncomingMessage) => string | undefined;
  private server: http.Server | null = null;
  private opening: Promise<void> | null = null;
  private windowUntil = 0;
  private pending: Pending[] = [];
  /** Responses in flight per pairing id, so a revoke reaches the work, not just the next request. */
  private readonly inflight = new Map<string, Set<ServerResponse>>();
  /** Requests in flight per peer address (MAX_PEER_INFLIGHT). */
  private readonly peerInflight = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private refusalsThisMinute = 0;
  private refusalMinute = 0;
  private suppressed = 0;
  /** Wrong codes typed at approve since the last right one (MAX_WRONG_CODES). */
  private wrongCodes = 0;
  /** The bound port while listening (the configured one, or the ephemeral one when it was 0). */
  port: number | null = null;

  constructor(o: DoorOptions) {
    this.o = o;
    this.home = o.home ?? lanHome();
    this.now = o.now ?? Date.now;
    this.log = o.log ?? ((s) => console.log(s));
    this.peerOf = o.peerOf ?? ((req) => req.socket.remoteAddress);
  }

  // ---------------------------------------------------------------------------------------------- lifecycle
  /** Start: a pairing window opens when nothing is paired yet; the listener comes up when there is a reason for it. */
  async start(): Promise<void> {
    fs.mkdirSync(this.home, { recursive: true });
    if (this.live().length === 0) this.openWindow();
    await this.converge();
    this.timer = setInterval(() => { void this.converge(); }, 15_000);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.close();
  }
  get listening(): boolean { return this.server !== null; }
  /** The registry as it is on disk now (never a cached copy). */
  private rows(): Pairing[] { return readRegistry(this.home, this.log); }
  private live(): Pairing[] { const t = this.now(); return this.rows().filter((p) => Date.parse(p.expiresAt) > t); }
  private prune(): void {
    const t = this.now();
    this.pending = this.pending.filter((p) => p.until > t);
  }
  /** Listen exactly while there is a reason to: an open window, an approval waiting for its claim, or a live pairing. */
  async converge(): Promise<void> {
    this.prune();
    const reason = this.windowUntil > this.now() || this.pending.some((p) => p.state === 'approved') || this.live().length > 0;
    if (reason && !this.server && this.o.lan !== false) await this.listen();
    else if (!reason && this.server) { await this.close(); this.log('lan door: closed (nothing paired, no pairing window)'); }
  }
  openWindow(by?: string): number {
    if (this.windowUntil <= this.now()) this.wrongCodes = 0; // a fresh window, a fresh count (an open one keeps its count)
    this.windowUntil = this.now() + WINDOW_MS;
    this.ledger({ event: 'window-open', until: new Date(this.windowUntil).toISOString(), ...(by ? { by } : {}) });
    this.log(`lan door: pairing window open until ${new Date(this.windowUntil).toISOString()} (the Headsets page, or npm run server -- pair open, reopens it)`);
    // the caller converges (the listener comes up); the window's end is a reason to look again (the 15 s sweep would get there too, later)
    setTimeout(() => { void this.converge(); }, WINDOW_MS + 50).unref();
    return this.windowUntil;
  }
  private listen(): Promise<void> {
    if (this.opening) return this.opening;
    const t = this.o.timeouts ?? { headersMs: HEADERS_TIMEOUT_MS, requestMs: REQUEST_TIMEOUT_MS };
    const s = http.createServer({ headersTimeout: t.headersMs, requestTimeout: t.requestMs, ...(t.checkMs ? { connectionsCheckingInterval: t.checkMs } : {}) }, (req, res) => { void this.handle(req, res); });
    s.maxConnections = MAX_CONNECTIONS;
    this.opening = new Promise<void>((resolve) => {
      s.once('error', (e: NodeJS.ErrnoException) => {
        this.log(`lan door: cannot listen on ${this.o.host}:${this.o.port}: ${e.code ?? ''} ${e.message}`);
        this.opening = null;
        resolve();
      });
      // Audience: the operator's own devices on the home network or tailnet; admission (privatePeer) is the first thing
      // every request meets, so a bind that turns out wider than meant still refuses every other peer.
      s.listen(this.o.port, this.o.host, () => {
        const a = s.address();
        this.port = a && typeof a === 'object' ? a.port : this.o.port;
        this.server = s;
        this.opening = null;
        this.log(`lan door: listening on http://${this.o.host}:${this.port} (private-range peers only)`);
        resolve();
      });
    });
    return this.opening;
  }
  private close(): Promise<void> {
    const s = this.server;
    this.server = null;
    this.port = null;
    if (!s) return Promise.resolve();
    return new Promise((resolve) => { s.close(() => resolve()); s.closeAllConnections(); });
  }

  // ---------------------------------------------------------------------------------------------- the ledger
  ledger(row: Record<string, unknown>): void { appendLedger(this.home, row, this.now()); }
  /** A refusal row, at most 30 a minute; the rest are counted and written as one `suppressed` row. */
  private refusalRow(cause: string, peer: string | undefined): void {
    const minute = Math.floor(this.now() / 60_000);
    if (minute !== this.refusalMinute) {
      if (this.suppressed) this.ledger({ event: 'refusals-suppressed', count: this.suppressed });
      this.refusalMinute = minute; this.refusalsThisMinute = 0; this.suppressed = 0;
    }
    if (++this.refusalsThisMinute > 30) { this.suppressed++; return; }
    this.ledger({ event: 'refused', cause, peer: peer ?? null });
  }
  /** Every refusal past admission: recorded with its cause, then the fixed delay, then the bare 403. */
  private async refuse(res: ServerResponse, cause: string, peer: string | undefined): Promise<void> {
    this.refusalRow(cause, peer);
    await sleep(REFUSAL_DELAY_MS);
    bare(res);
  }

  // ---------------------------------------------------------------------------------------------- the LAN side
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const peer = this.peerOf(req);
    // 1. admission, before anything is read or computed: the cheap refusal, no delay
    if (!privatePeer(peer)) { this.refusalRow('peer', peer); return bare(res); }
    // a peer holds at most MAX_PEER_INFLIGHT requests at once; past it, the bare 403 at once (no delay: no socket held)
    const n = this.peerInflight.get(peer as string) ?? 0;
    if (n >= MAX_PEER_INFLIGHT) { this.refusalRow('peer-inflight', peer); return bare(res); }
    this.peerInflight.set(peer as string, n + 1);
    let counted = true;
    const uncount = () => { if (!counted) return; counted = false; const m = (this.peerInflight.get(peer as string) ?? 1) - 1; if (m > 0) this.peerInflight.set(peer as string, m); else this.peerInflight.delete(peer as string); };
    res.on('close', uncount);
    res.on('finish', uncount);
    const target = req.url ?? '';
    // the Host must name this door, exactly (S3 finding 5): a DNS-rebound page in the PC's own browser, or anything that
    // reaches the socket under another name, is refused before the ceremony or a token is looked at. No CORS headers, ever.
    if (req.headers.host !== `${this.o.host}:${this.port}`) return await this.refuse(res, 'host', peer);
    try {
      if (req.method === 'POST' && (target === '/pair' || target === '/pair/claim')) {
        const b = await readSmallJson(req);
        const a = target === '/pair' ? this.requestPairing(b, peer as string) : this.claimPairing(b, peer as string);
        return 'refuse' in a ? await this.refuse(res, a.refuse, peer) : sendJson(res, a.status, a.body);
      }
      if (req.method === 'GET' && target === '/pair/me') {
        const m = TOKEN.exec(req.headers.authorization ?? ''), a = m ? this.me(m[1]) : null;
        return a ? sendJson(res, 200, a) : await this.refuse(res, 'me', peer);
      }
      return await this.forward(req, res, peer as string);
    } catch (e) {
      this.log(`lan door: ${(e as Error).message}`);
      bare(res);
    }
  }

  private findByNonce(nonce: string): Pending | undefined {
    const h = createHash('sha256').update(nonce, 'utf8').digest();
    let hit: Pending | undefined;
    for (const p of this.pending) if (timingSafeEqual(p.nonceHash, h) && !hit) hit = p; // every row, every time
    return hit;
  }

  /** POST /pair: a pending request (or the existing view of a retried one). `peer`: the socket's address, or `loopback`. */
  requestPairing(b: Record<string, unknown> | null, peer: string): Answer {
    this.prune();
    const no = (cause: string): Answer => { if (peer === 'loopback') this.refusalRow(cause, peer); return { refuse: cause }; };
    if (!b || typeof b.nonce !== 'string' || !NONCE.test(b.nonce) || typeof b.device !== 'string' || !DEVICE.test(b.device)
      || (b.scopes !== undefined && !isScopes(b.scopes))) return no('pair-body');
    const known = this.findByNonce(b.nonce);
    if (known) {
      // a retried request: the existing view, never a reset (a resolved record stays resolved); only from its own peer
      if (known.peer !== peer || known.state === 'denied') return no('pair-repeat');
      return { status: known.state === 'pending' ? 201 : 200, body: { state: known.state === 'pending' ? 'pending' : 'approved', code: known.code, expiresAt: new Date(known.until).toISOString() } };
    }
    if (this.windowUntil <= this.now()) return no('no-window');
    // one open request per peer (S3 finding 5): a new nonce from the same address is the same device asking again (an app
    // restarted mid-ceremony), so it replaces that peer's open request; one LAN host can never fill every pending slot
    const mine = this.pending.filter((x) => x.peer === peer && x.state === 'pending');
    if (mine.length) {
      this.pending = this.pending.filter((x) => !mine.includes(x));
      this.ledger({ event: 'pair-replaced', peer, devices: mine.map((x) => x.device) });
    }
    if (this.pending.filter((x) => x.state === 'pending').length >= MAX_PENDING) return no('pending-cap');
    let code: string;
    do code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    while (this.pending.some((p) => p.code === code));
    const p: Pending = {
      id: randomBytes(4).toString('hex'), at: this.now(), nonceHash: createHash('sha256').update(b.nonce, 'utf8').digest(), code, device: b.device, peer,
      requested: (b.scopes as Scope[] | undefined) ?? ['read'], state: 'pending', until: this.now() + PAIR_TTL_MS,
    };
    this.pending.push(p);
    this.ledger({ event: 'pair-request', device: p.device, peer, scopes: p.requested });
    // the code is shown on the requesting device only, never here (S3 finding 5): the owner types what the headset shows,
    // so a request from another host has no code in a log to be pasted by mistake
    this.log(`lan door: pairing request from ${peer}, claiming to be ${p.device}, for ${p.requested.join(',')}: its code is on that device's screen (type it on bp's Headsets page, or npm run server -- pair approve <code>)`);
    return { status: 201, body: { state: 'pending', code, expiresAt: new Date(p.until).toISOString() } };
  }

  /** POST /pair/claim: 202 while pending, the token exactly once after approval, 410 after that. */
  claimPairing(b: Record<string, unknown> | null, peer: string): Answer {
    this.prune();
    const no = (cause: string): Answer => { if (peer === 'loopback') this.refusalRow(cause, peer); return { refuse: cause }; };
    const p = b && typeof b.nonce === 'string' && NONCE.test(b.nonce) ? this.findByNonce(b.nonce) : undefined;
    // the claimant is the approved identity: the nonce's holder, from the address the request came from
    if (!p || p.peer !== peer) return no('claim-unknown');
    if (p.state === 'denied') return no('claim-denied');
    if (p.state === 'pending') return { status: 202, body: { state: 'pending' } };
    if (p.state === 'claimed') {
      this.ledger({ event: 'claim-again', device: p.device, peer, id: p.pairingId });
      return { status: 410, body: { state: 'claimed' } };
    }
    // approved: mint now, deliver once, keep only the fingerprint
    const rows = this.rows().filter((r) => Date.parse(r.expiresAt) > this.now());
    if (rows.length >= MAX_PAIRED) return no('paired-cap');
    const token = randomBytes(32).toString('base64url');
    let id: string;
    do id = randomBytes(4).toString('hex'); while (rows.some((r) => r.id === id));
    const t = this.now();
    const row: Pairing = {
      id, device: p.device, fingerprint: fingerprintOf(token).toString('hex'), scopes: p.granted ?? p.requested,
      createdAt: new Date(t).toISOString(), expiresAt: new Date(t + (p.days ?? DEFAULT_DAYS) * DAY_MS).toISOString(),
    };
    writeRegistry([...rows, row], this.home);
    p.state = 'claimed';
    p.pairingId = id;
    this.ledger({ event: 'claim', device: p.device, peer, id, scopes: row.scopes, expiresAt: row.expiresAt });
    this.log(`lan door: ${deviceId(row)} claimed its token (${row.scopes.join(',')} until ${row.expiresAt})`);
    return { status: 200, body: { token, device: deviceId(row), scopes: row.scopes, expiresAt: row.expiresAt } };
  }

  /** GET /pair/me: what a live token is, or null (unknown, expired, revoked). Never the token or its fingerprint. */
  me(token: string): { device: string; scopes: Scope[]; expiresAt: string } | null {
    const presented = fingerprintOf(token), t = this.now();
    let hit: Pairing | undefined;
    for (const r of this.rows()) if (timingSafeEqual(Buffer.from(r.fingerprint, 'hex'), presented) && !hit) hit = r;
    return hit && Date.parse(hit.expiresAt) > t ? { device: deviceId(hit), scopes: hit.scopes, expiresAt: hit.expiresAt } : null;
  }

  /** GET /lan/where (loopback only): where a tethered headset finds this door, so nobody types an address in VR. */
  where(): { door: { address: string; port: number } | null; listening: boolean; window: string | null; pairing: true } {
    const t = this.now();
    return {
      door: this.o.lan === false ? null : { address: this.o.host, port: this.port ?? this.o.port },
      listening: this.server !== null,
      window: this.windowUntil > t ? new Date(this.windowUntil).toISOString() : null,
      pairing: true,
    };
  }

  private async forward(req: IncomingMessage, res: ServerResponse, peer: string): Promise<void> {
    const m = TOKEN.exec(req.headers.authorization ?? '');
    if (!m) return this.refuse(res, 'no-token', peer);
    const presented = fingerprintOf(m[1]);
    const t = this.now();
    let hit: Pairing | undefined;
    // re-read per request, every row compared, in constant time over the full 32 bytes
    for (const r of this.rows()) if (timingSafeEqual(Buffer.from(r.fingerprint, 'hex'), presented) && !hit) hit = r;
    if (!hit) return this.refuse(res, 'unknown-token', peer);
    if (Date.parse(hit.expiresAt) <= t) return this.refuse(res, 'expired', peer);
    const verb = verbOf(hit.scopes, req.method ?? '', req.url ?? '');
    if (!verb) return this.refuse(res, 'scope', peer);
    const origin = `http://127.0.0.1:${this.o.loopbackPort}`;
    const headers = new Headers();
    for (const k of verb.forward) { const v = req.headers[k]; if (typeof v === 'string') headers.set(k, v); }
    headers.set('host', `127.0.0.1:${this.o.loopbackPort}`);
    headers.set('x-forwarded-for', '127.0.0.1');
    // x-bp-device from the pairing, and the decider seal when it holds `decide` (device-auth.ts; table-link-v2.md section 2)
    for (const [k, v] of Object.entries(deviceOverlay(hit))) headers.set(k, v);
    const id = hit.id, set = this.inflight.get(id) ?? new Set<ServerResponse>();
    this.inflight.set(id, set);
    set.add(res);
    res.on('close', () => { set.delete(res); if (!set.size && this.inflight.get(id) === set) this.inflight.delete(id); });
    await dispatch(this.o.routes, req, res, { url: new URL(verb.path + (verb.query ? `?${verb.query}` : ''), origin), headers });
  }

  // ---------------------------------------------------------------------------------------------- the owner's side
  /** What `pair list` shows: pending requests and pairings, never a token or a fingerprint. */
  status() {
    this.prune();
    const t = this.now();
    return {
      window: this.windowUntil > t ? new Date(this.windowUntil).toISOString() : null,
      listening: this.server ? `http://${this.o.host}:${this.port}` : null,
      // no code: it is on the requesting device's screen only (S3 finding 5)
      pending: this.pending.filter((p) => p.state === 'pending' || p.state === 'approved').map((p) => ({ device: p.device, peer: p.peer, state: p.state, scopes: p.granted ?? p.requested, until: new Date(p.until).toISOString() })),
      paired: this.rows().map((r) => ({ id: r.id, device: deviceId(r), scopes: r.scopes, createdAt: r.createdAt, expiresAt: r.expiresAt, expired: Date.parse(r.expiresAt) <= t })),
    };
  }
  /** The one mint gate: a person typed the code the device shows. Scopes and days may be narrowed (or scopes chosen) here. */
  approve(code: string, scopes?: Scope[], days?: number, by?: string): { ok: true; device: string; peer: string; scopes: Scope[]; days: number } | { ok: false; status: number; error: string; wrong?: { count: number; limit: number; cancelled: number } } {
    this.prune();
    const p = this.pending.find((x) => x.code === code.toUpperCase() && x.state === 'pending');
    if (!p) {
      // a wrong code counts, from the CLI and the Headsets page alike (MAX_WRONG_CODES); the code typed is never recorded
      const count = ++this.wrongCodes;
      this.ledger({ event: 'wrong-code', count, limit: MAX_WRONG_CODES });
      let cancelled = 0;
      if (count >= MAX_WRONG_CODES) {
        for (const x of this.pending) if (x.state === 'pending') { x.state = 'denied'; cancelled++; }
        this.windowUntil = 0;
        this.wrongCodes = 0;
        this.ledger({ event: 'wrong-code-limit', cancelled });
        this.log(`lan door: ${MAX_WRONG_CODES} wrong codes: every open pairing request is cancelled and the window is shut`);
        void this.converge();
      }
      return { ok: false, status: 404, error: `no pending request with code ${code} (it lives ${PAIR_TTL_MS / 1000} s)`, wrong: { count, limit: MAX_WRONG_CODES, cancelled } };
    }
    if (this.live().length >= MAX_PAIRED) return { ok: false, status: 409, error: `${MAX_PAIRED} devices are paired already; pair revoke one first` };
    // a right code resets the count only for a request from another device than this PC: a local program could otherwise
    // open its own request, approve it every few guesses and guess on forever (S4, 2026-11-10). The count also restarts
    // when a closed window is opened again (openWindow).
    if (!peerIsThisPc(p.peer)) this.wrongCodes = 0;
    p.state = 'approved';
    // a named-only scope (decide, scan) is granted when the owner's approve names it, never because the device asked
    p.granted = scopes ?? p.requested.filter((s) => !NAMED_ONLY.includes(s));
    if (!p.granted.length) p.granted = ['read'];
    p.days = days ?? DEFAULT_DAYS;
    p.until = this.now() + CLAIM_TTL_MS;
    this.ledger({ event: 'approve', device: p.device, peer: p.peer, requested: p.requested, granted: p.granted, days: p.days, ...(by ? { by } : {}) });
    void this.converge();
    return { ok: true, device: p.device, peer: p.peer, scopes: p.granted, days: p.days };
  }
  deny(code: string): boolean {
    this.prune();
    const p = this.pending.find((x) => x.code === code.toUpperCase() && (x.state === 'pending' || x.state === 'approved'));
    if (!p) return false;
    p.state = 'denied';
    this.ledger({ event: 'deny', device: p.device, peer: p.peer });
    return true;
  }
  /** The Headsets page's decline: by the request's opaque id (the page never holds a code). */
  denyId(id: string, by = 'page'): boolean {
    this.prune();
    const p = this.pending.find((x) => x.id === id && (x.state === 'pending' || x.state === 'approved'));
    if (!p) return false;
    p.state = 'denied';
    this.ledger({ event: 'deny', device: p.device, peer: p.peer, by });
    return true;
  }
  /** Turn the Wi-Fi listener on in a running door that was started without it (the Headsets page's switch, this run only):
   *  the same admission, Host rule and verbs as `--lan`, on `host:port`. */
  async widen(host: string, port: number): Promise<void> {
    if (this.o.lan !== false) return;
    this.o.host = host;
    this.o.port = port;
    this.o.lan = true;
    await this.converge();
  }
  /** What the Headsets page shows: no code, no nonce, no fingerprint, no token. `lastSeen` (headsets.ts) is when this
   *  process last authenticated each pairing, on either listener. */
  pageState(lastSeen: (deviceId: string) => string | undefined = () => undefined) {
    this.prune();
    const t = this.now();
    return {
      window: this.windowUntil > t ? new Date(this.windowUntil).toISOString() : null,
      wifi: this.o.lan === false ? null : { address: this.o.host, port: this.port ?? this.o.port, listening: this.server !== null },
      pending: this.pending.filter((p) => p.state === 'pending' || p.state === 'approved').map((p) => ({
        id: p.id, device: p.device, peer: p.peer, state: p.state, requested: p.requested, ...(p.granted ? { granted: p.granted } : {}),
        at: new Date(p.at).toISOString(), until: new Date(p.until).toISOString(),
      })),
      wrongCodes: { count: this.wrongCodes, limit: MAX_WRONG_CODES },
      paired: pairedView(this.rows(), t, lastSeen),
    };
  }
  /** Remove a pairing: its next request is refused, and its requests in flight are cut now. */
  async revoke(id: string, by?: string): Promise<boolean> {
    if (!removePairing(id, this.home)) return false;
    for (const res of this.inflight.get(id) ?? []) res.destroy();
    this.inflight.delete(id);
    this.ledger({ event: 'revoke', id, ...(by ? { by } : {}) });
    await this.converge();
    return true;
  }

  /** The loopback-only routes `npm run server -- pair ...` (lan-pair.ts) calls: a surface the LAN cannot reach (the mount
   *  refuses every non-loopback peer, and VERBS names none of them). Reads take the read guard, writes the write guard. */
  adminRoutes(): Route[] {
    const file = import.meta.filename;
    const write = (name: string, run: (b: Record<string, unknown>) => Promise<Response> | Response): Route => ({
      path: `/lan/pair/${name}`, file, methods: ['POST'],
      handlers: {
        POST: async (req) => {
          const denied = localOnly(req) ?? jsonOnly(req);
          if (denied) return Response.json({ error: denied }, { status: denied.startsWith('body must') ? 415 : 403 });
          let b: unknown;
          try { b = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
          if (!b || typeof b !== 'object' || Array.isArray(b)) return Response.json({ error: 'body must be a JSON object' }, { status: 400 });
          return run(b as Record<string, unknown>);
        },
      },
      match: (p) => (p === `/lan/pair/${name}` ? {} : null),
    });
    const code = (b: Record<string, unknown>) => (typeof b.code === 'string' && /^[A-Za-z0-9]{6}$/.test(b.code) ? b.code : null);
    return [
      {
        path: '/lan/pair', file, methods: ['GET'],
        handlers: { GET: (req) => { const denied = localHost(req); return denied ? Response.json({ error: denied }, { status: 403 }) : Response.json(this.status()); } },
        match: (p) => (p === '/lan/pair' ? {} : null),
      },
      write('open', async () => {
        const until = this.openWindow();
        await this.converge();
        return Response.json({ window: new Date(until).toISOString(), listening: this.server ? `http://${this.o.host}:${this.port}` : null });
      }),
      write('approve', async (b) => {
        const c = code(b);
        if (!c) return Response.json({ error: 'body must name the 6-character code' }, { status: 400 });
        if (b.scopes !== undefined && !isScopes(b.scopes)) return Response.json({ error: `scopes must be a list of ${SCOPES.join(', ')}` }, { status: 400 });
        if (b.days !== undefined && !(Number.isInteger(b.days) && (b.days as number) >= 1 && (b.days as number) <= MAX_DAYS)) return Response.json({ error: `days must be an integer 1-${MAX_DAYS}` }, { status: 400 });
        const r = this.approve(c, b.scopes as Scope[] | undefined, b.days as number | undefined);
        if (!r.ok && r.wrong) await sleep(REFUSAL_DELAY_MS); // a wrong code waits as the page's does (S4, 2026-11-10)
        return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: r.status });
      }),
      write('deny', (b) => {
        const c = code(b);
        if (!c) return Response.json({ error: 'body must name the 6-character code' }, { status: 400 });
        return this.deny(c) ? Response.json({ ok: true }) : Response.json({ error: `no open request with code ${c}` }, { status: 404 });
      }),
      write('revoke', async (b) => {
        if (typeof b.id !== 'string' || !/^[0-9a-f]{8}$/.test(b.id)) return Response.json({ error: 'body must name the pairing id (8 hex)' }, { status: 400 });
        return (await this.revoke(b.id)) ? Response.json({ ok: true }) : Response.json({ error: `no pairing ${b.id}` }, { status: 404 });
      }),
      write('sync', async () => { await this.converge(); return Response.json(this.status()); }),
      // the tether's side of the ceremony and its address book (table-link-v2.md section 4): the same answers as the LAN
      // door's /pair and /pair/claim, a refusal as a 403 naming its cause (a loopback caller can read the ledger and call the
      // CLI's routes anyway, so the cause hides nothing from it that the LAN's bare 403 hides from the network)
      ...(['/pair', '/pair/claim'] as const).map((p): Route => ({
        path: p, file, methods: ['POST'],
        handlers: {
          POST: async (req) => {
            const denied = localOnly(req) ?? jsonOnly(req);
            if (denied) return Response.json({ error: denied }, { status: denied.startsWith('body must') ? 415 : 403 });
            let b: unknown = null;
            try { b = await req.json(); } catch { /* refused below as pair-body or claim-unknown */ }
            const body = b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
            const a = p === '/pair' ? this.requestPairing(body, 'loopback') : this.claimPairing(body, 'loopback');
            if ('refuse' in a) return Response.json({ error: `pairing refused: ${a.refuse}` }, { status: 403, headers: { 'cache-control': 'no-store' } });
            void this.converge();
            return Response.json(a.body, { status: a.status, headers: { 'cache-control': 'no-store' } });
          },
        },
        match: (q) => (q === p ? {} : null),
      })),
      {
        path: '/pair/me', file, methods: ['GET'],
        handlers: {
          GET: (req) => {
            const denied = localHost(req);
            if (denied) return Response.json({ error: denied }, { status: 403 });
            const m = TOKEN.exec(req.headers.get('authorization') ?? ''), a = m ? this.me(m[1]) : null;
            return a ? Response.json(a, { headers: { 'cache-control': 'no-store' } })
              : Response.json({ error: 'device token unknown, expired or revoked: pair again' }, { status: 401, headers: { 'cache-control': 'no-store' } });
          },
        },
        match: (q) => (q === '/pair/me' ? {} : null),
      },
      {
        path: '/lan/where', file, methods: ['GET'],
        handlers: { GET: (req) => { const denied = localHost(req); return denied ? Response.json({ error: denied }, { status: 403 }) : Response.json(this.where(), { headers: { 'cache-control': 'no-store' } }); } },
        match: (q) => (q === '/lan/where' ? {} : null),
      },
    ];
  }
}
