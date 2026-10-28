// The place baton, run for real against this server when the crossing opens: the page arms it (with the human token, as
// bp's own page), then this page stands in for the APK on loopback - it claims it, publishes the table's places and
// returns it - so every exchange the demo replays on its clock has a real status and real byte counts. On the design's
// path the device's calls come from the Quest through the S8 LAN door (:3101, Bearer, scope place); that door is not
// built, so here the device names itself with x-bp-device. Any failure falls back to the simulated wire, and says so.
import type { CrossPlace, NextPlace } from './place';
import { placeWire } from './facts';

export interface Exchange {
  /** Which step of the crossing it is. */
  step: 'arm' | 'claim' | 'live' | 'lead' | 'return';
  verb: string;
  status: number;
  /** Bytes sent (the JSON body) and received (the response body). */
  up: number; down: number;
  /** The baton as the server answered. */
  body: unknown;
}

export const STANDIN = 'quest-3s-standin';
const enc = new TextEncoder();

async function call(step: Exchange['step'], method: 'GET' | 'POST', url: string, body: unknown, headers: Record<string, string>): Promise<Exchange> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(url, { method, cache: 'no-store', headers: { ...(text ? { 'content-type': 'application/json' } : {}), ...headers }, body: text });
  const out = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(out); } catch { parsed = out; }
  return { step, verb: method + ' ' + url, status: res.status, up: text ? enc.encode(text).length : 0, down: enc.encode(out).length, body: parsed };
}

/** Arm, claim, publish (where you were, then where the table leads), return. Null when the server has no baton route. */
export async function runBaton(a: CrossPlace, next: NextPlace | null): Promise<Exchange[] | null> {
  try {
    const tok = await fetch('/api/companion/human-token', { cache: 'no-store' });
    if (!tok.ok) return null;
    const { token } = (await tok.json()) as { token: string };
    const human = { 'x-bp-human': token }, dev = { 'x-bp-device': STANDIN };
    const out: Exchange[] = [];
    let arm = await call('arm', 'POST', '/api/session/place', { place: placeWire(a, 'web') }, human);
    // a baton an earlier crossing left live: hand it back first (only its own device may), then arm
    if (arm.status === 409) { await call('return', 'POST', '/api/session/place/return', {}, dev); arm = await call('arm', 'POST', '/api/session/place', { place: placeWire(a, 'web') }, human); }
    out.push(arm);
    if (arm.status !== 201) return out;
    out.push(await call('claim', 'GET', '/api/session/place?claim=1', undefined, dev));
    out.push(await call('live', 'POST', '/api/session/place', { place: placeWire(a, 'vr') }, dev));
    if (next) out.push(await call('lead', 'POST', '/api/session/place', { place: placeWire(a, 'vr', next.hash, next.level) }, dev));
    out.push(await call('return', 'POST', '/api/session/place/return', {}, dev));
    return out;
  } catch {
    return null;
  }
}
