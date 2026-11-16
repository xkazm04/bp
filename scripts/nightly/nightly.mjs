// Nightly backlog run: builds a product's open XS/S/M proposals (lens-scan store) in feature batches with up to
// --workers parallel headless Claude builders, each in its own worktree. A gated, committed batch is cherry-picked
// into one integration branch, marked done in the store, and its rows are folded into the product's release-log
// groups. Deadline-aware; never pushes; kills only the processes it spawned (by pid), never by name or command line.
//
//   node scripts/nightly/nightly.mjs --root C:/Users/mkdol/refactoring [--until 08:00] [--last-start 06:30]
//        [--workers 5] [--sizes XS,S,M] [--skip-lens security] [--batch 6] [--max-batches N] [--dry] [--by operator:mkdol]
//
// State: <root>/.ai/lens-scan/work/nightly/state.json (ids tried and why they stopped), nightly.log.
// Worktrees: <root>/../gp-nightly (integration, branch spark/nightly-<date>) and gp-nightly-<n> (one per worker).
// The worker worktrees are scratch and are removed when the run ends (their branches stay). The integration worktree stays: it
// holds the night's result for review; once that branch is merged into --base, `scripts/worktree-sweep.ps1 -Apply` in the product
// checkout removes it.
import { DatabaseSync } from 'node:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, lstatSync, readdirSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : (argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[i + 1]); };
const ROOT = resolve(String(opt('root', '.')));
const SIZES = String(opt('sizes', 'XS,S,M')).split(',');
const SKIP_LENS = String(opt('skip-lens', 'security')).split(',');
const BATCH = Number(opt('batch', 6));
const MAX = Number(opt('max-batches', 1e9));
const WORKERS = Number(opt('workers', 5));
const BY = String(opt('by', 'operator:mkdol'));
const DRY = opt('dry', false) === true;
const SKILL = join(homedir(), 'dolla/ai-registry/skills/lens-scan/scripts/store.mjs').replace(/\\/g, '/');
const PY = join(ROOT, '.venv/Scripts/python.exe');
const STORE = join(ROOT, '.ai/lens-scan');
const WORK = join(STORE, 'work/nightly');
const INT = resolve(String(opt('worktree', join(ROOT, '..', 'gp-nightly'))));
const BASE = String(opt('base', 'initial/refactoring'));
const BRANCH = String(opt('branch', `spark/nightly-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`));

/** Today's or tomorrow's HH:MM as a Date: the first one still ahead of now. */
function clock(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  if (d.getTime() < Date.now() - 12 * 3600e3) d.setDate(d.getDate() + 1);
  return d;
}
const UNTIL = clock(opt('until', '08:00')), LAST = clock(opt('last-start', '06:30'));
const log = (...a) => { const l = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(l); try { mkdirSync(WORK, { recursive: true }); appendFileSync(join(WORK, 'nightly.log'), l + '\n'); } catch { /* log only */ } };
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });
const gitIn = (wt, ...a) => run('git', ['-C', wt, ...a]);
const store = (...a) => run('node', ['--no-warnings', SKILL, '--db', join(STORE, 'scan.db'), ...a]);

// Every child this process starts is tracked, so a shutdown ends exactly those and nothing else on the machine.
const kids = new Set();
function stopKids() { for (const pid of kids) spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)]); kids.clear(); }
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stopKids(); process.exit(130); });
/** An async child with stdin input and a timeout; resolves { status, stdout }. */
function runAsync(cmd, args, { cwd, input, timeout }) {
  return new Promise((done) => {
    const p = spawn(cmd, args, { cwd, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    kids.add(p.pid);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', () => {});
    const t = setTimeout(() => spawnSync('taskkill', ['/F', '/T', '/PID', String(p.pid)]), timeout);
    p.on('close', (status) => { clearTimeout(t); kids.delete(p.pid); done({ status, stdout: out }); });
    p.stdin.end(input);
  });
}
/** Serializes the integration branch: cherry-picks, store writes and consolidation run one at a time. */
let chain = Promise.resolve();
const exclusive = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

const statePath = join(WORK, 'state.json');
mkdirSync(WORK, { recursive: true });
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { tried: {} };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 1));
const inFlight = new Set(); // 'feature|lens' pairs a worker holds

