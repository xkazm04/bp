// Checks what-already-landed (packages/core/src/scan/landed.ts landedOf, read from git by release.server.ts landings) on
// a temp git repo with a base commit, a pack branch and main:
//   1 trailer      a commit whose message ends `Lens-Item: <id>` lands that id, by trailer, at that commit
//   2 body line    a `Lens-Item:` line in a body paragraph (git's own %(trailers) misses it) lands it too
//   3 patch-id     a cherry-pick onto main whose message lost the line lands the item by patch-id, at the main commit
//   4 revert       `git revert` of a landing commit clears it, and its patch-id cannot bring it back; a revert of the
//                  revert restores it (pure)
//   5 no git, no ref: `unknown` with why, never "nothing landed"; the answer is cached by the base sha and moves with it
// Also: node scripts/check-landed.ts --root <repo> prints the landings of that repo's store and base (a read, no write).
// Run: node scripts/check-landed.ts   (Node type stripping; exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
const L = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/scan/landed.ts')).href) as typeof import('../packages/core/src/scan/landed.ts');
const R = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/release.server.ts')).href) as typeof import('../packages/core/src/server/release.server.ts');
type Scan = Parameters<typeof R.landings>[1];

const at = process.argv.indexOf('--root');
if (at >= 0) {
  const root = path.resolve(process.argv[at + 1] ?? '.');
  const S = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/store.server.ts')).href) as typeof import('../packages/core/src/server/store.server.ts');
  const scan = S.snapshotOf(path.join(root, '.ai/lens-scan/scan.db'));
  const l = await R.landings(root, scan);
  if (l.state !== 'known') { console.log(`landings on ${root}: unknown (${l.why})`); process.exit(0); }
  const ids = Object.keys(l.items).sort(), status = new Map(scan.proposals.map((p) => [p.id, p.status]));
  const by = (k: string) => ids.filter((i) => l.items[i].by === k).length;
  console.log(`landings on ${root} (${l.ref} at ${l.head.slice(0, 7)}): ${ids.length} (${by('trailer')} by trailer, ${by('patch-id')} by patch-id)`);
  const tally = new Map<string, number>();
  for (const i of ids) { const s = status.get(i) ?? 'not in the store'; tally.set(s, (tally.get(s) ?? 0) + 1); }
  console.log('  by store status: ' + [...tally].map(([s, n]) => `${s} ${n}`).join(', '));
  for (const i of ids) if (status.get(i) !== 'accepted') console.log(`  ${i} (${status.get(i) ?? 'not in the store'}) on ${l.ref} as ${l.items[i].sha.slice(0, 7)}, ${l.items[i].at.slice(0, 10)}`);
  process.exit(0);
}

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-landed-'));
try {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...a: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=bp-check', '-c', 'user.email=bp-check@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + r.stderr);
    return r.stdout.trim();
  };
  const write = (f: string, text: string) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), text); };
  const commit = (f: string, text: string, ...msg: string[]) => { write(f, text); git('add', f); git('commit', '-q', ...msg.flatMap((m) => ['-m', m])); return git('rev-parse', 'HEAD'); };
  git('init', '-q');
  git('checkout', '-q', '-b', 'main');
  const base = commit('src/base.ts', 'export const base = 0;\n', 'chore: the base');
  // the pack: item c is built on its branch, then lands on main with the line lost
  git('checkout', '-q', '-b', 'pack/dev-1');
  const cPack = commit('src/c.ts', 'export const c = 1;\nexport const cc = 2;\n', 'fix(c): the c change', 'Lens-Item: p-cccccc\nLens-Pack: k-dev-1');
  git('checkout', '-q', 'main');
  const a = commit('src/a.ts', 'export const a = 1;\n', 'fix(a): the a change', 'Lens-Item: p-aaaaaa\nLens-Pack: k-dev-1');
  const b = commit('src/b.ts', 'export const b = 1;\n', 'fix(b): the b change (#16)', 'Why it moved.', 'Lens-Item: p-bbbbbb\nLens-Pack: k-dev-1', 'Before moved since the proposal: a paragraph after the line.');
  git('cherry-pick', '-n', cPack);
  git('commit', '-q', '-m', 'squash: c, as the PR merged it');
  const cMain = git('rev-parse', 'HEAD');
  const d = commit('src/d.ts', 'export const d = 1;\n', 'fix(d): the d change', 'Lens-Item: p-dddddd');
  git('revert', '--no-edit', d);
  const dRevert = git('rev-parse', 'HEAD');

  const pack = { id: 'k-dev-1', lens: 'development', n: 1, branch: 'pack/dev-1', base_ref: 'main', base_sha: base, status: 'open', created_at: '2026-10-30T10:00:00.000Z', updated_at: '2026-10-30T10:00:00.000Z' };
  const prop = (id: string, sha: string, status = 'accepted') => ({ id, run_id: 'r1', feature: 'f', lens: 'development', title: id, kind: 'fix', status, created_at: '2026-10-30T10:00:00.000Z', updated_at: '2026-10-30T11:00:00.000Z', commit_sha: sha, pack_id: 'k-dev-1' });
  const scan = { packs: [pack], proposals: [prop('p-aaaaaa', a), prop('p-bbbbbb', b), prop('p-cccccc', cPack), prop('p-dddddd', d, 'failed')] } as unknown as Scan;

  const l = await R.landings(repo, scan);
  const items = l.state === 'known' ? l.items : {};
  const show = JSON.stringify(l);
  check('the answer is known, read at main\'s sha', l.state === 'known' && l.ref === 'main' && l.head === dRevert, show);
  check('1 trailer: p-aaaaaa lands at its commit, by trailer', items['p-aaaaaa']?.sha === a && items['p-aaaaaa'].by === 'trailer' && /^\d{4}-\d\d-\d\dT/.test(items['p-aaaaaa'].at), show);
  const gitTrailer = git('log', '-1', '--format=%(trailers:key=Lens-Item,valueonly)', b);
  check('2 body line: git\'s own trailer parser misses p-bbbbbb\'s line (the reason for reading the whole message)', gitTrailer === '', JSON.stringify(gitTrailer));
  check('2 body line: p-bbbbbb lands at its commit, by trailer', items['p-bbbbbb']?.sha === b && items['p-bbbbbb'].by === 'trailer', show);
  check('3 patch-id: p-cccccc (message lost the line) lands at the main commit, by patch-id', items['p-cccccc']?.sha === cMain && items['p-cccccc'].by === 'patch-id', show);
  check('4 revert: p-dddddd is not landed (its commit was reverted, and its patch-id cannot bring it back)', !('p-dddddd' in items), show);
  check('exactly the three landings', Object.keys(items).sort().join() === 'p-aaaaaa,p-bbbbbb,p-cccccc', Object.keys(items).join());
  check('landingOf reads a known answer, and nothing from an unknown one', L.landingOf(l, 'p-aaaaaa')?.sha === a && L.landingOf({ state: 'unknown', why: 'x' }, 'p-aaaaaa') === undefined && L.landingOf(null, 'p-aaaaaa') === undefined);

  // the pure half on git's own text: the same log, and the revert of the revert
  const log = git('log', '--format=' + L.LOG_FORMAT, base + '..main');
  const pure = L.landedOf(log);
  check('pure: landedOf over git log text gives the trailer landings (a, b; d reverted)', Object.keys(pure).sort().join() === 'p-aaaaaa,p-bbbbbb' && pure['p-aaaaaa'].sha === a, JSON.stringify(pure));
  const C = (sha: string, body: string, t: string) => ({ sha, at: t, body });
  const x = 'a'.repeat(40), rx = 'b'.repeat(40), rrx = 'c'.repeat(40);
  const chain = [C(rrx, `Revert "Revert ..."\n\nThis reverts commit ${rx}.\n`, '2026-10-30T03:00:00Z'), C(rx, `Revert "fix: x"\n\nThis reverts commit ${x.slice(0, 7)}.\nLens-Item: p-x\n`, '2026-10-30T02:00:00Z'), C(x, 'fix: x\n\nLens-Item: p-x\n', '2026-10-30T01:00:00Z')];
  check('pure: a revert (by a short sha) clears; a revert of that revert restores, at the first commit', L.landedOf(chain.slice(1))['p-x'] === undefined && L.landedOf(chain)['p-x']?.sha === x, JSON.stringify(L.landedOf(chain)));
  const twice = [C(rx, 'fix: x again\n\nLens-Item: p-x\n', '2026-10-30T02:00:00Z'), C(x, 'fix: x\n\nLens-Item: p-x\n', '2026-10-30T01:00:00Z')];
  check('pure: an id named twice lands at its earliest commit', L.landedOf(twice)['p-x']?.sha === x);
  check('pure: a "Lens-Item:" not at a line start names nothing', Object.keys(L.landedOf([C(x, 'fix: x\n\nsee Lens-Item: p-y\n', '2026-10-30T01:00:00Z')])).length === 0);
  check('baseOf: the oldest pack\'s ref and base sha; no pack reads HEAD', JSON.stringify(L.baseOf([{ ...pack, id: 'k-2', created_at: '2026-10-31T00:00:00Z', base_ref: 'dev', base_sha: x }, pack])) === JSON.stringify({ ref: 'main', since: base }) && JSON.stringify(L.baseOf([])) === JSON.stringify({ ref: 'HEAD' }));

  // the answer moves with the base, and a root git cannot read is unknown
  const e = commit('src/e.ts', 'export const e = 1;\n', 'fix(e): the e change', 'Lens-Item: p-eeeeee');
  const l2 = await R.landings(repo, scan);
  check('a new main commit is read on the next ask (cached by the base sha)', l2.state === 'known' && l2.head === e && l2.items['p-eeeeee']?.sha === e && l2.items['p-cccccc']?.sha === cMain, JSON.stringify(l2));
  const nogit = path.join(dir, 'nogit');
  fs.mkdirSync(nogit);
  // a ceiling at the temp dir: git must not find a repository above it
  process.env.GIT_CEILING_DIRECTORIES = dir;
  const l3 = await R.landings(nogit, scan);
  check('5 a root with no git -> unknown, "not a git repository" (never nothing landed)', l3.state === 'unknown' && /not a git repository/.test(l3.why), JSON.stringify(l3));
  const l4 = await R.landings(repo, { ...scan, packs: [{ ...pack, base_ref: 'trunk' }] } as Scan);
  check('5 a base ref the repo lacks -> unknown, naming it', l4.state === 'unknown' && /no trunk/.test(l4.why), JSON.stringify(l4));
} finally {
  delete process.env.GIT_CEILING_DIRECTORIES;
  fs.rmSync(dir, { recursive: true, force: true });
}

if (failed) { console.log(`check-landed: ${failed} failed, ${passed} passed`); process.exit(1); }
console.log(`check-landed: ${passed} passed`);
