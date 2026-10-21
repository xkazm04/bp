#!/usr/bin/env node
// Gate for the VR hand-off folders apps/vr/ArtSource/<id>/ (wolf-plan.md L4.1, P4): Wolf imports from master, so the
// manifests must be true. Per manifest.json it asserts
//   (a) id equals the folder name;
//   (b) every gate present is an object with pass === true, and input, mesh_acceptance, scale, finishing and poly_budget
//       are all present (mat-* folders also carry tiling), and so is every gate any manifest of the same `class` carries,
//       so a gate kind the writers add cannot be missing from one folder while its siblings have it;
//   (c) tris (a number, or an object of numbers that is summed; the largest one when budget_note says "per mesh") is at or
//       under budget_tris where that is set;
//   (d) every file listed in sha256 (and in files, where that maps paths to hashes) exists and its hash matches;
//   (d2) every entry of file_bytes (written by 7 of the 14 manifest writers) exists and is that many bytes: the gate notes
//       quote it ("largest N bytes"), so a hand-edited size is a false statement, not decoration;
//   (e) lynx_commit is a commit in git history (git cat-file -e) that touches the asset folder.
// Across ArtSource: no committed file is 50 MB or larger; a file over 10 MB prints a warning line.
// A seeded control runs in memory on a copy of one real manifest (a gate flipped to false, a bad sha) and must fail;
// nothing is written to disk. Exit 1 on any violation or if the control passes.
// Run: node scripts/check-art.mjs   (plain node, no deps)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(REPO, 'apps/vr/ArtSource');
const REL = 'apps/vr/ArtSource';
const MB = 1024 * 1024;
const GATES = ['input', 'mesh_acceptance', 'scale', 'finishing', 'poly_budget'];

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const gitOk = (...args) => { try { git(...args); return true; } catch { return false; } };
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const sumTris = (t) => (typeof t === 'number' ? t : t && typeof t === 'object' && Object.values(t).every((v) => typeof v === 'number') ? Object.values(t).reduce((a, b) => a + b, 0) : NaN);

// Violations for one manifest. `opts.commit` is false for the seeded control (the git half is the real tree's business).
// `opts.peers` are the other manifests: any gate a peer of the same `class` carries is required here too (the typed GATES
// and the mat- prefix stay as the floor, so a gate dropped from every manifest at once is still caught).
export function validate(folder, m, opts = {}) {
  const errs = [];
  const dir = path.join(ART, folder);
  if (m.id !== folder) errs.push(`id "${m.id}" is not the folder name`);

  const gates = m.gates && typeof m.gates === 'object' ? m.gates : {};
  const derived = (opts.peers ?? []).filter((p) => p && p.class === m.class).flatMap((p) => Object.keys(p.gates ?? {}));
  const required = [...new Set([...GATES, ...(folder.startsWith('mat-') ? ['tiling'] : []), ...derived])];
  for (const g of required) if (!(g in gates)) errs.push(`gate ${g} is missing`);
  for (const [g, v] of Object.entries(gates)) if (!v || typeof v !== 'object' || v.pass !== true) errs.push(`gate ${g} is not pass: true`);

  if (m.budget_tris != null) {
    // a per-mesh budget (budget_note "per mesh") bounds each mesh of a tris object, otherwise the object is summed
    const perMesh = /per mesh/i.test(m.budget_note ?? "") && m.tris && typeof m.tris === "object";
    const tris = perMesh ? Math.max(...Object.values(m.tris)) : sumTris(m.tris);
    if (!Number.isFinite(tris)) errs.push('tris is not a number or an object of numbers');
    else if (tris > m.budget_tris) errs.push(`tris ${tris} is over budget_tris ${m.budget_tris}`);
  }

  const listed = { ...(m.sha256 ?? {}) };
  for (const [k, v] of Object.entries(m.files ?? {})) if (typeof v === 'string') listed[k] = v;
  for (const [rel, want] of Object.entries(listed)) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) errs.push(`${rel} is listed but missing`);
    else if (sha256(file) !== want) errs.push(`${rel} sha256 does not match`);
  }

  for (const [rel, want] of Object.entries(m.file_bytes ?? {})) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) errs.push(`${rel} has a file_bytes entry but is missing`);
    else if (fs.statSync(file).size !== want) errs.push(`${rel} file_bytes ${want} does not match its size ${fs.statSync(file).size}`);
  }

  if (opts.commit !== false) {
    const c = m.lynx_commit;
    if (typeof c !== 'string' || !/^[0-9a-f]{7,40}$/.test(c)) errs.push(`lynx_commit is not a commit hash (${JSON.stringify(c)})`);
    else if (!gitOk('cat-file', '-e', `${c}^{commit}`)) errs.push(`lynx_commit ${c} is not in git history`);
    else if (!git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', c, '--', `${REL}/${folder}`).trim()) errs.push(`lynx_commit ${c} does not touch ${REL}/${folder}`);
  }
  return errs;
}

