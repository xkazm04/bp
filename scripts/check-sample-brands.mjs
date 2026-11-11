#!/usr/bin/env node
// No third-party brand or product names in the Kettle sample's source data (docs/concepts/demo-video/readiness.md G1, owner
// 2026-11-11: "Brand names - fix them in source data"). The competition video films the web and a PC-linked headset, both of
// which read packages/core/data; bundle-words.mjs --check (check:vr-bundle) covers only the headset's bundled copy. This scans
// the same brand list (BRANDS in apps/vr/tools/bundle-words.mjs, one list for both) over every file in packages/core/data and
// over the finding-shot manifest's text fields (its `prompt` fields are image-generator instructions, never on screen, and are
// skipped). The data files are generator output (gen-kettle.mjs, kettle-to-v3.ts, kettle-findings.mjs, gen-swarm.mjs), whose
// own --check gates prove the files match the generators, so a brand in a generator turns this red through its output.
//
// Allowed: exactly the ids in KEPT_IDS. They are slugs of two features renamed to neutral words ("Social sign-in", "Platform
// sign-in"); the slug is an id other files and stores carry, so it was kept (kettle-to-v3.ts KEPT_SLUG). Nothing else is.
//
//   node scripts/check-sample-brands.mjs              exit 1 on a brand name left (npm run check:sample-brands)
//   node scripts/check-sample-brands.mjs --dir <d>    scan another directory instead of packages/core/data (the planted test)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandHits } from '../apps/vr/tools/bundle-words.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEPT_IDS = ['apple-sign-in', 'google-sign-in', 'iam_03_google_sign_in', 'iam_04_apple_sign_in'];
const args = process.argv.slice(2);
const di = args.indexOf('--dir');
const DATA = di >= 0 ? path.resolve(args[di + 1]) : path.join(ROOT, 'packages/core/data');
const MANIFEST = path.join(ROOT, 'scripts/fixtures/kettle-finding-shots.manifest.json');

const strip = (text) => KEPT_IDS.reduce((t, id) => t.split(id).join('#kept-id#'), text);
const sources = fs.readdirSync(DATA).filter((f) => /\.(json|jsonl|js)$/.test(f)).map((f) => [path.join(DATA, f), fs.readFileSync(path.join(DATA, f), 'utf8')]);
if (di < 0) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const shown = JSON.stringify({ ...m, images: m.images.map(({ prompt, ...rest }) => rest) });
  sources.push([MANIFEST, shown]);
}
if (!sources.length) { console.log(`FAIL no data files in ${DATA}`); process.exit(1); }
let left = 0;
for (const [file, text] of sources) {
  for (const h of brandHits(strip(text))) { left++; console.log(`FAIL ${path.relative(ROOT, file)}: ...${h}...`); }
}
console.log(`check:sample-brands: ${sources.length} files, ${left} brand name(s) left`);
process.exit(left ? 1 : 0);
