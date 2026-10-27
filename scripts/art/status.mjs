#!/usr/bin/env node
// art:status - one read-only table of the apps/vr/ArtSource hand-off folders, so the operator can see, before re-running
// any art step, where each folder stands and what bringing it back would cost:
//   stage     awaiting-pick (with the options to pick from) | ready-to-build | built | failing <gate>, from the gates
//   problems  what check:art's validate() says about the folder
//   drift     files whose sha256 differs from the manifest, are missing, or are on disk but not in the manifest
//   stale     commits after lynx_commit that change CODE lines of the folder's declared scripts (score-assets.mjs
//             ENTRY_POINTS); a commit that only edits comments or whitespace does not make a manifest stale
//   next      the manifest's regenerate steps, each live one (ENTRY_POINTS[id].live) tagged PAID or GPU
// It writes nothing and runs no art step: the live scripts are read as strings only, and the only child process is git.
//   node scripts/art/status.mjs [--json] [--strict]     (npm run art:status)
// --strict exits 1 when any folder has problems or drift.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENTRY_POINTS } from './score-assets.mjs';
import { validate } from '../check-art.mjs';
import { ART_REL, folderDir, listFiles, readManifest } from './lib/manifest-kit.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** git in `root`, returning stdout; the one child process this module starts. */
export const gitIn = (root) => (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });

const MEASURED_SKIP = new Set(['input']);
const notRun = (g) => g && g.pass !== true && /^not run\b/i.test(String(g.note ?? '').trim());

/** The folder's stage from its gates: { stage, options? } | { stage: 'failing', gate }. */
export function stageOf(m) {
  const gates = m?.gates && typeof m.gates === 'object' ? m.gates : {};
  const measured = Object.entries(gates).filter(([g]) => !MEASURED_SKIP.has(g));
  const bad = measured.find(([, v]) => v?.pass !== true && !notRun(v));
  if (bad) return { stage: 'failing', gate: bad[0] };
  if (gates.input?.pass !== true) {
    const options = [...new Set([...(m.generator_options ?? []), ...(Array.isArray(m.generator) ? m.generator : [])].map((g) => g?.option).filter(Boolean))];
    return { stage: 'awaiting-pick', options };
  }
  if (measured.some(([, v]) => v?.pass !== true)) return { stage: 'ready-to-build' };
  return { stage: 'built' };
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Files that disagree with the manifest: [{ file, why: 'sha256 differs' | 'missing' | 'not in manifest' }]. */
export function driftOf(folder, m, root = REPO) {
  const dir = folderDir(root, folder);
  const listed = { ...(m?.sha256 ?? {}) };
  for (const [k, v] of Object.entries(m?.files ?? {})) if (typeof v === 'string') listed[k] = v;
  const out = [];
  for (const [file, want] of Object.entries(listed)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) out.push({ file, why: 'missing' });
    else if (sha256(p) !== want) out.push({ file, why: 'sha256 differs' });
  }
  if (fs.existsSync(dir)) for (const file of listFiles(dir)) if (!(file in listed)) out.push({ file, why: 'not in manifest' });
  return out;
}