/** True when this file was started directly (`node scripts/check-art.mjs`), false when another module imported it for validate(). */
const isMain = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

function main() {
  const folders = fs.readdirSync(ART, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  let fail = 0;
  const manifests = new Map();
  const unreadable = new Map();
  for (const f of folders) {
    try { manifests.set(f, JSON.parse(fs.readFileSync(path.join(ART, f, 'manifest.json'), 'utf8'))); } catch (e) { unreadable.set(f, `manifest.json unreadable: ${e.message}`); }
  }
  for (const f of folders) {
    let errs;
    try { errs = unreadable.has(f) ? [unreadable.get(f)] : validate(f, manifests.get(f), { peers: [...manifests.values()] }); } catch (e) { errs = [`manifest.json unreadable: ${e.message}`]; }
    for (const e of errs) console.log(`FAIL  ${f}: ${e}`);
    fail += errs.length;
  }

  let total = 0;
  for (const rel of git('ls-files', '-z', '--', REL).split('\0').filter(Boolean)) {
    const size = fs.statSync(path.join(REPO, rel)).size;
    total += size;
    if (size >= 50 * MB) { console.log(`FAIL  ${rel}: ${(size / MB).toFixed(1)} MB, 50 MB or larger`); fail++; }
    else if (size > 10 * MB) console.log(`WARN  ${rel}: ${(size / MB).toFixed(1)} MB, over 10 MB`);
  }

  // Seeded control, in memory only: the first manifest with a gate flipped, then with a bad sha.
  const seedFolder = [...manifests.keys()][0];
  const seed = manifests.get(seedFolder);
  const flipped = structuredClone(seed);
  flipped.gates[Object.keys(flipped.gates)[0]].pass = false;
  const badSha = structuredClone(seed);
  const key = Object.keys(badSha.sha256)[0];
  badSha.sha256[key] = '0'.repeat(64);
  // the size control needs a manifest that records file_bytes (7 of 14 do), which is not always the first one
  const sizeFolder = [...manifests.keys()].find((f) => Object.keys(manifests.get(f).file_bytes ?? {}).length > 0);
  const badSize = structuredClone(manifests.get(sizeFolder) ?? seed);
  if (sizeFolder) { const sk = Object.keys(badSize.file_bytes)[0]; badSize.file_bytes[sk] += 1; }
  const controls = [['gate false', flipped, 'is not pass: true'], ['bad sha', badSha, 'sha256 does not match']];
  if (sizeFolder) controls.push(['bad file_bytes', badSize, 'file_bytes']);
  else { console.log('FAIL  no manifest records file_bytes, so the size control cannot run'); fail++; }
  // a gate kind a sibling carries and this manifest lacks: a peer of the seed's class with a sixth gate the seed has never heard of
  const sixth = structuredClone(seed);
  sixth.gates.zz_new_gate = { pass: true };
  controls.push(['gate a sibling carries', seed, 'gate zz_new_gate is missing', [sixth]]);
  // a material by CLASS, in a folder that does not start with mat-: tiling is still required because its siblings carry it
  const matFolder = [...manifests.keys()].find((f) => 'tiling' in (manifests.get(f).gates ?? {}));
  if (matFolder) { const noTiling = structuredClone(manifests.get(matFolder)); delete noTiling.gates.tiling; controls.push(['tiling by class', noTiling, 'gate tiling is missing', [...manifests.values()], 'renamed-material']); }
  else { console.log('FAIL  no manifest carries tiling, so the by-class control cannot run'); fail++; }
  for (const [name, m, want, peers = [], asFolder] of controls) {
    const errs = validate(asFolder ?? (m === badSize ? sizeFolder : seedFolder), m, { commit: false, peers });
    const ok = errs.some((e) => e.includes(want));
    console.log(`${ok ? 'ok  ' : 'FAIL'}  seeded control (${name}) ${ok ? 'fails as expected' : 'was NOT caught'}`);
    if (!ok) fail++;
  }

  console.log(`${folders.length} asset folders, ${(total / MB).toFixed(1)} MB committed under ArtSource, ${fail} violation(s)`);
  process.exit(fail ? 1 : 0);
}

if (isMain) main();
