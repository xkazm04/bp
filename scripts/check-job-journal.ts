// The scan-job registry survives a process exit as a record (packages/core/src/server/jobs.server.ts, "the journal"):
// every state change of a job appends one line to <root>/.ai/lens-scan/work/bp-jobs/journal.jsonl (pid included), and
// the first time a product's root is known after a start the journal is reconciled against the processes that are
// still there. Without it a restart forgot a queued job, forgot a running one and left its detached `claude -p
// --dangerously-skip-permissions` child unsupervised, and `releaseBusy` read an empty registry.
//   WRITE half: a started job has a `running` line with the CLI's pid, a queued one a `queued` line, a finished or
//   cancelled one a terminal line; no line carries log_tail.
//   RECONCILE half, each over a fresh evaluation of the module whose globalThis registry was wiped (a process restart):
//   - a job last seen `queued` comes back `failed`, naming the restart;
//   - a job last seen `running` whose pid is gone comes back `failed`, naming the restart and the pid;
//   - one whose pid is alive is adopted as running (holds a slot, is cancellable by pid, ends when the pid does);
//   - an old line (12 h) whose pid is alive is NOT adopted: a pid that old may belong to a stranger;
//   - a finished job comes back as it was; a torn last line is skipped;
//   - an adopted release job makes enqueueRelease refuse a second one (409) instead of cutting the release twice;
//   - a second reconcile in one process, and a module reload that keeps globalThis, adopt nothing twice.
// The restart is reproduced as check-kettle-host-reload does a reload: the module is evaluated under distinct specifiers
// (?gen=N); the wipe of globalThis.__bpScanJobs / __bpScanJobsLoaded is what a process exit does. The children are real
// (the fake CLI sleeps until killed), the CLI is never the real one.
// Run: node scripts/check-job-journal.ts   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
process.env.BP_CLAUDE_BIN = path.join(ROOT, 'scripts/fixtures/fake-claude.mjs');

