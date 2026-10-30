#!/usr/bin/env node
// The cross-repo drift report, bp's half of roadmap E5: how far a Personas checkout's ports of bp have drifted. It reads
// bp's contract manifest (packages/schema/contract.json, held by check:contract) and the Personas tree READ-ONLY, and
// prints:
//   ported     every Personas file that says "PORTED from bp <path>", with its pin when it has one
//              (`@ <commit>`, and `sha256:<hex>` of bp's LF bytes at that commit), the pins grouped by commit, and
//              whether each pinned commit exists in this bp repo
//   contract   per manifest file: in sync (a pin or a verbatim copy carries bp's current hash), behind (pinned at another
//              hash: the copy must follow bp), pinned by commit only (the hash at that commit is compared), or missing
//              (no port names it). Golden copies are found by content too: a Personas file with the same LF bytes.
// It is a report, never a gate: it is NOT in npm run check (a machine without a Personas checkout would print SKIP, and
// a SKIP fails the suite). --strict exits 1 when a contract file is behind or missing; --json prints the report as JSON.
//   node scripts/personas-drift.mjs --personas C:/t/hk-bp-ref-personas [--strict] [--json]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const P = opt('--personas') ?? process.env.BP_PERSONAS;
if (!P || !fs.existsSync(P)) { console.error(`personas-drift: name a Personas checkout with --personas <dir> (${P ? P + ' does not exist' : 'none given'})`); process.exit(2); }

const lf = (s) => s.replace(/\r\n/g, '\n');
const sha = (s) => crypto.createHash('sha256').update(lf(s), 'utf8').digest('hex');
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/schema/contract.json'), 'utf8'));

// ---------------------------------------------------------------------------------------------- the Personas tree
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'build', '.next', 'coverage', '.turbo', 'gen']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|rs|md|json|css|yaml|yml|toml|py)$/;
const files = [];
(function walk(d) {
  let ents = [];
  try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(d, e.name)); }
    else if (TEXT.test(e.name)) files.push(path.join(d, e.name));
  }
})(P);
const rel = (f) => path.relative(P, f).split(path.sep).join('/');
const read = (f) => { try { const st = fs.statSync(f); return st.size > 4 << 20 ? '' : fs.readFileSync(f, 'utf8'); } catch { return ''; } };

