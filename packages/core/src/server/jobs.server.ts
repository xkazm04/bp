// The live scan-job registry: lens scans, execute runs and release runs the blueprint starts by running the Claude Code
// CLI headless in the product repo (`claude -p --dangerously-skip-permissions`, the operator's choice: a
// headless run cannot answer permission prompts). Per product: the latest 50 jobs, a FIFO queue, at most
// 3 running. The prompt goes to the CLI on stdin, never on the command line; every id in it was held to
// SAFE_ID here and to the map or store by the route. Each job logs to
// `<root>/.ai/lens-scan/work/bp-jobs/<job>.log` and keeps its last lines as `log_tail`. The registry lives on
// globalThis so a dev-server module reload keeps the running children. Server-only: route handlers import it.
// An execute job a wave package queues (waves.server.ts) also runs with `--model <m> --effort <e>`: only values of the
// WAVE_MODELS / WAVE_EFFORTS allow-lists reach the command line, and the job carries them with its wave and package.
// A release job (`/lens-scan release --id <rel> [--finish]`) ends `done` by the release's status in the store, not by
// a run alone: a cut must leave it pr-open (or later), a finish tagged; its run_id is the release-head measure run
// the cut starts (note `bp-job:<id> · release <rel> at <sha>`), when it got that far.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_PROPOSALS, MAX_QUEUED, MAX_RUNNING, MAX_SELECTION, RUN_NOTE_PREFIX, SAFE_ID, type ReleaseStep, type ScanJob, type ScanScope } from '../scan/jobs.ts';
import { RELEASE_ID } from '../scan/release.ts';
import { ABANDONED_FROM, ABANDONED_TO, reached } from '../scan/release-steps.ts';
import { busyIds } from '../scan/admit.ts';
import { WAVE_EFFORTS, WAVE_MODELS, type WaveEffort, type WaveModel } from '../scan/waves.ts';
import { OVERLAY_PATH, PREPARABLE, lensSetupNeed } from '../scan/lens-setup.ts';
import { findProduct, recovered, warnOnce, writeAtomic } from './products.server.ts';
import { close, openRead, readRelease, type ReleaseRead } from './store.server.ts';
import { storeCall } from './release.server.ts';

if (typeof window !== 'undefined') throw new Error('jobs.server.ts is server-only');

export { MAX_PROPOSALS, MAX_QUEUED, MAX_RUNNING }; // defined in jobs.ts, where the client's steer plan reads them too
export const KEEP_JOBS = 50;
export const CLI_MISSING = 'Claude Code CLI not found (set BP_CLAUDE_BIN)';
const TAIL_LINES = 20, TAIL_BYTES = 2048, NOTIFY_MS = 400;
/** The flags of a job run (a wave package adds `--model` and `--effort`); the prompt follows on stdin. */
const JOB_ARGS = ['-p', '--dangerously-skip-permissions', '--output-format', 'text'];

// ------------------------------------------------------------------------------------- the CLI
interface Cli { file: string; args: string[]; verbatim: boolean }
/** Only these characters may reach cmd.exe (a .cmd-only install): flags, constants and validated ids. */
const CMD_SAFE = /^[A-Za-z0-9._:\/-]+$/;

/** A Windows command on PATH: `name.exe`/`.com` run directly, `name.cmd`/`.bat` only through cmd.exe. */
function winLookup(bin: string): string | null {
  const exts = path.extname(bin) ? [''] : ['.exe', '.com', '.cmd', '.bat'];
  const dirs = /[\\/]/.test(bin) ? [''] : (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) for (const e of exts) {
    const f = d ? path.join(d, bin + e) : path.resolve(bin + e);
    try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ }
  }
  return null;
}

/** How to start the CLI with `args`: null = not installed. A string = refused (unsafe for cmd.exe). */
function resolveCli(args: string[]): Cli | string | null {
  const bin = process.env.BP_CLAUDE_BIN || 'claude';
  if (/\.(mjs|cjs|js)$/i.test(bin)) return fs.existsSync(bin) ? { file: process.execPath, args: [bin, ...args], verbatim: false } : null;
  if (process.platform !== 'win32') return { file: bin, args, verbatim: false };
  const f = winLookup(bin);
  if (!f) return null;
  if (!/\.(cmd|bat)$/i.test(f)) return { file: f, args, verbatim: false };
  // A batch shim cannot be spawned without a shell (Node refuses since the 2024 fix). cmd.exe re-parses its
  // command line, so it holds only the shim's path (operator-set: PATH or BP_CLAUDE_BIN) and characters
  // with no meaning to cmd; the prompt stays on stdin.
  if (/["%^!]/.test(f) || args.some((a) => !CMD_SAFE.test(a))) return `refusing to pass these arguments through cmd.exe (${path.basename(f)})`;
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `""${f}" ${args.join(' ')}"`], verbatim: true };
}

export type SpawnResult = { ok: true; child: ChildProcess } | { ok: false; error: string; missing: boolean };

