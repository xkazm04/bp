// The place baton, run for real against this server on the crossing's own clock: the page arms it (with the human token, as
// bp's own page) when the crossing reaches "armed", and this page stands in for the APK on loopback - it claims at t 0.8,
// writes the place when the lift is done, writes the next place when the table leads, and hands it back when the headset
// comes off. Each write goes out on the companion stream (`event: place`), so the page behind the overlay really follows
// the table. On the design's path the device's calls come from the Quest through the S8 LAN door (:3101, Bearer, scope
// place); that door is not built, so here the device names itself with x-bp-device. A step fires once per run, in order;
// a replay starts a new run (an arm over a baton the stand-in still holds hands it back first).
import type { CrossPlace, NextPlace } from './place';
import { placeWire } from './place';

export type BatonStep = 'arm' | 'claim' | 'live' | 'lead' | 'return';
export const BATON_STEPS: readonly BatonStep[] = ['arm', 'claim', 'live', 'lead', 'return'];

export interface Exchange {
  step: BatonStep;
  verb: string;
  status: number;
  /** Bytes sent (the JSON body) and received (the response body). */
  up: number; down: number;
  /** The baton as the server answered. */
  body: unknown;
}

export const STANDIN = 'quest-3s-standin';
const enc = new TextEncoder();

async function call(step: BatonStep, method: 'GET' | 'POST', url: string, body: unknown, headers: Record<string, string>): Promise<Exchange> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(url, { method, cache: 'no-store', headers: { ...(text ? { 'content-type': 'application/json' } : {}), ...headers }, body: text });
  const out = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(out); } catch { parsed = out; }
  return { step, verb: method + ' ' + url, status: res.status, up: text ? enc.encode(text).length : 0, down: enc.encode(out).length, body: parsed };
}

export interface BatonRun {
  /** Fire `step` (and every earlier step not fired yet), once each, in order. */
  upTo(step: BatonStep): void;
  /** Hand back what the stand-in holds, and nothing else (closing early, switching the door): no unplayed write goes out. */
  handBack(): void;
  /** Whether this run has fired anything. */
  started(): boolean;
  /** Start a new run: the next arm re-arms. */
  reset(): void;
  /** Whether the stand-in holds the baton now (claimed, not returned). */
  holds(): boolean;
}

/** A run for place `a` (the table leads to `next`); `onResult` gets each exchange as it completes, `onFail` once if the route is not there. */
export function batonRun(a: CrossPlace, next: NextPlace | null, report: (x: Exchange) => void, onFail: () => void): BatonRun {
  // a reset starts a new generation: a request of an earlier one still in flight reports to nobody
  let token: string | null = null, chain: Promise<unknown> = Promise.resolve(), fired = new Set<BatonStep>(), failed = false, gen = 0;
  const dev = { 'x-bp-device': STANDIN };
  const run = async (s: BatonStep, g: number) => {
    if (failed || g !== gen) return;
    const onResult = (x: Exchange) => { if (g === gen) report(x); };
    if (s === 'arm') {
      if (!token) {
        const r = await fetch('/api/companion/human-token', { cache: 'no-store' });
        if (!r.ok) throw new Error('no token');
        token = ((await r.json()) as { token: string }).token;
      }
      const body = { place: placeWire(a, 'web') }, human = { 'x-bp-human': token };
      let x = await call('arm', 'POST', '/api/session/place', body, human);
      // a baton an earlier run left with the stand-in: hand it back first (only its own device may), then arm
      if (x.status === 409) { await call('return', 'POST', '/api/session/place/return', {}, dev); x = await call('arm', 'POST', '/api/session/place', body, human); }
      if (x.status === 404) throw new Error('no route');
      onResult(x);
    } else if (s === 'claim') onResult(await call('claim', 'GET', '/api/session/place?claim=1', undefined, dev));
    else if (s === 'live') onResult(await call('live', 'POST', '/api/session/place', { place: placeWire(a, 'vr') }, dev));
    else if (s === 'lead') { if (next) onResult(await call('lead', 'POST', '/api/session/place', { place: placeWire(a, 'vr', next.hash, next.level, next.room ? { kind: 'room', id: next.room.id } : a.target) }, dev)); }
    else onResult(await call('return', 'POST', '/api/session/place/return', {}, dev));
  };
  return {
    upTo(step) {
      for (const s of BATON_STEPS) {
        if (!fired.has(s)) { fired.add(s); const g = gen; chain = chain.then(() => run(s, g)).catch(() => { if (!failed && g === gen) { failed = true; onFail(); } }); }
        if (s === step) break;
      }
    },
    handBack() {
      if (!(fired.has('claim') && !fired.has('return'))) return;
      fired.add('return');
      chain = chain.then(() => call('return', 'POST', '/api/session/place/return', {}, dev)).catch(() => null);
    },
    started() { return fired.size > 0; },
    reset() { fired = new Set(); gen++; failed = false; },
    holds() { return fired.has('claim') && !fired.has('return'); },
  };
}
