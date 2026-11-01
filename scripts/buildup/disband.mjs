#!/usr/bin/env node
// Undo a TEST onboarding (scripts/buildup/onboard-live.ts) so the next one starts from the same repo:
//   snapshot  --root <repo> --state <file>     before the run: refuses unless the repo's git tree is clean; keeps
//                                              .git/info/exclude and whether .ai/lens-scan and .claude/lens-scan existed
//   restore   --root <repo> --state <file> --slug <s> [--bp <bp>]
//                                              after it: unregister the slug from bp.products.local.json, delete what the
//                                              run created (.ai/lens-scan, .claude/lens-scan if new, new untracked files),
//                                              revert tracked edits, put .git/info/exclude back, then require a clean tree.
// Test-only: it is not the product's removal flow (that is /projects, with its own confirmation).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const cmd = argv[0];
const ROOT = path.resolve(opt('root', '.'));
const STATE = path.resolve(opt('state', 'disband-state.json'));
const BP = path.resolve(opt('bp', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')));
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' });
const porcelain = () => git('status', '--porcelain').split('\n').filter(Boolean);
const exclude = path.join(ROOT, '.git', 'info', 'exclude');
const die = (m) => { console.error('disband: ' + m); process.exit(1); };

if (cmd === 'snapshot') {
  const dirty = porcelain();
  if (dirty.length) die(`${ROOT} is not clean (${dirty.length} entries): ${dirty.slice(0, 5).join('; ')}`);
  const state = {
    root: ROOT, head: git('rev-parse', 'HEAD').trim(),
    exclude: fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : null,
    hadLensScan: fs.existsSync(path.join(ROOT, '.ai', 'lens-scan')),
    hadClaudeLensScan: fs.existsSync(path.join(ROOT, '.claude', 'lens-scan')),
  };
  if (state.hadLensScan) die(`${ROOT}/.ai/lens-scan already exists: this harness only tests a never-adopted repo`);
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  console.log(`snapshot ${ROOT} @ ${state.head.slice(0, 7)} -> ${STATE}`);
} else if (cmd === 'restore') {
  const slug = opt('slug') ?? die('--slug is required');
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  if (path.resolve(state.root) !== ROOT) die(`state is for ${state.root}, not ${ROOT}`);
  // 1. unregister (the registry file is bp's, git-ignored)
  const reg = path.join(BP, 'bp.products.local.json');
  if (fs.existsSync(reg)) {
    const doc = JSON.parse(fs.readFileSync(reg, 'utf8'));
    const before = doc.products?.length ?? 0;
    doc.products = (doc.products ?? []).filter((p) => p.slug !== slug);
    if (doc.products.length !== before) { fs.writeFileSync(reg, JSON.stringify(doc, null, 2) + '\n'); console.log(`unregistered ${slug}`); }
  }
  // 2. what the run created
  fs.rmSync(path.join(ROOT, '.ai', 'lens-scan'), { recursive: true, force: true });
  if (!state.hadClaudeLensScan) fs.rmSync(path.join(ROOT, '.claude', 'lens-scan'), { recursive: true, force: true });
  // 3. tracked edits back to HEAD (the tree was clean at snapshot), new untracked files removed one by one
  if (git('rev-parse', 'HEAD').trim() !== state.head) die(`HEAD moved during the run (${state.head.slice(0, 7)} -> now); restore by hand`);
  for (const l of porcelain()) {
    const st = l.slice(0, 2), p = l.slice(3);
    if (st === '??') { fs.rmSync(path.join(ROOT, p), { recursive: true, force: true }); console.log(`removed ${p}`); }
    else { git('checkout', '--', p); console.log(`reverted ${p}`); }
  }
  if (state.exclude !== null) fs.writeFileSync(exclude, state.exclude);
  const left = porcelain();
  if (left.length) die(`not clean after restore: ${left.join('; ')}`);
  console.log(`restored ${ROOT} to ${state.head.slice(0, 7)}, clean`);
} else die('usage: disband.mjs snapshot|restore --root <repo> --state <file> [--slug s]');
