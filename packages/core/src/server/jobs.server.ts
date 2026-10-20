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
import path from 'node:path';
import { MAX_PROPOSALS, MAX_QUEUED, MAX_RUNNING, MAX_SELECTION, RUN_NOTE_PREFIX, SAFE_ID, type ReleaseStep, type ScanJob, type ScanScope } from '../scan/jobs.ts';
import { RELEASE_ID } from '../scan/release.ts';
import { WAVE_EFFORTS, WAVE_MODELS, type WaveEffort, type WaveModel } from '../scan/waves.ts';
import { close, openRead } from './store.server.ts';

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
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill()); } catch { child.kill(); }
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
}

// ------------------------------------------------------------------------------------ registry
type Listener = (jobs: ScanJob[]) => void;
interface Rec {
  job: ScanJob; root: string; prompt: string;
  child?: ChildProcess; live?: boolean; ended?: boolean;
  buf: string; lastErr: string; log?: fs.WriteStream;
}
interface Product { recs: Rec[]; subs: Set<Listener>; timer?: ReturnType<typeof setTimeout> }

const G = globalThis as typeof globalThis & { __bpScanJobs?: Map<string, Product> };
const registry: Map<string, Product> = (G.__bpScanJobs ??= new Map<string, Product>());
const prod = (slug: string): Product => {
  let p = registry.get(slug);
  if (!p) registry.set(slug, (p = { recs: [], subs: new Set() }));
  return p;
};
const copy = (r: Rec): ScanJob => ({ ...r.job });
const now = () => new Date().toISOString();
const jobId = () => 'j-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');

/** The product's jobs, oldest first (queued and running ones always kept, finished ones down to the latest 50). */
export function list(slug: string): ScanJob[] { return (registry.get(slug)?.recs ?? []).map(copy); }

/** Called with the whole list after each change (log lines coalesced to one call per 400 ms). Returns the unsubscribe. */
export function subscribe(slug: string, fn: Listener): () => void {
  const p = prod(slug);
  p.subs.add(fn);
  return () => { p.subs.delete(fn); };
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
  const drop = new Set(p.recs.filter((r) => r.ended && !r.live).slice(0, extra)); // the oldest finished ones
  p.recs = p.recs.filter((r) => !drop.has(r));
}

export type Enqueued = { ok: true; job: ScanJob } | { ok: false; status: 400 | 429; error: string };

function enqueue(slug: string, root: string, job: ScanJob, prompt: string): Enqueued {
  const p = prod(slug);
  if (p.recs.filter((r) => r.job.status === 'queued').length >= MAX_QUEUED) return { ok: false, status: 429, error: `${MAX_QUEUED} jobs are already queued for ${slug}` };
  const rec: Rec = { job, root, prompt, buf: '', lastErr: '' };
  p.recs.push(rec);
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
  if (releaseBusy(slug, release)) return { ok: false, status: 409, error: `a release job for ${release} is already queued or running` };
  const prompt = `/lens-scan release --id ${release}` + (step === 'finish' ? ' --finish' : '');
  return enqueue(slug, root, { id: jobId(), kind: 'release', release, version, step, status: 'queued', queued_at: now() }, prompt);
}

/** Whether a release job of that release is queued or running. */
export function releaseBusy(slug: string, release: string): boolean {
  return (registry.get(slug)?.recs ?? []).some((r) => r.job.kind === 'release' && r.job.release === release && (r.job.status === 'queued' || r.job.status === 'running'));
}

/** Proposal ids a queued or running execute job of the product is building: a lens execute leaves them alone. */
export function busyProposals(slug: string): Set<string> {
  const out = new Set<string>();
  for (const r of registry.get(slug)?.recs ?? []) {
    if (r.job.kind === 'execute' && (r.job.status === 'queued' || r.job.status === 'running')) for (const id of r.job.proposals ?? []) out.add(id);
  }
  return out;
}

function pump(slug: string): void {
  const p = prod(slug);
  for (const r of p.recs) {
    if (p.recs.filter((x) => x.live).length >= MAX_RUNNING) return;
    if (r.job.status === 'queued') start(slug, r);
  }
}

