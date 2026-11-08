// Mutation harness for packages/schema/generate.mjs --check (the mutants are written outside the checkout).
// usage: node packages/schema/mutants.mjs . [--rev <commit>] [mutation ...]   (cwd for each run = the repo root given)
//   --rev reads generate.mjs, parity.mjs and roots.mjs as of that commit (git show), e.g. the parent of the hardening commit
// Each mutant is a copy of generate.mjs + parity.mjs + roots.mjs with ONE edit (a string, or a RegExp replaced
// everywhere it matches), written under the OS temp dir beside a junction to this repo's node_modules (so ajv and
// typescript resolve as bare imports) with HERE pointed into this repo, and run as --check against the real tree. The identity run must exit 0:
// a loader failure exits 1 too and would read like a caught mutation, so a non-zero exit with no FAIL line is
// printed as LOADER/CRASH. Table and verdicts: docs/concepts/vr-light-table/plan.md, 'check:schema's controls
// mutation-tested'. Not part of any gate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(process.argv[2]).split(path.sep).join('/');
const args = process.argv.slice(3), revAt = args.indexOf('--rev');
const rev = revAt >= 0 ? args.splice(revAt, 2)[1] : null;
const want = args;
const source = (f) => (rev
  ? spawnSync('git', ['show', `${rev}:packages/schema/${f}`], { cwd: repo, encoding: 'utf8' }).stdout
  : fs.readFileSync(path.join(repo, 'packages/schema', f), 'utf8').split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10))); // a Windows checkout's CRLF must not hide a find string that spans a line

