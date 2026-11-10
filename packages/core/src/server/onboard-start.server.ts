// Onboarding a project from the headset (owner, 2026-11-10: "Pick and start on the headset ... no PC click";
// docs/concepts/vr-light-table/table-link-v2.md section 14). The PC decides what it offers, the headset picks one by an
// opaque id and the PC starts reading it at once: registered under the slug the /projects page would give it, then the
// same adopt job the page queues, with the page's own options (no model, no flags, no path from the device).
//
//   candidates()     GET /api/onboarding/candidates: the git work trees that are direct children of the parent folders of
//                    the products already registered ("the folders next to your projects"), not registered yet, or registered
//                    but never read, at most MAX_CANDIDATES, by name. Each as { id, name, hint, state }: `id` an HMAC of the
//                    folder's real path under a per-process key (never the path; a restart changes it), `name` the folder's
//                    name, `hint` at most HINT_MAX characters a person knows it by (its last commit's subject, else its
//                    remote's repo name), refused when it reads like a path, a drive or this account's user name. Nothing
//                    else about the disk leaves the PC (registry device-pairing, verb-allowlists: "reads are a projection").
//   startOnboarding  POST /api/onboarding/start { candidate, shown }: the id is resolved against the list as the PC would
//                    offer it NOW (re-derived, never trusted from the device: verb-allowlists "writes act only on what the
//                    projection showed"), the folder checked again (checkFolder), registered, the adopt job queued, the start
//                    recorded in the decision log ({ kind: "onboard", surface, device, shown, product, target: slug, job }).
//
// The bounds on a start from a device (each a constant below, each held by scripts/check-onboard-door.ts):
//   DEVICE_IN_FLIGHT        one device-started onboarding queued or running on this PC at a time, from any device (409 with
//                           its slug, so the headset can watch it); a start already under way in this process counts too
//   DEVICE_STARTS_PER_DAY   3 a rolling 24 h per paired device (`<device>:<pairing id>`), counted from the decision log, so a
//                           restart forgets nothing (429 with words, `retryAfterS` and Retry-After)
//   only an offered id      anything else is 404 (an id the PC does not offer, a folder gone, a path in place of an id: 400)
//   the page's options      enqueueAdopt(slug, root, { name }): what /projects sends for a first read
// A start from bp's own page (the human token) is recorded too (surface web) and is not bounded: the page is the person.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import type { ProductEntry } from '../scan/types.ts';
import { readRegistry } from './products.server.ts';
import { readinessOf } from './readiness.server.ts';
import { addProduct } from './registry.server.ts';
import { checkFolder, latestAdopt } from './onboarding.server.ts';
import { enqueueAdopt, list } from './jobs.server.ts';
import { readDecisions, recordDecision, SHOWN_MAX, type Decider } from './decider.server.ts';

if (typeof window !== 'undefined') throw new Error('onboard-start.server.ts is server-only');

// ------------------------------------------------------------------------------------------------ the numbers (a contract)
export const MAX_CANDIDATES = 24;
export const HINT_MAX = 60;
/** At most this many entries of one parent folder are looked at (a parent like a home folder holds thousands). */
export const MAX_CHILDREN_SCANNED = 400;
/** The list is computed at most this often (each candidate costs a `git log`); a start always re-derives it. */
export const CANDIDATES_TTL_MS = 10_000;
export const DEVICE_STARTS_PER_DAY = 3;
export const DEVICE_IN_FLIGHT = 1;
export const DAY_MS = 86_400_000;
/** An id: 24 lower-case hex characters. Anything else (a path, a slug, a name) is refused before it is looked up. */
export const CANDIDATE_ID = /^[0-9a-f]{24}$/;

export type CandidateState = 'new' | 'registered' | 'onboarding';
export interface Candidate { id: string; name: string; hint: string; state: CandidateState }
export interface CandidateList { candidates: Candidate[]; roots: number }
/** What the PC keeps of a candidate: the projection plus where it is and the slug it has, never sent. */
interface Found extends Candidate { real: string; slug: string | null }

const g = globalThis as unknown as { __bpCandidateKey?: Buffer; __bpCandidates?: { at: number; list: Found[]; roots: number }; __bpDeviceStarting?: boolean };
const key = (): Buffer => (g.__bpCandidateKey ??= randomBytes(32));
const fold = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
export const candidateId = (real: string): string => createHmac('sha256', key()).update(fold(real)).digest('hex').slice(0, 24);

const live = (slug: string) => { const j = latestAdopt(slug); return j?.status === 'queued' || j?.status === 'running'; };
const realOf = (p: string): string => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