/** Start the Claude Code CLI (BP_CLAUDE_BIN, else `claude` on PATH; a .js/.mjs path runs on this Node). */
export function spawnCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): SpawnResult {
  const cli = resolveCli(args);
  if (cli === null) return { ok: false, error: CLI_MISSING, missing: true };
  if (typeof cli === 'string') return { ok: false, error: cli, missing: false };
  try {
    const child = spawn(cli.file, cli.args, {
      cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: cli.verbatim, detached: process.platform !== 'win32', // its own group, so the tree can be killed
    });
    child.stdin?.on('error', () => { /* the CLI exited before reading its prompt: its exit says why */ });
    return { ok: true, child };
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
    return { ok: false, error: missing ? CLI_MISSING : (e as Error).message, missing };
  }
}

/** Kill a CLI and everything it started (the CLI runs tools as children). */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  killPid(child.pid, () => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
}

/** The same by pid alone: a job adopted after a restart has no ChildProcess, only the pid its journal line recorded. */
function killPid(pid: number, fallback: () => void = () => { /* gone */ }): void {
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', fallback); } catch { fallback(); }
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { fallback(); }
}

const pidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

// ------------------------------------------------------------------------------------ the skill
// Every job prompt is a `/lens-scan ...` slash command, which the CLI runs only when it can see the skill from the product
// repo. Without it the CLI answers in prose, exits 0 and writes no run: found 2026-10-25, a Grinex performance scan "failed"
// after 13 s with the CLI's closing question as its error (an execute run on 2026-10-19 the same way). So a job checks first.
export const NO_JOB_SKILL = 'the lens-scan skill is not visible from this product repo, so Claude Code cannot run /lens-scan there';

const samePath = (a: string, b: string) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

/** Where the CLI started in `root` finds a `lens-scan` skill: `.claude/skills/lens-scan` in the root or an ancestor, the user's
 *  `<configDir>/skills/lens-scan`, or the `skills/lens-scan` of an installed plugin (user scope, or project scope for the root or
 *  an ancestor). A candidate counts only with a SKILL.md through realpath, so a link to a deleted worktree is missing. null = none. */
