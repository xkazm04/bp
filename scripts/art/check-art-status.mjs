#!/usr/bin/env node
// Cases for scripts/art/status.mjs (npm run art:status), the read-only table of the apps/vr/ArtSource hand-off folders.
//   cli-json   --json on the real tree: one row per folder, each built, no problems (the verdict check:art gives)
//   stage      stageOf(manifest): awaiting-pick (with the generated options), ready-to-build, built, failing <gate>
//   drift      driftOf(folder, manifest, root): an altered sha256, a file the manifest does not list, the untouched manifest
//   stale      staleOf(folder, manifest, entryPoint, git) on a stub git: a commit that only edits comments is not stale,
//              a commit that changes code is
//   next       nextOf(manifest, entryPoint, root): the regenerate steps, a live script tagged with its ENTRY_POINTS note
//   text       the text table (header + one line per folder, 120 columns at most), --strict and exitCode(rows, opts)
//   pin        the module spawns nothing but git
//   guard      a run writes nothing: every manifest.json is byte-identical before and after
// Nothing here runs Blender, ComfyUI, Leonardo or any live script; the stale cases never touch real history.
// Run: node scripts/art/check-art-status.mjs   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const ART = path.join(REPO, 'apps', 'vr', 'ArtSource');
const STATUS = path.join(HERE, 'status.mjs');

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const finish = () => { console.log(`\n${failed ? `${failed} failed` : 'all passed'}`); process.exit(failed ? 1 : 0); };

const folders = fs.readdirSync(ART, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const readM = (f) => JSON.parse(fs.readFileSync(path.join(ART, f, 'manifest.json'), 'utf8'));
const digestAll = () => folders.map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ART, f, 'manifest.json'))).digest('hex')).join(',');

let mod = null;
try { mod = await import(pathToFileURL(STATUS).href); } catch (e) { check('status.mjs imports', false, e.message.split('\n')[0]); }
const fn = (name) => (mod && typeof mod[name] === 'function' ? mod[name] : null);
const run = (...args) => spawnSync(process.execPath, [STATUS, ...args], { cwd: REPO, encoding: 'utf8', timeout: 120000 });

// ---- cli-json and the guard ----------------------------------------------------------------------------------------
const before = digestAll();
{
  const r = run('--json');
  let rows = null;
  try { rows = JSON.parse(r.stdout); } catch { /* reported below */ }
  check('cli-json: --json exits 0 with a JSON array', r.status === 0 && Array.isArray(rows), `exit ${r.status}: ${(r.stderr || r.stdout || '').split('\n').find(Boolean) ?? ''}`);
  rows = Array.isArray(rows) ? rows : [];
  check(`cli-json: ${folders.length} rows whose ids equal the ArtSource folder names`, isDeepStrictEqual(rows.map((x) => x.id).sort(), folders), rows.map((x) => x.id).join(','));
  const keys = ['id', 'stage', 'problems', 'drift', 'stale', 'next'];
  check('cli-json: every row has id, stage, problems, drift, stale, next', rows.length > 0 && rows.every((x) => keys.every((k) => k in x)));
  const off = rows.filter((x) => x.stage !== 'built' || !Array.isArray(x.problems) || x.problems.length);
  check('cli-json: every row is "built" with problems [] (as check:art says)', rows.length > 0 && off.length === 0, off.map((x) => `${x.id}:${x.stage}:${x.problems}`).join(' | '));
}

// ---- stage ------------------------------------------------------------------------------------------------------------
{
  const stageOf = fn('stageOf');
  const notRun = { pass: false, note: 'not run' };
  const pending = {
    id: 'x', generator: [{ option: 'A' }, { option: 'B' }, { option: 'C' }, { option: 'D' }],
    gates: { input: { pass: false, note: 'owner has not picked' }, mesh_acceptance: notRun, scale: notRun, finishing: notRun, poly_budget: notRun },
  };
  const s1 = stageOf?.(pending);
  check('stage: input false, the rest "not run" -> awaiting-pick with options A-D from generator[].option', s1?.stage === 'awaiting-pick' && isDeepStrictEqual(s1?.options, ['A', 'B', 'C', 'D']), JSON.stringify(s1));
  const ready = structuredClone(pending); ready.gates.input = { pass: true, note: 'picked B' };
  check('stage: input true, mesh_acceptance "not run" -> ready-to-build', stageOf?.(ready)?.stage === 'ready-to-build', JSON.stringify(stageOf?.(ready)));
  const built = structuredClone(ready); for (const g of Object.keys(built.gates)) built.gates[g] = { pass: true, note: 'ok' };
  check('stage: all gates pass -> built', stageOf?.(built)?.stage === 'built', JSON.stringify(stageOf?.(built)));
  const failing = structuredClone(built); failing.gates.scale = { pass: false, note: 'height 9 cm over 7' };
  const s4 = stageOf?.(failing);
  check('stage: a measured gate false -> failing, naming that gate', s4?.stage === 'failing' && s4?.gate === 'scale', JSON.stringify(s4));
}

