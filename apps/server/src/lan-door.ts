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
//    The registry is re-read from disk on every request (a revoke reaches the next request; an unreadable file
//    authenticates nobody), every row's fingerprint is compared in constant time over its full length, and every
//    refusal past admission waits REFUSAL_DELAY_MS before it answers.
// 4. Scope (verb-allowlists). VERBS below is the whole remote vocabulary, a closed grammar: a method plus an anchored path
//    pattern, no percent-escapes, no query except the baton's `claim=1`. `read`: the plan reads; `standup`: read plus the
//    companion turn, focus and cards GETs; `place`: the three baton verbs; `focus`: the shared focus's GET and POST (a
//    headset follows and publishes without `read`; the route pins its reader to the paired device); `decide`: two verbs, the
//    headset's pinch on a card: a REPEAT declined (ROADMAP F8: .../proposals/<id>/decline, which refuses any card that is
//    not the same idea declined before) and the card's decision approved (D12: .../proposals/<id>/approve, the Morning
//    Watch's Approve: proposed -> approved, no job queued). `decide` has its own ceremony: a device may ask for it, but
//    only the owner's approve that names it (`--scope ...,decide`) grants it; a plain approve drops it. Never the plan's
//    free decide (proposals/<id>), cards/<id>, human-token, dispatch, build
//    or finish, and none of this server's own /lan or /athena routes.
// 5. The rewrite. Only Content-Type and Accept are copied from the device; Host becomes this server's loopback address,
//    X-Forwarded-For the door itself, and `x-bp-device` the paired device's id (`<device>:<pairing id>`), so whatever
//    `x-bp-device` or `x-bp-human` the device sent is dropped (W1's rule, baton.server.ts).
//
// Every refusal, whatever its cause, is the same bare 403 (no body, `cache-control: no-store`, `connection: close`). The
// cause goes to $BP_HOME/lan/ledger.jsonl (with grants, claims, denials and revocations), rate-capped. Two answers are
// deliberately not that 403, both only to a holder of the nonce: 202 `pending`, and 410 `claimed`.
// Recorded deviations (plan.md D1): the token travels in cleartext HTTP (S8; TLS is the follow-up); the binding is the
// token plus the private-range class, not a device key; the approval surface is the CLI, the web lamp's is not built.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEVICE_HEADER } from '@bp/core/server/api/session/baton.server';
import { jsonOnly, localHost, localOnly } from '@bp/core/scan/local-only';
import { dispatch, type Route } from './mount.ts';

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
const MAX_PAIR_BODY = 2048;
const DAY_MS = 86_400_000;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const DEVICE = /^[A-Za-z0-9_.-]{1,40}$/;
const TOKEN = /^Bearer ([A-Za-z0-9_-]{43})$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: read off a headset, typed on a keyboard

export const SCOPES = ['read', 'standup', 'place', 'focus', 'decide'] as const;
/** Granted only when the owner's approve names it (never by a device's request alone). */
export const NAMED_ONLY: readonly Scope[] = ['decide'];
export type Scope = (typeof SCOPES)[number];
const isScopes = (v: unknown): v is Scope[] =>
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
export function lanAddress(): string | null {
  const found = Object.values(os.networkInterfaces()).flatMap((l) => l ?? []).filter((i) => i.family === 'IPv4' && !i.internal && privatePeer(i.address)).map((i) => i.address);
  return found.find((a) => !a.startsWith('100.')) ?? found[0] ?? null;
}

// ------------------------------------------------------------------------------------------------ the verbs
interface Verb { scope: Scope; method: 'GET' | 'POST'; path: RegExp; query?: string }
// SLUG: the registry's own rule (registry.server.ts SLUG_RE, focus.ts), so the door never forwards a slug no product can have (E6, D3)
const SLUG = '[a-z0-9][a-z0-9-]{0,62}', ID = '[A-Za-z0-9_.-]{1,80}';
const products = (rest: string) => new RegExp(`^/api/products/${SLUG}/${rest}$`);
/** The whole remote vocabulary. A request that matches no row is refused; nothing else is reachable through the door. */
export const VERBS: readonly Verb[] = [
  { scope: 'read', method: 'GET', path: products('structure') },
  { scope: 'read', method: 'GET', path: products('plan') },
  { scope: 'read', method: 'GET', path: products('scans') },
  { scope: 'read', method: 'GET', path: products(`scans/${ID}`) },
  { scope: 'read', method: 'GET', path: products('scan') },
  { scope: 'read', method: 'GET', path: products('waves') },
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
];
/** The verb a request names, or null. `standup` includes `read`. The raw request target is parsed here, strictly: printable
 *  ASCII, no percent-escape, no dot segment, no empty segment, and a query only where the verb names it exactly. */
