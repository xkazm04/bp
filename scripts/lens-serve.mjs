#!/usr/bin/env node
// Build and serve bp's web app for a measurement (lens-scan's `## Gates`, `## Harness` and `## Probes`, and bundle stats)
// from ANY checkout: the main one, a builder worktree or a lens-scan pack worktree.
//
//   node scripts/lens-serve.mjs build [--dist .next-lens]          the production build (Turbopack `next build apps/web`)
//   node scripts/lens-serve.mjs start --port <n> [--dist .next-lens] [--no-build]
//                                                                  build when stale, then `next start` on 127.0.0.1:<n>
//   node scripts/lens-serve.mjs where [--dist .next-lens]          print the build root and dist dir, build nothing
//
// Why a mirror: a worktree's node_modules is a link (or per-entry junctions) into the main checkout, and Turbopack
// refuses to resolve packages outside its root (turbopack.root is derived from apps/web/next.config.ts, so it is the
// checkout the config sits in: `next build <worktree>/apps/web` run from the main root fails the same way, measured
// 2026-10-30), and the webpack builder cannot parse the sample's .jsonl import. So when <root>/node_modules/next is a
// link, the checkout's own files (tracked + untracked, not ignored; apps/vr left out) are mirrored into
// $TMPDIR/bp-lens/<checkout>-<hash>/ with a real copy of the main checkout's node_modules whose @bp/* junctions point
// into the MIRROR, and the build runs there. A real node_modules (the main checkout) builds in place. Either way the
// app built is this checkout's source, and the tsconfig include `next build` appends is put back afterwards.
//
// The build is skipped when its stamp (every mirrored file's path, size and mtime, the lockfile and the dist dir) is
// unchanged since the last build. `start` runs `next start` as its child with stdio inherited and exits with it; kill
// the process tree (harness.py does; `node scripts/kill-port.mjs <n>` by hand). Prints one JSON line on stderr per
// step ({"lens-serve": ...}) so a caller's stdout stays the server's.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIST = opt('--dist', '.next-lens');
if (!/^\.next[\w.-]*$/.test(DIST)) fail(`--dist must look like .next-<x> (gitignored as .next-*/): ${DIST}`, 2);
const say = (o) => process.stderr.write(JSON.stringify({ 'lens-serve': o }) + '\n');
function fail(msg, code = 1) { process.stderr.write(`lens-serve: ${msg}\n`); process.exit(code); }

// lstat reports a Windows junction as a symbolic link too
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const linked = isLink(path.join(ROOT, 'node_modules', 'next')) || isLink(path.join(ROOT, 'node_modules'));
const MIRROR = path.join(os.tmpdir(), 'bp-lens', path.basename(ROOT) + '-' + createHash('sha1').update(ROOT.toLowerCase()).digest('hex').slice(0, 8));
const BUILD_ROOT = linked ? MIRROR : ROOT;
const WEB = path.join(BUILD_ROOT, 'apps', 'web');
const DIST_ABS = path.join(WEB, DIST);

function sourceFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const files = out.split('\0').filter((f) => f && !f.startsWith('apps/vr/') && fs.existsSync(path.join(ROOT, f)));
  // runtime config the server reads from its cwd (gitignored, machine-local): the products a live `?product=` opens
  for (const f of ['bp.products.local.json']) if (fs.existsSync(path.join(ROOT, f))) files.push(f);
  return [...new Set(files)].sort();
}

function syncMirror(files) {
  fs.mkdirSync(MIRROR, { recursive: true });
  const listFile = path.join(MIRROR, '.lens-serve-files.json');
  const before = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : [];
  const keep = new Set(files);
  let copied = 0, removed = 0;
  for (const f of before) if (!keep.has(f)) { fs.rmSync(path.join(MIRROR, f), { force: true }); removed++; }
  for (const f of files) {
    const s = fs.statSync(path.join(ROOT, f)); if (!s.isFile()) continue;
    const d = path.join(MIRROR, f);
    let same = false;
    try { const t = fs.statSync(d); same = t.size === s.size && Math.abs(t.mtimeMs - s.mtimeMs) < 2; } catch { /* absent */ }
    if (same) continue;
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), d); fs.utimesSync(d, s.atime, s.mtime); copied++;
  }
  fs.writeFileSync(listFile, JSON.stringify(files));
  // node_modules: a real copy of the main checkout's, refreshed when the lockfile changes; @bp/* point into the mirror
  const srcNm = path.dirname(fs.realpathSync(path.join(ROOT, 'node_modules', 'next')));
  const nm = path.join(MIRROR, 'node_modules');
  const lockHash = hashFile(path.join(ROOT, 'package-lock.json'));
  const lockStamp = path.join(nm, '.lens-serve-lock');
  let nmCopied = false;
  if (!fs.existsSync(lockStamp) || fs.readFileSync(lockStamp, 'utf8') !== lockHash) {
    fs.rmSync(nm, { recursive: true, force: true });
    fs.cpSync(srcNm, nm, { recursive: true, filter: (src) => path.relative(srcNm, src).split(path.sep)[0] !== '@bp' });
    fs.writeFileSync(lockStamp, lockHash); nmCopied = true;
  }
  const scope = path.join(nm, '@bp');
  fs.mkdirSync(scope, { recursive: true });
  for (const ws of ['apps', 'packages']) {
    const dir = path.join(MIRROR, ws); if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const pj = path.join(dir, name, 'package.json'); if (!fs.existsSync(pj)) continue;
      const pkg = JSON.parse(fs.readFileSync(pj, 'utf8')).name || '';
      if (!pkg.startsWith('@bp/')) continue;
      const link = path.join(scope, pkg.slice(4));
      try { if (fs.realpathSync(link) === fs.realpathSync(path.join(dir, name))) continue; } catch { /* absent or dangling */ }
      fs.rmSync(link, { recursive: true, force: true });
      fs.symlinkSync(path.join(dir, name), link, 'junction');
    }
  }
  return { copied, removed, nmCopied };
}

