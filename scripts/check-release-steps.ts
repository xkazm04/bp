// Checks the one release step table (packages/core/src/scan/release-steps.ts): where a build or finish may start, where it
// lands, and what an abandoned cut becomes, said once and read by the route, the job runner, the Kettle sim and the UI table.
//   (1) canStart(step, status) over the 6 statuses: build exactly from draft and failed, finish exactly from pr-open and merged;
//   (2) reached(step, status): build exactly at pr-open, merged and tagged, finish exactly at tagged;
//   (3) 12 cells (step x status): TrainSim.startable and the live route (release-job.ts startRelease) refuse 409 exactly
//       where canStart is false, both with the words "<id> is <s>; <step> starts from ..." (gh is signed out on the live
//       side, so a cell that may start answers 412 rather than queueing a job);
//   (4) a release job whose CLI leaves the row at s and exits 0 (s = building, pr-open, merged, tagged, failed; step build
//       and finish) ends done iff reached(step, s), and TrainSim.end agrees on the same (step, s);
//   (5) a cancelled build job whose row is building -> the row failed with a reason, written by store.mjs
//       `release-update --status failed --from building` (a logging shim in front of the real store.mjs proves the door);
//       when store.mjs refuses (the row moved on to pr-open) the row is left as it is and nothing is warned;
//   (6) no `UPDATE releases` anywhere in packages/core/src: the blueprint never writes a release transition itself;
//   (7) releaseState.ts RELEASE_STATE: statuses whose actions include build or retry -> exactly STEP_FROM.build; statuses
//       whose actions include finish or finishAsk -> exactly STEP_FROM.finish.
// The live half runs the real job registry over stand-in Claude Code CLIs written here; (5) needs lens-scan's store.mjs
// (resolved as release.server.ts resolves it): missing is a FAILURE when CI or BP_REQUIRE_LENS_SCAN=1 says so, else a SKIP
// that says so. Run: node scripts/check-release-steps.ts (Node's type stripping). Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT); // resolves '@/' and '@bp/core'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const load = (rel: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, rel)).href);

let failed = 0, passed = 0, skipped = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 20000): Promise<boolean> { const t = Date.now() + ms; while (Date.now() < t) { if (pred()) return true; await sleep(50); } return pred(); }

const STATUSES = ['draft', 'building', 'pr-open', 'merged', 'tagged', 'failed'] as const;
const STEPS = ['build', 'finish'] as const;
const set = (xs: readonly string[]) => [...xs].sort().join(',');

let S: Any = null;
try { S = await load('packages/core/src/scan/release-steps.ts'); } catch (e) { check('release-steps.ts loads', false, (e as Error).message.split('\n')[0]); }
const { TrainSim } = await load('packages/core/src/model/train-sim.ts');
const J = await load('packages/core/src/server/jobs.server.ts');
const RS = await load('packages/core/src/server/release.server.ts');
const RJ = await load('packages/core/src/server/api/products/[slug]/releases/[id]/release-job.ts');
const { RELEASE_STATE } = await load('apps/web/src/components/ledger/train/release/releaseState.ts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-release-steps-'));
const cwd0 = process.cwd(), env0 = { ...process.env };
const warns: string[] = [];
const warn0 = console.warn;
console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };

