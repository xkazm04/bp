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
import { readDecisions, recordDecision, SHOWN_MAX, type Decider, type DecisionRecord } from './decider.server.ts';

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
/** `held`: git folders next to the products that are NOT offered to a headset (heldWhy): start those on the PC. */
export interface CandidateList { candidates: Candidate[]; roots: number; held: number }
/** What the PC keeps of a candidate: the projection plus where it is and the slug it has, never sent. */
interface Found extends Candidate { real: string; slug: string | null }

/** The files by which a folder carries its own agent configuration (S4, 2026-11-10): a headset never starts a run in such a
 *  folder. The adopt job no longer loads them (jobs.server.ts ADOPT_ARGS), but a folder that ships hooks or MCP servers is
 *  one somebody prepared for an agent, and only the owner at the PC should decide to run one there. */
export const AGENT_CONFIG = ['.mcp.json', '.claude/settings.json', '.claude/settings.local.json', '.claude/hooks'] as const;
/** A folder name the adopt prompt may carry as it is: letters, digits, space, dot, underscore, hyphen. */
export const SAFE_NAME = /^[A-Za-z0-9 ._-]{1,100}$/;
/** Why the PC holds a folder back from a headset, or null: its own agent configuration, or a name that needed replacing. */
export function heldWhy(dir: string, name: string): 'agent-config' | 'name' | null {
  if (AGENT_CONFIG.some((f) => fs.existsSync(path.join(dir, f)))) return 'agent-config';
  return SAFE_NAME.test(name) ? null : 'name';
}

const g = globalThis as unknown as { __bpCandidateKey?: Buffer; __bpCandidates?: { at: number; list: Found[]; roots: number; held: number }; __bpDeviceStarting?: boolean };
const key = (): Buffer => (g.__bpCandidateKey ??= randomBytes(32));
const fold = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
export const candidateId = (real: string): string => createHmac('sha256', key()).update(fold(real)).digest('hex').slice(0, 24);

const live = (slug: string) => { const j = latestAdopt(slug); return j?.status === 'queued' || j?.status === 'running'; };
const realOf = (p: string): string => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

/** The git work trees directly under the registered products' parent folders, with the slug each is registered under. */
function discover(): { found: Omit<Found, 'hint'>[]; held: Set<string>; roots: number } {
  const { products } = readRegistry();
  const parents = new Map<string, string>();
  for (const p of products) { const d = path.dirname(realOf(p.root)); parents.set(fold(d), d); }
  const byRoot = new Map<string, ProductEntry>();
  for (const p of products) byRoot.set(fold(realOf(p.root)), p);
  const seen = new Set<string>(), found: Omit<Found, 'hint'>[] = [], held = new Set<string>();
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
      // its own agent configuration, or a name the prompt could not carry as it is: counted, never offered (S4)
      if (heldWhy(dir, e.name)) { held.add(candidateId(dir)); continue; }
      found.push({ id: candidateId(dir), name: e.name, state, real: dir, slug: reg?.slug ?? null });
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name));
  return { found: found.slice(0, MAX_CANDIDATES), held, roots: parents.size };
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
  if (c && now - c.at < CANDIDATES_TTL_MS) return { candidates: c.list.map(projection), roots: c.roots, held: c.held };
  const { found, held, roots } = discover();
  const withHints = await Promise.all(found.map(async (f) => ({ ...f, hint: await hintOf(f.real) })));
  g.__bpCandidates = { at: now, list: withHints, roots, held: held.size };
  return { candidates: withHints.map(projection), roots, held: held.size };
}
const projection = (f: Found): Candidate => ({ id: f.id, name: f.name, hint: f.hint, state: f.state });
/** Drop the cached list (a start changed what is offered). */
export const forgetCandidates = (): void => { g.__bpCandidates = undefined; };

