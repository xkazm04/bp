#!/usr/bin/env node
// The standard's catalog, as a gate. Without it the catalog is a hand-maintained list that nothing
// reconciles with the directory it copies, and a drift reads as a working product:
//   catalog   packages/core/src/standard/catalog.ts lists exactly the manifests in docs/standard/lenses/ —
//             same count, each id equal to its file's stem, and each entry the file's own JSON. The
//             directory is the ground truth (packages/schema/generate.mjs and scripts/validate-structure.mjs
//             both read it with readdir); catalog.ts is seven hand-written imports, so an eighth manifest
//             would validate everywhere and still be missing from BUILTIN_LENSES, which is what a v2 map
//             reads its "available but unmeasured" lenses from.
// Run: node packages/core/check-standard.mjs   (plain node; type stripping loads the .ts modules)
// Exit 1 on any failed expectation, else 0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const load = (p) => import(pathToFileURL(path.join(HERE, p)).href);
const { BUILTIN_LENSES } = await load('src/standard/catalog.ts');

let held = 0;
const failures = [];
const expect = (ok, what) => { if (ok) held++; else failures.push(what); };

// ------------------------------------------------------------------ catalog: the directory is the list
{
  const dir = 'docs/standard/lenses';
  const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.json')).sort();
  expect(files.length > 0, `${dir}: no manifest files found`);
  expect(BUILTIN_LENSES.length === files.length,
    `catalog: BUILTIN_LENSES has ${BUILTIN_LENSES.length} manifests, ${dir} has ${files.length} (${files.join(', ')})`);
  const byId = new Map(BUILTIN_LENSES.map((m) => [m.id, m]));
  expect(byId.size === BUILTIN_LENSES.length, 'catalog: BUILTIN_LENSES has a duplicate id');
  for (const f of files) {
    const stem = f.slice(0, -'.json'.length);
    const m = byId.get(stem);
    expect(!!m, `catalog: ${dir}/${f} is not in BUILTIN_LENSES (add the import to src/standard/catalog.ts)`);
    if (!m) continue;
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'));
    expect(json.id === stem, `${dir}/${f}: id ${JSON.stringify(json.id)} is not the file's stem`);
    expect(JSON.stringify(m) === JSON.stringify(json), `catalog: the entry for "${stem}" is not ${dir}/${f}'s own JSON`);
    expect(m.$schema === 'lens-manifest/1', `catalog: "${stem}" is not a lens-manifest/1`);
  }
  for (const m of BUILTIN_LENSES) {
    expect(fs.existsSync(path.join(ROOT, dir, m.id + '.json')), `catalog: "${m.id}" has no manifest in ${dir}`);
  }
}

for (const f of failures) console.log('FAIL  ' + f);
console.log(failures.length
  ? `check-standard: ${failures.length} failed, ${held} held`
  : `check-standard: ${held} expectations held over ${BUILTIN_LENSES.length} built-in manifests`);
process.exit(failures.length ? 1 : 0);
