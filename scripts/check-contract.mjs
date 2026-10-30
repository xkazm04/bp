#!/usr/bin/env node
// The bp-Personas contract's manifest gate (roadmap S2, E5's bp half): packages/schema/contract.json lists every file a
// port copies or reproduces - the contract schemas, the goldens, the copy targets and the contract text - each with the
// sha256 of its LF bytes. This fails when one of them changes without its manifest entry (the hash no longer matches),
// so a change to the contract is always a visible manifest edit with a new `rev`, which is what a port's pins and
// scripts/personas-drift.mjs compare against. Also asserted, one line each:
//   listed    every file under packages/schema/golden/ and every schema the manifest's schemas reference by a cross-file
//             $ref is in the manifest (a new golden cannot ride outside it)
//   mirrors   a moved file's old path (`mirrors`) is the same bytes as its new home (ports still read the old one)
//   moved     every `moved` row's `to` is listed and its `from` is one of that entry's mirrors
//   writers   every golden names the script that writes it and the source it holds, and both exist
// Each rule has a seeded control run on an in-memory copy (a byte changed, a golden unlisted, a mirror drifted, a
// moved row whose old path is gone): a matcher that stopped biting fails the run instead of reporting a clean tree.
//   node scripts/check-contract.mjs           the gate (in npm run check)
//   node scripts/check-contract.mjs --write   recompute every hash; when any changed, rev + 1 (then commit both)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'packages/schema/contract.json';
const GOLDEN_DIR = 'packages/schema/golden';
const lf = (s) => s.replace(/\r\n/g, '\n');
export const hashOf = (text) => crypto.createHash('sha256').update(lf(text), 'utf8').digest('hex');
const readRel = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : null);