// ---- drift ------------------------------------------------------------------------------------------------------------
{
  const driftOf = fn('driftOf');
  const real = readM('light-table-frame');
  const altered = structuredClone(real);
  const k = Object.keys(altered.sha256)[0];
  altered.sha256[k] = '0'.repeat(64);
  check('drift: one sha256 entry altered (in memory) -> [{ file, why: "sha256 differs" }]', isDeepStrictEqual(driftOf?.('light-table-frame', altered, REPO), [{ file: k, why: 'sha256 differs' }]), JSON.stringify(driftOf?.('light-table-frame', altered, REPO)));
  check('drift: the untouched real manifest -> []', isDeepStrictEqual(driftOf?.('light-table-frame', real, REPO), []), JSON.stringify(driftOf?.('light-table-frame', real, REPO)));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-art-status-'));
  try {
    const dir = path.join(root, 'apps', 'vr', 'ArtSource', 'scratch');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    const m = { id: 'scratch', sha256: { 'a.txt': crypto.createHash('sha256').update('a\n').digest('hex') } };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
    check('drift: scratch folder, every file listed -> []', isDeepStrictEqual(driftOf?.('scratch', m, root), []), JSON.stringify(driftOf?.('scratch', m, root)));
    fs.mkdirSync(path.join(dir, 'evidence'));
    fs.writeFileSync(path.join(dir, 'evidence', 'extra.jpg'), 'x');
    check('drift: scratch folder with an extra file -> [{ file, why: "not in manifest" }]', isDeepStrictEqual(driftOf?.('scratch', m, root), [{ file: 'evidence/extra.jpg', why: 'not in manifest' }]), JSON.stringify(driftOf?.('scratch', m, root)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// ---- stale (stub git; the binding revision: only commits that change code lines count) --------------------------------
{
  const staleOf = fn('staleOf');
  const ep = { writer: 'scripts/art/w.mjs', scripts: ['scripts/art/w.mjs', 'scripts/art/x.mjs'] };
  const m = { ...readM('light-table-frame'), id: 'x' }; // a real lynx_commit; the census allows one assignment site, in the kit
  const H = '\u0001';
  const diff = (file, lines) => [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1,3 +1,3 @@', ...lines].join('\n');
  const commentOnly = [`${H}aaa1111 docs: reword`, diff('scripts/art/w.mjs', ['-// old words', '+// new words', ' const a = 1;', '-/* a block', '- * that spans */', '+/* a block', '+ * that moved */', '+   ', '-'])].join('\n');
  const code = [`${H}abc1234 fix: x`, diff('scripts/art/x.mjs', ['-const a = 1; // one', '+const a = 2; // one'])].join('\n');
  const calls = [];
  const stub = (out) => (args) => { calls.push(args); return out; };
  check('stale: a commit that only edits comments and blank lines -> []', isDeepStrictEqual(staleOf?.('x', m, ep, stub(commentOnly)), []), JSON.stringify(staleOf?.('x', m, ep, stub(commentOnly))));
  check('stale: a commit that changes a code line -> [{ sha, subject }]', isDeepStrictEqual(staleOf?.('x', m, ep, stub(code)), [{ sha: 'abc1234', subject: 'fix: x' }]), JSON.stringify(staleOf?.('x', m, ep, stub(code))));
  const both = `${commentOnly}\n${code}\n`;
  check('stale: of two commits only the code-changing one is counted', isDeepStrictEqual(staleOf?.('x', m, ep, stub(both)), [{ sha: 'abc1234', subject: 'fix: x' }]), JSON.stringify(staleOf?.('x', m, ep, stub(both))));
  const a = calls[calls.length - 1] ?? [];
  check('stale: git is asked for log -p -w <lynx_commit>..HEAD over exactly the declared scripts', a[0] === 'log' && a.includes('-p') && a.includes('-w') && a.includes(`${m.lynx_commit}..HEAD`) && isDeepStrictEqual(a.slice(a.indexOf('--') + 1), ep.scripts), JSON.stringify(a));
}

// ---- next -------------------------------------------------------------------------------------------------------------
{
  const nextOf = fn('nextOf');
  const { ENTRY_POINTS } = await import(pathToFileURL(path.join(HERE, 'score-assets.mjs')).href);
  const city = readM('city-backdrop');
  const want = city.regenerate.split(';').map((s) => s.trim()).filter(Boolean).map((s) => s.replaceAll('<repo-root>', REPO));
  const steps = nextOf?.(city, ENTRY_POINTS['city-backdrop'], REPO) ?? [];
  check('next: city-backdrop steps are regenerate split on ";" with <repo-root> filled', isDeepStrictEqual(steps.map((s) => s.cmd), want), JSON.stringify(steps.map((s) => s.cmd)));
  const leo = steps.filter((s) => s.live);
  check('next: city-backdrop - only the leonardo-studio.mjs step is live, "paid Leonardo Studio: spends studio credits"', leo.length === 1 && /scripts\/lookdev\/leonardo-studio\.mjs/.test(leo[0].cmd) && leo[0].live === 'paid Leonardo Studio: spends studio credits', JSON.stringify(leo));
  const lamp = nextOf?.(readM('lamp-agent'), ENTRY_POINTS['lamp-agent'], REPO) ?? [];
  const tr = lamp.filter((s) => s.live);
  check('next: lamp-agent - only the leonardo.mjs concept step is live, with the paid note (the Blender build is not)', tr.length === 1 && /leonardo\.mjs/.test(tr[0].cmd) && /paid/i.test(tr[0].live), JSON.stringify(tr));
  check('next: lamp-agent - no <repo> placeholder is left', lamp.length > 0 && lamp.every((s) => !/<repo(-root)?>/.test(s.cmd)), JSON.stringify(lamp.map((s) => s.cmd)));
  const frame = nextOf?.(readM('light-table-frame'), ENTRY_POINTS['light-table-frame'], REPO) ?? [];
  check('next: light-table-frame - no step is live', frame.length > 0 && frame.every((s) => !s.live), JSON.stringify(frame));
}

// ---- text, strict, exitCode ---------------------------------------------------------------------------------------
{
  const r = run();
  const lines = r.stdout.split('\n').filter((l) => l.length);
  check(`text: exit 0, a header plus ${folders.length} lines`, r.status === 0 && lines.length === folders.length + 1, `exit ${r.status}, ${lines.length} lines: ${r.stderr.split('\n').find(Boolean) ?? ''}`);
  const wide = lines.filter((l) => l.length > 120);
  check('text: every line is 120 columns at most', lines.length > 0 && wide.length === 0, wide.map((l) => l.length).join(','));
  const line = (id) => lines.find((l) => l.startsWith(id + ' ')) ?? '';
  check('text: city-backdrop and lamp-agent show PAID, light-table-frame neither', /\bPAID\b/.test(line('city-backdrop')) && /\bPAID\b/.test(line('lamp-agent')) && !/\b(PAID|GPU)\b/.test(line('light-table-frame')), [line('city-backdrop'), line('lamp-agent'), line('light-table-frame')].join(' | '));
  const s = run('--strict');
  check('text: --strict exits 0 on the current tree', s.status === 0, `exit ${s.status}`);
  const exitCode = fn('exitCode');
  const clean = [{ id: 'a', problems: [], drift: [] }];
  check('text: exitCode - clean rows give 0 strict and not', exitCode?.(clean, { strict: true }) === 0 && exitCode?.(clean, {}) === 0);
  check('text: exitCode - a row with problems gives 1 under strict, 0 without', exitCode?.([{ id: 'a', problems: ['gate x is not pass: true'], drift: [] }], { strict: true }) === 1 && exitCode?.([{ id: 'a', problems: ['p'], drift: [] }], { strict: false }) === 0);
  check('text: exitCode - a row with drift gives 1 under strict', exitCode?.([{ id: 'a', problems: [], drift: [{ file: 'f', why: 'not in manifest' }] }], { strict: true }) === 1);
}

// ---- pin and guard ------------------------------------------------------------------------------------------------------
{
  const src = fs.existsSync(STATUS) ? fs.readFileSync(STATUS, 'utf8') : '';
  const calls = [...src.matchAll(/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(\s*([^,)]*)/g)];
  check('pin: status.mjs has a spawn call and every one names git', calls.length > 0 && calls.every((c) => /^['"]git['"]$/.test(c[2].trim())), calls.map((c) => c[0]).join(' | ') || 'no spawn call');
  check('pin: status.mjs never imports a live script (leonardo.mjs, trellis_run.mjs)', src.length > 0 && !/import[^;]*(leonardo|trellis_run)\.mjs/.test(src));
  check('guard: every manifest.json is byte-identical after the runs (art:status writes nothing)', digestAll() === before);
}

finish();