try {
  // ------------------------------------------------------------------ (1) (2) the table
  if (S) {
    for (const step of STEPS) {
      const can = STATUSES.filter((s) => S.canStart(step, s)), at = STATUSES.filter((s) => S.reached(step, s));
      check(`canStart ${step} -> exactly ${step === 'build' ? 'draft, failed' : 'pr-open, merged'}`, set(can) === set(step === 'build' ? ['draft', 'failed'] : ['pr-open', 'merged']), can.join());
      check(`STEP_FROM.${step} is canStart's set`, set(S.STEP_FROM[step]) === set(can), String(S.STEP_FROM[step]));
      check(`reached ${step} -> exactly ${step === 'build' ? 'pr-open, merged, tagged' : 'tagged'}`, set(at) === set(step === 'build' ? ['pr-open', 'merged', 'tagged'] : ['tagged']), at.join());
    }
  }

  // ------------------------------------------------------------------ a TrainSim with no sample: releases put in by hand
  const host = () => ({ now: () => Date.parse('2026-10-15T12:00:00.000Z'), runs: [], ms: [], act: [], props: [], pAt: new Map(), nextMeasurement: () => 1, nextActivity: () => 1, field: () => undefined, changed: () => {} });
  const relRow = (id: string, status: string): Any => ({ id, version: id.slice(4), branch: 'release/' + id.slice(4), status, created_at: '2026-10-15T12:00:00.000Z', updated_at: '2026-10-15T12:00:00.000Z' });

  // ------------------------------------------------------------------ (3) 12 cells: the sim and the live route
  const words = (id: string, s: string, step: string) => `${id} is ${s}; ${step} starts from ${(step === 'build' ? ['draft', 'failed'] : ['pr-open', 'merged']).join(' or ')}`;
  const ghFake = path.join(dir, 'fake-gh.mjs');
  fs.writeFileSync(ghFake, "if (process.env.FAKE_GH_OUT === '1') { console.error('You are not logged into any GitHub hosts.'); process.exit(1); }\nif (process.argv[2] === 'api') console.log('octocat');\nprocess.exit(0);\n");
  process.env.BP_GH_BIN = ghFake;
  process.env.FAKE_GH_OUT = '1';
  const proot = path.join(dir, 'cells'), pdb = path.join(proot, '.ai/lens-scan/scan.db');
  const newStore = (file: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
    return db;
  };
  const insert = (db: DatabaseSync, id: string, status: string) => {
    const r = relRow(id, status);
    db.prepare('INSERT INTO releases (id, version, branch, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(r.id, r.version, r.branch, r.status, r.created_at, r.updated_at);
  };
  {
    const db = newStore(pdb);
    for (const s of STATUSES) insert(db, `rel-1.0.0-${s}`, s);
    db.close();
  }
  fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products: [{ slug: 'cells', name: 'cells', root: proot }, { slug: 'jobs', name: 'jobs', root: path.join(dir, 'jobs') }] }));
  process.chdir(dir);
  const sim = new TrainSim(host());
  for (const s of STATUSES) sim.releases.push(relRow(`rel-1.0.0-${s}`, s));
  for (const step of STEPS) for (const s of STATUSES) {
    const id = `rel-1.0.0-${s}`, may = S ? !!S.canStart(step, s) : step === 'build' ? s === 'draft' || s === 'failed' : s === 'pr-open' || s === 'merged';
    let simErr: Any = null;
    try { sim.startable(id, step); } catch (e) { simErr = e; }
    const live = await RJ.startRelease(new Request('http://localhost:3000/x', { method: 'POST' }), Promise.resolve({ slug: 'cells', id }), step);
    const body = await live.json();
    const cell = `${step} from ${s}`;
    if (may) check(`cell ${cell}: the sim starts it and the route does not refuse it 409`, !simErr && live.status === 412, `${simErr?.status ?? 'ok'} / ${live.status}`);
    else check(`cell ${cell}: both refuse 409 with "${words(id, s, step)}"`, simErr?.status === 409 && simErr.body?.error === words(id, s, step) && live.status === 409 && body.error === words(id, s, step),
      `${simErr?.status}:${simErr?.body?.error} / ${live.status}:${body.error}`);
  }
  delete process.env.FAKE_GH_OUT;

  // ------------------------------------------------------------------ (4) where a job lands: the live runner and the sim
  // A stand-in CLI that moves the row to the status its version names (`-to-<status>`) and exits 0, or (`-hang`) moves it and hangs.
  const fake = path.join(dir, 'fake-claude-lands.mjs');
  fs.writeFileSync(fake, [
    "import { DatabaseSync } from 'node:sqlite';",
    "let input = ''; process.stdin.setEncoding('utf8'); for await (const c of process.stdin) input += c;",
    "const rid = /--id (\\S+)/.exec(input)?.[1] ?? '';",
    "const to = /-to-([a-z-]+?)(?:-hang)?$/.exec(rid)?.[1] ?? 'draft';",
    "const db = new DatabaseSync(process.cwd() + '/.ai/lens-scan/scan.db', { timeout: 5000 });",
    "db.prepare('UPDATE releases SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(to, to === 'failed' ? 'lands fake: failed' : null, new Date().toISOString(), rid); db.close();",
    "console.log('moved ' + rid + ' to ' + to);",
    "if (rid.endsWith('-hang')) await new Promise((r) => setTimeout(r, 120000));",
  ].join('\n'));
  process.env.BP_CLAUDE_BIN = fake;
  const jroot = path.join(dir, 'jobs'), jdb = path.join(jroot, '.ai/lens-scan/scan.db');
  const LANDS = ['building', 'pr-open', 'merged', 'tagged', 'failed'] as const;
  const cells: { step: string; s: string; id: string; v: string }[] = [];
  {
    const db = newStore(jdb);
    let n = 0;
    for (const step of STEPS) for (const s of LANDS) {
      const v = `2.${n++}.0-${step}-to-${s}`, id = 'rel-' + v;
      insert(db, id, step === 'build' ? 'draft' : 'pr-open');
      cells.push({ step, s, id, v });
    }
    db.close();
  }
  const started = cells.map((c) => ({ c, e: J.enqueueRelease('jobs', jroot, c.id, c.v, c.step) }));
  const jobOf = (id: string): Any => J.list('jobs').find((j: Any) => j.id === id);
  await until(() => started.every(({ e }) => e.ok && ['done', 'failed'].includes(jobOf(e.job.id)?.status)), 60000);
  for (const { c, e } of started) {
    const j = e.ok ? jobOf(e.job.id) : undefined;
    const want = c.step === 'build' ? ['pr-open', 'merged', 'tagged'].includes(c.s) : c.s === 'tagged';
    const reachedSays = S ? !!S.reached(c.step, c.s) : want;
    check(`live ${c.step} left at ${c.s} -> ${want ? 'done' : 'failed'}, as reached says`, (j?.status === 'done') === want && reachedSays === want && ['done', 'failed'].includes(j?.status), `${j?.status} ${j?.error ?? ''}`);
    const ts = new TrainSim(host());
    ts.releases.push(relRow(c.id, c.step === 'build' ? 'draft' : 'pr-open'));
    const sjob = { id: 'j-sim-' + c.v, kind: 'release', release: c.id, version: c.v, step: c.step, status: 'running', queued_at: '' };
    ts.begin(sjob, 'run-x', { ghOff: false, conflict: false, gateFails: false });
    ts.releases[0] = { ...ts.releases[0], status: c.s };
    const end = ts.end(sjob);
    check(`sim ${c.step} left at ${c.s} -> ${want ? 'done' : 'an error'}, agreeing with the live job`, !end.error === want && (j?.status === 'done') === !end.error, JSON.stringify(end));
  }

  // ------------------------------------------------------------------ (5) a cancelled build fails its row through store.mjs
  const real = RS.storeScript();
  const required = process.env.BP_REQUIRE_LENS_SCAN === '1' || !!process.env.CI;
  if (!real) {
    if (required) check('store.mjs is installed (lens-scan)', false, 'none of lensScanDirs() holds scripts/store.mjs');
    else { skipped++; console.log('SKIP (5) the cancelled build through store.mjs: lens-scan is not installed here (set BP_LENS_SCAN_DIR)'); }
  } else {
    const shimDir = path.join(dir, 'lens-scan-shim'), shimLog = path.join(dir, 'store-calls.log');
    fs.mkdirSync(path.join(shimDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(shimDir, 'scripts', 'store.mjs'), [
      "import fs from 'node:fs';",
      "import { spawnSync } from 'node:child_process';",
      `fs.appendFileSync(${JSON.stringify(shimLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
      `const r = spawnSync(process.execPath, ['--no-warnings', ${JSON.stringify(real)}, ...process.argv.slice(2)], { encoding: 'utf8' });`,
      "process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? ''); process.exit(r.status ?? 1);",
    ].join('\n'));
    process.env.BP_LENS_SCAN_DIR = shimDir;
    const croot = path.join(dir, 'cancel'), cdb = path.join(croot, '.ai/lens-scan/scan.db');
    { const db = newStore(cdb); insert(db, 'rel-3.0.0-to-building-hang', 'draft'); insert(db, 'rel-3.0.1-to-pr-open-hang', 'draft'); db.close(); }
    const row = (id: string): Any => { const db = new DatabaseSync(cdb, { readOnly: true }); try { return db.prepare('SELECT status, error FROM releases WHERE id = ?').get(id); } finally { db.close(); } };
    const calls = () => (fs.existsSync(shimLog) ? fs.readFileSync(shimLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]) : []);
    const updateOf = (id: string) => calls().find((a) => a.includes('release-update') && a[a.indexOf('--release') + 1] === id);
    const flag = (a: string[] | undefined, f: string) => (a ? a[a.indexOf(f) + 1] : undefined);

    const a = J.enqueueRelease('cancel', croot, 'rel-3.0.0-to-building-hang', '3.0.0-to-building-hang', 'build');
    check('cancel: the cut moved the row to building', await until(() => row('rel-3.0.0-to-building-hang')?.status === 'building'), row('rel-3.0.0-to-building-hang')?.status);
    if (a.ok) J.cancel('cancel', a.job.id);
    const ua = await until(() => row('rel-3.0.0-to-building-hang')?.status === 'failed', 15000);
    const ca = updateOf('rel-3.0.0-to-building-hang');
    check('a cancelled build job whose row is building -> the row failed, with a reason', ua && !!row('rel-3.0.0-to-building-hang')?.error, JSON.stringify(row('rel-3.0.0-to-building-hang')));
    check('...written by store.mjs release-update --status failed --from building --error <why>', !!ca && flag(ca, '--status') === 'failed' && flag(ca, '--from') === 'building' && !!flag(ca, '--error') && flag(ca, '--error') === row('rel-3.0.0-to-building-hang')?.error, JSON.stringify(calls()));

    const b = J.enqueueRelease('cancel', croot, 'rel-3.0.1-to-pr-open-hang', '3.0.1-to-pr-open-hang', 'build');
    check('moved on: the cut moved the row to pr-open', await until(() => row('rel-3.0.1-to-pr-open-hang')?.status === 'pr-open'), row('rel-3.0.1-to-pr-open-hang')?.status);
    const w0 = warns.length;
    if (b.ok) J.cancel('cancel', b.job.id);
    const asked = await until(() => !!updateOf('rel-3.0.1-to-pr-open-hang'), 15000);
    await sleep(500); // the refusal's answer is read after the call: give a warning the time to appear
    check('a cancelled build job whose row moved on: store.mjs is asked and refuses, the row stays pr-open', asked && row('rel-3.0.1-to-pr-open-hang')?.status === 'pr-open', JSON.stringify(row('rel-3.0.1-to-pr-open-hang')));
    check('...and nothing is warned', warns.slice(w0).filter((l) => /rel-3\.0\.1/.test(l)).length === 0, JSON.stringify(warns.slice(w0)));
  }

  // ------------------------------------------------------------------ (6) no direct release write in core
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const hits = walk(path.join(ROOT, 'packages/core/src')).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f)).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [f, i + 1, l] as const)).filter(([, , l]) => /UPDATE releases/.test(l));
  check('grep "UPDATE releases" over packages/core/src -> 0 matches', hits.length === 0, hits.map(([f, n]) => path.relative(ROOT, f) + ':' + n).join(', '));

  // ------------------------------------------------------------------ (7) the UI action table agrees with the step table
  const offering = (acts: string[]) => STATUSES.filter((s) => (RELEASE_STATE[s].actions as string[]).some((x) => acts.includes(x)));
  check('RELEASE_STATE: statuses offering build or retry -> exactly STEP_FROM.build (draft, failed)', !!S && set(offering(['build', 'retry'])) === set(S.STEP_FROM.build), offering(['build', 'retry']).join());
  check('RELEASE_STATE: statuses offering finish or finishAsk -> exactly STEP_FROM.finish (pr-open, merged)', !!S && set(offering(['finish', 'finishAsk'])) === set(S.STEP_FROM.finish), offering(['finish', 'finishAsk']).join());
} finally {
  for (const slug of ['cells', 'jobs', 'cancel']) for (const j of J.list(slug)) if (j.status === 'queued' || j.status === 'running') J.cancel(slug, j.id);
  console.warn = warn0;
  process.chdir(cwd0);
  for (const k of ['BP_CLAUDE_BIN', 'BP_GH_BIN', 'FAKE_GH_OUT', 'BP_LENS_SCAN_DIR']) if (env0[k] === undefined) delete process.env[k]; else process.env[k] = env0[k];
  await sleep(300);
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a dying child still holds a file */ }
}

console.log(failed ? `check-release-steps: ${failed} failed, ${passed} passed${skipped ? `, ${skipped} skipped` : ''}` : `check-release-steps: ${passed} checks passed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