export function verbOf(scopes: readonly Scope[], method: string, target: string): { path: string; query: string } | null {
  if (!/^\/[\x21-\x7e]*$/.test(target) || /%|\/\/|\/\.\.?(\/|\?|$)/.test(target)) return null;
  const q = target.indexOf('?');
  const p = q < 0 ? target : target.slice(0, q), query = q < 0 ? '' : target.slice(q + 1);
  const has = (s: Scope) => scopes.includes(s) || (s === 'read' && scopes.includes('standup'));
  const v = VERBS.find((x) => x.method === method && x.path.test(p) && (x.query ?? '') === query);
  return v && has(v.scope) ? { path: p, query } : null;
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
export function readRegistry(home = lanHome(), warn: (s: string) => void = console.error): Pairing[] {
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

// ------------------------------------------------------------------------------------------------ the door
interface Pending {
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
  /** Where the peer address is read: the socket. A check's harness substitutes it; nothing in this server does. */
  peerOf?: (req: IncomingMessage) => string | undefined;
  log?: (line: string) => void;
}

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
  private timer: NodeJS.Timeout | null = null;
  private refusalsThisMinute = 0;
  private refusalMinute = 0;
  private suppressed = 0;
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
    if (reason && !this.server) await this.listen();
    else if (!reason && this.server) { await this.close(); this.log('lan door: closed (nothing paired, no pairing window)'); }
  }
  openWindow(): number {
    this.windowUntil = this.now() + WINDOW_MS;
    this.ledger({ event: 'window-open', until: new Date(this.windowUntil).toISOString() });
    this.log(`lan door: pairing window open until ${new Date(this.windowUntil).toISOString()} (npm run server -- pair open reopens it)`);
    // the caller converges (the listener comes up); the window's end is a reason to look again (the 15 s sweep would get there too, later)
    setTimeout(() => { void this.converge(); }, WINDOW_MS + 50).unref();
    return this.windowUntil;
  }
  private listen(): Promise<void> {
    if (this.opening) return this.opening;
    const s = http.createServer((req, res) => { void this.handle(req, res); });
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
  private ledger(row: Record<string, unknown>): void {
    try {
      fs.mkdirSync(this.home, { recursive: true });
      fs.appendFileSync(path.join(this.home, 'ledger.jsonl'), JSON.stringify({ at: new Date(this.now()).toISOString(), ...row }) + '\n');
    } catch { /* the ledger is a record, never a reason to fail a request */ }
  }
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
    const target = req.url ?? '';
    try {
      if (req.method === 'POST' && target === '/pair') return await this.pairRequest(req, res, peer as string);
      if (req.method === 'POST' && target === '/pair/claim') return await this.pairClaim(req, res, peer as string);
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

  private async pairRequest(req: IncomingMessage, res: ServerResponse, peer: string): Promise<void> {
    this.prune();
    const b = await readSmallJson(req);
    if (!b || typeof b.nonce !== 'string' || !NONCE.test(b.nonce) || typeof b.device !== 'string' || !DEVICE.test(b.device)
      || (b.scopes !== undefined && !isScopes(b.scopes))) return this.refuse(res, 'pair-body', peer);
    const known = this.findByNonce(b.nonce);
    if (known) {
      // a retried request: the existing view, never a reset (a resolved record stays resolved); only from its own peer
      if (known.peer !== peer || known.state === 'denied') return this.refuse(res, 'pair-repeat', peer);
      return sendJson(res, known.state === 'pending' ? 201 : 200, { state: known.state === 'pending' ? 'pending' : 'approved', code: known.code, expiresAt: new Date(known.until).toISOString() });
    }
    if (this.windowUntil <= this.now()) return this.refuse(res, 'no-window', peer);
    if (this.pending.filter((x) => x.state === 'pending').length >= MAX_PENDING) return this.refuse(res, 'pending-cap', peer);
    let code: string;
    do code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    while (this.pending.some((p) => p.code === code));
    const p: Pending = {
      nonceHash: createHash('sha256').update(b.nonce, 'utf8').digest(), code, device: b.device, peer,
      requested: (b.scopes as Scope[] | undefined) ?? ['read'], state: 'pending', until: this.now() + PAIR_TTL_MS,
    };
    this.pending.push(p);
    this.ledger({ event: 'pair-request', device: p.device, peer, scopes: p.requested });
    this.log(`lan door: pairing request from ${p.device} at ${peer} for ${p.requested.join(',')}: code ${code} (npm run server -- pair approve ${code})`);
    return sendJson(res, 201, { state: 'pending', code, expiresAt: new Date(p.until).toISOString() });
  }

  private async pairClaim(req: IncomingMessage, res: ServerResponse, peer: string): Promise<void> {
    this.prune();
    const b = await readSmallJson(req);
    const p = b && typeof b.nonce === 'string' && NONCE.test(b.nonce) ? this.findByNonce(b.nonce) : undefined;
    // the claimant is the approved identity: the nonce's holder, from the address the request came from
    if (!p || p.peer !== peer) return this.refuse(res, 'claim-unknown', peer);
    if (p.state === 'denied') return this.refuse(res, 'claim-denied', peer);
    if (p.state === 'pending') return sendJson(res, 202, { state: 'pending' });
    if (p.state === 'claimed') {
      this.ledger({ event: 'claim-again', device: p.device, peer, id: p.pairingId });
      return sendJson(res, 410, { state: 'claimed' });
    }
    // approved: mint now, deliver once, keep only the fingerprint
    const rows = this.rows().filter((r) => Date.parse(r.expiresAt) > this.now());
    if (rows.length >= MAX_PAIRED) return this.refuse(res, 'paired-cap', peer);
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
    return sendJson(res, 200, { token, device: deviceId(row), scopes: row.scopes, expiresAt: row.expiresAt });
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
    for (const k of ['content-type', 'accept']) { const v = req.headers[k]; if (typeof v === 'string') headers.set(k, v); }
    headers.set('host', `127.0.0.1:${this.o.loopbackPort}`);
    headers.set('x-forwarded-for', '127.0.0.1');
    headers.set(DEVICE_HEADER, deviceId(hit));
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
      pending: this.pending.filter((p) => p.state === 'pending' || p.state === 'approved').map((p) => ({ code: p.code, device: p.device, peer: p.peer, state: p.state, scopes: p.granted ?? p.requested, until: new Date(p.until).toISOString() })),
      paired: this.rows().map((r) => ({ id: r.id, device: deviceId(r), scopes: r.scopes, createdAt: r.createdAt, expiresAt: r.expiresAt, expired: Date.parse(r.expiresAt) <= t })),
    };
  }
  /** The one mint gate: a person typed the code the device shows. Scopes and days may be narrowed (or scopes chosen) here. */
  approve(code: string, scopes?: Scope[], days?: number): { ok: true; device: string; peer: string; scopes: Scope[]; days: number } | { ok: false; status: number; error: string } {
    this.prune();
    const p = this.pending.find((x) => x.code === code.toUpperCase() && x.state === 'pending');
    if (!p) return { ok: false, status: 404, error: `no pending request with code ${code} (it lives ${PAIR_TTL_MS / 1000} s)` };
    if (this.live().length >= MAX_PAIRED) return { ok: false, status: 409, error: `${MAX_PAIRED} devices are paired already; pair revoke one first` };
    p.state = 'approved';
    // a named-only scope (decide) is granted when the owner's approve names it, never because the device asked
    p.granted = scopes ?? p.requested.filter((s) => !NAMED_ONLY.includes(s));
    if (!p.granted.length) p.granted = ['read'];
    p.days = days ?? DEFAULT_DAYS;
    p.until = this.now() + CLAIM_TTL_MS;
    this.ledger({ event: 'approve', device: p.device, peer: p.peer, requested: p.requested, granted: p.granted, days: p.days });
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
  /** Remove a pairing: its next request is refused, and its requests in flight are cut now. */
  async revoke(id: string): Promise<boolean> {
    const rows = this.rows();
    if (!rows.some((r) => r.id === id)) return false;
    writeRegistry(rows.filter((r) => r.id !== id), this.home);
    for (const res of this.inflight.get(id) ?? []) res.destroy();
    this.inflight.delete(id);
    this.ledger({ event: 'revoke', id });
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
      write('approve', (b) => {
        const c = code(b);
        if (!c) return Response.json({ error: 'body must name the 6-character code' }, { status: 400 });
        if (b.scopes !== undefined && !isScopes(b.scopes)) return Response.json({ error: `scopes must be a list of ${SCOPES.join(', ')}` }, { status: 400 });
        if (b.days !== undefined && !(Number.isInteger(b.days) && (b.days as number) >= 1 && (b.days as number) <= MAX_DAYS)) return Response.json({ error: `days must be an integer 1-${MAX_DAYS}` }, { status: 400 });
        const r = this.approve(c, b.scopes as Scope[] | undefined, b.days as number | undefined);
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
    ];
  }
}
