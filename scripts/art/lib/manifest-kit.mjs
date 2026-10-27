// The one writer of apps/vr/ArtSource/<id>/manifest.json. A hand-off manifest is a staged record, written by three stages:
//   concept   scripts/lookdev/write-prop-manifests.mjs: the generated options, contact sheet, kept option, identity
//   decision  scripts/art/record-pick.mjs: the owner's pick and the input gate once decided
//   build     the per-asset writers (scripts/art/**/write_manifest*.mjs): measurements, evidence and the measured gates
// writeStage(root, folder, stage, fields) merges one stage's fields into the existing manifest, replaces only the keys
// that stage owns, refuses a key another stage owns (nothing is written then), and stamps sha256, file_bytes and
// lynx_commit itself, so no writer can forget or diverge on them. check-art.mjs is the reader.
// A src module a node check imports: plain ESM, no dependency.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

export const ART_REL = 'apps/vr/ArtSource';
export const MB10 = 10 * 1024 * 1024;
export const STAGES = ['concept', 'decision', 'build'];

export const today = () => new Date().toISOString().slice(0, 10);
export const gate = (pass, note, date = today()) => ({ pass, note, date });
export const cm = (v) => Math.round(v * 1e4) / 100;

/** Prints the usage line and exits 2 unless argv carries at least `count` arguments; returns them otherwise. */
export function argsOrUsage(count, usage) {
  const args = process.argv.slice(2);
  if (args.length < count || args.slice(0, count).some((a) => !a)) {
    console.error(`usage: ${usage}`);
    process.exit(2);
  }
  return args;
}

// lynx_commit: the newest commit that touches this asset folder, so check:art can trace the manifest to a real tree.
// It throws when nothing has committed the folder yet (there is no honest hash to stamp).
export function lynxCommit(root, folder) {
  const r = spawnSync('git', ['log', '-1', '--format=%H', '--', `${ART_REL}/${folder}`], { cwd: root, encoding: 'utf8' });
  const h = (r.stdout ?? '').trim();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`lynx_commit: no commit touches ${ART_REL}/${folder} yet; commit the folder first so the manifest can name it`);
  return h;
}

/** Every file under dir but manifest.json, as sorted forward-slash paths relative to dir. */
export function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : p === path.join(base, 'manifest.json') ? [] : [path.relative(base, p).split(path.sep).join('/')];
  }).sort();
}

/** The folder as the manifest records it: files, sha256 and file_bytes per file, and the files at or over 10 MB. */
export function inventory(dir) {
  const files = listFiles(dir);
  const sha256 = Object.fromEntries(files.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]));
  const file_bytes = Object.fromEntries(files.map((f) => [f, fs.statSync(path.join(dir, f)).size]));
  return { files, sha256, file_bytes, oversize: files.filter((f) => file_bytes[f] >= MB10) };
}

export const folderDir = (root, folder) => path.join(root, ART_REL, folder);
const manifestPath = (root, folder) => path.join(folderDir(root, folder), 'manifest.json');