// [name, file, find, replace, what it guts, the assertion lines to show (regex)]
const M = [
  ['identity', 'generate.mjs', '', '', 'nothing (loader sanity)', /is current|every schema field|agrees with the generated/],
  ['A1-stale-reads-fresh', 'generate.mjs', 'const have = read(f), rel =', 'const have = text, rel =', 'staleness: the loop compares the fresh text with itself, never the committed file', /is current|is stale|stale-probe|probe: the stale/],
  ['A2-stale-prefix-current', 'generate.mjs', 'while (i < a.length && a[i] === b[i]) i++;', 'while (i < a.length && a[i] === b[i]) i++; if (i === a.length) return { stale: false };', 'staleness: a committed file that is a prefix of the fresh one (tail missing) reads current', /is current|is stale|truncated|appended/],
  ['B1-cov-no-raw', 'generate.mjs', "if (c.how === 'raw' && !(fn", "if (false && !(fn", 'coverage: a raw carry (cross_refs, glyph) whose CopyRaw is missing is not reported', /every schema field|fix-up|CopyRaw|coverage/],
  ['B2-cov-decl-whole-file', 'generate.mjs', '.test(decl)) { problems.push(`${where}: no UPROPERTY', '.test(ue)) { problems.push(`${where}: no UPROPERTY', "coverage: a UPROPERTY is looked for in the whole header, so another struct's field of the same name satisfies it", /every schema field|fix-up|UPROPERTY|coverage/],
  ['B3-cov-no-recursion', 'generate.mjs', 'if (h && need.has(h.name) &&', 'if (false && h && need.has(h.name) &&', 'coverage: a FixUp that no longer recurses into a held struct with carried fields is not reported', /every schema field|fix-up|recurse|coverage/],
  ['B4-cov-renamed-fn-only', 'generate.mjs', "if (c.how === 'renamed' && !(fn && ", "if (c.how === 'renamed' && !(fn || ", 'coverage: a renamed carry passes whenever its struct has any FixUp', /every schema field|fix-up|coverage/],
  ['C1-parity-no-extra', 'parity.mjs', 'for (const name of hs.keys()) if (!gs.has(name)) problems.push', 'for (const name of hs.keys()) if (false) problems.push', 'parity: a field in types.ts and not in the schema is not reported', /agrees with the generated|parity/],
  ['C2-parity-no-missing', 'parity.mjs', 'if (!hs.has(name)) { problems.push(`${where}.${name}: in the schema, not in types.ts`); continue; }', 'if (!hs.has(name)) continue;', 'parity: a field in the schema and not in types.ts is not reported', /agrees with the generated|parity/],
  ['C3-parity-optional-one-way', 'parity.mjs', 'if (hs.get(name) !== req) problems.push', 'if (!req && hs.get(name)) problems.push', 'parity: required in the schema but optional in types.ts is not reported', /agrees with the generated|parity/],
  ['C4-parity-plan-pair-dropped', 'roots.mjs', "    { gen: 'Plan', hand: { file: 'packages/core/src/server/plan-projection.ts', name: 'Plan' } },\n", '', 'parity: the Plan shapes are never compared', /agrees with the generated|parity|pair/],
  ['C5-parity-enum-missing-only', 'parity.mjs', 'extra = [...hl].filter((v) => !gl.has(v))', 'extra = []', 'parity: an enum value in types.ts and not in the schema is not reported', /agrees with the generated|parity/],
  // the ten bp-Personas contract pairs (decision-brief-1, shared-focus-1, morning-deck-1): before roots.mjs, dropping
  // them from WIRE_PAIRS exited 0 with 52 shapes compared instead of 90, the self-proof naming only 8 roots
  ['C6-parity-contract-pairs-dropped', 'roots.mjs', /\n {4}\{ gen: '(DecisionBrief|FocusPlace|SharedView|SharedPlace|FocusPost|FocusAnswer|MorningDeck|AgentDeck|SteerRow|SteerPost)', hand: [^\n]*/g, '', 'parity: the contract pairs are never compared', /agrees with the generated|parity|pair/],
];

const tmp = path.join(os.tmpdir(), 'bp-schema-mutants'); // mutants live outside the checkout
fs.mkdirSync(tmp, { recursive: true });
if (!fs.existsSync(path.join(tmp, 'node_modules'))) fs.symlinkSync(path.join(repo, 'node_modules'), path.join(tmp, 'node_modules'), 'junction');
for (const [name, file, find, replace, guts, show] of M) {
  if (want.length && !want.includes(name)) continue;
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const src = {
    'generate.mjs': source('generate.mjs'),
    'parity.mjs': source('parity.mjs'),
    'roots.mjs': source('roots.mjs'),
  };
  if (find) {
    const n = find instanceof RegExp ? (src[file].match(find) ?? []).length : src[file].split(find).length - 1;
    if (find instanceof RegExp ? !n : n !== 1) { console.log(`## ${name}: HARNESS ERROR, the find string occurs ${n} times in ${file}`); continue; }
    src[file] = src[file].replace(find, () => replace);
  }
  const rewrites = [
    ['generate.mjs', 'const HERE = path.dirname(fileURLToPath(import.meta.url));', `const HERE = ${JSON.stringify(repo + '/packages/schema')};`],
    ['roots.mjs', 'const HERE = path.dirname(fileURLToPath(import.meta.url));', `const HERE = ${JSON.stringify(repo + '/packages/schema')};`],
  ];
  for (const [f, a, b] of rewrites) {
    if (!src[f].includes(a)) { console.log(`## ${name}: HARNESS ERROR, rewrite target missing in ${f}: ${a}`); process.exit(2); }
    src[f] = src[f].replace(a, () => b);
  }
  for (const [f, t] of Object.entries(src)) fs.writeFileSync(path.join(dir, f), t);
  const r = spawnSync(process.execPath, [path.join(dir, 'generate.mjs'), '--check'], { cwd: repo, encoding: 'utf8' });
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  const fails = lines.filter((l) => l.startsWith('FAIL'));
  console.log(`## ${name}  exit ${r.status}  (${guts})`);
  if (!lines.length || (r.status && !fails.length)) console.log(`   LOADER/CRASH, not a caught mutation: ${(r.stderr || '').trim().split('\n').slice(0, 4).join(' | ')}`);
  for (const l of fails) console.log(`   ${l}`);
  for (const l of lines.filter((l) => !l.startsWith('FAIL') && show.test(l))) console.log(`   ${l}`);
}