type Mod = typeof import('../packages/core/src/server/jobs.server.ts');
type ScanJob = import('../packages/core/src/scan/jobs.ts').ScanJob;
const G = globalThis as typeof globalThis & { __bpScanJobs?: unknown; __bpScanJobsLoaded?: unknown };
let gen = 0;
/** A process restart: the registry and the loaded-journal marks are gone, the module is evaluated afresh. */
async function restart(): Promise<Mod> {
  delete G.__bpScanJobs; delete G.__bpScanJobsLoaded;
  return await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/jobs.server.ts')).href + '?gen=' + ++gen) as Mod;
}
/** A module reload: evaluated afresh, globalThis kept. */
async function reload(): Promise<Mod> {
  return await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/jobs.server.ts')).href + '?gen=' + ++gen) as Mod;
}

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 15000): Promise<boolean> { const t = Date.now() + ms; while (Date.now() < t) { if (pred()) return true; await sleep(40); } return pred(); }
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const kill = (pid: number) => { try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-job-journal-'));
const root = (n: string) => { const r = path.join(dir, n); fs.mkdirSync(r, { recursive: true }); return r; };
const jfile = (r: string) => path.join(r, '.ai', 'lens-scan', 'work', 'bp-jobs', 'journal.jsonl');
const lines = (r: string) => (fs.existsSync(jfile(r)) ? fs.readFileSync(jfile(r), 'utf8').split('\n').filter(Boolean) : []).map((l) => JSON.parse(l) as { at: string; slug: string; pid?: number; job: ScanJob });
const lastOf = (r: string, id: string) => lines(r).filter((l) => l.job.id === id).pop();
const get = (M: Mod, slug: string, id: string) => M.list(slug).find((j) => j.id === id);
const SCOPE = { kind: 'all' as const, label: 'Everything', features: [] as string[] };
const spawned: number[] = [];
const sleeper = (): ChildProcess => { const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' }); c.unref(); spawned.push(c.pid!); return c; };

try {
  // ---------------------------------------------------------------- the write half, and a restart over a live registry
  const R = root('live');
  const M1 = await restart();
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const e = M1.enqueueMeasure('prod', R, 'slow', SCOPE);
    if (e.ok) ids.push(e.job.id);
  }
  check('4 jobs enqueued', ids.length === 4);
  check('3 run, the 4th waits', await until(() => ids.filter((i) => get(M1, 'prod', i)?.status === 'running').length === 3) && get(M1, 'prod', ids[3])?.status === 'queued');
  const pids = ids.slice(0, 3).map((i) => lastOf(R, i)?.pid ?? 0);
  spawned.push(...pids);
  check('write: every running job has a running line with the CLI pid', pids.every((p) => p > 0 && alive(p)) && ids.slice(0, 3).every((i) => lastOf(R, i)?.job.status === 'running'), JSON.stringify(pids));
  check('write: the waiting job has a queued line and no pid', lastOf(R, ids[3])?.job.status === 'queued' && lastOf(R, ids[3])?.pid === undefined);
  check('write: no line carries log_tail', lines(R).every((l) => !('log_tail' in l.job)));
  check('write: a line per state change (queued, then running)', lines(R).filter((l) => l.job.id === ids[0]).map((l) => l.job.status).join() === 'queued,running');

  const M2 = await restart(); // the process exits and comes back; the children, detached, do not
  check('restart: nothing is known before a root is', M2.list('prod').length === 0);
  M2.reconcileJobs('prod', R);
  const after = M2.list('prod');
  check('reconcile: all 4 jobs are back', after.length === 4, String(after.length));
  check('reconcile: the queued job is failed and names the restart', get(M2, 'prod', ids[3])?.status === 'failed' && /restarted/.test(get(M2, 'prod', ids[3])?.error ?? '') && /queued/.test(get(M2, 'prod', ids[3])?.error ?? ''), get(M2, 'prod', ids[3])?.error);
  check('reconcile: the 3 live children are adopted as running', ids.slice(0, 3).every((i) => get(M2, 'prod', i)?.status === 'running'));
  check('reconcile: the failure is journalled too', lastOf(R, ids[3])?.job.status === 'failed');
  M2.reconcileJobs('prod', R);
  check('reconcile twice adopts nothing twice', M2.list('prod').length === 4);
  const M2b = await reload(); // a module reload keeps globalThis: the live registry is the truth
  M2b.reconcileJobs('prod', R);
  check('a module reload that keeps globalThis adopts nothing twice', M2b.list('prod').length === 4);

  // the 4th slot: adopted jobs hold their slots, so a new job queues instead of starting a 4th child
  const extra = M2.enqueueMeasure('prod', R, 'slow', SCOPE);
  check('adopted jobs hold the 3 slots (a new job queues)', extra.ok && extra.job.status === 'queued');

  // cancel an adopted job: killed by pid
  const c = M2.cancel('prod', ids[0]);
  check('cancel of an adopted job reads cancelled', c?.status === 'cancelled');
  check('cancel of an adopted job kills its process', await until(() => !alive(pids[0])), String(pids[0]));
  // an adopted job whose process dies by itself ends, with no run in the store: failed naming the restart
  kill(pids[1]);
  check('an adopted job ends when its pid does (failed, no run)', await until(() => get(M2, 'prod', ids[1])?.status === 'failed', 20000) && /restarted/.test(get(M2, 'prod', ids[1])?.error ?? ''), get(M2, 'prod', ids[1])?.error);
  check('...and the ending is journalled', await until(() => lastOf(R, ids[1])?.job.status === 'failed'));

  // ------------------------------------------------------- a running job whose pid is gone, over a finished one
  const D = root('dead');
  const gone = sleeper(); const gonePid = gone.pid!; kill(gonePid);
  check('control process is gone', await until(() => !alive(gonePid)));
  const at = new Date().toISOString();
  const base = { queued_at: at, kind: 'measure' as const, lens: 'slow', scope: SCOPE };
  fs.mkdirSync(path.dirname(jfile(D)), { recursive: true });
  fs.writeFileSync(jfile(D), [
    { at, slug: 'p2', job: { ...base, id: 'j-done-0001', status: 'queued' } },
    { at, slug: 'p2', pid: 1, job: { ...base, id: 'j-done-0001', status: 'done', started_at: at, ended_at: at, exit_code: 0, run_id: 'run-9' } },
    { at, slug: 'p2', pid: gonePid, job: { ...base, id: 'j-dead-0002', status: 'running', started_at: at } },
    { at, slug: 'other', pid: gonePid, job: { ...base, id: 'j-other-0003', status: 'running', started_at: at } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n{"at":"torn","slug":"p2","job":{"id":"j-to');
  const M3 = await restart();
  M3.reconcileJobs('p2', D);
  const l3 = M3.list('p2');
  check('dead pid: the running job is failed, naming the restart and the pid', get(M3, 'p2', 'j-dead-0002')?.status === 'failed' && /restarted/.test(get(M3, 'p2', 'j-dead-0002')?.error ?? '') && (get(M3, 'p2', 'j-dead-0002')?.error ?? '').includes(String(gonePid)), get(M3, 'p2', 'j-dead-0002')?.error);
  check('a finished job comes back as it was', get(M3, 'p2', 'j-done-0001')?.status === 'done' && get(M3, 'p2', 'j-done-0001')?.run_id === 'run-9');
  check('another product on the same root is left alone; a torn last line is skipped', l3.length === 2 && M3.list('other').length === 0, String(l3.length));

  // ---------------------------------------------------------------- an old line must not be trusted with a live pid
  const O = root('old');
  const stranger = sleeper();
  const old = new Date(Date.now() - 13 * 3600_000).toISOString();
  fs.mkdirSync(path.dirname(jfile(O)), { recursive: true });
  fs.writeFileSync(jfile(O), JSON.stringify({ at: old, slug: 'p3', pid: stranger.pid, job: { ...base, id: 'j-old-0004', status: 'running', started_at: old } }) + '\n');
  const M4 = await restart();
  M4.reconcileJobs('p3', O);
  check('a 13 h old running line with a live pid is failed, not adopted', get(M4, 'p3', 'j-old-0004')?.status === 'failed');
  M4.cancel('p3', 'j-old-0004');
  check('...and its pid (a stranger by now) is never killed', alive(stranger.pid!));

  // ----------------------------------------------------- duplicate release after a restart is refused
  const Rl = root('rel');
  const rel = sleeper();
  const now = new Date().toISOString();
  fs.mkdirSync(path.dirname(jfile(Rl)), { recursive: true });
  fs.writeFileSync(jfile(Rl), JSON.stringify({ at: now, slug: 'p4', pid: rel.pid, job: { id: 'j-rel-0005', kind: 'release', release: 'rel-1.0.0', version: '1.0.0', step: 'build', status: 'running', queued_at: now, started_at: now } }) + '\n');
  const M5 = await restart();
  const dup = M5.enqueueRelease('p4', Rl, 'rel-1.0.0', '1.0.0', 'build');
  check('a release job running before the restart refuses a second (409)', !dup.ok && dup.status === 409, JSON.stringify(dup));
  check('releaseBusy sees the adopted job', M5.releaseBusy('p4', 'rel-1.0.0'));
  const other = M5.enqueueRelease('p4', Rl, 'rel-2.0.0', '2.0.0', 'build');
  check('another release is still accepted', other.ok);
  M5.cancel('p4', 'j-rel-0005');
  check('cancelling the adopted release job frees the release', await until(() => !alive(rel.pid!)) && !M5.releaseBusy('p4', 'rel-1.0.0'));

  // ------------------------------------------------------------------ the journal does not grow for ever
  const C = root('compact');
  fs.mkdirSync(path.dirname(jfile(C)), { recursive: true });
  const t0 = Date.now();
  const many: string[] = [];
  for (let i = 0; i < 300; i++) for (const st of ['queued', 'done']) many.push(JSON.stringify({ at: now, slug: 'p5', job: { ...base, id: 'j-c-' + String(i).padStart(4, '0'), status: st, queued_at: new Date(t0 + i).toISOString() } }));
  fs.writeFileSync(jfile(C), many.join('\n') + '\n');
  const M6 = await restart();
  M6.reconcileJobs('p5', C);
  check('compaction: the journal keeps the last line per job, the newest 200', lines(C).length === 200 && lines(C).every((l) => l.job.status === 'done'), String(lines(C).length));
  check('the registry keeps its own 50', M6.list('p5').length === M6.KEEP_JOBS);
} finally {
  for (const p of spawned) kill(p);
  await sleep(300);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a child still holds a file: the OS temp dir clears it */ }
}
console.log(`check-job-journal: ${passed} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
