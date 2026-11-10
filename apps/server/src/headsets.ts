// The Headsets page's routes (docs/concepts/vr-light-table/table-link-v2.md section 13): bp's own page pairs, lists and revokes
// headsets, and switches the LAN door on for this run of the server. Server-only routes, like the door's own (lan-door.ts
// adminRoutes): core cannot reach the door (check:core-purity), so they live here, under /api/companion/headsets so the web
// app's rewrite to this process (apps/web/next.config.ts, BP_COMPANION_URL) carries them. They are mounted on every start,
// door or no door, because the page must show a door that is off and switch it on.
//
// The gate, every route, in this order (registry: device-pairing pairing-ceremony, authorization ceiling-before-consent):
//   1. localOnly (a loopback Host, no foreign Origin, not cross-site, every X-Forwarded-For hop loopback), and jsonOnly on a write;
//   2. no device: a request carrying Authorization, the decider seal or x-bp-device is refused (403), whatever else it holds.
//      A paired headset's token, even one with `decide`, never manages headsets: the page is the human here;
//   3. the page's human token (`x-bp-human`, door.server.ts isHuman), never deciderOf.
// The page never receives a pairing code: it names a pending request by an opaque id (to decline it) and APPROVE carries the
// code the owner TYPED from the headset's screen; a wrong one counts toward MAX_WRONG_CODES (lan-door.ts) and waits
// REFUSAL_DELAY_MS before it answers. The old /lan/pair/* routes stay for the CLI unchanged (no human token: a terminal on the PC).
import { setTimeout as sleep } from 'node:timers/promises';
import { jsonOnly, localOnly } from '@bp/core/scan/local-only';
import { isHuman } from '@bp/core/server/api/companion/door.server';
import { DECIDER_SEAL_HEADER } from '@bp/core/server/decider-header';
import { DEVICE_HEADER } from '@bp/core/server/api/session/baton.server';
import type { Route } from './mount.ts';
import {
  DEFAULT_DAYS, MAX_DAYS, MAX_PAIRED, MAX_PENDING, MAX_WRONG_CODES, NAMED_ONLY, REFUSAL_DELAY_MS, SCOPES,
  appendLedger, isScopes, lanHome, pairedView, readRegistry, removePairing, type LanDoor, type Scope,
} from './lan-door.ts';
import { lastSeen } from './device-auth.ts';

export const HEADSETS = '/api/companion/headsets';
/** off: no door (the ceremony routes answer 404); pair: the ceremony over the cable only; lan: the Wi-Fi listener too. */
export type DoorMode = 'off' | 'pair' | 'lan';

/** What main.ts hands the routes: the door as it is now, and the one switch that attaches or widens it for this run. */
export interface DoorSwitch {
  door(): LanDoor | null;
  mode(): DoorMode;
  /** What the command line said: a restart goes back to it. */
  readonly started: DoorMode;
  /** Where Wi-Fi binds, or would bind if switched on (address null: no private-range interface). */
  wifiAt(): { address: string | null; port: number };
  /** Attach the door as --pair or --lan does, or widen a cable-only door to Wi-Fi. null when done, else what went wrong. */
  switchOn(mode: 'pair' | 'lan'): Promise<string | null>;
  /** $BP_HOME/lan (a check passes its own). */
  home?: string;
}

const NO_STORE = { 'cache-control': 'no-store' };
const answer = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE });
const fail = (error: string, status: number, more: Record<string, unknown> = {}): Response => answer({ error, ...more }, status);

/** The gate (above). null: the request may go on. */
export function headsetGate(req: Request): Response | null {
  const denied = localOnly(req);
  if (denied) return fail(denied, 403);
  if (req.method !== 'GET') { const notJson = jsonOnly(req); if (notJson) return fail(notJson, 415); }
  if (req.headers.has('authorization') || req.headers.has(DECIDER_SEAL_HEADER) || req.headers.has(DEVICE_HEADER)) {
    return fail("a headset cannot pair or revoke headsets: that is bp's own page's to do", 403);
  }
  if (!isHuman(req)) return fail("only bp's own page may pair or revoke headsets (it needs the page's x-bp-human token)", 403);
  return null;
}

