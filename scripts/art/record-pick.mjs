#!/usr/bin/env node
// The decision stage as a command: records the owner's pick among a manifest's generated options, with a date and an
// author, through the kit (scripts/art/lib/manifest-kit.mjs), so the pick is never a hand edit of manifest.json.
//   node scripts/art/record-pick.mjs <asset-id> <option> [--note "<why>"] [--by <who>]
// Sets picked and gates.input = { pass: true, note, date, by } and restamps sha256, file_bytes and lynx_commit. The
// concept and build fields are left as they are. Exit 2 on an unknown asset or an option the manifest does not offer.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argsOrUsage, readManifest, today, writeStage } from './lib/manifest-kit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'node scripts/art/record-pick.mjs <asset-id> <option> [--note "<why>"] [--by <who>]';
const args = argsOrUsage(2, USAGE);
const [id, option] = args;
const flag = (name) => { const i = args.indexOf(name); return i > 1 && i + 1 < args.length ? args[i + 1] : null; };

let m;
try { m = readManifest(ROOT, id); } catch (e) { console.error(`${id}: manifest.json unreadable: ${e.message}`); process.exit(2); }
if (!m) { console.error(`${id}: no manifest.json under apps/vr/ArtSource/${id}\nusage: ${USAGE}`); process.exit(2); }
// the options the concept stage generated (older manifests keep them inside generator)
const offered = [...new Set([...(m.generator_options ?? []), ...(Array.isArray(m.generator) ? m.generator : [])].map((g) => g?.option).filter(Boolean))];
if (!offered.length) { console.error(`${id}: the manifest offers no generated options to pick from`); process.exit(2); }
if (!offered.includes(option)) { console.error(`${id}: option ${JSON.stringify(option)} is not one of the options the manifest offers: ${offered.join(', ')}`); process.exit(2); }

const note = flag('--note') ?? `Owner picked option ${option}`;
const by = flag('--by') ?? 'owner';
try {
  writeStage(ROOT, id, 'decision', { picked: option, gates: { input: { pass: true, note, date: today(), by } } });
} catch (e) { console.error(e.message); process.exit(1); }
console.log(`${id}: picked ${option} (${by}, ${today()})`);