function hashFile(p) { return fs.existsSync(p) ? createHash('sha1').update(fs.readFileSync(p)).digest('hex') : 'none'; }

// what the web build reads: the app, the workspace packages, the root manifests (a probe or overlay edit is no rebuild)
const BUILD_INPUT = /^(apps\/web\/|apps\/server\/|packages\/|package\.json$|package-lock\.json$|tsconfig[^/]*\.json$|bp\.products\.local\.json$)/;
function stampOf(files) {
  const h = createHash('sha1').update(DIST).update(hashFile(path.join(ROOT, 'package-lock.json')));
  for (const f of files.filter((x) => BUILD_INPUT.test(x))) { const s = fs.statSync(path.join(ROOT, f)); h.update(f + '\0' + s.size + '\0' + Math.round(s.mtimeMs) + '\n'); }
  return h.digest('hex');
}

function build() {
  const files = sourceFiles();
  const stamp = stampOf(files);
  const stampFile = path.join(DIST_ABS, 'lens-serve.stamp');
  if (fs.existsSync(path.join(DIST_ABS, 'BUILD_ID')) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp) {
    say({ step: 'build', skipped: 'unchanged since the last build', root: ROOT, build_root: BUILD_ROOT, dist: DIST });
    return;
  }
  const t0 = Date.now();
  if (linked) say({ step: 'mirror', mirror: MIRROR, ...syncMirror(files), ms: Date.now() - t0 });
  const tsconfig = path.join(WEB, 'tsconfig.json');
  const tsBefore = fs.readFileSync(tsconfig);
  const t1 = Date.now();
  const r = spawnSync(process.execPath, [path.join(BUILD_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build', 'apps/web'],
    { cwd: BUILD_ROOT, stdio: ['ignore', process.stderr, process.stderr], env: { ...process.env, NEXT_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: '1' } });
  if (!fs.readFileSync(tsconfig).equals(tsBefore)) fs.writeFileSync(tsconfig, tsBefore); // next build appends <dist>/types to include
  if (r.status !== 0) fail(`next build failed (exit ${r.status}) in ${BUILD_ROOT}`);
  fs.writeFileSync(stampFile, stamp);
  say({ step: 'build', root: ROOT, build_root: BUILD_ROOT, mirrored: linked, dist: DIST, ms: Date.now() - t1 });
}

function start() {
  const port = Number(opt('--port', ''));
  if (!Number.isInteger(port) || port < 1024) fail('start needs --port <n>', 2);
  if (!argv.includes('--no-build')) build();
  else if (!fs.existsSync(path.join(DIST_ABS, 'BUILD_ID'))) fail(`no build at ${DIST_ABS}; run without --no-build`);
  say({ step: 'start', port, build_root: BUILD_ROOT, dist: DIST });
  const child = spawn(process.execPath, [path.join(BUILD_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', 'apps/web', '-p', String(port), '-H', '127.0.0.1'],
    { cwd: BUILD_ROOT, stdio: 'inherit', env: { ...process.env, NEXT_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: '1' } });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => child.kill());
  child.on('exit', (code) => process.exit(code ?? 1));
}

if (cmd === 'build') build();
else if (cmd === 'start') start();
else if (cmd === 'where') process.stdout.write(JSON.stringify({ root: ROOT, build_root: BUILD_ROOT, mirrored: linked, web: WEB, dist: DIST_ABS }) + '\n');
else fail('usage: node scripts/lens-serve.mjs build|start --port <n>|where [--dist .next-lens] [--no-build]', 2);
