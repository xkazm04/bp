#!/usr/bin/env node
// Gate: every enum-keyed word/shape/number table in apps/web/src/variants covers every value the lens
// manifest declares for that field (docs/standard/lenses/*.json, `fields[].type === 'enum'`, `values`).
// Lenses are data (docs/blueprint-ui.md): a variant may not branch on a lens id, but it DOES keep a table
// per enum field - `{ none: 'No design yet', sketch: 'A sketch', ... }` - and nothing until now tied those
// tables back to the manifest. A value added to a manifest enum left every table silently short: the
// lookup falls through to `?? something` or to `undefined`, and tsc, every check and the build stay green
// because the tables are typed `Record<string, T>`.
//
// A table is recognised by its KEYS, not by its name: an object literal whose keys hit at least 3 values of
// one enum, with no key outside that enum other than the sentinels below, is that enum's table.
//   SENTINELS   'n/a' (bl() gives it for an inapplicable facet) and 'unknown'.
//   OPT-OUT     `enum-partial: <why>` in a comment on the table's line or the line above - for a table
//               that is partial on purpose (shaped's CROP has no crop for `none`: no design to crop).
// The matcher strips comments first, so a comment naming the missing value cannot stand in for it, and it
// fails loud when it recognises implausibly few tables or enums (a matcher that stopped biting reports a
// clean codebase in a voice indistinguishable from success). Every run also proves itself red on a seeded
// table with a value removed.
// Run: node scripts/check-variant-words.mjs   (plain node, no deps; exit 1 on any gap)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LENS_DIR = path.join(ROOT, 'docs/standard/lenses');
const VARIANTS = path.join(ROOT, 'apps/web/src/variants');
const SENTINELS = new Set(['n/a', 'unknown']);
const MIN_ENUMS = 10, MIN_TABLES = 15;   // floors: below these the scan stopped matching

/** Every enum field of every lens manifest: [{ id, values }]. */
function enumsOf(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const fld of m.fields ?? []) {
      if (fld.type === 'enum' && Array.isArray(fld.values) && fld.values.length) out.push({ id: `${m.id}.${fld.key}`, values: fld.values });
    }
  }
  return out;
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
// Comments are blanked, not deleted (scripts/lib/source.ts deletes them), so every offset and line number in
// the stripped text is still the one in the file - the opt-out comment is then read back at the right line.
const blank = (s) => s.replace(/[^\n]/g, ' ');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])(\/\/.*)$/gm, (_, a, b) => a + blank(b));
const LITERAL = /\{([^{}]{10,2000})\}/g;
const KEY = /(?:^|,)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w-]*))\s*:/g;

/** Tables of `src` (comments already stripped) against `enums`: [{ enumId, keys, missing, line, optOut }]. */
function tablesOf(src, raw, enums) {
  const out = [];
  for (const m of src.matchAll(LITERAL)) {
    const keys = [...m[1].matchAll(KEY)].map((k) => k[1] ?? k[2] ?? k[3]);
    if (keys.length < 3) continue;
    let best = null;
    for (const e of enums) {
      const hit = keys.filter((k) => e.values.includes(k)).length;
      if (hit >= 3 && (!best || hit > best.hit)) best = { e, hit };
    }
    if (!best) continue;
    if (keys.some((k) => !best.e.values.includes(k) && !SENTINELS.has(k))) continue;   // not this enum's table
    const line = src.slice(0, m.index).split('\n').length;
    // The opt-out is read from the RAW source (it is a comment); comments are blanked rather than deleted, so
    // `line` is the file's own line, and the marker is looked for in a comment on it or on the line above.
    const near = raw.split('\n').slice(Math.max(0, line - 2), line);
    const optOut = near.some((l) => /(?:^|\s)(?:\/\/|\/\*|\*)[^\n]*enum-partial:/.test(l));
    out.push({ enumId: best.e.id, keys, missing: best.e.values.filter((v) => !keys.includes(v)), line, optOut });
  }
  return out;
}

const enums = enumsOf(LENS_DIR);
const files = walk(VARIANTS).filter((f) => /\.tsx?$/.test(f));
const gaps = [], seen = [];
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  for (const t of tablesOf(strip(raw), raw, enums)) {
    seen.push(t);
    if (t.missing.length && !t.optOut) {
      gaps.push(`${rel}:${t.line}  the ${t.enumId} table has no entry for ${t.missing.map((v) => `'${v}'`).join(', ')} (add it, or mark the table "enum-partial: <why>" in a comment)`);
    }
  }
}

// ------------------------------------------------------------------ controls: the matcher must still bite
const controls = [];
{
  const e = enums.find((x) => x.values.length >= 4);
  const full = `const T: Record<string, string> = { ${e.values.map((v) => `'${v}': 'x'`).join(', ')} };`;
  const short = `const T: Record<string, string> = { ${e.values.slice(0, -1).map((v) => `'${v}': 'x'`).join(', ')} };`;
  const run = (s) => tablesOf(strip(s), s, enums);
  const whole = run(full);
  controls.push(['a complete table is recognised and passes', whole.length === 1 && whole[0].enumId === e.id && !whole[0].missing.length]);
  const cut = run(short);
  controls.push([`a table missing '${e.values.at(-1)}' is caught`, cut.length === 1 && cut[0].missing.length === 1 && cut[0].missing[0] === e.values.at(-1)]);
  const excused = run(`/* enum-partial: a control */\n${short}`);
  controls.push(['the enum-partial opt-out excuses a partial table', excused.length === 1 && excused[0].optOut]);
  const commented = run(`// ${e.values.at(-1)}: handled elsewhere\n${short}`);
  controls.push(['a comment naming the value does not stand in for the entry', commented.length === 1 && commented[0].missing.length === 1]);
}
if (enums.length < MIN_ENUMS) controls.push([`${enums.length} manifest enums read, expected at least ${MIN_ENUMS}`, false]);
if (seen.length < MIN_TABLES) controls.push([`${seen.length} enum tables recognised in ${files.length} variant files, expected at least ${MIN_TABLES}`, false]);

const bad = controls.filter(([, ok]) => !ok);
for (const [what] of bad) console.log(`FAIL control: ${what}`);
for (const g of gaps) console.log('FAIL ' + g);
const excusedN = seen.filter((t) => t.missing.length && t.optOut).length;
console.log(
  gaps.length || bad.length
    ? `check-variant-words: ${gaps.length} gap(s), ${bad.length} of ${controls.length} controls failed`
    : `check-variant-words: ${seen.length} enum tables in ${files.length} variant files cover all ${enums.length} manifest enums (${excusedN} marked enum-partial); ${controls.length} controls held`,
);
process.exit(gaps.length || bad.length ? 1 : 0);