const MARK = /\bPORTED(?: VERBATIM)? from bp ([^\s,;)]+)([^\n]*)/g;
const ported = [], byHash = new Map(), goldenPins = [];
for (const f of files) {
  const text = read(f);
  if (!text) continue;
  byHash.set(sha(text), [...(byHash.get(sha(text)) ?? []), rel(f)]);
  const marks = [...text.matchAll(MARK)].map((m) => {
    const tail = m[2];
    const commit = /@\s*([0-9a-f]{7,40})\b/.exec(tail)?.[1];
    const hash = /sha256:([0-9a-f]{64})/.exec(tail)?.[1];
    return { bp: m[1].replace(/[.:]$/, ''), ...(commit ? { commit } : {}), ...(hash ? { sha256: hash } : {}) };
  });
  if (marks.length) ported.push({ file: rel(f), marks });
  // a golden copy's pin in a test: { path: '<bp path>', commit: '<sha>', sha256: '<hex>' }
  for (const m of text.matchAll(/path:\s*['"]([^'"]+)['"][\s\S]{0,240}?commit:\s*['"]([0-9a-f]{7,40})['"][\s\S]{0,240}?sha256:\s*['"]([0-9a-f]{64})['"]/g)) goldenPins.push({ file: rel(f), bp: m[1], commit: m[2], sha256: m[3] });
}

// ---------------------------------------------------------------------------------------------- pins
const commits = new Map();
for (const p of ported) for (const m of p.marks) if (m.commit) commits.set(m.commit, (commits.get(m.commit) ?? 0) + 1);
const known = (c) => git('cat-file', '-e', `${c}^{commit}`).status === 0;
const pinnedFiles = ported.filter((p) => p.marks.some((m) => m.commit));
const hashAt = (commit, bpPath) => { const r = git('show', `${commit}:${bpPath}`); return r.status === 0 ? sha(r.stdout) : null; };

// ---------------------------------------------------------------------------------------------- the contract
const mirrorsOf = (f) => f.mirrors ?? [];
const contract = manifest.files.map((f) => {
  const now = f.sha256, names = [f.path, ...mirrorsOf(f)];
  const pins = [
    ...ported.flatMap((p) => p.marks.filter((m) => names.includes(m.bp)).map((m) => ({ by: p.file, ...m }))),
    ...goldenPins.filter((g) => names.includes(g.bp)).map((g) => ({ by: g.file, bp: g.bp, commit: g.commit, sha256: g.sha256 })),
  ];
  const copies = byHash.get(now) ?? [];
  const reads = pins.map((p) => {
    const h = p.sha256 ?? (p.commit && known(p.commit) ? hashAt(p.commit, p.bp) : null);
    return { ...p, at: h, state: !h ? 'pinned, hash unknown' : h === now ? 'in sync' : 'behind' };
  });
  const state = reads.some((r) => r.state === 'in sync') || copies.length ? (reads.some((r) => r.state === 'behind') ? 'mixed' : 'in sync')
    : reads.some((r) => r.state === 'behind') ? 'behind' : reads.length ? 'pinned, hash unknown' : 'missing';
  return { path: f.path, role: f.role, sha256: now, state, pins: reads, copies };
});

const report = {
  bp: { head: git('rev-parse', '--short', 'HEAD').stdout.trim(), contract: manifest.contract, rev: manifest.rev },
  personas: { dir: P, head: spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: P, encoding: 'utf8' }).stdout?.trim() || '?' },
  ported: { files: ported.length, pinned: pinnedFiles.length, byCommit: Object.fromEntries([...commits].sort((a, b) => b[1] - a[1])), unknownCommits: [...commits.keys()].filter((c) => !known(c)), list: ported },
  contract,
};
if (argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)); }
else {
  const short = (h) => (h ? h.slice(0, 12) : '-');
  console.log(`personas-drift: bp ${report.bp.head} (${manifest.contract} rev ${manifest.rev}) against Personas ${report.personas.head} at ${P}`);
  console.log(`\nported: ${ported.length} Personas files say "PORTED from bp"; ${pinnedFiles.length} name a commit (${Object.entries(report.ported.byCommit).map(([c, n]) => `${n} @ ${c}`).join(', ') || 'none'})${report.ported.unknownCommits.length ? `; not in this bp repo: ${report.ported.unknownCommits.join(', ')}` : ''}`);
  for (const p of ported) for (const m of p.marks) console.log(`  ${m.commit ? (m.sha256 ? 'pinned+hash' : 'pinned     ') : 'unpinned   '}  ${p.file}  <-  ${m.bp}${m.commit ? ' @ ' + m.commit : ''}${m.sha256 ? ' sha256:' + short(m.sha256) : ''}`);
  console.log(`\ncontract: ${contract.length} files in packages/schema/contract.json`);
  for (const c of contract) {
    console.log(`  ${c.state.padEnd(20)} ${c.role.padEnd(11)} ${c.path}  (bp sha256 ${short(c.sha256)})`);
    for (const r of c.pins) console.log(`      pin  ${r.by}: ${r.bp}${r.commit ? ' @ ' + r.commit : ''} -> ${r.state}${r.at && r.at !== c.sha256 ? ` (pinned ${short(r.at)})` : ''}`);
    for (const x of c.copies) console.log(`      copy ${x} (same bytes)`);
  }
  const n = (s) => contract.filter((c) => c.state === s).length;
  console.log(`\nsummary: ${n('in sync')} in sync, ${n('behind') + n('mixed')} behind, ${n('pinned, hash unknown')} pinned without a readable hash, ${n('missing')} missing in Personas, of ${contract.length} contract files`);
}
const bad = contract.filter((c) => c.state !== 'in sync').length;
process.exit(argv.includes('--strict') && bad ? 1 : 0);