// The same comment blanking check-art-scripts.mjs applies before it reads a script (block comments, then // to line end).
const blankComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\r\n]/g, ' '))
  .split('\n').map((l) => l.replace(/(^|[^:'"\w])(\/\/.*)$/, (_, a, c) => a + ' '.repeat(c.length))).join('\n');

/** True when the changed lines of one side of one file carry code (not only comments and whitespace). */
function changesCode(lines) {
  return blankComments(lines.join('\n')).split('\n')
    // a line left from a block comment the hunk cut into: ` * text` or a lone `*/`
    .some((l, i) => l.trim() !== '' && !lines[i].trim().startsWith('*'));
}

/**
 * Commits after lynx_commit that change code lines of the folder's declared scripts: [{ sha, subject }], newest first.
 * `git(args)` returns stdout (gitIn(root) by default; the check passes a stub).
 */
export function staleOf(folder, m, entryPoint, git = gitIn(REPO)) {
  const c = m?.lynx_commit;
  const scripts = entryPoint?.scripts ?? [];
  if (typeof c !== 'string' || !/^[0-9a-f]{7,40}$/.test(c) || !scripts.length) return [];
  const out = git(['log', '-p', '-w', '--no-color', '--format=%x01%h %s', `${c}..HEAD`, '--', ...scripts]);
  const stale = [];
  for (const chunk of String(out).split('\u0001').slice(1)) {
    const [head, ...body] = chunk.split('\n');
    const sp = head.indexOf(' ');
    const sha = sp < 0 ? head.trim() : head.slice(0, sp), subject = sp < 0 ? '' : head.slice(sp + 1).trim();
    const sides = new Map();
    let file = '';
    for (const l of body) {
      if (l.startsWith('diff --git ')) { file = l; continue; }
      if (l.startsWith('+++ ') || l.startsWith('--- ')) continue;
      if (l[0] !== '+' && l[0] !== '-') continue;
      const key = `${l[0]}${file}`;
      if (!sides.has(key)) sides.set(key, []);
      sides.get(key).push(l.slice(1));
    }
    if ([...sides.values()].some(changesCode)) stale.push({ sha, subject });
  }
  return stale;
}

/** The regenerate steps with the repo placeholders filled: [{ cmd, live? }], `live` the ENTRY_POINTS note. */
export function nextOf(m, entryPoint, root = REPO) {
  const live = entryPoint?.live ?? {};
  return String(m?.regenerate ?? '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const cmd = s.replaceAll('<repo-root>', root).replaceAll('<repo>', root);
    const hit = Object.keys(live).find((script) => cmd.includes(script));
    return hit ? { cmd, live: live[hit] } : { cmd };
  });
}

/** PAID for a step that spends money, GPU for one that queues a GPU job, LIVE for any other live note. */
export const liveTag = (note) => (/paid|credit/i.test(note) ? 'PAID' : /GPU/.test(note) ? 'GPU' : 'LIVE');

/** 1 under strict when any row has problems or drift, else 0. */
export const exitCode = (rows, { strict = false } = {}) => (strict && rows.some((r) => (r.problems?.length ?? 0) > 0 || (r.drift?.length ?? 0) > 0) ? 1 : 0);

/** One row per ArtSource folder. */
export function rowsOf(root = REPO, git = gitIn(root)) {
  const art = path.join(root, ART_REL);
  const folders = fs.readdirSync(art, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const manifests = new Map(), unreadable = new Map();
  for (const f of folders) {
    try { manifests.set(f, readManifest(root, f) ?? (() => { throw new Error('manifest.json is missing'); })()); } catch (e) { unreadable.set(f, e.message); }
  }
  const peers = [...manifests.values()];
  return folders.map((id) => {
    if (unreadable.has(id)) return { id, stage: 'unreadable', problems: [`manifest.json unreadable: ${unreadable.get(id)}`], drift: [], stale: [], next: [] };
    const m = manifests.get(id), ep = ENTRY_POINTS[id];
    let problems;
    try { problems = validate(id, m, { root, peers }); } catch (e) { problems = [`validate threw: ${e.message}`]; }
    if (!ep) problems = [...problems, 'no ENTRY_POINTS row in scripts/art/score-assets.mjs'];
    let stale;
    try { stale = staleOf(id, m, ep, git); } catch (e) { stale = []; problems = [...problems, `git log failed: ${String(e.message).split('\n')[0]}`]; }
    return { id, ...stageOf(m), problems, drift: driftOf(id, m, root), stale, next: nextOf(m, ep, root) };
  });
}

const stageText = (r) => (r.stage === 'failing' ? `failing ${r.gate}` : r.stage === 'awaiting-pick' && r.options?.length ? `awaiting-pick ${r.options.join('/')}` : r.stage);
const nextText = (r) => {
  const tags = [...new Set(r.next.filter((s) => s.live).map((s) => liveTag(s.live)))];
  return `${r.next.length} step${r.next.length === 1 ? '' : 's'}, ${tags.length ? tags.join('+') : 'free'}`;
};
const cut = (s, n) => (s.length > n ? s.slice(0, n - 3) + '...' : s);

/** The text table: a header and one line per folder (detail lines follow a row that has problems or drift). */
export function textOf(rows) {
  const w = Math.max(2, ...rows.map((r) => r.id.length)) + 2;
  const out = [`${'id'.padEnd(w)}${'stage'.padEnd(24)}${'problems'.padEnd(10)}${'drift'.padEnd(7)}${'stale (newest)'.padEnd(18)}next`];
  for (const r of rows) {
    const stale = r.stale.length ? `${r.stale.length} (${r.stale[0].sha})` : '0';
    out.push(cut(`${r.id.padEnd(w)}${cut(stageText(r), 22).padEnd(24)}${String(r.problems.length).padEnd(10)}${String(r.drift.length).padEnd(7)}${stale.padEnd(18)}${nextText(r)}`, 120));
    for (const p of r.problems) out.push(cut(`    problem  ${p}`, 120));
    for (const d of r.drift) out.push(cut(`    drift    ${d.file}: ${d.why}`, 120));
  }
  return out.join('\n');
}

const isMain = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const rows = rowsOf();
  console.log(args.includes('--json') ? JSON.stringify(rows, null, 2) : textOf(rows));
  process.exit(exitCode(rows, { strict: args.includes('--strict') }));
}