// ------------------------------------------------------------------------------------------------ the start
const json = (body: unknown, status: number, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
const SHOWN_BAD = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u; // decider.server.ts marksOf's rule

/** A decision row of a read a headset caused: started by it before the PC confirm (surface vr, verdict start), or confirmed
 *  at the PC on its ask (verdict confirm, with the asking device). The page's own starts (no device) are not among them. */
const headsetRead = (r: DecisionRecord): boolean =>
  r.kind === 'onboard' && typeof r.job === 'string' && !!r.device && ((r.surface === 'vr' && r.verdict === 'start') || r.verdict === 'confirm');

/** The headset-asked onboardings the decision log knows, newest first, with each one's job as this process sees it. */
export function deviceOnboards(limit = 20): { at: string; device: string; slug: string; name: string; shown?: string; job: string; status: string }[] {
  const rows = readDecisions().filter(headsetRead).reverse().slice(0, limit);
  const names = new Map(readRegistry().products.map((p) => [p.slug, p.name]));
  return rows.map((r) => {
    const j = list(r.target).find((x) => x.id === r.job);
    return { at: r.at, device: r.device ?? '', slug: r.target, name: names.get(r.target) ?? r.target, ...(r.shown ? { shown: r.shown } : {}), job: r.job as string, status: j?.status ?? 'unknown' };
  });
}

/** A headset-asked onboarding queued or running now (its slug), or null. */
function deviceInFlight(): string | null {
  for (const r of readDecisions()) {
    if (!headsetRead(r)) continue;
    const j = list(r.target).find((x) => x.id === r.job);
    if (j && (j.status === 'queued' || j.status === 'running')) return r.target;
  }
  return null;
}
/** This device's confirmed (or, before the PC confirm, started) reads in the last 24 h (oldest first). */
function startsToday(device: string, now: number): number[] {
  return readDecisions().filter((r) => headsetRead(r) && r.device === device)
    .map((r) => Date.parse(r.at)).filter((t) => t > now - DAY_MS).sort((a, b) => a - b);
}

type Hit = Pick<Found, 'name' | 'real'>;
type Outcome = { ok: true; slug: string; name: string; job: string } | { ok: false; status: number; error: string; extra?: Record<string, unknown>; headers?: Record<string, string> };

/** The start itself: the folder check (and that it still resolves to the offered path), the register under the slug /projects
 *  would give it, the adopt job with the page's options, the decision row. `deviceWords`: errors in fixed words (no path). */
async function runStart(hit: Hit, row: Omit<DecisionRecord, 'at' | 'product' | 'target' | 'job'>, deviceWords: boolean): Promise<Outcome> {
  // the existing check: still a directory inside a git work tree; the slug /projects would propose (or the one it has)
  const c = await checkFolder(hit.real);
  if (!c.ok) {
    console.log(`onboarding: the folder check of ${hit.name} failed: ${c.error}`); // the path stays in the server's log
    return { ok: false, status: 404, error: 'That folder is gone or is no longer a git folder. Read the list again.' };
  }
  // the check can take up to a minute: the folder it resolved must still be the one offered (a junction swapped in
  // meanwhile would send the run elsewhere), and the offered path is the one used from here on (S4)
  let link = true;
  try { link = fs.lstatSync(hit.real).isSymbolicLink(); } catch { /* gone: refused below */ }
  if (link || fold(c.value.root) !== fold(hit.real) || fold(realOf(hit.real)) !== fold(hit.real)) {
    console.log(`onboarding: ${hit.name} resolved somewhere else during its check; not started`);
    return { ok: false, status: 409, error: 'That folder changed while this PC was checking it. Read the list again.' };
  }
  let slug = c.value.registered, name = hit.name;
  if (slug) name = readRegistry().products.find((p) => p.slug === slug)?.name ?? name;
  else {
    const r = addProduct({ slug: c.value.slug, name: hit.name, root: hit.real });
    if (!r.ok) {
      // the registry's words can name the folder's path (registry.server.ts checkRoot): to a headset, fixed words (S4)
      console.log(`onboarding: could not register ${hit.name}: ${r.error}`);
      return { ok: false, status: r.status === 409 ? 409 : 500, error: `This PC could not register ${hit.name}: ${deviceWords ? 'the folder is gone, or the registry could not take it' : r.error}` };
    }
    slug = r.value.slug;
  }
  // the page's own options for a first read: no model, no resume, nothing from the device
  const q = enqueueAdopt(slug, hit.real, { name });
  if (!q.ok) return { ok: false, status: q.status, error: q.status === 409 ? `${name} is already being read: watch it.` : `This PC could not start reading ${name}: ${q.error}`, extra: { ...(q.status === 409 ? { slug } : {}), ...(q.status === 429 ? { retryAfterS: 60 } : {}) }, ...(q.status === 429 ? { headers: { 'retry-after': '60' } } : {}) };
  recordDecision({ ...row, product: slug, target: slug, job: q.job.id });
  forgetCandidates();
  console.log(`onboarding: ${row.device ? `headset ${row.device}'s ask, confirmed at the PC,` : "bp's page"} started reading ${slug} (job ${q.job.id})`);
  return { ok: true, slug, name, job: q.job.id };
}

// ------------------------------------------------------------------------------------------------ the ask (owner, 2026-11-10)
// "Add the PC confirm: the headset picks the folder; a confirm appears on the Headsets page naming the folder, and the run
// starts only after your click there." A headset's start is an ASK; the page's CONFIRM runs the start (confirmAsk). Asks live
// in this process's memory (a restart forgets a waiting ask: the headset reads 404 and asks again); the rows are on disk.
export const ASK_TTL_MS = 10 * 60_000;
export const ASKS_PER_HOUR = 6;
const HOUR_MS = 3_600_000;
export type AskState = 'waiting' | 'confirmed' | 'declined' | 'expired';
interface Ask { id: string; device: string; candidate: string; name: string; hint: string; shown: string; askedAt: number; expiresAt: number; state: AskState; slug?: string; job?: string; reason?: string }
const asks = (): Map<string, Ask> => ((g as { __bpAsks?: Map<string, Ask> }).__bpAsks ??= new Map());
/** An ask's id: 24 lower-case hex, random (it names nothing on disk). */
export const ASK_ID = /^[0-9a-f]{24}$/;

/** Waiting asks past their 10 minutes become expired; asks older than a day are forgotten. */
function sweep(now: number): void {
  for (const [id, a] of asks()) {
    if (a.state === 'waiting' && now >= a.expiresAt) a.state = 'expired';
    if (a.state !== 'waiting' && now - a.askedAt > DAY_MS) asks().delete(id);
  }
}
/** What the asking headset reads: `{ request, name, state, slug?, job?, reason? }`. */
const askView = (a: Ask) => ({ request: a.id, name: a.name, state: a.state, ...(a.slug ? { slug: a.slug } : {}), ...(a.job ? { job: a.job } : {}), ...(a.reason ? { reason: a.reason } : {}) });

/** GET /api/onboarding/requests/<id> for `device`: its own ask, or null (another pairing's, or none: the route's 404). */
export function askOf(id: string, device: string, now = Date.now()): ReturnType<typeof askView> | null {
  sweep(now);
  const a = ASK_ID.test(id) ? asks().get(id) : undefined;
  return a && a.device === device ? askView(a) : null;
}
/** The Headsets page's open asks, oldest first: the folder's name and hint as the PC knows them, and what the headset said
 *  it showed (so a mismatch is visible). */
export function openAsks(now = Date.now()): { id: string; device: string; name: string; hint: string; shown: string; askedAt: string; expiresAt: string }[] {
  sweep(now);
  return [...asks().values()].filter((a) => a.state === 'waiting').sort((x, y) => x.askedAt - y.askedAt)
    .map((a) => ({ id: a.id, device: a.device, name: a.name, hint: a.hint, shown: a.shown, askedAt: new Date(a.askedAt).toISOString(), expiresAt: new Date(a.expiresAt).toISOString() }));
}

function declineRow(a: Ask, reason: string): void {
  a.state = 'declined';
  a.reason = reason;
  recordDecision({ kind: 'onboard', surface: 'web', device: a.device, shown: a.shown, target: a.name, verdict: 'decline', reason, request: a.id });
}

/** POST /api/companion/headsets/ask/confirm (the page's gate is headsets.ts's): re-resolve, re-check the bounds, start. A
 *  failure declines the ask with the sentence as its reason. `{ status, body }` for the route. */
export async function confirmAsk(id: string, now = Date.now()): Promise<{ status: number; body: Record<string, unknown> }> {
  sweep(now);
  const a = ASK_ID.test(id) ? asks().get(id) : undefined;
  if (!a) return { status: 404, body: { error: 'That ask is no longer known to this server.' } };
  if (a.state !== 'waiting') return { status: 409, body: { error: `That ask is ${a.state} already.`, state: a.state } };
  if (g.__bpDeviceStarting) return { status: 409, body: { error: 'Another headset ask is being started right now: try again in a moment.' } };
  const fail = (reason: string, status = 409) => { declineRow(a, reason); return { status, body: { error: reason, state: 'declined' } }; };
  const busy = deviceInFlight();
  if (busy) return fail(`A project a headset asked for is still being read (${busy}): one at a time. Stop it first, or wait.`);
  const today = startsToday(a.device, now);
  if (today.length >= DEVICE_STARTS_PER_DAY) return fail(`This headset already had ${today.length} project reads confirmed in the last 24 hours (at most ${DEVICE_STARTS_PER_DAY}): start this one from Projects instead.`, 429);
  const offer = discover();
  if (offer.held.has(a.candidate)) return fail(`${a.name} now carries its own agent settings: start it from Projects if you mean to.`, 403);
  const hit = offer.found.find((f) => f.id === a.candidate);
  if (!hit) return fail(`This PC no longer offers ${a.name} (gone, moved, or read already).`, 404);
  if (hit.slug && live(hit.slug)) return fail(`${hit.name} is already being read.`);
  g.__bpDeviceStarting = true;
  try {
    const r = await runStart(hit, { kind: 'onboard', surface: 'web', device: a.device, shown: a.shown, verdict: 'confirm', request: a.id }, true);
    if (!r.ok) return fail(r.error, r.status);
    a.state = 'confirmed';
    a.slug = r.slug;
    a.job = r.job;
    return { status: 200, body: { ok: true, request: a.id, state: 'confirmed', slug: r.slug, name: r.name, job: r.job } };
  } finally { g.__bpDeviceStarting = false; }
}
/** POST /api/companion/headsets/ask/decline: the owner said no. */
export function declineAsk(id: string, now = Date.now()): { status: number; body: Record<string, unknown> } {
  sweep(now);
  const a = ASK_ID.test(id) ? asks().get(id) : undefined;
  if (!a) return { status: 404, body: { error: 'That ask is no longer known to this server.' } };
  if (a.state !== 'waiting') return { status: 409, body: { error: `That ask is ${a.state} already.`, state: a.state } };
  declineRow(a, 'declined at the PC');
  return { status: 200, body: { ok: true, request: a.id, state: 'declined' } };
}

/** POST /api/onboarding/start for `who` (the page, or a sealed headset holding onboard). The body is already JSON. From the
 *  page the read starts at once (202 `{ slug, name, job }`); from a headset it is an ask the owner confirms on the Headsets
 *  page (202 `{ request, name, state: "waiting" }`). */
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
  const offer = discover();
  // a folder with its own agent configuration (or a name the prompt cannot carry) is never started from here, even by an
  // id a client kept from before the folder changed (S4)
  if (offer.held.has(b.candidate)) return json({ error: 'This folder carries its own agent settings (or a name bp will not pass on): start it on your PC, from the Projects page.' }, 403);
  const hit = offer.found.find((f) => f.id === b.candidate);
  if (!hit) return json({ error: 'This PC does not offer that project (any more). Read the list again.' }, 404);
  if (hit.slug && live(hit.slug)) return json({ error: `${hit.name} is already being read: watch it.`, slug: hit.slug }, 409);

  if (who.surface !== 'vr') {
    const r = await runStart(hit, { kind: 'onboard', surface: who.surface, ...(shownOk ? { shown: s as string } : {}), verdict: 'start' }, false);
    return r.ok ? json({ slug: r.slug, name: r.name, job: r.job }, 202) : json({ error: r.error, ...(r.extra ?? {}) }, r.status, r.headers);
  }

  // a headset: an ask, at most ASKS_PER_HOUR a rolling hour per pairing (counted from the decision log: a restart forgets nothing)
  const device = who.device ?? '';
  const lastHour = readDecisions().filter((r) => r.kind === 'onboard-ask' && r.device === device).map((r) => Date.parse(r.at)).filter((t) => t > now - HOUR_MS).sort((x, y) => x - y);
  if (lastHour.length >= ASKS_PER_HOUR) {
    const retryAfterS = Math.max(1, Math.ceil((lastHour[0] + HOUR_MS - now) / 1000));
    return json({ error: `This headset asked to read ${lastHour.length} projects in the last hour: ask again in ${Math.ceil(retryAfterS / 60)} min, or start it on the PC.`, limit: `${ASKS_PER_HOUR} asks an hour per paired headset`, retryAfterS }, 429, { 'retry-after': String(retryAfterS) });
  }
  sweep(now);
  // one open ask per pairing: a new one replaces the waiting one
  for (const a of asks().values()) if (a.device === device && a.state === 'waiting') declineRow(a, 'replaced by a newer ask from this headset');
  const a: Ask = { id: randomBytes(12).toString('hex'), device, candidate: hit.id, name: hit.name, hint: await hintOf(hit.real), shown: s as string, askedAt: now, expiresAt: now + ASK_TTL_MS, state: 'waiting' };
  asks().set(a.id, a);
  recordDecision({ kind: 'onboard-ask', surface: 'vr', device, shown: a.shown, target: a.name, verdict: 'ask', request: a.id });
  console.log(`onboarding: headset ${device} asks to read ${a.name}: waiting for a confirm on bp's Headsets page`);
  return json({ request: a.id, name: a.name, state: 'waiting' }, 202);
}

