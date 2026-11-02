// Onboarding in the app (spark project-onboarding), the server side the routes call:
//   checkFolder     POST /api/onboarding/check: is this folder a git work tree, what adopt-bp would produce there
//                   (`adopt.mjs check --json`), the slug and name bp proposes, and whether the root is registered already.
//   latestAdopt     GET /api/products/[slug]/onboarding: the product's latest adopt job (live, or read back from the journal).
//   buildupStream   GET /api/products/[slug]/onboarding/events: the job's build-up events as Server-Sent Events, every
//                   event from `begin` first (the journal: a reload, a second tab or a late subscriber catches up), then
//                   live ones, with a comment ping every 15 s. The stream stays open after `done`/`failed` (pings only), so
//                   an EventSource does not reconnect into a second replay.
// The adopt job itself (enqueueAdopt) is jobs.server.ts's; its feed, prompt and check are onboarding-job.server.ts's.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ScanJob } from '../scan/jobs.ts';
import type { BuildupEvent, OnboardCheck, OnboardCheckItem } from '../scan/onboarding.ts';
import { RESERVED_SLUGS, SLUG_RE } from '../scan/readiness.ts';
import { list } from './jobs.server.ts';
import { adoptSkillDir, closeJournal, NO_ADOPT_SKILL, runAdoptCheck, subscribeBuildup } from './onboarding-job.server.ts';
import { readRegistry } from './products.server.ts';

if (typeof window !== 'undefined') throw new Error('onboarding.server.ts is server-only');

const fwd = (p: string) => p.replace(/\\/g, '/');
const samePath = (a: string, b: string) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

/** The slug bp proposes for a folder name: lower-case kebab, at most 63 characters, `project` when nothing is left. */
export function slugOf(name: string): string {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '');
  return SLUG_RE.test(s) ? s : 'project';
}

/** `base`, else `base-2`, `base-3`, ... : the first one no registered product (and no reserved slug) has. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const free = (s: string) => !taken.has(s) && !RESERVED_SLUGS.includes(s);
  if (free(base)) return base;
  for (let n = 2; ; n++) { const sfx = '-' + n, s = base.slice(0, 63 - sfx.length).replace(/-+$/, '') + sfx; if (free(s)) return s; }
}

const gitWorkTree = (dir: string): Promise<boolean> => new Promise((resolve) => {
  execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, windowsHide: true, timeout: 15_000, encoding: 'utf8' }, (err, out) => resolve(!err && out.trim() === 'true'));
});

export type CheckResult = { ok: true; value: OnboardCheck } | { ok: false; status: 400; error: string };

/** What bp would onboard at `root`. 400 for anything but an existing directory inside a git work tree. */
export async function checkFolder(root: unknown): Promise<CheckResult> {
  if (typeof root !== 'string' || !root.trim()) return { ok: false, status: 400, error: 'root must be a non-empty path' };
  const abs = path.resolve(root.trim());
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { return { ok: false, status: 400, error: `${fwd(abs)} does not exist` }; }
  if (!st.isDirectory()) return { ok: false, status: 400, error: `${fwd(abs)} is not a directory` };
  let real = abs;
  try { real = fs.realpathSync.native(abs); } catch { /* keep it as typed */ }
  if (!(await gitWorkTree(real))) return { ok: false, status: 400, error: `${fwd(real)} is not a git work tree` };
  const { products } = readRegistry();
  const registered = products.find((p) => samePath(p.root, real))?.slug ?? null;
  const name = path.basename(real) || real;
  const slug = registered ?? uniqueSlug(slugOf(name), new Set(products.map((p) => p.slug)));
  const skill = adoptSkillDir();
  let items: OnboardCheckItem[];
  if (!skill) items = [{ id: 'adopt-bp', state: 'missing', detail: NO_ADOPT_SKILL }];
  else {
    const c = await runAdoptCheck(skill, real, process.cwd());
    items = c.error ? [{ id: 'check', state: 'failed', detail: c.error }] : c.items;
  }
  return { ok: true, value: { root: fwd(real), git: true, slug, name, registered, items, need: items.filter((i) => i.state !== 'ok').length } };
}

/** The product's adopt jobs, oldest first. */
const adoptJobs = (slug: string): ScanJob[] => list(slug).filter((j) => j.kind === 'adopt');

/** The latest adopt job of the product, or null. */
export function latestAdopt(slug: string): ScanJob | null {
  return adoptJobs(slug).at(-1) ?? null;
}

const PING_MS = 15_000;
/** The most build-up streams one product may hold open at once (a runaway client answers 429, as the product stream does). */
export const MAX_BUILDUP_STREAMS = 16;
const OPEN = ((globalThis as typeof globalThis & { __bpBuildupStreams?: Map<string, number> }).__bpBuildupStreams ??= new Map<string, number>());

/** The build-up of adopt job `jobId` (default: the latest) as SSE. 404 when the product has no such adopt job. */
export function buildupStream(req: Request, slug: string, root: string, jobId: string | null): Response {
  const jobs = adoptJobs(slug);
  const job = jobId ? jobs.find((j) => j.id === jobId) : jobs.at(-1);
  if (!job) return Response.json({ error: jobId ? `no onboarding job ${jobId} for ${slug}` : `${slug} has no onboarding job` }, { status: 404 });
  const open = OPEN.get(slug) ?? 0;
  if (open >= MAX_BUILDUP_STREAMS) return Response.json({ error: `${open} onboarding streams are already open for ${slug} (at most ${MAX_BUILDUP_STREAMS}); close one first` }, { status: 429 });
  OPEN.set(slug, open + 1);
  // a job that ended out of sight of its feed (a restart) ends its build-up too, before the replay reads it
  if (job.status !== 'queued' && job.status !== 'running') closeJournal(root, job);
  const enc = new TextEncoder();
  let done = false, unsubscribe: (() => void) | null = null, ping: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (done) return;
    done = true;
    OPEN.set(slug, Math.max(0, (OPEN.get(slug) ?? 1) - 1));
    if (ping) clearInterval(ping);
    unsubscribe?.(); unsubscribe = null;
  };
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const write = (s: string) => { if (done) return; try { ctrl.enqueue(enc.encode(s)); } catch { stop(); } };
      unsubscribe = subscribeBuildup(root, job.id, (e: BuildupEvent) => write(`data: ${JSON.stringify(e)}\n\n`));
      ping = setInterval(() => write(': ping\n\n'), PING_MS);
      req.signal.addEventListener('abort', () => { stop(); try { ctrl.close(); } catch { /* already closed */ } });
    },
    cancel() { stop(); },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
