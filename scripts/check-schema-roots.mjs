#!/usr/bin/env node
// One root table for packages/schema: every schema file is one row of packages/schema/roots.mjs, naming its generated
// root, the structs a client reads on their own, and for each of them a hand-written pair ({ gen, hand: { file, name } })
// or an `unpaired: '<reason>'`. The generator's ROOTS, parity.mjs's pairs and wireSource, check:schema's per-root
// self-proof and the one ajv instance (schemaAjv) all derive from it. Asserts, one line per acceptance case:
//   1  the table with the DecisionBrief->Brief pair removed: check:schema exits 1 naming DecisionBrief
//   2  the table with the ten bp-Personas contract pairs removed: check:schema exits 1 (was 0, 52 shapes instead of 90)
//   3  the per-root self-proof iterates every generated name in the table, SteerRow and FocusAnswer included
//   4  an unpaired root with its reason removed: check:schema exits 1 naming it; the four reasoned roots pass
//   5  wireSource's export lines are exactly the table's non-types.ts hand pairs; a hand name its file does not export
//      fails the compare ('no export X')
//   6  no text outside roots.mjs imports ajv's 2020 build (git grep), and check:schema reports a seeded one at file:line
//   7  schemaAjv() serves a schema by file name and by $id, with allowUnionTypes, and every former ajv site calls it
//   8  mutants.mjs: identity exits 0, C1-C5 caught, the new C6 (contract pairs dropped) caught
// Each table case runs generate.mjs --check from a temp copy of generate.mjs + parity.mjs + roots.mjs (outside the
// checkout, node_modules reached through a junction) against the real tree.
// Run: node scripts/check-schema-roots.mjs   (exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = path.join(ROOT, 'packages/schema');
const NEEDLE = ['ajv', 'dist', '2020'].join('/'); // spelled apart so this file is no hit of its own rule
let failed = 0, passed = 0;
const check = (n, name, ok, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}  ${name}${ok || !detail ? '' : `  (${String(detail).slice(0, 300)})`}`);
};
const load = async (rel) => { try { return await import(pathToFileURL(path.join(ROOT, rel)).href); } catch (e) { return { __error: e.message.split('\n')[0] }; } };
const R = await load('packages/schema/roots.mjs');
const P = await load('packages/schema/parity.mjs');
const rowsOk = Array.isArray(R.ROOTS);

// ---- a temp copy of the three modules, roots.mjs edited, run as --check against the real tree
const TMP = path.join(os.tmpdir(), 'bp-check-schema-roots');
fs.mkdirSync(TMP, { recursive: true });
const nm = path.join(TMP, 'node_modules');
if (!fs.existsSync(nm)) fs.symlinkSync(path.join(ROOT, 'node_modules'), nm, 'junction');
const HERE_LINE = 'const HERE = path.dirname(fileURLToPath(import.meta.url));';
const runEdited = (name, edit) => {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['generate.mjs', 'parity.mjs', 'roots.mjs']) {
    if (!fs.existsSync(path.join(SCHEMA, f))) return { status: null, out: `${f} missing`, edited: false };
    let t = fs.readFileSync(path.join(SCHEMA, f), 'utf8');
    if (t.includes(HERE_LINE)) t = t.replace(HERE_LINE, () => `const HERE = ${JSON.stringify(SCHEMA.split(path.sep).join('/'))};`);
    if (f === 'roots.mjs') { const e = edit(t); if (e === t) return { status: null, out: 'the edit matched nothing in roots.mjs', edited: false }; t = e; }
    fs.writeFileSync(path.join(dir, f), t);
  }
  const r = spawnSync(process.execPath, [path.join(dir, 'generate.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}`, edited: true };
};
const dropPairs = (names) => (t) => t.split('\n').filter((l) => !names.some((n) => new RegExp(`\\{ gen: '${n}', hand:`).test(l))).join('\n');
const failLines = (out) => out.split(/\r?\n/).filter((l) => l.startsWith('FAIL')).join(' / ');