export function jobSkillIn(root: string, configDir: string): string | null {
  const has = (dir: string): string | null => { try { const r = fs.realpathSync(dir); return fs.existsSync(path.join(r, 'SKILL.md')) ? r : null; } catch { return null; } };
  const ups: string[] = [];
  for (let d = path.resolve(root); ; d = path.dirname(d)) { ups.push(d); if (path.dirname(d) === d) break; }
  for (const d of ups) { const f = has(path.join(d, '.claude', 'skills', 'lens-scan')); if (f) return f; }
  const user = has(path.join(configDir, 'skills', 'lens-scan'));
  if (user) return user;
  let reg: { plugins?: Record<string, { scope?: string; projectPath?: string; installPath?: string }[]> };
  try { reg = JSON.parse(fs.readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8')); } catch { return null; }
  for (const xs of Object.values(reg?.plugins ?? {})) for (const x of Array.isArray(xs) ? xs : []) {
    const mine = x?.scope === 'user' || (typeof x?.projectPath === 'string' && ups.some((d) => samePath(d, x.projectPath!)));
    const f = mine && typeof x.installPath === 'string' ? has(path.join(x.installPath, 'skills', 'lens-scan')) : null;
    if (f) return f;
  }
  return null;
}

/** Why a job in `root` cannot run its slash command, or null. A .js/.mjs BP_CLAUDE_BIN is a stand-in that loads no skills, and a
 *  CLI that cannot be started is spawnCli's to report (CLI_MISSING says more than a missing skill). */
function skillMissing(root: string): string | null {
  if (/\.(mjs|cjs|js)$/i.test(process.env.BP_CLAUDE_BIN ?? '')) return null;
  const cli = resolveCli([]);
  if (cli === null || typeof cli === 'string') return null;
  if (jobSkillIn(root, process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'))) return null;
  return `${NO_JOB_SKILL}: link the ai-registry skill to ${path.join(root, '.claude', 'skills', 'lens-scan')} (or ~/.claude/skills/lens-scan)`;
}

// ------------------------------------------------------------------------------------ registry
type Listener = (jobs: ScanJob[]) => void;
interface Rec {
  job: ScanJob; root: string; prompt: string; phase: Phase;
  child?: ChildProcess;
  /** The CLI's pid once it started (journalled), and whether this record was adopted after a restart (no child, only the pid). */
  pid?: number; orphan?: boolean; watch?: ReturnType<typeof setInterval>;
  buf: string; lastErr: string; log?: fs.WriteStream;
}
interface Product { recs: Rec[]; subs: Set<Listener>; timer?: ReturnType<typeof setTimeout> }

// ------------------------------------------------------------------------------------ phases
/**
 * Where a job is in its life, which the wire status alone cannot say: a cancel is a REQUEST. The job reads `cancelled` from the
 * cancel call on (the UI is unchanged), but it stays `cancelling` - holding its slot, its release busy, its pid supervised and
 * journalled - until its process has gone; only then is it `ended` (and a release row it left building failed). Every move
 * goes through one table, and an event the table lacks (a cancel of an ended job, a second exit) changes nothing and journals
 * nothing. start: its CLI is spawned. cancel: the operator asked. exit: its process ended, or a job that never ran was ended.
 */
export type Phase = 'queued' | 'running' | 'cancelling' | 'ended';
export type PhaseEvent = 'start' | 'cancel' | 'exit';
const PHASES: Record<Phase, Partial<Record<PhaseEvent, Phase>>> = {
  queued: { start: 'running', cancel: 'ended', exit: 'ended' },
  running: { cancel: 'cancelling', exit: 'ended' },
  cancelling: { exit: 'ended' },
  ended: {},
};
const isPhase = (p: unknown): p is Phase => typeof p === 'string' && Object.hasOwn(PHASES, p);
/** The phase `e` moves `p` to; null = the table has no such move. */
export const nextPhase = (p: Phase, e: PhaseEvent): Phase | null => (isPhase(p) ? PHASES[p][e] : undefined) ?? null;
/** Move `r` by `e`; false, and nothing changed, when the table refuses it. */
function step(r: Rec, e: PhaseEvent): boolean { const n = nextPhase(r.phase, e); if (n) r.phase = n; return n !== null; }
/** A job whose process may still be there holds one of the MAX_RUNNING slots. */
const holdsSlot = (r: Rec): boolean => r.phase === 'running' || r.phase === 'cancelling';

const G = globalThis as typeof globalThis & { __bpScanJobs?: Map<string, Product>; __bpScanJobsLoaded?: Set<string> };
const registry: Map<string, Product> = (G.__bpScanJobs ??= new Map<string, Product>());
// A module reload may hand this module records the booleans-era runner made (live / ended, no phase): read them once.
for (const p of registry.values()) for (const r of p.recs as (Rec & { live?: boolean; ended?: boolean })[]) {
  r.phase ??= r.live ? (r.job.status === 'cancelled' ? 'cancelling' : 'running') : r.ended ? 'ended' : 'queued';
}
/** `slug + root` pairs whose journal this process has already read (on globalThis too: a module reload must not adopt twice). */
const loaded: Set<string> = (G.__bpScanJobsLoaded ??= new Set<string>());
const prod = (slug: string): Product => {
  let p = registry.get(slug);
  if (!p) registry.set(slug, (p = { recs: [], subs: new Set() }));
  return p;
};
const copy = (r: Rec): ScanJob => ({ ...r.job });
const now = () => new Date().toISOString();
const jobId = () => 'j-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');

/** The product's jobs, oldest first (queued and running ones always kept, finished ones down to the latest 50). */
export function list(slug: string): ScanJob[] { ensure(slug); return (registry.get(slug)?.recs ?? []).map(copy); }

/** Called with the whole list after each change (log lines coalesced to one call per 400 ms). Returns the unsubscribe. */
export function subscribe(slug: string, fn: Listener): () => void {
  const p = prod(slug);
  p.subs.add(fn);
  return () => { p.subs.delete(fn); };
}

// ------------------------------------------------------------------------------------ the journal
// The registry is memory, and a process exit used to take it: the detached CLI child kept running with nothing that knew
// of it. Every state change of a job appends one line to `<root>/.ai/lens-scan/work/bp-jobs/journal.jsonl` (the job without
// its log tail, and the CLI's pid once it started); the first time a product's root is known after a start, `reconcileJobs`
// reads it back. globalThis still keeps the registry across a module reload; the journal is the next layer, for a process exit.
const JOURNAL_KEEP = 200, ORPHAN_MAX_MS = 12 * 3600_000, ORPHAN_POLL_MS = 2000;
export const journalFile = (root: string): string => path.join(root, '.ai', 'lens-scan', 'work', 'bp-jobs', 'journal.jsonl');
interface JournalLine { at: string; slug: string; pid?: number; phase?: Phase; job: ScanJob }

/** A line's phase. A line written before phases has none: its status says, and `cancelled` with a pid and no exit code was a
 *  cancel whose process had not been reaped yet (a cancel journals at request time; the reaping line carries the exit). */
function phaseOf(l: JournalLine): Phase {
  if (isPhase(l.phase)) return l.phase;
  const st = l.job.status;
  if (st === 'queued' || st === 'running') return st;
  return st === 'cancelled' && l.pid !== undefined && l.job.exit_code === undefined ? 'cancelling' : 'ended';
}

function journal(slug: string, r: Rec): void {
  const file = journalFile(r.root);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { log_tail: _tail, ...job } = r.job;
    const line: JournalLine = { at: now(), slug, ...(r.pid !== undefined ? { pid: r.pid } : {}), phase: r.phase, job };
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
    recovered('job journal ' + file);
  } catch (e) { warnOnce('job journal ' + file, e); } // the job still runs; a restart will not find it
}

function readJournal(root: string): JournalLine[] {
  let text: string;
  try { text = fs.readFileSync(journalFile(root), 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnOnce('job journal ' + journalFile(root), e);
    return [];
  }
  const out: JournalLine[] = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try {
      const x = JSON.parse(l) as JournalLine;
      if (typeof x?.slug === 'string' && typeof x.job?.id === 'string' && SAFE_ID.test(x.job.id) && typeof x.job.queued_at === 'string') out.push(x);
    } catch { /* a torn last line */ }
  }
  return out;
}

/** Read the jobs of `root` back after a restart, once per process. A job the journal last saw queued never ran: failed. One it
 *  saw running whose process is gone is failed, naming the restart; one whose process is still there is adopted as running (it
 *  holds its slot, a cancel kills it by pid, and it ends, judged by the store, when the pid does). One it saw cancelling is a
 *  cancel the restart cut short: a live fresh pid is adopted as cancelling and killed again, and ends when it goes; a gone pid
 *  (or a 12 h old one, never killed) ends it at once. Either way a release row it left building is then failed. Ended ones
 *  come back as they were. */
export function reconcileJobs(slug: string, root: string): void {
  const key = slug + '\0' + root;
  if (loaded.has(key)) return;
  loaded.add(key);
  const lines = readJournal(root);
  if (!lines.length) return;
  const last = new Map<string, JournalLine>();
  for (const l of lines) if (l.slug === slug) last.set(l.job.id, l);
  const p = prod(slug);
  const known = new Set(p.recs.map((r) => r.job.id));
  const back: Rec[] = [];
  for (const l of last.values()) {
    if (known.has(l.job.id)) continue; // a module reload: the live record is the truth
    const ph = phaseOf(l);
    const r: Rec = { job: { ...l.job }, root, prompt: '', buf: '', lastErr: '', phase: ph, ...(l.pid !== undefined ? { pid: l.pid } : {}) };
    const gone = (why: string) => { Object.assign(r.job, { status: 'failed', error: why }); r.job.ended_at ??= now(); step(r, 'exit'); };
    // an old pid may belong to a stranger by now: never adopted, never killed
    const adoptable = (pid: number | undefined): pid is number => pid !== undefined && Date.now() - Date.parse(l.at) < ORPHAN_MAX_MS && pidAlive(pid);
    if (ph === 'queued') gone('the server restarted while this job was queued; it never ran');
    else if (ph === 'running') {
      if (adoptable(r.pid)) r.orphan = true;
      else gone(`the server restarted and this job's process${r.pid !== undefined ? ` (pid ${r.pid})` : ''} was gone`);
    } else if (ph === 'cancelling') {
      if (adoptable(r.pid)) { r.orphan = true; killPid(r.pid); } // the kill the restart may have cut short
      else { r.job.ended_at ??= now(); step(r, 'exit'); }
    }
    if (r.phase !== ph) { if (r.job.kind === 'release' && r.job.status !== 'done') failBuilding(r); journal(slug, r); }
    back.push(r);
  }
  p.recs = [...back, ...p.recs].sort((a, b) => a.job.queued_at.localeCompare(b.job.queued_at));
  prune(p);
  for (const r of back) if (r.orphan && p.recs.includes(r)) watchOrphan(slug, r);
  compactJournal(root);
  notify(slug);
}

/** An adopted job has no child to close: poll its pid, and judge it by the store when it goes, as a closed child is. */
function watchOrphan(slug: string, r: Rec): void {
  const timer = (r.watch = setInterval(() => {
    if (r.phase === 'ended') { clearInterval(timer); return; }
    if (r.pid !== undefined && pidAlive(r.pid)) return;
    clearInterval(timer);
    if (r.phase === 'cancelling') { finish(slug, r, 'cancelled'); return; } // reaped: no run to judge
    if (r.job.kind === 'release') { settleRelease(slug, r, 0); return; }
    if (r.job.kind === 'prepare') { settlePrepare(slug, r, { exit_code: 0 }); return; }
    const run = r.job.run_id ?? runOf(r.root, r.job.id);
    if (run) { r.job.run_id = run; finish(slug, r, 'done', { exit_code: 0 }); }
    else finish(slug, r, 'failed', { error: 'the server restarted while this job ran, and its process ended without a run in the store' });
  }, ORPHAN_POLL_MS));
  timer.unref?.();
}

/** Keep the journal from growing for ever: the last line per job, the newest JOURNAL_KEEP of them. */
function compactJournal(root: string): void {
  try {
    const last = new Map<string, JournalLine>();
    for (const l of readJournal(root)) { const k = l.slug + '\0' + l.job.id; last.delete(k); last.set(k, l); }
    const keep = [...last.values()].slice(-JOURNAL_KEEP);
    writeAtomic(journalFile(root), keep.map((l) => JSON.stringify(l)).join('\n') + (keep.length ? '\n' : ''));
  } catch (e) { warnOnce('job journal ' + journalFile(root), e); }
}

/** Make sure the journal of the product's root has been read: with the root (an enqueue), else through the product registry. */
function ensure(slug: string, root?: string): void {
  try {
    const at = root ?? findProduct(slug)?.root;
    if (at) reconcileJobs(slug, at);
  } catch (e) { warnOnce('job journal ' + slug, e); }
}

function notify(slug: string, soon = false): void {
  const p = prod(slug);
  if (soon) { p.timer ??= setTimeout(() => notify(slug), NOTIFY_MS); return; }
  if (p.timer) { clearTimeout(p.timer); p.timer = undefined; }
  if (!p.subs.size) return;
  const jobs = list(slug);
  for (const fn of p.subs) try { fn(jobs); } catch { /* a closed stream: its own cleanup unsubscribes */ }
}

function prune(p: Product): void {
  const extra = p.recs.length - KEEP_JOBS;
  if (extra <= 0) return;
  const drop = new Set(p.recs.filter((r) => r.phase === 'ended').slice(0, extra)); // the oldest ended ones, never a cancelling one
  p.recs = p.recs.filter((r) => !drop.has(r));
}

export type Enqueued = { ok: true; job: ScanJob } | { ok: false; status: 400 | 429; error: string };

function enqueue(slug: string, root: string, job: ScanJob, prompt: string): Enqueued {
  ensure(slug, root);
  const p = prod(slug);
  if (p.recs.filter((r) => r.job.status === 'queued').length >= MAX_QUEUED) return { ok: false, status: 429, error: `${MAX_QUEUED} jobs are already queued for ${slug}` };
  const rec: Rec = { job, root, prompt, phase: 'queued', buf: '', lastErr: '' };
  p.recs.push(rec);
  journal(slug, rec);
  prune(p);
  pump(slug);
  notify(slug);
  return { ok: true, job: copy(rec) };
}

/** Queue a lens scan. The route has checked the lens against the map and the scope's features against its features. */
export function enqueueMeasure(slug: string, root: string, lens: string, scope: ScanScope): Enqueued {
  if (!SAFE_ID.test(lens)) return { ok: false, status: 400, error: 'unknown-lens' };
  const all = scope.kind === 'all';
  if ((!all && !scope.features.length) || scope.features.some((f) => !SAFE_ID.test(f)) || (scope.id !== undefined && !SAFE_ID.test(scope.id))) return { ok: false, status: 400, error: 'bad-scope' };
  if (scope.kind === 'selection' && (scope.id !== undefined || scope.features.length > MAX_SELECTION)) return { ok: false, status: 400, error: 'bad-scope' };
  const prompt = `/lens-scan measure --lens ${lens}` + (all ? '' : ` --scope ${scope.features.join(',')}`);
  return enqueue(slug, root, { id: jobId(), kind: 'measure', lens, scope, status: 'queued', queued_at: now() }, prompt);
}

/**
 * The fixed prompt of a prepare job: make `lens` measurable in the product repo by the lens-scan overlay rules. lens-scan has no
 * mode of its own for this, so the prompt is the contract, with the lens id (SAFE_ID and PREPARABLE) its only variable. One line:
 * the job log quotes it as `# prompt (stdin): ...`.
 */
export function preparePrompt(lens: string): string {
  return `Make the ${lens} lens measurable by /lens-scan in this repo, following the lens-scan skill's "Project overlay" section and references/metrics.md#probes. `
    + `For performance: write probe scripts under scripts/probes/ that drive a local PRODUCTION build (never a dev server) of the main features with Playwright, each printing one JSON line per metric `
    + `({"metric","feature","samples":[...]}, 20+ samples for a distribution, 3+ passes for a per-pass total), and add one \`<feature> <metric>: <command>\` line per probed feature and metric under a \`## Probes\` section of ${OVERLAY_PATH}. `
    + `Run at least one probe and check it prints valid JSON lines; never invent or estimate a reading. Follow this repo's own CLAUDE.md and rules; do not commit to a protected branch and do not push. `
    + `Do not start a measure run. End with exactly one line: \`lens-scan prepared: <what you added>\` or \`lens-scan refused: <why>\`.`;
}

/** Queue a prepare job for `lens` (the route checked it against the map). 400 for a lens no prepare job knows, 409 while one for the
 *  same lens is queued or running. */
export function enqueuePrepare(slug: string, root: string, lens: string): Enqueued | { ok: false; status: 409; error: string } {
  if (!SAFE_ID.test(lens) || !PREPARABLE.includes(lens)) return { ok: false, status: 400, error: 'not-preparable' };
  ensure(slug, root);
  if (prod(slug).recs.some((r) => r.job.kind === 'prepare' && r.job.lens === lens && r.phase !== 'ended')) return { ok: false, status: 409, error: `a prepare job for ${lens} is already queued or running` };
  return enqueue(slug, root, { id: jobId(), kind: 'prepare', lens, status: 'queued', queued_at: now() }, preparePrompt(lens));
}

/** A prepare job ends by the repo, not the exit alone: `done` when the overlay now lets lens-scan measure the lens (re-read), else
 *  failed with lens-scan's refusal line, or saying the overlay still lacks what the lens needs. */
function settlePrepare(slug: string, r: Rec, extra: Partial<ScanJob>): void {
  let overlay: string | null = null;
  try { overlay = fs.readFileSync(path.join(r.root, OVERLAY_PATH), 'utf8'); } catch { /* none yet */ }
  const need = lensSetupNeed(r.job.lens ?? '', undefined, overlay);
  if (!need) { finish(slug, r, 'done', extra); return; }
  const said = plainLines(r.buf).reverse().find((l) => l.startsWith('lens-scan refused:'));
  finish(slug, r, 'failed', { ...extra, error: said ?? `the run ended and ${need.why}` });
}

/** What a wave package runs its execute job with. Absent = the CLI's default, exactly as a plain dispatch. */
export interface ExecuteOpts { model?: WaveModel; effort?: WaveEffort; wave?: string; package?: string }

/** Queue an execute run over approved proposals (the route approved the proposed ones first). `opts`: model and effort are
 *  allow-listed (WAVE_MODELS / WAVE_EFFORTS) before they can reach the command line; wave and package are SAFE_ID; else 400 bad-opts. */
export function enqueueExecute(slug: string, root: string, ids: string[], opts: ExecuteOpts = {}): Enqueued {
  if (!ids.length || ids.length > MAX_PROPOSALS || ids.some((i) => !SAFE_ID.test(i))) return { ok: false, status: 400, error: 'bad-ids' };
  const { model, effort, wave, package: pkg } = opts;
  if ((model !== undefined && !WAVE_MODELS.includes(model)) || (effort !== undefined && !WAVE_EFFORTS.includes(effort))
    || (wave !== undefined && !SAFE_ID.test(wave)) || (pkg !== undefined && !SAFE_ID.test(pkg))) return { ok: false, status: 400, error: 'bad-opts' };
  const prompt = `/lens-scan execute --proposals ${ids.join(',')}`;
  const job: ScanJob = { id: jobId(), kind: 'execute', proposals: [...ids], ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(wave ? { wave } : {}), ...(pkg ? { package: pkg } : {}), status: 'queued', queued_at: now() };
  return enqueue(slug, root, job, prompt);
}

/** Queue a release run: `build` cuts it (`/lens-scan release --id <rel>`), `finish` tags it (`--finish`). The route checked the
 *  release's status and `gh auth status`; one release has at most one queued or running job (409 otherwise). */
export function enqueueRelease(slug: string, root: string, release: string, version: string, step: ReleaseStep): Enqueued | { ok: false; status: 409; error: string } {
  if (!RELEASE_ID.test(release) || release !== 'rel-' + version || (step !== 'build' && step !== 'finish')) return { ok: false, status: 400, error: 'bad-release' };
  ensure(slug, root);
  if (releaseBusy(slug, release)) return { ok: false, status: 409, error: `a release job for ${release} is already queued or running` };
  const prompt = `/lens-scan release --id ${release}` + (step === 'finish' ? ' --finish' : '');
  return enqueue(slug, root, { id: jobId(), kind: 'release', release, version, step, status: 'queued', queued_at: now() }, prompt);
}

/** Whether a release job of that release is queued, running, or cancelled with its process not yet gone. */
export function releaseBusy(slug: string, release: string): boolean {
  ensure(slug);
  return (registry.get(slug)?.recs ?? []).some((r) => r.job.kind === 'release' && r.job.release === release && r.phase !== 'ended');
}

/** Proposal ids a queued or running execute job of the product is building: a lens execute leaves them alone. */
export function busyProposals(slug: string): Set<string> {
  ensure(slug);
  return busyIds((registry.get(slug)?.recs ?? []).map((r) => r.job));
}

function pump(slug: string): void {
  const p = prod(slug);
  for (const r of p.recs) {
    if (p.recs.filter(holdsSlot).length >= MAX_RUNNING) return;
    if (r.phase === 'queued') start(slug, r);
  }
}

function finish(slug: string, r: Rec, status: 'done' | 'failed' | 'cancelled', extra: Partial<ScanJob> = {}): void {
  if (!step(r, 'exit')) return; // a second close or error after the first
  if (r.job.status !== 'cancelled') Object.assign(r.job, { status }, extra);
  else if (extra.exit_code !== undefined) r.job.exit_code = extra.exit_code;
  r.job.ended_at ??= now();
  if (r.job.kind === 'release' && r.job.status !== 'done') failBuilding(r);
  r.log?.end(`\n# ${r.job.status}${r.job.exit_code !== undefined ? ` (exit ${r.job.exit_code})` : ''} at ${r.job.ended_at}\n`);
  r.log = undefined;
  if (r.watch) clearInterval(r.watch);
  journal(slug, r);
  pump(slug);
  notify(slug);
}

/**
 * A release job that ends without `done` while its release row is still `building` leaves a row no route can move (no step
 * starts from building, scan/release-steps.ts STEP_FROM): the CLI was cancelled or died before it wrote an outcome. Fail the
 * row with the job's reason so a build may start again, as the Kettle sim does (train-sim.ts: "its building release fails").
 * The write is lens-scan's own: store.mjs `release-update --status failed --from building`, its compare-and-set, so the
 * blueprint never writes a release transition itself (release.server.ts). A row the CLI did move (failed with its own error,
 * pr-open) is refused (exit 1, "it moved on"), the expected no-op, and left as it is. Fire and forget, best effort: a store
 * that cannot be written leaves the row as it was, and the server says so once. A v1 store (no releases table) has no row to
 * fail, and is not handed to store.mjs, which would migrate it in place.
 */
function failBuilding(r: Rec): void {
  const id = r.job.release;
  if (!id) return;
  const file = path.join(r.root, '.ai', 'lens-scan', 'scan.db');
  const read = readRelease(file, id);
  if (read.kind === 'no-store' || read.kind === 'no-table' || read.kind === 'absent') return;
  const why = r.job.status === 'cancelled' ? 'cancelled from the blueprint before the cut finished' : (r.job.error ?? failedLine(r) ?? 'the release job ended before the cut finished');
  void storeCall(file, ['release-update', '--release', id, '--status', ABANDONED_TO, '--from', ABANDONED_FROM, '--error', why.slice(0, 500)]).then((a) => {
    if (a.ok || a.kind === 'refused') { recovered('release row ' + id); return; }
    warnOnce('release row ' + id, a.error);
  });
}

function onOutput(slug: string, r: Rec, chunk: Buffer, err: boolean): void {
  const s = chunk.toString('utf8');
  r.log?.write(chunk);
  r.buf = (r.buf + s).slice(-TAIL_BYTES * 2);
  const lines = r.buf.replace(/\r/g, '').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  r.job.log_tail = lines.slice(-TAIL_LINES).join('\n').slice(-TAIL_BYTES);
  if (err) { const last = s.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).pop(); if (last) r.lastErr = last.slice(0, 300); }
  notify(slug, true);
}

function start(slug: string, r: Rec): void {
  if (!step(r, 'start')) return;
  r.job.status = 'running';
  r.job.started_at = now();
  try {
    const dir = path.join(r.root, '.ai', 'lens-scan', 'work', 'bp-jobs');
    fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, r.job.id + '.log');
    r.log = fs.createWriteStream(logFile, { flags: 'a' });
    // A write that fails mid-run (a full disk, a revoked share) ends the only durable record of a job that keeps
    // running: log_tail lives in memory and KEEP_JOBS drops it. Say which file stopped taking lines.
    r.log.on('error', (e) => { r.log = undefined; warnOnce('job log ' + logFile, e); });
    const opt = [r.job.model && `model ${r.job.model}`, r.job.effort && `effort ${r.job.effort}`, r.job.wave && `wave ${r.job.wave}`, r.job.package && `package ${r.job.package}`].filter(Boolean).join(' · ');
    r.log.write(`# bp job ${r.job.id} started ${r.job.started_at}\n${opt ? `# ${opt}\n` : ''}# prompt (stdin): ${r.prompt}\n`);
  } catch (e) {
    r.log = undefined; // a read-only repo still runs; log_tail still fills
    // ...but nothing on disk will say this job ran, so the one unattended record of a `--dangerously-skip-permissions`
    // child is gone. The job's own answer cannot carry it (it reports the run, not the logging), so the server says it.
    warnOnce('job log ' + path.join(r.root, '.ai', 'lens-scan', 'work', 'bp-jobs', r.job.id + '.log'), e);
  }
  const noSkill = skillMissing(r.root);
  if (noSkill) { r.log?.write(`# ${noSkill}\n`); finish(slug, r, 'failed', { error: noSkill }); return; }
  const args = [...JOB_ARGS, ...(r.job.model ? ['--model', r.job.model] : []), ...(r.job.effort ? ['--effort', r.job.effort] : [])]; // allow-listed at enqueue
  const s = spawnCli(args, r.root, { ...process.env, BP_JOB_ID: r.job.id });
  if (!s.ok) { finish(slug, r, 'failed', { error: s.error }); return; }
  const c = (r.child = s.child);
  r.pid = c.pid;
  journal(slug, r);
  c.stdout?.on('data', (d: Buffer) => onOutput(slug, r, d, false));
  c.stderr?.on('data', (d: Buffer) => onOutput(slug, r, d, true));
  c.on('error', (e: NodeJS.ErrnoException) => finish(slug, r, 'failed', { error: e.code === 'ENOENT' ? CLI_MISSING : e.message }));
  c.on('close', (code, signal) => {
    if (code === 0 && r.job.kind === 'release') settleRelease(slug, r, 0);
    else if (code === 0 && r.job.kind === 'prepare') settlePrepare(slug, r, { exit_code: 0 });
    else if (code === 0) {
      // lens-scan refuses a headless run before its run-start (an unknown slug, no map) and still exits 0: no run = failed
      const run = r.job.run_id ?? runOf(r.root, r.job.id);
      if (run) { r.job.run_id = run; finish(slug, r, 'done', { exit_code: 0 }); }
      else finish(slug, r, 'failed', { exit_code: 0, error: refusal(r) });
    } else finish(slug, r, 'failed', code === null ? { error: r.lastErr || `killed (${signal ?? 'signal'})` } : { exit_code: code, error: r.lastErr || `exit ${code}` });
  });
  c.stdin?.end(r.prompt + '\n');
}

/** Cancel a job: a queued one leaves the queue (ended), a running one is killed with its process tree and stays `cancelling`
 *  until the process has gone (finish, on close or the orphan watch). Either reads `cancelled` at once. null = no such job. */
export function cancel(slug: string, id: string): ScanJob | null {
  const r = registry.get(slug)?.recs.find((x) => x.job.id === id);
  if (!r) return null;
  const was = r.phase;
  if (!step(r, 'cancel')) return copy(r); // ended, or already cancelling: nothing to do, nothing to journal
  r.job.status = 'cancelled'; r.job.ended_at = now();
  if (was === 'running') {
    r.log?.write(`\n# cancelled from the blueprint at ${r.job.ended_at}\n`);
    if (r.child) killTree(r.child);
    else if (r.orphan && r.pid !== undefined) killPid(r.pid);
  }
  journal(slug, r);
  notify(slug); // a cancelling job keeps its slot until the process has gone
  return copy(r);
}

/** The note lens-scan writes for job `id`: `bp-job:<id>`, or `bp-job:<id> <more>` (never a bare prefix: j-1 is not j-10). */
const isNoteOf = (note: string | undefined, id: string): boolean => note === RUN_NOTE_PREFIX + id || !!note?.startsWith(RUN_NOTE_PREFIX + id + ' ');

/** The store run job `id` produced, read from the product's store at exit (no stream may have seen it). */
function runOf(root: string, id: string): string | undefined {
  const db = openRead(path.join(root, '.ai', 'lens-scan', 'scan.db'));
  if (!db) return undefined;
  try {
    const rows = db.prepare('SELECT id, note FROM runs WHERE note LIKE ? ORDER BY started_at DESC').all(RUN_NOTE_PREFIX + id + '%') as { id: string; note: string | null }[];
    return rows.find((x) => isNoteOf(x.note ?? undefined, id))?.id;
  } catch { return undefined; /* no runs table yet */ } finally { close(db); }
}

/** An unreadable store (a write lock past the busy timeout, say) is read again this many times, this far apart, before the
 *  job gives up and says what it could not read: the cut it is judging may well have succeeded. */
const STORE_RETRIES = 3, STORE_RETRY_MS = 1000;

/** What a release job says when the store would not give its release's row: the cause, not the CLI's last log line. */
function storeCause(read: Exclude<ReleaseRead, { kind: 'row' }>, id: string): string {
  switch (read.kind) {
    case 'no-store': return `the release store is missing (no .ai/lens-scan/scan.db), so ${id} could not be checked`;
    case 'no-table': return `the release store has no releases table (a v1 store), so ${id} could not be checked`;
    case 'absent': return `the release store has no release ${id}`;
    case 'unreadable': return `the release store could not be read (${read.error}), so the outcome of ${id} is unknown; check its status before building again`;
  }
}

/**
 * A release job that exited 0 ends by the release's status in the store (a finish starts no run, and a cut can fail after its
 * measure run): `done` when the row is where the step leaves it, else `failed` with the most specific reason there is - the
 * CLI's own `release failed`/`refused` line, the row's error, or the condition of the store that kept the row from being read.
 */
function settleRelease(slug: string, r: Rec, attempt: number): void {
  const read = readRelease(path.join(r.root, '.ai', 'lens-scan', 'scan.db'), r.job.release ?? '');
  if (read.kind === 'unreadable' && attempt < STORE_RETRIES) {
    setTimeout(() => settleRelease(slug, r, attempt + 1), STORE_RETRY_MS);
    return;
  }
  const run = r.job.run_id ?? runOf(r.root, r.job.id);
  const ok = read.kind === 'row' && reached(r.job.step ?? 'build', read.status);
  const extra: Partial<ScanJob> = { exit_code: 0, ...(run ? { run_id: run } : {}) };
  if (ok) { finish(slug, r, 'done', extra); return; }
  const why = read.kind === 'row' ? (read.status === 'failed' && read.error ? read.error : undefined) : storeCause(read, r.job.release ?? '');
  finish(slug, r, 'failed', { ...extra, error: failedLine(r) ?? why ?? refusal(r) });
}

/** The log's lines as plain text: a reply is markdown, so a `**lens-scan refused: ...**` line (Grinex, 2026-10-25) loses its
 *  list, quote and heading marks and its emphasis before a line is matched or quoted as an error. */
const plainLines = (buf: string): string[] => buf.replace(/\r/g, '').split('\n')
  .map((l) => l.trim().replace(/^(?:[>#]+\s*|[-*+]\s+)+/, '').replace(/\*\*|__/g, '').trim()).filter(Boolean);

/** lens-scan's `lens-scan release failed: <what>` or `lens-scan refused: <why>` line, the latest one. */
function failedLine(r: Rec): string | undefined {
  const lines = plainLines(r.buf);
  return [...lines].reverse().find((l) => l.startsWith('lens-scan release failed:') || l.startsWith('lens-scan refused:'));
}

/** The CLI saying it has no lens-scan skill: `/lens-scan isn't installed`, `is not available`, `Unknown skill: lens-scan`. */
export const SKILL_ABSENT = /lens-scan\W{0,4}\s+(?:isn['’]t|is not)\s+(?:installed|available)|unknown (?:skill|slash command|command)\W{0,3}\s*\/?lens-scan/i;

/** Why a job that exited 0 made no run: lens-scan's `lens-scan refused: <why>` line; else, when the CLI said it has no lens-scan
 *  skill, that (its last line is then a question to a person nobody is there to answer); else the last log line. */
function refusal(r: Rec): string {
  const lines = plainLines(r.buf);
  const refused = [...lines].reverse().find((l) => l.startsWith('lens-scan refused:'));
  if (refused) return refused;
  if (lines.some((l) => SKILL_ABSENT.test(l))) return NO_JOB_SKILL + ' (the CLI said so and wrote no run)';
  return lines[lines.length - 1] ?? 'the run never started (no run in the store)';
}

/** A store run whose note is `bp-job:<id>` (or `bp-job:<id> <more>`) belongs to that job: remember its run id. true = something changed. */
export function attachRun(slug: string, runId: string, note: string | undefined): boolean {
  if (!note?.startsWith(RUN_NOTE_PREFIX)) return false;
  const r = registry.get(slug)?.recs.find((x) => isNoteOf(note, x.job.id));
  if (!r || r.job.run_id === runId) return false;
  r.job.run_id = runId;
  journal(slug, r);
  notify(slug);
  return true;
}