function candidates() {
  const db = new DatabaseSync(join(STORE, 'scan.db'), { readOnly: true });
  const rows = db.prepare(`SELECT id, lens, feature, title, body, size, metric, status FROM proposals WHERE status IN ('proposed','approved') AND kind = 'fix'
    AND size IN (${SIZES.map(() => '?').join(',')}) AND lens NOT IN (${SKIP_LENS.map(() => '?').join(',')}) ORDER BY created_at, id`).all(...SIZES, ...SKIP_LENS);
  db.close();
  return rows.filter((r) => !state.tried[r.id]);
}
/** The next batch: the free (feature, lens) pair with the most open items, at most BATCH of them, smallest first. */
function nextBatch() {
  const by = new Map();
  for (const r of candidates()) { const k = `${r.feature}|${r.lens}`; if (inFlight.has(k)) continue; (by.get(k) ?? by.set(k, []).get(k)).push(r); }
  const best = [...by.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!best) return null;
  const rank = { XS: 0, S: 1, M: 2 };
  return { key: best[0], items: best[1].sort((a, b) => rank[a.size] - rank[b.size]).slice(0, BATCH) };
}

function ensureWorktree(wt, branch, from) {
  if (existsSync(wt)) return;
  const r = run('git', ['-C', ROOT, 'worktree', 'add', wt, '-B', branch, from]);
  if (r.status) throw new Error(`worktree ${wt}: ${r.stderr}`);
  // node_modules is not tracked: the frontend gate reads the main checkout's through a junction
  const nm = join(ROOT, 'frontend/node_modules');
  if (existsSync(nm) && !existsSync(join(wt, 'frontend/node_modules'))) run('cmd', ['/c', 'mklink', '/J', join(wt, 'frontend/node_modules').replace(/\//g, '\\'), nm.replace(/\//g, '\\')]);
}

/** Remove a worktree this run made. Its junctions (the frontend node_modules link) are unlinked first: `git worktree remove` walks
 *  into a junction and empties the main checkout's folder. The branch is kept, so no commit is lost. */
function removeWorktree(wt) {
  if (!existsSync(wt)) return;
  const nm = join(wt, 'frontend/node_modules');
  try { if (lstatSync(nm).isSymbolicLink()) rmdirSync(nm); } catch { /* none */ }
  const left = [];
  const walk = (d, depth) => { if (depth > 3) return; for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.name === '.git') continue; try { if (lstatSync(f).isSymbolicLink()) left.push(f); else if (e.isDirectory()) walk(f, depth + 1); } catch { /* vanished */ } } };
  try { walk(wt, 0); } catch { /* unreadable */ }
  if (left.length) { log(`worktree ${wt} kept: a link remains at ${left[0]}`); return; }
  const r = run('git', ['-C', ROOT, 'worktree', 'remove', '--force', wt]);
  log(r.status ? `worktree ${wt} not removed: ${r.stderr.trim().slice(-200)}` : `worktree ${wt} removed`);
}

const PROMPT = (batch) => `You are fixing a batch of backlog items from the lens-scan store of this repository, nightly and unattended. Nobody can answer questions: decide, and skip an item you cannot do safely.

Read CLAUDE.md first and obey it (module isolation, tenant and access rules, styleguide, help text and docs/features updates for what you change). Work only in this checkout.
Items (the same feature, one lens):
${batch.map((r) => `\n### ${r.id} [${r.size}] ${r.title}\n${r.body}`).join('\n')}

Rules:
- Make the smallest change that delivers each item, with a test where the item asks for one (unit tests for logic, API tests for endpoints, frontend tests for UI). A security vulnerability you stumble on is NOT yours: leave it and mention it.
- Do not run git add, commit, stash or checkout; the runner commits. Do not touch .ai/ or release-log/. Never stop or kill processes you did not start.
- Run the tests you wrote or changed with: ${PY} -m pytest <files> -q (backend) and, for frontend edits, the matching vitest file or \`npx tsc --noEmit -p frontend\`. A check that could not run is incomplete: say so.
- If two items ask for the same change, do it once and report both ids.
- Finish with exactly one last line of JSON: {"done":[{"id":"p-..","files":["..."],"summary":"one plain sentence of what changed for the user"}],"skipped":[{"id":"p-..","reason":"..."}]}`;

function gate(wt, files, batch) {
  const sizeM = batch.some((r) => r.size !== 'XS');
  state.sinceFull = (state.sinceFull ?? 0) + 1;
  const full = state.sinceFull >= 10;
  if (!sizeM && !full) return { ok: true, note: 'XS: gate skipped' };
  const out = [];
  const tests = files.filter((f) => /^tests\/.*test_.*\.py$/.test(f));
  if (tests.length) { const r = run(PY, ['-m', 'pytest', '-q', '-x', ...tests], { cwd: wt, timeout: 20 * 60e3 }); out.push(`pytest ${r.status}`); if (r.status) return { ok: false, note: (r.stdout + r.stderr).slice(-1500) }; }
  if (files.some((f) => f.startsWith('frontend/src/'))) { const r = run(join(wt, 'frontend/node_modules/.bin/tsc.cmd'), ['--noEmit', '-p', '.'], { cwd: join(wt, 'frontend'), timeout: 15 * 60e3, shell: true }); out.push(`tsc ${r.status}`); if (r.status) return { ok: false, note: (r.stdout + r.stderr).slice(-1500) }; }
  if (full) state.sinceFull = 0;
  return { ok: true, note: out.join(', ') || 'no checks matched' };
}

async function consolidate() {
  const prompt = `In this repository, release-log/data/groups.json lists curated groups per page and every delivered row must be listed exactly once (release-log/README.md, tool/build.py curated_groups). New proposals were delivered (status done in .ai/lens-scan/scan.db at ${STORE}, read-only: sqlite). Run \`${PY} release-log/tool/build.py --store ${STORE}\`; if it stops because rows are unlisted, add each new row to the existing group with the SAME AIM (same module and kind of change; prefer extending a group over creating one, create a new group only when none fits, keep groups near 10 items, merge near-duplicate rows' commits under one row where the build allows) and rebuild until it passes. Edit only release-log/data/*.json (not generated pages by hand). Do not run git and do not stop processes. End with one line: consolidated: <n rows into m groups, k new groups>.`;
  const r = await runAsync('claude', ['-p', '--dangerously-skip-permissions', '--model', 'claude-opus-5-5'], { cwd: INT, input: prompt, timeout: 40 * 60e3 });
  const rl = gitIn(INT, 'status', '--porcelain', '--', 'release-log').stdout.trim();
  if (rl) { gitIn(INT, 'add', '--', 'release-log'); gitIn(INT, 'commit', '-m', 'docs(release-log): fold the night\'s delivered items into the groups of their aim\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>'); }
  return r.stdout.trim().split('\n').pop();
}

/** The last pass, once the batches are done: one clean grouping and categorisation, and a Czech proofread. */
async function polish() {
  const prompt = `Final polish of the release log in this checkout (release-log/, read release-log/README.md and tool/glossary.cs.md first). Many items were delivered and folded into groups overnight; make the whole report clean and understandable.
1. Grouping and categories: review release-log/data/groups.json and areas.json. Merge groups with the same aim, split any far above about 10 items, give every group a clear plain title and a one-sentence "about" (en and cs), put every row on the page of its focus area, and fold near-duplicate rows (same aim, same module) under one row with all their commits. Never lose a row or a commit; every row is listed exactly once.
2. Czech proofread: every Czech text the night added or changed (data/plain.cs.json, data/strings.cs.json, data/evidence/*.json cs values, data/points/*.json cs bullets, the groups' cs titles). Native product copy: correct grammar and diacritics, the house terms and rulings of tool/glossary.cs.md (R1-R8), vykání without "Vy", the register and typography rules, no English left over. Keep placeholders, ICU plurals and code tokens unchanged.
3. Gates, all must pass: \`${PY} release-log/tool/build.py --store ${STORE}\`, \`${PY} release-log/tool/i18n_checks.py\`, \`${PY} -m pytest release-log/tool -q\`. Rebuild so the pages and data/model.json match the data.
Edit only release-log/data/*.json and tool/glossary.cs.md (never generated pages by hand). Do not run git, and do not stop processes. End with one line: polished: <groups before -> after, rows merged, cs texts fixed, gates>.`;
  const r = await runAsync('claude', ['-p', '--dangerously-skip-permissions', '--model', 'claude-opus-5-5'], { cwd: INT, input: prompt, timeout: Math.max(20 * 60e3, UNTIL.getTime() - Date.now()) });
  const rl = gitIn(INT, 'status', '--porcelain', '--', 'release-log').stdout.trim();
  if (rl) { gitIn(INT, 'add', '--', 'release-log'); gitIn(INT, 'commit', '-m', 'docs(release-log): final polish - one clean grouping and a Czech proofread\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>'); }
  return r.stdout.trim().split('\n').pop();
}

let started = 0, landedSinceCons = 0;

async function worker(n) {
  const wt = resolve(join(INT, '..', `gp-nightly-${n}`));
  ensureWorktree(wt, `${BRANCH}-w${n}`, BRANCH);
  while (started < MAX && Date.now() < LAST.getTime()) {
    const next = nextBatch(); if (!next) return;
    const { key, items: batch } = next; inFlight.add(key);
    const ids = batch.map((r) => r.id), num = ++started;
    try {
      gitIn(wt, 'reset', '--hard', BRANCH); gitIn(wt, 'clean', '-fdq');
      log(`[w${n}] batch ${num}: ${key} ${ids.join(',')}`);
      const budget = Math.max(5 * 60e3, Math.min(45 * 60e3, UNTIL.getTime() - Date.now() - 20 * 60e3));
      const r = await runAsync('claude', ['-p', '--dangerously-skip-permissions'], { cwd: wt, input: PROMPT(batch), timeout: budget });
      const report = (() => { try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return null; } })();
      const files = gitIn(wt, 'status', '--porcelain').stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
      const doneIds = new Set((report?.done ?? []).map((d) => d.id).filter((id) => ids.includes(id)));
      for (const s of report?.skipped ?? []) if (ids.includes(s.id)) state.tried[s.id] = `skipped: ${s.reason}`;
      const revert = () => { gitIn(wt, 'checkout', '--', '.'); gitIn(wt, 'clean', '-fdq'); gitIn(wt, 'reset', '--hard', BRANCH); };
      if (!files.length || !doneIds.size) { for (const id of ids) state.tried[id] ??= report ? 'no change' : `no report (exit ${r.status})`; revert(); save(); log(`[w${n}] nothing to land`); continue; }
      const g = gate(wt, files, batch);
      if (!g.ok) { for (const id of doneIds) state.tried[id] = `gate red: ${g.note.slice(-300)}`; revert(); save(); log(`[w${n}] gate red, reverted: ${g.note.slice(-200)}`); continue; }
      gitIn(wt, 'add', '--', ...files);
      const head = `fix(${batch[0].feature}): ${[...doneIds].map((id) => (report.done.find((d) => d.id === id)?.summary ?? id)).join('; ')}`.slice(0, 200);
      const msg = `${head}\n\nlens-scan ${batch[0].lens} proposals: ${[...doneIds].join(', ')}\nGate: ${g.note}\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`;
      const c = gitIn(wt, 'commit', '-m', msg);
      if (c.status) { log(`[w${n}] commit failed: ${c.stderr.slice(-300)}`); revert(); for (const id of doneIds) state.tried[id] = 'commit failed'; save(); continue; }
      const wsha = gitIn(wt, 'rev-parse', 'HEAD').stdout.trim();
      await exclusive(async () => {
        const p = gitIn(INT, 'cherry-pick', wsha);
        if (p.status) { gitIn(INT, 'cherry-pick', '--abort'); for (const id of doneIds) state.tried[id] = 'cherry-pick conflict'; save(); log(`[w${n}] cherry-pick conflict, batch left`); return; }
        const sha = gitIn(INT, 'rev-parse', '--short=9', 'HEAD').stdout.trim();
        store('decide', '--ids', [...doneIds].join(','), '--decision', 'approve', '--by', BY, '--note', 'nightly run');
        for (const id of doneIds) { store('proposal-update', '--id', id, '--status', 'done', '--result-sha', sha, '--commit-sha', sha); state.tried[id] = `done ${sha}`; }
        save(); log(`[w${n}] landed ${sha}: ${[...doneIds]} (${g.note})`);
        if (++landedSinceCons >= 4) { landedSinceCons = 0; log(`  ${await consolidate()}`); }
      });
    } catch (e) { log(`[w${n}] ERROR ${e.stack}`); for (const id of ids) state.tried[id] ??= `error: ${e.message}`; save(); }
    finally { inFlight.delete(key); }
  }
}

async function main() {
  log(`nightly start root=${ROOT} workers=${WORKERS} until=${UNTIL.toISOString()} last-start=${LAST.toISOString()} sizes=${SIZES} skip=${SKIP_LENS}${DRY ? ' DRY' : ''}`);
  if (DRY) { const b = nextBatch(); log(`open candidates ${candidates().length}; next batch`, b ? `${b.key}: ${b.items.map((r) => r.id + r.size)}` : 'none'); return; }
  ensureWorktree(INT, BRANCH, BASE);
  if (opt('polish-only', false) === true) { log(`  ${await polish()}`); return; }
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));
  for (let n = 1; n <= WORKERS; n++) removeWorktree(resolve(join(INT, '..', `gp-nightly-${n}`)));
  await exclusive(async () => { log(`  ${await consolidate()}`); });
  if (opt('polish', true) !== 'false') await exclusive(async () => { log(`  ${await polish()}`); });
  log(`nightly end after ${started} batches; branch ${BRANCH} at ${gitIn(INT, 'rev-parse', '--short', 'HEAD').stdout.trim()}`);
}
main().catch((e) => { log(`FATAL ${e.stack}`); stopKids(); process.exit(1); });
