#!/usr/bin/env node
// Per-feature client bundle attribution from a real production build (lens-scan's `bundle_stats`, metric bundleKb).
//
//   node scripts/lens-bundle-stats.mjs [--structure .ai/lens-scan/app-structure.json] [--route /] [--dist .next-lens]
//                                      [--out .ai/lens-scan/bundle-stats.json]
//
// 1. builds this checkout when stale (scripts/lens-serve.mjs build: Turbopack, a scratch mirror for a worktree);
// 2. runs Turbopack's own analyzer over that build's module graph, same config and dist dir (`next analyze -o apps/web`,
//    ~10 s), which records every chunk part the route's client output holds: its source module and its byte size
//    (minified, before transfer compression; the sum over the route equals Next's own route summary, checked below);
// 3. attributes each client part of the route (its first-load chunks AND its async chunks: a lazy panel is still that
//    feature's cost when opened; JS, CSS and emitted media) to the features whose context file_paths own its source
//    file (the structure's features -> contexts -> file_paths; a directory entry owns everything under it).
// A part no feature owns (node_modules, Next's runtime) is reported under `unowned`, never spread over the features.
// A file two features share counts for both (named in `shared_files`). Writes the stats file and prints one JSON line
// per feature with client bytes: {"feature","metric":"bundleKb","value","unit":"KB","method":"static","evidence"}.
// Features with none print nothing (no row: unmeasured, never 0). Exit 1 when the build or the analyzer fails or the
// attribution does not add up to the route's own total.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIST = opt('--dist', '.next-lens');
const ROUTE = opt('--route', '/');
const STRUCTURE = path.resolve(ROOT, opt('--structure', '.ai/lens-scan/app-structure.json'));
const OUT = path.resolve(ROOT, opt('--out', '.ai/lens-scan/bundle-stats.json'));
const fail = (m) => { process.stderr.write('lens-bundle-stats: ' + m + '\n'); process.exit(1); };

