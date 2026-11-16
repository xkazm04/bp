// The /headsets page's one door to the server (docs/concepts/vr-light-table/table-link-v2.md section 13): the door's state, the
// pairing ceremony's owner side (open, approve by the TYPED code, decline, revoke, switch the door on), the policy grants and
// the decision log. The headsets routes live only in apps/server (:3100); the web app reaches them through its rewrite
// (BP_COMPANION_URL), and every call carries bp's own page's human token (x-bp-human), fetched from that same process.
//
// Reachability is decided by the state read: a 404 there means this web app serves its own companion (no BP_COMPANION_URL),
// a network failure or a 5xx means the server behind it is down. Either way the page shows one message and nothing else.
//
// `?fixture=1` swaps every call for an in-memory fake (the /projects precedent), so every state can be seen and screenshotted
// without a headset: `1` (Wi-Fi on, a request waiting, two pairings, grants and a log), `off`, `cable`, `paired`, `empty`,
// `noserver`, `nowire` and `ask` (a headset's ask waiting for CONFIRM; nothing running, so CONFIRM starts it). In the fixture the code K7QX4M approves the waiting request; any other code is wrong.
import { humanToken } from '@/components/crossing/follow';

export type DoorMode = 'off' | 'pair' | 'lan';
export type Scope = 'read' | 'standup' | 'place' | 'focus' | 'decide' | 'scan' | 'onboard';
export interface PendingView { id: string; device: string; peer: string; state: 'pending' | 'approved'; requested: Scope[]; granted?: Scope[]; at: string; until: string }
export interface PairedView { id: string; device: string; name: string; scopes: Scope[]; createdAt: string; expiresAt: string; expired: boolean; lastSeen?: string }
export interface HeadsetState {
  now: string;
  door: DoorMode;
  started: DoorMode;
  window: string | null;
  wifi: { address: string; port: number; listening: boolean } | null;
  wifiAt: { address: string | null; port: number } | null;
  pending: PendingView[];
  wrongCodes: { count: number; limit: number };
  paired: PairedView[];
  scopes: Scope[];
  namedOnly: Scope[];
  days: { default: number; max: number };
  limits: { pending: number; paired: number };
  /** Project reads a headset started (the onboard scope), newest first (table-link-v2.md section 14). */
  onboards: OnboardView[];
  onboardBounds: { perDay: number; inFlight: number };
  /** A headset's asks to read a folder, waiting for CONFIRM or DECLINE on this page (owner, 2026-11-10: the PC confirm). */
  asks: AskView[];
}
/** One open ask: the folder's name and hint as the PC knows them, and the words the headset says it showed. */
export interface AskView { id: string; device: string; name: string; hint: string; shown: string; askedAt: string; expiresAt: string }
export interface OnboardView { at: string; device: string; slug: string; name: string; shown?: string; job: string; status: string }
export interface Marks { surface: 'web' | 'vr'; device?: string; shown?: string }
export interface Grant { id: string; product: string; tools: string[]; minTier?: number; expiresAt: string; createdAt: string; grantedBy?: Marks }
export interface Decision { at: string; kind: 'morning' | 'card' | 'policy-grant' | 'policy-revoke' | 'onboard' | 'onboard-ask'; surface: 'web' | 'vr'; device?: string; shown?: string; product?: string; target: string; verdict: string; job?: string; request?: string; reason?: string }
export interface DecisionPage { rows: Decision[]; matched: number; total: number; limit: number; unreadable: number; recorded: boolean; filter: { surface?: string; device?: string } }

/** The page cannot reach bp's server: `noserver` (nothing answers behind the web app) or `nowire` (the web app serves its
 *  own companion, so the headsets routes are not here). */
export class Unreachable extends Error {
  kind: 'noserver' | 'nowire';
  constructor(kind: 'noserver' | 'nowire') { super(kind); this.kind = kind; }
}
/** A refusal, in the route's own words. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export interface HeadsetsApi {
  fixture: string | null;
  state(): Promise<HeadsetState>;
  open(): Promise<HeadsetState>;
  approve(code: string, scopes: Scope[], days: number): Promise<{ device: string; peer: string; scopes: Scope[]; days: number }>;
  deny(id: string): Promise<void>;
  revoke(id: string): Promise<void>;
  door(mode: 'pair' | 'lan'): Promise<HeadsetState>;
  grants(): Promise<Grant[]>;
  revokeGrant(id: string): Promise<void>;
  decisions(surface: 'vr' | 'web' | null): Promise<DecisionPage>;
  /** STOP a project read a headset started (the existing job cancel, from this page only). */
  stop(slug: string, job: string): Promise<void>;
  /** CONFIRM a headset's ask: the PC starts reading the folder (its answer, or the sentence it failed with). */
  confirmAsk(id: string): Promise<{ slug: string; name: string; job: string }>;
  declineAsk(id: string): Promise<void>;
}