// the real run, read by cases 3, 4, 6
const real = spawnSync(process.execPath, [path.join(SCHEMA, 'generate.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
const realOut = real.stdout ?? '';
const line = (re) => realOut.split(/\r?\n/).find((l) => re.test(l)) ?? '';

// 1
{
  const r = runEdited('c1-brief', dropPairs(['DecisionBrief']));
  const want = 'DecisionBrief: a struct a client reads with no hand-written pair and no unpaired reason';
  check(1, 'the table with the DecisionBrief->Brief pair removed fails check:schema, naming DecisionBrief', r.edited && r.status === 1 && r.out.includes(want), `${r.edited ? 'exit ' + r.status : r.out}: ${failLines(r.out)}`);
}
// 2
const CONTRACT = ['DecisionBrief', 'FocusPlace', 'SharedView', 'SharedPlace', 'FocusPost', 'FocusAnswer', 'MorningDeck', 'AgentDeck', 'SteerRow', 'SteerPost'];
{
  const r = runEdited('c2-contract', dropPairs(CONTRACT));
  const named = CONTRACT.filter((n) => !['FocusPost', 'SteerPost'].includes(n)).every((n) => r.out.includes(`${n}: a struct a client reads with no hand-written pair`));
  check(2, 'the table with the ten contract pairs removed fails check:schema, each read struct named', r.edited && r.status === 1 && named, `${r.edited ? 'exit ' + r.status : r.out}: ${failLines(r.out)}`);
}
// 3
{
  const gens = rowsOk ? [...new Set(R.ROOTS.flatMap((row) => (row.pairs ?? []).map((p) => p.gen)))] : [];
  const l = line(/^ok {4}self-proof: a field added to each of the \d+ generated/);
  const listed = (/generated names?[^:]*: ([^)]*)\)/.exec(l)?.[1] ?? '').split(', ').filter(Boolean);
  const all = gens.length >= 16 && gens.every((g) => listed.includes(g)) && listed.length === gens.length && ['SteerRow', 'FocusAnswer', 'DecisionBrief', 'SteerPost'].every((g) => listed.includes(g));
  check(3, `check:schema's per-root self-proof probes every generated name in the table (${gens.length}), SteerRow and FocusAnswer included`, all, l || 'no self-proof line listing its names');
}
// 4
{
  const UNPAIRED = ['StructureEnvelope', 'ScanWire', 'SharedFocus', 'MorningWatch'];
  const reasoned = rowsOk ? R.ROOTS.filter((row) => typeof row.unpaired === 'string' && row.unpaired.length > 10).map((row) => row.root).sort() : [];
  const r = runEdited('c4-unreasoned', (t) => t.replace(/(\n\s*)unpaired: '[^']*'/, "$1zzNoReason: ''"));
  const first = rowsOk ? R.ROOTS.find((row) => row.unpaired)?.root : null;
  const named = first && r.out.includes(`${first}: a struct a client reads with no hand-written pair and no unpaired reason`);
  const selfProof = /^ok {4}control: a table row whose root is neither paired nor unpaired is reported, naming it/m.test(realOut);
  check(4, 'an unpaired root with its reason removed fails check:schema naming it; the four reasoned roots pass; the new-row control is in check:schema',
    JSON.stringify(reasoned) === JSON.stringify([...UNPAIRED].sort()) && r.status === 1 && named && selfProof && real.status === 0,
    `reasoned ${reasoned.join(',') || 'none'}; edited exit ${r.status}; named ${!!named}; control line ${selfProof}; real exit ${real.status}`);
}
// 5
{
  let ok = false, detail = P.__error ?? R.__error ?? '';
  if (rowsOk && typeof P.wireSource === 'function' && typeof P.compare === 'function') {
    const src = P.wireSource(ROOT);
    const exported = new Set();
    for (const m of src.matchAll(/^export type \{ ([^}]+) \} from '([^']+)';$/gm)) for (const n of m[1].split(',').map((s) => s.trim())) exported.add(`${path.relative(ROOT, m[2]).split(path.sep).join('/')}#${n}`);
    const want = new Set(R.ROOTS.flatMap((row) => row.pairs ?? []).filter((p) => p.hand.file !== R.HAND_TS).map((p) => `${p.hand.file}#${p.hand.name}`));
    const lines = src.split('\n').filter(Boolean);
    const same = exported.size === want.size && [...want].every((k) => exported.has(k)) && lines.every((l) => /^export type \{/.test(l));
    // a row whose hand name its file does not export: the compare throws as it did with the hand list
    const bent = structuredClone(R.ROOTS);
    bent.find((row) => row.root === 'DecisionBrief').pairs[0].hand.name = 'ZzNoSuchBrief';
    let threw = '';
    try {
      const gen = fs.readFileSync(path.join(SCHEMA, 'generated/ts/app-structure.ts'), 'utf8').replace(/\r\n/g, '\n');
      const hand = fs.readFileSync(path.join(ROOT, R.HAND_TS), 'utf8').replace(/\r\n/g, '\n');
      P.compare(gen, hand, P.wireSource(ROOT, bent), bent);
    } catch (e) { threw = e.message; }
    ok = same && threw === 'types.ts: no export ZzNoSuchBrief';
    detail = `${exported.size} exported vs ${want.size} in the table; bent threw ${JSON.stringify(threw)}`;
  }
  check(5, 'wireSource re-exports exactly the table\'s hand pairs, and a hand name its file does not export fails the compare', ok, detail);
}
// 6
{
  const g = spawnSync('git', ['grep', '-n', '--untracked', '-F', '-e', NEEDLE], { cwd: ROOT, encoding: 'utf8' });
  const hits = (g.stdout ?? '').split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith('packages/schema/roots.mjs:'));
  const ruled = /^ok {4}no text outside packages\/schema\/roots\.mjs imports ajv/m.test(realOut);
  const seeded = /^ok {4}control: a seeded ajv import in scripts\/[\w./-]+ is reported at scripts\/[\w./-]+:\d+/m.test(realOut);
  check(6, `git grep ${NEEDLE} outside packages/schema/roots.mjs has 0 hits, and check:schema owns the rule with a seeded control`, hits.length === 0 && ruled && seeded, `${hits.length} hits: ${hits.slice(0, 6).join(' | ')}; rule line ${ruled}; control line ${seeded}`);
}
// 7
{
  let ok = false, detail = R.__error ?? 'no schemaAjv export';
  if (typeof R.schemaAjv === 'function') {
    const a = R.schemaAjv();
    const byFile = a.getSchema('decision-brief-1.schema.json'), byId = a.getSchema('https://app-structure.example/schema/decision-brief-1.schema.json');
    const callers = ['packages/schema/generate.mjs', 'scripts/validate-structure.mjs', 'scripts/check-bplink.mjs', 'scripts/lib/wire-schema.ts', 'scripts/check-decision-brief.ts']
      .filter((f) => !fs.readFileSync(path.join(ROOT, f), 'utf8').includes('schemaAjv('));
    ok = typeof byFile === 'function' && typeof byId === 'function' && a.opts.allowUnionTypes === true && a.opts.strict === true && a.opts.strictRequired === false && R.schemaAjv() === a && !callers.length;
    detail = `byFile ${typeof byFile}, byId ${typeof byId}, allowUnionTypes ${a.opts.allowUnionTypes}, shared ${R.schemaAjv() === a}; not calling schemaAjv(): ${callers.join(', ') || 'none'}`;
  }
  check(7, 'schemaAjv() serves decision-brief-1 by file name and by $id, strict with allowUnionTypes, one instance, called by all five former ajv sites', ok, detail);
}
// 8
{
  const want = ['identity', 'C1-parity-no-extra', 'C2-parity-no-missing', 'C3-parity-optional-one-way', 'C4-parity-plan-pair-dropped', 'C5-parity-enum-missing-only', 'C6-parity-contract-pairs-dropped'];
  const r = spawnSync(process.execPath, [path.join(SCHEMA, 'mutants.mjs'), ROOT, ...want], { cwd: ROOT, encoding: 'utf8' });
  const blocks = new Map();
  let cur = null;
  for (const l of (r.stdout ?? '').split(/\r?\n/)) {
    const h = /^## ([^\s:]+)(?::|\s+exit (\S+))/.exec(l); // '## name  exit N' or '## name: HARNESS ERROR ...'
    if (h) { cur = { exit: h[2] ?? null, lines: [l] }; blocks.set(h[1], cur); } else if (cur) cur.lines.push(l);
  }
  const bad = want.filter((n) => {
    const b = blocks.get(n);
    if (!b || b.lines.some((l) => /LOADER\/CRASH|HARNESS ERROR/.test(l))) return true;
    return n === 'identity' ? b.exit !== '0' : !(b.exit === '1' && b.lines.some((l) => l.trim().startsWith('FAIL')));
  });
  check(8, 'mutants.mjs: identity exits 0, C1-C5 and the new C6 (contract pairs dropped) are caught', r.status === 0 && !bad.length, `exit ${r.status}; not as wanted: ${bad.join(', ')}; ${(r.stdout ?? '').slice(0, 200)}`);
}

// only the case dirs go: the node_modules junction stays (a recursive rm must never walk into the repo's node_modules)
for (const d of fs.readdirSync(TMP)) if (d !== 'node_modules') fs.rmSync(path.join(TMP, d), { recursive: true, force: true, maxRetries: 3 });
console.log(`check-schema-roots: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
