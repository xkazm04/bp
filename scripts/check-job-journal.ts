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
//   PHASES (queued -> running -> cancelling -> ended, journalled as `phase`): a cancel is a request until the process is
//   reaped - a restart over a live cancel adopts it as cancelling (release busy, pid killed again), one whose pid is gone
//   ends it and fails the release row it left building; the table refuses a move it lacks and journals nothing; a legacy
//   line (no phase) reads cancelled-with-pid-and-no-exit as cancelling; prune never drops a cancelling job.
// The restart is reproduced as check-kettle-host-reload does a reload: the module is evaluated under distinct specifiers
// (?gen=N); the wipe of globalThis.__bpScanJobs / __bpScanJobsLoaded is what a process exit does. The children are real
// (the fake CLI sleeps until killed), the CLI is never the real one.
// Run: node scripts/check-job-journal.ts   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
process.env.BP_CLAUDE_BIN = path.join(ROOT, 'scripts/fixtures/fake-claude.mjs');
const RS = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/release.server.ts')).href) as typeof import('../packages/core/src/server/release.server.ts');

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
  // a cancel is a request: the release stays busy until the pid has gone and the watcher has reaped it (one poll later)
  check('cancelling the adopted release job frees the release', await until(() => !alive(rel.pid!)) && await until(() => !M5.releaseBusy('p4', 'rel-1.0.0')));

  // ------------------------------------------- the phase model: a cancel is a request until the process is reaped
  // Phases queued -> running -> cancelling -> ended, journalled on every line as `phase`; one table says which event moves
  // which phase, and an event the table lacks changes nothing and journals nothing.
  const relJob = (id: string, release: string, t: string) => ({ id, kind: 'release', release, version: release.slice(4), step: 'build', queued_at: t, started_at: t });
  // 1. a restart over a cancel line whose child is still alive: adopted as cancelling, killed again, reaped when it goes
  const K = root('cancel-live');
  const kc = sleeper(); const kcPid = kc.pid!;
  const tk = new Date().toISOString();
  fs.mkdirSync(path.dirname(jfile(K)), { recursive: true });
  fs.writeFileSync(jfile(K), JSON.stringify({ at: tk, slug: 'p7', pid: kcPid, phase: 'cancelling', job: { ...relJob('j-can-0007', 'rel-7.0.0', tk), status: 'cancelled', ended_at: tk } }) + '\n');
  const M7 = await restart();
  M7.reconcileJobs('p7', K);
  check('restart over a live cancel: the job reads cancelled', get(M7, 'p7', 'j-can-0007')?.status === 'cancelled', JSON.stringify(get(M7, 'p7', 'j-can-0007')));
  check('restart over a live cancel: the release stays busy while the pid lives', alive(kcPid) && M7.releaseBusy('p7', 'rel-7.0.0'));
  check('restart over a live cancel: the pid is killed again', await until(() => !alive(kcPid)), String(kcPid));
  check('restart over a live cancel: the release is free once the pid has gone', await until(() => !M7.releaseBusy('p7', 'rel-7.0.0')));
  check('...and the reaping is journalled as ended', await until(() => (lastOf(K, 'j-can-0007') as { phase?: string } | undefined)?.phase === 'ended'), JSON.stringify(lastOf(K, 'j-can-0007')));

  // 2. the same line with the pid already gone and the release row still building: the row is failed, with a reason
  const B = root('cancel-gone');
  const bstore = path.join(B, '.ai', 'lens-scan'); fs.mkdirSync(bstore, { recursive: true });
  const bdb = path.join(bstore, 'scan.db');
  { const w = new DatabaseSync(bdb); w.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
    w.prepare("INSERT INTO releases (id, version, branch, status, created_at, updated_at) VALUES ('rel-8.0.0', '8.0.0', 'release/8.0.0', 'building', ?, ?)").run(now, now); w.close(); }
  const bg = sleeper(); const bgPid = bg.pid!; kill(bgPid);
  check('control process is gone (2)', await until(() => !alive(bgPid)));
  fs.mkdirSync(path.dirname(jfile(B)), { recursive: true });
  fs.writeFileSync(jfile(B), JSON.stringify({ at: now, slug: 'p8', pid: bgPid, phase: 'cancelling', job: { ...relJob('j-can-0008', 'rel-8.0.0', now), status: 'cancelled', ended_at: now } }) + '\n');
  const relRow = () => { const d = new DatabaseSync(bdb, { readOnly: true, timeout: 5000 }); try { return d.prepare("SELECT status, error FROM releases WHERE id = 'rel-8.0.0'").get() as { status: string; error: string | null } | undefined; } finally { d.close(); } };
  const M8 = await restart();
  M8.reconcileJobs('p8', B);
  check('restart over a cancel whose pid is gone: the job is ended, not busy', get(M8, 'p8', 'j-can-0008')?.status === 'cancelled' && !M8.releaseBusy('p8', 'rel-8.0.0'));
  if (!RS.storeScript()) { console.log('SKIP the stranded-row case (failBuilding writes through store.mjs; lens-scan is not installed here)'); } else {
    check('restart over a cancel whose pid is gone: the building row is failed with a cancellation reason', await until(() => relRow()?.status === 'failed', 10000) && /cancel/.test(relRow()?.error ?? ''), JSON.stringify(relRow()));
  }

  // 3. an in-process cancel of a running job: phases queued, running, cancelling, ended; the wire reads cancelled at once
  const P = root('phases');
  const M9 = await restart();
  const pj = M9.enqueueMeasure('p9', P, 'slow', SCOPE);
  check('phases: the job starts', pj.ok && await until(() => (lastOf(P, pj.job.id)?.pid ?? 0) > 0));
  const ppid = pj.ok ? lastOf(P, pj.job.id)?.pid ?? 0 : 0; if (ppid) spawned.push(ppid);
  const pc = pj.ok ? M9.cancel('p9', pj.job.id) : null;
  check('phases: the cancel call answers cancelled, and the list reads cancelled from then on', pc?.status === 'cancelled' && pj.ok && get(M9, 'p9', pj.job.id)?.status === 'cancelled');
  check('phases: the process goes', await until(() => !alive(ppid)), String(ppid));
  const phases = () => pj.ok ? lines(P).filter((l) => l.job.id === pj.job.id).map((l) => (l as { phase?: string }).phase).join() : '';
  check('phases: the journal reads queued,running,cancelling,ended', await until(() => phases() === 'queued,running,cancelling,ended'), phases());
  check('phases: the ended line still reads cancelled on the wire', pj.ok && lastOf(P, pj.job.id)?.job.status === 'cancelled' && get(M9, 'p9', pj.job.id)?.status === 'cancelled');

  // 4. a transition the table does not allow changes nothing and journals nothing
  const T = (M9 as unknown as { nextPhase?: (p: string, e: string) => string | null }).nextPhase;
  check('the transition table is exported', typeof T === 'function');
  check('table: queued -start-> running, running -cancel-> cancelling, cancelling -exit-> ended, queued -cancel-> ended',
    !!T && T('queued', 'start') === 'running' && T('running', 'cancel') === 'cancelling' && T('cancelling', 'exit') === 'ended' && T('queued', 'cancel') === 'ended');
  check('table: refuses cancel of an ended job, a second exit, a start after a cancel', !!T && T('ended', 'cancel') === null && T('ended', 'exit') === null && T('cancelling', 'start') === null && T('cancelling', 'cancel') === null);
  // GUARD (holds today): cancel of an ended job, and a second cancel of a cancelling one, change nothing and append no line
  if (pj.ok) {
    const n0 = lines(P).length, before = JSON.stringify(get(M9, 'p9', pj.job.id));
    const again = M9.cancel('p9', pj.job.id);
    check('GUARD cancel of an ended job: returned unchanged, no journal line', JSON.stringify(again) === before && lines(P).length === n0, `${lines(P).length} vs ${n0}`);
  }
  const pj2 = M9.enqueueMeasure('p9', P, 'slow', SCOPE);
  if (pj2.ok && await until(() => (lastOf(P, pj2.job.id)?.pid ?? 0) > 0)) {
    spawned.push(lastOf(P, pj2.job.id)!.pid!);
    const first = M9.cancel('p9', pj2.job.id);
    const n1 = lines(P).length;
    const second = M9.cancel('p9', pj2.job.id);
    check('GUARD a second cancel while cancelling: same answer, no journal line', JSON.stringify(first) === JSON.stringify(second) && lines(P).length === n1, `${lines(P).length} vs ${n1}`);
  } else check('GUARD a second cancel while cancelling: the job starts', false);

  // 5. a legacy line (no phase): cancelled with a pid and no exit_code was a cancel in flight - read as cancelling
  const L = root('legacy');
  const lc = sleeper(); const lcPid = lc.pid!;
  const ls = sleeper(); const lsPid = ls.pid!;
  const tl = new Date().toISOString();
  fs.mkdirSync(path.dirname(jfile(L)), { recursive: true });
  fs.writeFileSync(jfile(L), [
    { at: tl, slug: 'pa', pid: lcPid, job: { ...relJob('j-leg-0010', 'rel-10.0.0', tl), status: 'cancelled', ended_at: tl } },
    { at: old, slug: 'pa', pid: lsPid, job: { ...relJob('j-leg-0011', 'rel-11.0.0', old), status: 'cancelled', ended_at: old } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const MA = await restart();
  MA.reconcileJobs('pa', L);
  check('legacy cancel line, fresh, live pid: adopted as cancelling (the release busy)', MA.releaseBusy('pa', 'rel-10.0.0') && get(MA, 'pa', 'j-leg-0010')?.status === 'cancelled');
  check('legacy cancel line, fresh, live pid: killed and reaped', await until(() => !alive(lcPid)) && await until(() => !MA.releaseBusy('pa', 'rel-10.0.0')));
  check('legacy cancel line, 13 h old: not adopted', !MA.releaseBusy('pa', 'rel-11.0.0') && get(MA, 'pa', 'j-leg-0011')?.status === 'cancelled');
  await sleep(600);
  check('legacy cancel line, 13 h old: its pid (a stranger by now) is never killed', alive(lsPid));

  // 6. prune keeps a cancelling job, and it still holds its slot
  const Q = root('prune');
  const qc = sleeper(), q1 = sleeper(), q2 = sleeper();
  const tq = Date.now();
  const iso = (i: number) => new Date(tq - 100_000 + i).toISOString();
  const qlines: object[] = [{ at: iso(0), slug: 'pb', pid: qc.pid, phase: 'cancelling', job: { ...base, id: 'j-q-cancel', status: 'cancelled', queued_at: iso(0), started_at: iso(0), ended_at: iso(0) } }];
  for (let i = 1; i <= 55; i++) qlines.push({ at: iso(i), slug: 'pb', pid: 1, phase: 'ended', job: { ...base, id: 'j-q-' + String(i).padStart(4, '0'), status: 'done', queued_at: iso(i), ended_at: iso(i), exit_code: 0, run_id: 'run-' + i } });
  for (const [n, c] of [[60, q1], [61, q2]] as const) qlines.push({ at: iso(n), slug: 'pb', pid: c.pid, phase: 'running', job: { ...base, id: 'j-q-run-' + n, status: 'running', queued_at: iso(n), started_at: iso(n) } });
  fs.mkdirSync(path.dirname(jfile(Q)), { recursive: true });
  fs.writeFileSync(jfile(Q), qlines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const MB = await restart();
  MB.reconcileJobs('pb', Q);
  check('prune: the cancelling job (the oldest) is kept over 55 finished ones', !!get(MB, 'pb', 'j-q-cancel') && MB.list('pb').length === MB.KEEP_JOBS, String(MB.list('pb').length));
  const fourth = MB.enqueueMeasure('pb', Q, 'slow', SCOPE);
  check('prune: the cancelling job still holds its slot (with two running, a 4th enqueue queues)', fourth.ok && fourth.job.status === 'queued', JSON.stringify(fourth));
  if (fourth.ok) MB.cancel('pb', fourth.job.id);
  MB.cancel('pb', 'j-q-run-60'); MB.cancel('pb', 'j-q-run-61');

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