export function readManifest(root, folder) {
  const p = manifestPath(root, folder);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

// ---- field ownership ------------------------------------------------------------------------------------------------
const CONCEPT = new Set(['generator_options', 'contact_sheet', 'option_input_check', 'generator_note', 'kept_option', 'recommendation', 'concept_licence']);
// The asset's identity is the concept stage's; where an asset has no concept stage (procedural), the build stands in for it.
const IDENTITY = new Set(['id', 'class', 'budget_tris', 'budget_note']);
const DECISION = new Set(['picked']);
const STAMPED = new Set(['sha256', 'file_bytes', 'lynx_commit', 'lynx_commit_note']);
const MEASURED = ['mesh_acceptance', 'scale', 'finishing', 'poly_budget'];

/** True when the record has a concept stage (any concept-owned field). */
export const hasConcept = (m) => !!m && [...CONCEPT].some((k) => k in m);
/** True once the input is decided: a pick, an input gate stamped `by`, or a measured gate that passed (the build ran). */
export const isDecided = (m) => !!m && (m.picked != null || m.gates?.input?.by != null || MEASURED.some((g) => m.gates?.[g]?.pass === true));

/** The stage that owns a top-level key of the record m ('kit' for the stamped ones). */
export function ownerOf(key, m) {
  if (STAMPED.has(key)) return 'kit';
  if (DECISION.has(key)) return 'decision';
  if (CONCEPT.has(key)) return 'concept';
  if (IDENTITY.has(key)) return hasConcept(m) ? 'concept' : 'build';
  return 'build';
}
/** The stage that owns one gate: input is the concept's while undecided, the decision's after, the build's with no concept. */
export function gateOwner(g, m) {
  if (g !== 'input') return 'build';
  return !hasConcept(m) ? 'build' : isDecided(m) ? 'decision' : 'concept';
}

const mergeInto = (base, fields) => ({ ...base, ...fields, gates: { ...(base?.gates ?? {}), ...(fields?.gates ?? {}) } });

/**
 * Writes one stage of folder's manifest. `fields` are the stage's own keys (gates merge per gate); a key another stage owns
 * throws, naming the key and its owner, before anything is written. `opts.ifOwned` are fields written only where this
 * stage owns them now (the concept's input gate while undecided). `opts.defaults` fill keys and gates that are absent
 * (placeholders such as a "not run" gate); they never overwrite another stage's value. Returns the manifest written.
 */
export function writeStage(root, folder, stage, fields, opts = {}) {
  if (!STAGES.includes(stage)) throw new Error(`writeStage: unknown stage ${JSON.stringify(stage)} (one of ${STAGES.join(', ')})`);
  const old = readManifest(root, folder);
  const probe = mergeInto(mergeInto(old ?? {}, fields), opts.ifOwned ?? {});
  const refuse = (key, owner) => { throw new Error(`writeStage(${stage}) ${folder}: ${key} is owned by the ${owner} stage, not ${stage}`); };
  for (const k of Object.keys(fields)) {
    if (k === 'gates') continue;
    if (ownerOf(k, probe) !== stage) refuse(k, ownerOf(k, probe));
  }
  for (const g of Object.keys(fields.gates ?? {})) if (gateOwner(g, probe) !== stage) refuse(`gates.${g}`, gateOwner(g, probe));
  const own = { ...fields, gates: { ...(fields.gates ?? {}) } };
  for (const [k, v] of Object.entries(opts.ifOwned ?? {})) {
    if (k === 'gates') { for (const [g, gv] of Object.entries(v)) if (gateOwner(g, probe) === stage) own.gates[g] = gv; }
    else if (ownerOf(k, probe) === stage) own[k] = v;
  }

  // keep every key this stage does not own, replace the ones it does (a rerun drops a field the stage stopped writing)
  const next = {};
  for (const [k, v] of Object.entries(old ?? {})) if (k === 'gates' || ownerOf(k, probe) !== stage) next[k] = v;
  const keptGates = Object.fromEntries(Object.entries(old?.gates ?? {}).filter(([g]) => gateOwner(g, probe) !== stage));
  Object.assign(next, own, { gates: { ...keptGates, ...own.gates } });
  for (const [k, v] of Object.entries(opts.defaults ?? {})) {
    if (k === 'gates') { for (const [g, gv] of Object.entries(v)) if (!(g in next.gates)) next.gates[g] = gv; }
    else if (!(k in next)) next[k] = v;
  }
  if (!Object.keys(next.gates).length) delete next.gates;

  const inv = inventory(folderDir(root, folder));
  Object.assign(next, {
    sha256: inv.sha256,
    file_bytes: inv.file_bytes,
    lynx_commit: lynxCommit(root, folder),
    lynx_commit_note: 'stamped by the writer: the newest commit touching this folder when the manifest was written',
  });
  if (old && isDeepStrictEqual(old, next)) return next;
  fs.writeFileSync(manifestPath(root, folder), JSON.stringify(next, null, 2) + '\n');
  return next;
}