/** Every problem with a manifest against a file reader (`read(rel)` -> text or null) and the goldens on disk. */
export function verdict(manifest, read, goldens) {
  const problems = [], listed = new Set(manifest.files.map((f) => f.path));
  for (const f of manifest.files) {
    const text = read(f.path);
    if (text === null) { problems.push(`${f.path}: listed, not on disk`); continue; }
    const h = hashOf(text);
    if (h !== f.sha256) problems.push(`${f.path}: changed without its manifest entry (sha256 ${h.slice(0, 12)}, manifest ${String(f.sha256).slice(0, 12)}): update the contract text if the wire or a rule changed, then node scripts/check-contract.mjs --write`);
    for (const m of f.mirrors ?? []) {
      const mt = read(m);
      if (mt === null) problems.push(`${m}: the mirror of ${f.path} is gone (ports still read the old path)`);
      else if (lf(mt) !== lf(text)) problems.push(`${m}: the mirror of ${f.path} differs from it (node ${f.writer ?? 'its writer'} --write writes both)`);
    }
    if (f.role === 'golden') for (const k of ['writer', 'of']) if (!f[k] || read(f[k]) === null) problems.push(`${f.path}: a golden names its ${k === 'of' ? 'source' : 'writer'} (${k}), and it exists`);
    if (f.role === 'schema') {
      const refs = [...text.matchAll(/"\$ref":\s*"([\w.-]+\.schema\.json)#/g)].map((x) => `packages/schema/schema/${x[1]}`);
      for (const r of new Set(refs)) if (!listed.has(r)) problems.push(`${f.path}: references ${r}, which the manifest does not list`);
    }
  }
  for (const g of goldens) if (!listed.has(g)) problems.push(`${g}: a golden outside the manifest`);
  for (const m of manifest.moved ?? []) {
    const to = manifest.files.find((f) => f.path === m.to);
    if (!to) problems.push(`moved ${m.from} -> ${m.to}: ${m.to} is not listed`);
    else if (!(to.mirrors ?? []).includes(m.from)) problems.push(`moved ${m.from} -> ${m.to}: the old path is not kept as a mirror`);
  }
  return problems;
}

const goldensOnDisk = () => (fs.existsSync(path.join(ROOT, GOLDEN_DIR)) ? fs.readdirSync(path.join(ROOT, GOLDEN_DIR)).filter((f) => f.endsWith('.json')).map((f) => `${GOLDEN_DIR}/${f}`) : []);
const manifestText = readRel(MANIFEST);
if (manifestText === null) { console.log(`FAIL  ${MANIFEST} is missing`); process.exit(1); }
const manifest = JSON.parse(manifestText);

if (process.argv.includes('--write')) {
  let changed = 0;
  for (const f of manifest.files) { const t = readRel(f.path); if (t === null) continue; const h = hashOf(t); if (h !== f.sha256) { f.sha256 = h; changed++; } }
  if (changed) manifest.rev = (manifest.rev ?? 0) + 1;
  fs.writeFileSync(path.join(ROOT, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  console.log(changed ? `wrote ${MANIFEST}: ${changed} hash(es) changed, rev ${manifest.rev}` : `${MANIFEST} is current (rev ${manifest.rev})`);
  process.exit(0);
}

let failed = 0, passed = 0;
const say = (ok, line) => { if (ok) passed++; else failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${line}`); };
const goldens = goldensOnDisk();
const real = verdict(manifest, readRel, goldens);
const roles = (r) => manifest.files.filter((f) => f.role === r).length;
say(!real.length, `${MANIFEST} rev ${manifest.rev} holds ${manifest.files.length} files (${roles('schema')} schemas, ${roles('golden')} goldens, ${roles('copy-target')} copy targets, ${roles('text')} text) at their hashes${real.length ? ': ' + real.join('; ') : ''}`);
say(manifest.files.length >= 8 && roles('schema') >= 3 && roles('golden') >= 2 && goldens.length >= 2, `the manifest is not empty and the goldens directory is read (${goldens.length} on disk)`);

// controls: each rule bites on an in-memory copy of the real tree
const over = (edits) => (rel) => (rel in edits ? edits[rel] : readRel(rel));
const first = (role) => manifest.files.find((f) => f.role === role);
const controls = [
  ['a byte changed in a schema', over({ [first('schema').path]: readRel(first('schema').path) + ' ' }), goldens, (p) => p.some((x) => x.startsWith(first('schema').path + ': changed without its manifest entry'))],
  ['a byte changed in a copy target', over({ [first('copy-target').path]: readRel(first('copy-target').path).replace(/\n/, '\n// probe\n') }), goldens, (p) => p.some((x) => x.startsWith(first('copy-target').path + ': changed without'))],
  ['a golden on disk the manifest does not list', readRel, [...goldens, `${GOLDEN_DIR}/zz-probe.json`], (p) => p.includes(`${GOLDEN_DIR}/zz-probe.json: a golden outside the manifest`)],
  ['a mirror drifted from its new home', ...(() => { const f = manifest.files.find((x) => x.mirrors?.length); return [over({ [f.mirrors[0]]: readRel(f.mirrors[0]).replace('"cases"', '"casez"') }), goldens, (p) => p.some((x) => x.startsWith(f.mirrors[0] + ': the mirror of'))]; })()],
  ['a mirror deleted', ...(() => { const f = manifest.files.find((x) => x.mirrors?.length); return [(rel) => (rel === f.mirrors[0] ? null : readRel(rel)), goldens, (p) => p.some((x) => x.startsWith(f.mirrors[0] + ': the mirror of') && x.includes('gone'))]; })()],
];
for (const [what, read, gs, caught] of controls) {
  const p = verdict(manifest, read, gs);
  say(caught(p), `control: ${what} is reported${caught(p) ? '' : ` (got ${p.length ? p.join('; ') : 'nothing'})`}`);
}
const noMirror = { ...manifest, files: manifest.files.map((f) => (f.mirrors ? { ...f, mirrors: [] } : f)) };
const mv = verdict(noMirror, readRel, goldens);
say((manifest.moved ?? []).length > 0 && mv.some((x) => x.includes('the old path is not kept as a mirror')), 'control: a moved file whose old path is no longer a mirror is reported');
const unref = { ...manifest, files: manifest.files.filter((f) => !f.path.endsWith('decision-brief-1.schema.json')) };
say(verdict(unref, readRel, goldens).some((x) => x.includes('references packages/schema/schema/decision-brief-1.schema.json')), 'control: a schema referenced by a listed one and left out of the manifest is reported');
console.log(`\ncheck-contract: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