if (!fs.existsSync(STRUCTURE)) fail(`no structure at ${STRUCTURE} (lens-scan phase 1 writes it; pass --structure)`);
const serve = path.join(ROOT, 'scripts', 'lens-serve.mjs');
const b = spawnSync(process.execPath, [serve, 'build', '--dist', DIST], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
if (b.status !== 0) fail('the build failed');
const where = JSON.parse(execFileSync(process.execPath, [serve, 'where', '--dist', DIST], { cwd: ROOT, encoding: 'utf8' }));
const buildRoot = where.build_root;
const a = spawnSync(process.execPath, [path.join(buildRoot, 'node_modules', 'next', 'dist', 'bin', 'next'), 'analyze', '-o', 'apps/web'],
  { cwd: buildRoot, stdio: ['ignore', process.stderr, process.stderr], env: { ...process.env, NEXT_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: '1' } });
if (a.status !== 0) fail(`next analyze failed (exit ${a.status})`);

const dataDir = path.join(where.dist, 'diagnostics', 'analyze', 'data');
const routeDir = ROUTE === '/' ? dataDir : path.join(dataDir, ...ROUTE.split('/').filter(Boolean));
const buf = fs.readFileSync(path.join(routeDir, 'analyze.data'));
const head = JSON.parse(buf.subarray(4, 4 + buf.readUInt32BE(0)).toString('utf8')); // a length-prefixed JSON header
if (head.schema_version !== 1) fail(`analyze.data schema ${head.schema_version}, this reader knows 1`);
const S = head.sources;
const pathOf = (i) => { const p = []; while (i != null && i >= 0 && S[i]) { p.unshift(S[i].path); i = S[i].parent_source_index; } return p.join(''); };
const clientFiles = new Set(head.output_files.map((o, i) => (o.filename.includes('/_next/static/') || o.filename.includes('/static/') ? i : -1)).filter((i) => i >= 0));

// the source module -> its repo-relative file: '[project]/packages/core/data/x.json.[json].cjs' -> 'packages/core/data/x.json'
const repoFile = (p) => p.startsWith('[project]/') ? p.slice('[project]/'.length).replace(/\.\[\w+\]\.\w+$/, '').replace(/ \[.*$/, '') : null;
const perFile = new Map();
let total = 0, compressedTotal = 0;
for (const c of head.chunk_parts) {
  if (!clientFiles.has(c.output_file_index)) continue;
  total += c.size; compressedTotal += c.compressed_size;
  const key = repoFile(pathOf(c.source_index)) ?? pathOf(c.source_index);
  const e = perFile.get(key) ?? { size: 0, compressed: 0 };
  e.size += c.size; e.compressed += c.compressed_size; perFile.set(key, e);
}
const summaries = JSON.parse(fs.readFileSync(path.join(dataDir, 'route-summaries.json'), 'utf8'));
const summary = summaries.find((r) => r.route === ROUTE);
if (summary && summary.client.size !== total) fail(`attribution sums to ${total} B, the route summary says ${summary.client.size} B`);

const st = JSON.parse(fs.readFileSync(STRUCTURE, 'utf8'));
const ctx = new Map(st.contexts.map((c) => [c.name, c]));
const owners = new Map(); // file -> [feature]
const features = {};
for (const f of st.features) {
  const roots = f.contexts.flatMap((n) => ctx.get(n)?.file_paths ?? []);
  const owns = (file) => roots.some((r) => file === r || file.startsWith(r.replace(/\/?$/, '/')));
  let size = 0, compressed = 0; const files = [];
  for (const [file, e] of perFile) {
    if (!owns(file)) continue;
    size += e.size; compressed += e.compressed; files.push([file, e.size]);
    owners.set(file, [...(owners.get(file) ?? []), f.slug]);
  }
  if (!files.length) continue;
  files.sort((x, y) => y[1] - x[1]);
  features[f.slug] = { bundleKb: +(size / 1024).toFixed(1), compressedKb: +(compressed / 1024).toFixed(1), files: files.length, top: files.slice(0, 5).map(([p, s]) => ({ file: p, kb: +(s / 1024).toFixed(1) })) };
}
let unowned = 0; const unownedTop = [];
for (const [file, e] of perFile) if (!owners.has(file)) { unowned += e.size; unownedTop.push([file, e.size]); }
unownedTop.sort((x, y) => y[1] - x[1]);
const stats = {
  generated_at: new Date().toISOString(), generator: 'scripts/lens-bundle-stats.mjs', route: ROUTE,
  build: { root: ROOT, build_root: buildRoot, dist: DIST, analyzer: 'next analyze -o (Turbopack)', next: JSON.parse(fs.readFileSync(path.join(dataDir, 'metadata.json'), 'utf8')).nextVersion },
  unit: 'KB = 1024 bytes of client output (minified, uncompressed); compressedKb is the analyzer\'s compressed size',
  route_client_kb: +(total / 1024).toFixed(1), route_client_compressed_kb: +(compressedTotal / 1024).toFixed(1),
  unowned_kb: +(unowned / 1024).toFixed(1), unowned_top: unownedTop.slice(0, 8).map(([p, s]) => ({ source: p, kb: +(s / 1024).toFixed(1) })),
  shared_files: [...owners].filter(([, fs2]) => fs2.length > 1).map(([file, fs2]) => ({ file, features: fs2 })),
  features,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(stats, null, 2) + '\n');
const rel = path.relative(ROOT, OUT).split(path.sep).join('/');
for (const [slug, v] of Object.entries(features)) {
  process.stdout.write(JSON.stringify({ feature: slug, metric: 'bundleKb', value: v.bundleKb, unit: 'KB', method: 'static',
    evidence: `node scripts/lens-bundle-stats.mjs: ${v.files} source file(s) in route ${ROUTE}'s client output (next analyze over the ${DIST} build), ${rel}` }) + '\n');
}