/** The page's whole view. Never a code, a nonce, a fingerprint or a token. */
export function headsetState(sw: DoorSwitch) {
  const door = sw.door(), home = sw.home ?? lanHome(), now = Date.now();
  const at = sw.wifiAt();
  const view = door ? door.pageState(lastSeen) : { window: null, wifi: null, pending: [], wrongCodes: { count: 0, limit: MAX_WRONG_CODES }, paired: pairedView(readRegistry(home), now, lastSeen) };
  return {
    now: new Date(now).toISOString(),
    door: sw.mode(),
    started: sw.started,
    ...view,
    // where TURN WI-FI ON would bind (when it is not on yet)
    wifiAt: view.wifi ? null : at,
    scopes: SCOPES,
    namedOnly: NAMED_ONLY,
    days: { default: DEFAULT_DAYS, max: MAX_DAYS },
    limits: { pending: MAX_PENDING, paired: MAX_PAIRED },
  };
}

export function headsetRoutes(sw: DoorSwitch): Route[] {
  const file = import.meta.filename;
  const home = () => sw.home ?? lanHome();
  const write = (name: string, run: (b: Record<string, unknown>) => Promise<Response> | Response): Route => ({
    path: `${HEADSETS}/${name}`, file, methods: ['POST'],
    handlers: {
      POST: async (req) => {
        const refused = headsetGate(req);
        if (refused) return refused;
        let b: unknown;
        try { b = await req.json(); } catch { return fail('body must be JSON', 400); }
        if (!b || typeof b !== 'object' || Array.isArray(b)) return fail('body must be a JSON object', 400);
        return run(b as Record<string, unknown>);
      },
    },
    match: (p) => (p === `${HEADSETS}/${name}` ? {} : null),
  });
  const needDoor = (): LanDoor | Response => sw.door() ?? fail('pairing is off on this server: switch it on first', 409);
  const ID = /^[0-9a-f]{8}$/;
  return [
    {
      path: HEADSETS, file, methods: ['GET'],
      handlers: { GET: (req) => headsetGate(req) ?? answer(headsetState(sw)) },
      match: (p) => (p === HEADSETS ? {} : null),
    },
    write('open', (b) => {
      void b;
      const d = needDoor();
      if (d instanceof Response) return d;
      d.openWindow('page');
      return d.converge().then(() => answer(headsetState(sw)));
    }),
    write('approve', async (b) => {
      const d = needDoor();
      if (d instanceof Response) return d;
      if (typeof b.code !== 'string' || !/^[A-Za-z0-9]{6}$/.test(b.code.trim())) return fail('Type the 6 characters the headset shows', 400);
      if (!isScopes(b.scopes)) return fail(`Tick at least one permission (${SCOPES.join(', ')})`, 400);
      if (!(Number.isInteger(b.days) && (b.days as number) >= 1 && (b.days as number) <= MAX_DAYS)) return fail(`The pairing lasts 1 to ${MAX_DAYS} days`, 400);
      const r = d.approve(b.code.trim(), b.scopes as Scope[], b.days as number, 'page');
      if (r.ok) return answer({ ok: true, device: r.device, peer: r.peer, scopes: r.scopes, days: r.days });
      if (!r.wrong) return fail(r.error, r.status);
      // a wrong code: counted (lan-door.ts), and answered after the door's fixed delay, as the door answers a guess
      await sleep(REFUSAL_DELAY_MS);
      const left = r.wrong.limit - r.wrong.count;
      const words = r.wrong.cancelled || left <= 0
        ? `${r.wrong.limit} wrong codes in a row: every open request was cancelled and pairing is shut. Open pairing again and ask the headset for a new code.`
        : `That code matches no open request. Check the headset and type it again (${left} ${left === 1 ? 'try' : 'tries'} left before every request is cancelled).`;
      return fail(words, 404, { wrong: r.wrong });
    }),
    write('deny', (b) => {
      const d = needDoor();
      if (d instanceof Response) return d;
      if (typeof b.id !== 'string' || !ID.test(b.id)) return fail('body must name the request (its id)', 400);
      return d.denyId(b.id, 'page') ? answer({ ok: true }) : fail('That request is no longer open', 404);
    }),
    write('revoke', async (b) => {
      if (typeof b.id !== 'string' || !ID.test(b.id)) return fail('body must name the pairing (its id)', 400);
      const d = sw.door();
      // the registry is on disk, and a pairing works over the cable with no door attached: revoke works either way
      const ok = d ? await d.revoke(b.id, 'page') : removePairing(b.id, home());
      if (ok && !d) appendLedger(home(), { event: 'revoke', id: b.id, by: 'page' });
      return ok ? answer({ ok: true }) : fail('No pairing with that id', 404);
    }),
    write('door', async (b) => {
      if (b.mode !== 'pair' && b.mode !== 'lan') return fail("body must be { mode: 'pair' | 'lan' }", 400);
      const err = await sw.switchOn(b.mode);
      return err ? fail(err, 409) : answer(headsetState(sw));
    }),
  ];
}