function finish(slug: string, r: Rec, status: 'done' | 'failed' | 'cancelled', extra: Partial<ScanJob> = {}): void {
  if (r.ended) return;
  r.ended = true; r.live = false;
  if (r.job.status !== 'cancelled') Object.assign(r.job, { status }, extra);
  else if (extra.exit_code !== undefined) r.job.exit_code = extra.exit_code;
  r.job.ended_at ??= now();
  r.log?.end(`\n# ${r.job.status}${r.job.exit_code !== undefined ? ` (exit ${r.job.exit_code})` : ''} at ${r.job.ended_at}\n`);
  r.log = undefined;
  pump(slug);
  notify(slug);
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
  r.job.status = 'running';
  r.job.started_at = now();
  r.live = true;
  try {
    const dir = path.join(r.root, '.ai', 'lens-scan', 'work', 'bp-jobs');
    fs.mkdirSync(dir, { recursive: true });
    r.log = fs.createWriteStream(path.join(dir, r.job.id + '.log'), { flags: 'a' });
    r.log.on('error', () => { r.log = undefined; });
    const opt = [r.job.model && `model ${r.job.model}`, r.job.effort && `effort ${r.job.effort}`, r.job.wave && `wave ${r.job.wave}`, r.job.package && `package ${r.job.package}`].filter(Boolean).join(' · ');
    r.log.write(`# bp job ${r.job.id} started ${r.job.started_at}\n${opt ? `# ${opt}\n` : ''}# prompt (stdin): ${r.prompt}\n`);
  } catch { r.log = undefined; /* a read-only repo still runs; log_tail still fills */ }
  const args = [...JOB_ARGS, ...(r.job.model ? ['--model', r.job.model] : []), ...(r.job.effort ? ['--effort', r.job.effort] : [])]; // allow-listed at enqueue
  const s = spawnCli(args, r.root, { ...process.env, BP_JOB_ID: r.job.id });
  if (!s.ok) { finish(slug, r, 'failed', { error: s.error }); return; }
  const c = (r.child = s.child);
  c.stdout?.on('data', (d: Buffer) => onOutput(slug, r, d, false));
  c.stderr?.on('data', (d: Buffer) => onOutput(slug, r, d, true));
  c.on('error', (e: NodeJS.ErrnoException) => finish(slug, r, 'failed', { error: e.code === 'ENOENT' ? CLI_MISSING : e.message }));
  c.on('close', (code, signal) => {
    if (code === 0 && r.job.kind === 'release') {
      // a release ends by its status: a finish starts no run, and a cut can fail after its measure run
      const run = r.job.run_id ?? runOf(r.root, r.job.id), rel = releaseOf(r.root, r.job.release ?? '');
      const ok = !!rel && (r.job.step === 'finish' ? rel.status === 'tagged' : ['pr-open', 'merged', 'tagged'].includes(rel.status));
      const extra: Partial<ScanJob> = { exit_code: 0, ...(run ? { run_id: run } : {}) };
      if (ok) finish(slug, r, 'done', extra);
      else finish(slug, r, 'failed', { ...extra, error: failedLine(r) ?? (rel?.status === 'failed' && rel.error ? rel.error : refusal(r)) });
    } else if (code === 0) {
      // lens-scan refuses a headless run before its run-start (an unknown slug, no map) and still exits 0: no run = failed
      const run = r.job.run_id ?? runOf(r.root, r.job.id);
      if (run) { r.job.run_id = run; finish(slug, r, 'done', { exit_code: 0 }); }
      else finish(slug, r, 'failed', { exit_code: 0, error: refusal(r) });
    } else finish(slug, r, 'failed', code === null ? { error: r.lastErr || `killed (${signal ?? 'signal'})` } : { exit_code: code, error: r.lastErr || `exit ${code}` });
  });
  c.stdin?.end(r.prompt + '\n');
}

/** Cancel a job: a queued one leaves the queue, a running one is killed with its process tree. null = no such job. */
export function cancel(slug: string, id: string): ScanJob | null {
  const r = registry.get(slug)?.recs.find((x) => x.job.id === id);
  if (!r) return null;
  if (r.job.status === 'queued') {
    r.job.status = 'cancelled'; r.job.ended_at = now();
    r.ended = true;
    notify(slug);
  } else if (r.job.status === 'running') {
    r.job.status = 'cancelled'; r.job.ended_at = now();
    r.log?.write(`\n# cancelled from the blueprint at ${r.job.ended_at}\n`);
    if (r.child) killTree(r.child);
    notify(slug); // the slot frees when the process has gone (finish, on close)
  }
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

/** A release's status and error, read from the product's store at exit. */
function releaseOf(root: string, id: string): { status: string; error?: string } | undefined {
  const db = openRead(path.join(root, '.ai', 'lens-scan', 'scan.db'));
  if (!db) return undefined;
  try {
    const row = db.prepare('SELECT status, error FROM releases WHERE id = ?').get(id) as { status: string; error: string | null } | undefined;
    return row ? { status: row.status, ...(row.error ? { error: row.error } : {}) } : undefined;
  } catch { return undefined; /* a v1 store: no releases table */ } finally { close(db); }
}

/** lens-scan's `lens-scan release failed: <what>` or `lens-scan refused: <why>` line, the latest one. */
function failedLine(r: Rec): string | undefined {
  const lines = r.buf.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  return [...lines].reverse().find((l) => l.startsWith('lens-scan release failed:') || l.startsWith('lens-scan refused:'));
}

/** Why a job that exited 0 made no run: lens-scan's `lens-scan refused: <why>` line, else the last log line. */
function refusal(r: Rec): string {
  const lines = r.buf.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  return [...lines].reverse().find((l) => l.startsWith('lens-scan refused:')) ?? lines[lines.length - 1] ?? 'the run never started (no run in the store)';
}

/** A store run whose note is `bp-job:<id>` (or `bp-job:<id> <more>`) belongs to that job: remember its run id. true = something changed. */
export function attachRun(slug: string, runId: string, note: string | undefined): boolean {
  if (!note?.startsWith(RUN_NOTE_PREFIX)) return false;
  const r = registry.get(slug)?.recs.find((x) => isNoteOf(note, x.job.id));
  if (!r || r.job.run_id === runId) return false;
  r.job.run_id = runId;
  notify(slug);
  return true;
}