/** The git work trees directly under the registered products' parent folders, with the slug each is registered under. */
function discover(): { found: Omit<Found, 'hint'>[]; roots: number } {
  const { products } = readRegistry();
  const parents = new Map<string, string>();
  for (const p of products) { const d = path.dirname(realOf(p.root)); parents.set(fold(d), d); }
  const byRoot = new Map<string, ProductEntry>();
  for (const p of products) byRoot.set(fold(realOf(p.root)), p);
  const seen = new Set<string>(), found: Omit<Found, 'hint'>[] = [];
  for (const parent of parents.values()) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(parent, { withFileTypes: true }).slice(0, MAX_CHILDREN_SCANNED); } catch { continue; }
    for (const e of entries) {
      // a directory, not a link (a junction or symlink could lead anywhere), not hidden, with its own .git
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = path.join(parent, e.name);
      if (!fs.existsSync(path.join(dir, '.git'))) continue;
      const k = fold(dir);
      if (seen.has(k)) continue;
      seen.add(k);
      const reg = byRoot.get(k);
      let state: CandidateState = 'new';
      if (reg) {
        if (live(reg.slug)) state = 'onboarding';
        else if (readinessOf(reg).map || latestAdopt(reg.slug)?.status === 'done') continue; // read already: not offered
        else state = 'registered';
      }
      found.push({ id: candidateId(dir), name: e.name, state, real: dir, slug: reg?.slug ?? null });
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name));
  return { found: found.slice(0, MAX_CANDIDATES), roots: parents.size };
}