const TIMEOUT_MS = 15_000;
async function send(url: string, method: string, body?: unknown, fresh = false): Promise<Response> {
  let token: string;
  try { token = await humanToken(fresh); } catch { throw new Unreachable('noserver'); }
  try {
    return await fetch(url, {
      method, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'x-bp-human': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { throw new Unreachable('noserver'); }
}
/** One call as bp's own page: a 403 retries once with a fresh token (a restarted server minted a new one). */
async function call<T>(url: string, method = 'GET', body?: unknown, reach = false): Promise<T> {
  let r = await send(url, method, body);
  if (r.status === 403) r = await send(url, method, body, true);
  if (r.status >= 500) throw new Unreachable('noserver');
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (reach && r.status === 404) throw new Unreachable('nowire');
  if (!r.ok) throw new ApiError(j?.error ?? `the server answered ${r.status}`, r.status);
  if (j === null) throw new Unreachable('noserver');
  return j;
}
const H = '/api/companion/headsets';
const real: HeadsetsApi = {
  fixture: null,
  state: () => call<HeadsetState>(H, 'GET', undefined, true),
  open: () => call<HeadsetState>(H + '/open', 'POST', {}),
  approve: (code, scopes, days) => call(H + '/approve', 'POST', { code, scopes, days }),
  deny: async (id) => { await call(H + '/deny', 'POST', { id }); },
  revoke: async (id) => { await call(H + '/revoke', 'POST', { id }); },
  door: (mode) => call<HeadsetState>(H + '/door', 'POST', { mode }),
  grants: () => call<Grant[]>('/api/companion/policies'),
  revokeGrant: async (id) => { await call('/api/companion/policies/' + encodeURIComponent(id), 'DELETE'); },
  decisions: (surface) => call<DecisionPage>('/api/companion/decisions' + (surface ? '?surface=' + surface : '')),
  stop: async (slug, job) => { await call(H + '/stop', 'POST', { slug, job }); },
  confirmAsk: (id) => call(H + '/ask/confirm', 'POST', { id }),
  declineAsk: async (id) => { await call(H + '/ask/decline', 'POST', { id }); },
};

// ------------------------------------------------------------------------------------------------ the fixture
const SCOPES: Scope[] = ['read', 'standup', 'place', 'focus', 'decide', 'scan', 'onboard'];
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const ahead = (s: number) => new Date(Date.now() + s * 1000).toISOString();

function fixtureApi(kind: string): HeadsetsApi {
  const door: DoorMode = kind === 'off' ? 'off' : kind === 'cable' ? 'pair' : 'lan';
  let mode = door;
  let window: string | null = kind === '1' || kind === 'cable' ? ahead(84) : null;
  let wrong = 0;
  const pending: PendingView[] = kind === '1' || kind === 'cable'
    ? [{ id: '3f2a9c01', device: 'quest3s', peer: kind === 'cable' ? 'loopback' : '192.168.1.50', state: 'pending', requested: ['standup', 'place', 'focus', 'decide', 'scan'], at: ago(36), until: ahead(84) }]
    : [];
  const paired: PairedView[] = kind === 'off' || kind === 'cable' || kind === 'empty' ? [] : [
    { id: 'b81c44e0', device: 'quest3s:b81c44e0', name: 'quest3s', scopes: ['standup', 'place', 'focus', 'decide', 'scan', 'onboard'], createdAt: ago(86400 * 3), expiresAt: ahead(86400 * 27), expired: false, lastSeen: ago(42) },
    { id: '0d9e7a12', device: 'quest-lan:0d9e7a12', name: 'quest-lan', scopes: ['read'], createdAt: ago(86400 * 40), expiresAt: ago(86400 * 10), expired: true },
  ];
  const grants: Grant[] = kind === 'empty' || kind === 'off' || kind === 'cable' ? [] : [
    { id: 'pol_0mw9pv75q02e8d2', product: 'kettle-web', tools: ['decision.answer', 'scan.directed'], minTier: 1, createdAt: ago(3600), expiresAt: ahead(3600 * 7), grantedBy: { surface: 'vr', device: 'quest3s:b81c44e0', shown: 'Let it approve tier 1+ findings and run directed scans on Kettle Web for 8 hours?' } },
    { id: 'pol_0mw9a1b2c03d4e5', product: 'kettle-desk', tools: ['finding.decline'], minTier: 2, createdAt: ago(86400), expiresAt: ago(3600 * 16), grantedBy: { surface: 'vr', device: 'quest3s:b81c44e0', shown: 'Let it decline tier 2+ repeats on Kettle Desk for 8 hours?' } },
    { id: 'pol_0mw8z9y8x07w6v5', product: '*', tools: ['wave.dispatch'], createdAt: ago(86400 * 2), expiresAt: ahead(86400 * 5), grantedBy: { surface: 'web' } },
  ];
  const log: Decision[] = kind === 'empty' || kind === 'off' || kind === 'cable' ? [] : [
    { at: ago(3600), kind: 'policy-grant', surface: 'vr', device: 'quest3s:b81c44e0', shown: grants[0].grantedBy!.shown, product: 'kettle-web', target: grants[0].id, verdict: `grant decision.answer,scan.directed tier 1+ until ${grants[0].expiresAt}` },
    { at: ago(3700), kind: 'card', surface: 'vr', device: 'quest3s:b81c44e0', shown: 'Decline this card? The companion wants to decline the repeat "Inline the onboarding tips" on Kettle Desk: you declined the same idea on 3 November.', product: 'kettle-desk', target: 'card_0mw9pv4q00174cb', verdict: 'decline' },
    { at: ago(3800), kind: 'morning', surface: 'vr', device: 'quest3s:b81c44e0', shown: 'Approve the top blocker? "Checkout drops the basket after a timeout" (tier 1, Kettle Web). Its brief: three reports this week, one fix touches two files.', product: 'kettle-web', target: 'find-kettle-web-1', verdict: 'approve' },
    { at: ago(5400), kind: 'morning', surface: 'web', product: 'kettle-phone', target: 'find-kettle-phone-1', verdict: 'defer' },
    { at: ago(86400), kind: 'policy-revoke', surface: 'vr', device: 'quest3s:b81c44e0', product: 'kettle-desk', target: 'pol_0mw8a1b2c03d4e5', verdict: 'revoke' },
  ];
  const onboards: OnboardView[] = kind === 'empty' || kind === 'off' || kind === 'cable' ? [] : [
    { at: ago(420), device: 'quest3s:b81c44e0', slug: 'harbor', name: 'harbor', shown: 'Read harbor now? "Add the tide table export". This starts a paid agent run on your PC.', job: 'j-mh2k1x9-a7q2', status: 'running' },
  ];
  log.unshift({ at: ago(420), kind: 'onboard', surface: 'vr', device: 'quest3s:b81c44e0', shown: onboards[0]?.shown, product: 'harbor', target: 'harbor', verdict: 'start', job: 'j-mh2k1x9-a7q2' });
  if (!onboards.length) log.shift();
  // `?fixture=ask`: a headset's ask waits for the owner's CONFIRM (the PC confirm, owner 2026-11-10); nothing is running
  if (kind === 'ask') { onboards.forEach((o) => { o.status = 'done'; }); }
  const asks: AskView[] = kind === 'ask' ? [
    { id: '5c1e0b7a9d2f4e6a8b3c1d0e', device: 'quest3s:b81c44e0', name: 'tidewater', hint: 'Add the harbour schedule importer', shown: 'Read tidewater now? It is read on your PC once you confirm it there.', askedAt: ago(25), expiresAt: ahead(575) },
  ] : [];
  if (asks.length) log.unshift({ at: asks[0].askedAt, kind: 'onboard-ask', surface: 'vr', device: asks[0].device, shown: asks[0].shown, target: asks[0].name, verdict: 'ask', request: asks[0].id });
  const pause = (ms = 200) => new Promise<void>((r) => setTimeout(r, ms));
  const state = (): HeadsetState => {
    if (window && Date.parse(window) <= Date.now()) window = null;
    return {
      now: new Date().toISOString(), door: mode, started: door, window,
      wifi: mode === 'lan' ? { address: '192.168.1.20', port: 3101, listening: true } : null,
      wifiAt: mode === 'lan' ? null : { address: '192.168.1.20', port: 3101 },
      pending: pending.map((p) => ({ ...p })), wrongCodes: { count: wrong, limit: 5 }, paired: paired.map((p) => ({ ...p })),
      scopes: SCOPES, namedOnly: ['decide', 'scan', 'onboard'], days: { default: 30, max: 30 }, limits: { pending: 4, paired: 8 },
      onboards: onboards.map((o) => ({ ...o })), onboardBounds: { perDay: 3, inFlight: 1 },
      asks: asks.map((a) => ({ ...a })),
    };
  };
  const need = () => { if (mode === 'off') throw new ApiError('pairing is off on this server: switch it on first', 409); };
  return {
    fixture: kind,
    async state() {
      await pause();
      if (kind === 'noserver' || kind === 'nowire') throw new Unreachable(kind);
      return state();
    },
    async open() { await pause(); need(); window = ahead(120); return state(); },
    async approve(code, scopes, days) {
      await pause(400); need();
      const p = pending.find((x) => x.state === 'pending');
      if (!p || code.trim().toUpperCase() !== 'K7QX4M') {
        wrong++;
        const left = 5 - wrong;
        if (left <= 0) { pending.splice(0); window = null; wrong = 0; throw new ApiError('5 wrong codes in a row: every open request was cancelled and pairing is shut. Open pairing again and ask the headset for a new code.', 404); }
        throw new ApiError(`That code matches no open request. Check the headset and type it again (${left} ${left === 1 ? 'try' : 'tries'} left before every request is cancelled).`, 404);
      }
      wrong = 0;
      Object.assign(p, { state: 'approved', granted: scopes, until: ahead(120) });
      setTimeout(() => {
        const i = pending.indexOf(p);
        if (i >= 0) pending.splice(i, 1);
        paired.unshift({ id: 'c0ffee42', device: `${p.device}:c0ffee42`, name: p.device, scopes, createdAt: new Date().toISOString(), expiresAt: ahead(86400 * days), expired: false, lastSeen: new Date().toISOString() });
      }, 2500);
      return { device: p.device, peer: p.peer, scopes, days };
    },
    async deny(id) { await pause(); const i = pending.findIndex((x) => x.id === id); if (i < 0) throw new ApiError('That request is no longer open', 404); pending.splice(i, 1); },
    async revoke(id) { await pause(); const i = paired.findIndex((x) => x.id === id); if (i < 0) throw new ApiError('No pairing with that id', 404); paired.splice(i, 1); },
    async door(m) { await pause(500); if (mode !== 'lan') mode = m; if (!paired.length && !window) window = ahead(120); return state(); },
    async grants() { await pause(); return grants.map((g) => ({ ...g })); },
    async revokeGrant(id) {
      await pause(); const i = grants.findIndex((g) => g.id === id); if (i < 0) throw new ApiError(`no policy ${id}`, 404);
      const g = grants.splice(i, 1)[0];
      log.unshift({ at: new Date().toISOString(), kind: 'policy-revoke', surface: 'web', product: g.product, target: id, verdict: 'revoke' });
    },
    async decisions(surface) {
      await pause();
      const rows = log.filter((r) => !surface || r.surface === surface);
      return { rows, matched: rows.length, total: log.length, limit: 100, unreadable: 0, recorded: log.length > 0, filter: surface ? { surface } : {} };
    },
    async stop(slug, job) {
      await pause(); const o = onboards.find((x) => x.slug === slug && x.job === job);
      if (!o) throw new ApiError('No project read started from a headset matches that', 404);
      o.status = 'cancelled';
    },
    async confirmAsk(id) {
      await pause(600); const i = asks.findIndex((a) => a.id === id);
      if (i < 0) throw new ApiError('That ask is no longer known to this server.', 404);
      const a = asks.splice(i, 1)[0];
      const busy = onboards.find((o) => o.status === 'running');
      if (busy) {
        const reason = `A project a headset asked for is still being read (${busy.slug}): one at a time. Stop it first, or wait.`;
        log.unshift({ at: new Date().toISOString(), kind: 'onboard', surface: 'web', device: a.device, shown: a.shown, target: a.name, verdict: 'decline', reason, request: a.id });
        throw new ApiError(reason, 409);
      }
      const job = 'j-mh3q8c2-k4d1';
      onboards.unshift({ at: new Date().toISOString(), device: a.device, slug: a.name, name: a.name, shown: a.shown, job, status: 'running' });
      log.unshift({ at: new Date().toISOString(), kind: 'onboard', surface: 'web', device: a.device, shown: a.shown, product: a.name, target: a.name, verdict: 'confirm', job, request: a.id });
      return { slug: a.name, name: a.name, job };
    },
    async declineAsk(id) {
      await pause(); const i = asks.findIndex((a) => a.id === id);
      if (i < 0) throw new ApiError('That ask is no longer known to this server.', 404);
      const a = asks.splice(i, 1)[0];
      log.unshift({ at: new Date().toISOString(), kind: 'onboard', surface: 'web', device: a.device, shown: a.shown, target: a.name, verdict: 'decline', reason: 'declined at the PC', request: a.id });
    },
  };
}

let api: HeadsetsApi | null = null;
/** The door for this page load: the fixture when the URL asks for it, else the server. */
export function headsetsApi(): HeadsetsApi {
  if (api) return api;
  const f = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('fixture');
  api = f ? fixtureApi(f) : real;
  return api;
}