// ------------------------------------------------------------------------------------------------ the hint
const git = (cwd: string, args: string[]): Promise<string> => new Promise((resolve) => {
  execFile('git', args, { cwd, windowsHide: true, timeout: 5_000, encoding: 'utf8' }, (err, out) => resolve(err ? '' : String(out).trim()));
});
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/gu;
/** Why a hint may not leave the PC, or null: a drive letter, a backslash, an absolute or home path, this account's name. */
export function hintLeaks(s: string): boolean {
  if (/\b[A-Za-z]:[\\/]/.test(s) || s.includes('\\') || /(^|[^\w.-])\/(?:Users|home|mnt|var|tmp|opt|root|private|srv|media)\//i.test(s) || /~[\\/]/.test(s)) return true;
  const names = new Set([os.userInfo().username, process.env.USERNAME, process.env.USER].filter((n): n is string => !!n && n.length >= 3).map((n) => n.toLowerCase()));
  const low = s.toLowerCase();
  return [...names].some((n) => low.includes(n));
}
const clip = (s: string): string => { const t = s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim(); return t.length <= HINT_MAX ? t : t.slice(0, HINT_MAX - 1).trimEnd() + '…'; };
/** A line a person knows the folder by: its last commit's subject, else its remote's repo name, else a plain word. */
async function hintOf(dir: string): Promise<string> {
  const subject = clip(await git(dir, ['log', '-1', '--format=%s']));
  if (subject && !hintLeaks(subject)) return subject;
  const url = await git(dir, ['config', '--get', 'remote.origin.url']);
  const repo = clip((url.split(/[/:]/).pop() ?? '').replace(/\.git$/i, ''));
  if (repo && !hintLeaks(repo)) return repo;
  return subject ? 'a git folder (its last commit names a path)' : 'a git folder with no commits yet';
}

/** GET /api/onboarding/candidates: the PC's offer (cached CANDIDATES_TTL_MS). Never a path. */
export async function candidates(now = Date.now()): Promise<CandidateList> {
  const c = g.__bpCandidates;
  if (c && now - c.at < CANDIDATES_TTL_MS) return { candidates: c.list.map(projection), roots: c.roots };
  const { found, roots } = discover();
  const withHints = await Promise.all(found.map(async (f) => ({ ...f, hint: await hintOf(f.real) })));
  g.__bpCandidates = { at: now, list: withHints, roots };
  return { candidates: withHints.map(projection), roots };
}
const projection = (f: Found): Candidate => ({ id: f.id, name: f.name, hint: f.hint, state: f.state });
/** Drop the cached list (a start changed what is offered). */
export const forgetCandidates = (): void => { g.__bpCandidates = undefined; };

// ------------------------------------------------------------------------------------------------ the start
const json = (body: unknown, status: number, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
const SHOWN_BAD = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u; // decider.server.ts marksOf's rule

/** The device-started onboardings the decision log knows, newest first, with each one's job as this process sees it. */
export function deviceOnboards(limit = 20): { at: string; device: string; slug: string; name: string; shown?: string; job: string; status: string }[] {
  const rows = readDecisions().filter((r) => r.kind === 'onboard' && r.surface === 'vr' && typeof r.job === 'string').reverse().slice(0, limit);
  const names = new Map(readRegistry().products.map((p) => [p.slug, p.name]));
  return rows.map((r) => {
    const j = list(r.target).find((x) => x.id === r.job);
    return { at: r.at, device: r.device ?? '', slug: r.target, name: names.get(r.target) ?? r.target, ...(r.shown ? { shown: r.shown } : {}), job: r.job as string, status: j?.status ?? 'unknown' };
  });
}

/** A device-started onboarding queued or running now (its slug), or null. */
function deviceInFlight(): string | null {
  for (const r of readDecisions()) {
    if (r.kind !== 'onboard' || r.surface !== 'vr' || typeof r.job !== 'string') continue;
    const j = list(r.target).find((x) => x.id === r.job);
    if (j && (j.status === 'queued' || j.status === 'running')) return r.target;
  }
  return null;
}
/** This device's starts in the last 24 h (oldest first). */
function startsToday(device: string, now: number): number[] {
  return readDecisions().filter((r) => r.kind === 'onboard' && r.surface === 'vr' && r.device === device && r.verdict === 'start')
    .map((r) => Date.parse(r.at)).filter((t) => t > now - DAY_MS).sort((a, b) => a - b);
}

/** POST /api/onboarding/start for `who` (the page, or a sealed headset holding onboard). The body is already JSON. */
export async function startOnboarding(who: Decider, body: unknown, now = Date.now()): Promise<Response> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'The request must be { candidate, shown }.' }, 400);
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => k !== 'candidate' && k !== 'shown');
  // the device sends no model, no flags, no path: a key the contract does not name is refused, not ignored
  if (extra.length) return json({ error: `Only a candidate and the words shown may be sent (not ${extra.join(', ')}).` }, 400);
  if (typeof b.candidate !== 'string' || !CANDIDATE_ID.test(b.candidate)) return json({ error: 'Pick a project from the list this PC offers: candidate must be one of its ids.' }, 400);
  const s = b.shown;
  const shownOk = typeof s === 'string' && s.trim().length > 0 && s.length <= SHOWN_MAX && !SHOWN_BAD.test(s);
  if (who.surface === 'vr' && !shownOk) return json({ error: `A start from the table must say what it showed: shown, 1..${SHOWN_MAX} characters.` }, 400);
  if (s !== undefined && !shownOk) return json({ error: `shown must be 1..${SHOWN_MAX} characters` }, 400);

  // the offer as it is NOW (never the cached list: a folder may have gone or been read since)
  const hit = discover().found.find((f) => f.id === b.candidate);
  if (!hit) return json({ error: 'This PC does not offer that project (any more). Read the list again.' }, 404);
  if (hit.slug && live(hit.slug)) return json({ error: `${hit.name} is already being read: watch it.`, slug: hit.slug }, 409);

  if (who.surface === 'vr') {
    if (g.__bpDeviceStarting) return json({ error: 'Another project is being started from a headset right now: wait for it.' }, 409);
    const busy = deviceInFlight();
    if (busy) return json({ error: `A project started from a headset is still being read (${busy}): one at a time. Watch it, or stop it on the PC.`, slug: busy }, 409);
    const today = startsToday(who.device ?? '', now);
    if (today.length >= DEVICE_STARTS_PER_DAY) {
      const retryAfterS = Math.max(1, Math.ceil((today[0] + DAY_MS - now) / 1000));
      return json({ error: `This headset started ${today.length} project reads in the last 24 hours: the next one can start in ${Math.ceil(retryAfterS / 3600)} h, or start it on the PC.`, limit: `${DEVICE_STARTS_PER_DAY} a day per paired headset, one at a time per PC`, retryAfterS }, 429, { 'retry-after': String(retryAfterS) });
    }
    g.__bpDeviceStarting = true;
  }
  try {
    // the existing check: still a directory inside a git work tree; the slug /projects would propose (or the one it has)
    const c = await checkFolder(hit.real);
    if (!c.ok) return json({ error: 'That folder is gone or is no longer a git folder. Read the list again.' }, 404);
    let slug = c.value.registered, name = hit.name;
    if (slug) name = readRegistry().products.find((p) => p.slug === slug)?.name ?? name;
    else {
      const r = addProduct({ slug: c.value.slug, name: hit.name, root: hit.real });
      if (!r.ok) return json({ error: `This PC could not register ${hit.name}: ${r.error}` }, r.status === 409 ? 409 : 500);
      slug = r.value.slug;
    }
    // the page's own options for a first read: no model, no resume, nothing from the device
    const q = enqueueAdopt(slug, hit.real, { name });
    if (!q.ok) return json({ error: q.status === 409 ? `${name} is already being read: watch it.` : `This PC could not start reading ${name}: ${q.error}`, ...(q.status === 409 ? { slug } : {}), ...(q.status === 429 ? { retryAfterS: 60 } : {}) }, q.status, q.status === 429 ? { 'retry-after': '60' } : {});
    recordDecision({ kind: 'onboard', surface: who.surface, ...(who.device ? { device: who.device } : {}), ...(shownOk ? { shown: s as string } : {}), product: slug, target: slug, verdict: 'start', job: q.job.id });
    forgetCandidates();
    console.log(`onboarding: ${who.surface === 'vr' ? `headset ${who.device}` : "bp's page"} started reading ${slug} (job ${q.job.id})`);
    return json({ slug, name, job: q.job.id }, 202);
  } finally {
    if (who.surface === 'vr') g.__bpDeviceStarting = false;
  }
}
