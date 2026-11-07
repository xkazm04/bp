// Pins the one check protocol (scripts/lib/expect.ts) and the ratchet that keeps checks on it. npm run check reads two text
// conventions from its children: a line starting FAIL is kept in the red report above the 25-line tail
// (scripts/lib/check-report.mjs), and a line starting SKIP fails the suite (scripts/check-all.mjs). Nothing made a child
// follow either: 133 of 151 check files carried a hand harness (121 after this card), and check-overlays printed its
// failure details indented by two spaces, so a red run past 24 failure lines lost its header and its first failures
// (measured: a 30-failure output in that shape kept neither the header nor failures 1-5). The harness prints the conventions at the source. Cases:
//   1  expect(true) x2 + expect(false, 'c broke') -> exactly one `FAIL  c broke`, last line
//      RESULT {"check":"x","held":2,"failed":1,"skipped":0}, exit 1
//   2  no expectation at all -> `FAIL  x: no expectation ran`, exit 1 (a check that asserted nothing is not green)
//   3  skip('no LAN on this machine') + one held -> `SKIP  no LAN on this machine` (check-all's /^\s*SKIP\b/), RESULT
//      skipped 1, exit 0; and the same child run under a copy of check-all (BP_CHECK_ONLY) is FAILED as an unforgiven
//      SKIP, unless check-all's opt-out list names it and its condition holds (check:python-syntax with python hidden)
//   4  an expect() after done() is not dropped: `FAIL  x: expectation after done(): <what>`, exit 1
//   5  check-overlays' own BP_OVERLAYS_MUTATE control: exit 1 and every failure line starts `FAIL  `; failReport over a
//      30-failure harness output keeps all 30
//   7  a check file (tracked or new) that declares its own `const|let expect|check|ok|assert = (` and is not in LEGACY
//      below fails, named; a LEGACY file that no longer declares one fails too (remove it: the ceiling only goes down)
//   8  a file that imports scripts/lib/expect.ts AND declares a local harness fails, named with its line
// Case 6 (each migrated check green with one RESULT line) is every migrated check's own run under npm run check; this file
// asserts each of them imports the harness and calls done(). This file cannot report through the harness it tests, so it
// keeps one counter of its own (`fact`), outside the ratchet's names on purpose.
// Run: node scripts/check-harness.mjs   (exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { failReport } from './lib/check-report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'scripts/lib/expect.ts');
const LIB_URL = pathToFileURL(LIB).href;
let passed = 0, failed = 0;
const fact = (ok, name, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL  ' + name + (detail ? ': ' + detail : '')); } };

// The checks this card moved onto the harness (case 6). A check migrated later joins this list and leaves LEGACY.
const MIGRATED = [
  'scripts/check-overlays.ts', 'scripts/check-sim-blockers.ts', 'scripts/check-morning-cursor.ts', 'scripts/check-timeview.ts',
  'scripts/check-search.ts', 'scripts/check-camera.ts', 'scripts/check-sim-answers.ts', 'scripts/check-sim-orders.ts',
  'scripts/check-sim-precedent.ts', 'scripts/check-legacy-unmeasured.mjs', 'scripts/check-stream-status.mjs',
  'scripts/check-route-guards.mjs',
];

// The hand-harness ceiling: the check files that still declare their own harness. Measured at the migration; it only goes
// DOWN. A new check imports scripts/lib/expect.ts instead; migrating one of these removes its line in the same change.
const LEGACY = [
  'apps/server/src/check-mount.ts', 'apps/web/src/components/rail/check-keys.ts',
  'apps/web/src/components/sheet/check-rows.ts', 'apps/web/src/components/sheet/check-screens-strip.ts',
  'apps/web/src/components/timeline/check-changes.ts', 'apps/web/src/components/timeline/check-keys.ts',
  'apps/web/src/components/timeline/check-run.ts', 'apps/web/src/components/timeline/check-scrub.ts',
  'apps/web/src/components/timeline/check-size.ts', 'apps/web/src/components/timeline/check-slider.ts',
  'apps/web/src/variants/check-copies.ts', 'packages/core/check-standard.mjs', 'scripts/art/check-art-scripts.mjs',
  'scripts/art/check-art-status.mjs', 'scripts/check-aggregate-report.mjs', 'scripts/check-athena-host.mjs',
  'scripts/check-bold-decor.ts', 'scripts/check-bold-schedule.ts', 'scripts/check-bplink.mjs',
  'scripts/check-build-admit.ts', 'scripts/check-build-forecast.ts', 'scripts/check-buildup-live.ts',
  'scripts/check-channel-seam.ts', 'scripts/check-claims.ts', 'scripts/check-clear-cover.ts',
  'scripts/check-clear-path.ts', 'scripts/check-companion-brain.ts', 'scripts/check-companion-card-summary.ts',
  'scripts/check-companion-door.ts', 'scripts/check-companion-runtime.ts', 'scripts/check-companion-web.ts',
  'scripts/check-compare.ts', 'scripts/check-crossing.ts', 'scripts/check-decision-brief.ts', 'scripts/check-deep-link.ts',
  'scripts/check-engine-copy.ts', 'scripts/check-engine-harness.ts', 'scripts/check-engine-lines.ts',
  'scripts/check-engine-store.ts', 'scripts/check-fake-claude.mjs', 'scripts/check-fixtures.ts',
  'scripts/check-gate-helpers.mjs', 'scripts/check-job-journal.ts', 'scripts/check-kettle-host-reload.mjs',
  'scripts/check-kettle-sim.mjs', 'scripts/check-lan-door.ts', 'scripts/check-landed.ts', 'scripts/check-ledger-guards.ts',
  'scripts/check-ledger-intents.ts', 'scripts/check-lens-chat-keep.ts', 'scripts/check-lens-manifest.ts',
  'scripts/check-live-health.ts', 'scripts/check-live-steer.ts', 'scripts/check-live-tracks.ts',
  'scripts/check-loader-json.mjs', 'scripts/check-local-only.ts', 'scripts/check-model.ts',
  'scripts/check-morning-brief.ts', 'scripts/check-morning-watch.ts', 'scripts/check-on-main.ts',
  'scripts/check-onboarding-feed.ts', 'scripts/check-onboarding.ts', 'scripts/check-outcome-evidence.ts',
  'scripts/check-outcome.ts', 'scripts/check-place-baton.ts', 'scripts/check-place-words.ts',
  'scripts/check-plan-islands.mjs', 'scripts/check-preview-seat.ts', 'scripts/check-purge.ts',
  'scripts/check-readiness.ts', 'scripts/check-release-notes.ts', 'scripts/check-release-preflight.ts',
  'scripts/check-release-slice.ts', 'scripts/check-release-states.ts', 'scripts/check-release-steps.ts',
  'scripts/check-release-tag.ts', 'scripts/check-release-train.ts', 'scripts/check-release-words.ts',
  'scripts/check-render-units.ts', 'scripts/check-replay-flags.ts', 'scripts/check-route-door.ts',
  'scripts/check-rules-panel.ts', 'scripts/check-rules.ts', 'scripts/check-scan-client.ts',
  'scripts/check-scan-demo-train.mjs', 'scripts/check-scan-demo.mjs', 'scripts/check-scan-jobs.ts',
  'scripts/check-scan-liveness.ts', 'scripts/check-scan-wire.ts', 'scripts/check-schema-compat.mjs',
  'scripts/check-schema-roots.mjs', 'scripts/check-schema-vocab.mjs', 'scripts/check-server.mjs',
  'scripts/check-shaped-legend.ts', 'scripts/check-shared-focus.ts', 'scripts/check-sim-undo.ts',
  'scripts/check-store-compare.ts', 'scripts/check-store-triage.ts', 'scripts/check-subtle-health-ink.ts',
  'scripts/check-surfaces.ts', 'scripts/check-switcher.ts', 'scripts/check-theme-colors.ts',
  'scripts/check-train-budget.ts', 'scripts/check-train-parity.ts', 'scripts/check-train-pending.ts',
  'scripts/check-train-plan.ts', 'scripts/check-train-reasons.ts', 'scripts/check-train-sim.ts',
  'scripts/check-train-undo.ts', 'scripts/check-train-wire.ts', 'scripts/check-triage-cap.ts',
  'scripts/check-trouble-index.ts', 'scripts/check-variant-chunk.ts', 'scripts/check-vr-approve.ts',
  'scripts/check-vr-decline.ts', 'scripts/check-vr-tour.ts', 'scripts/check-wave-arrange.ts',
  'scripts/check-wave-bench.ts', 'scripts/check-waves.ts', 'scripts/check-web-bind.mjs',
  'scripts/lookdev/check-leonardo.mjs',
];

const HAND = /^\s*(?:const|let)\s+(expect|check|ok|assert)\s*=\s*\(/;
const LOCAL = /^\s*(?:(?:const|let)\s+(expect|check|ok|assert)\s*=\s*\(|function\s+(expect|check)\s*\()/;
const IMPORTS_LIB = /from\s+['"](?:\.\/|\.\.\/)*(?:scripts\/)?lib\/expect\.ts['"]/;
const CHECK_FILE = /(^|\/)check-[^/]*\.(m?js|ts)$/;

/** Problems of a set of check files ({ rel, text }) against the LEGACY ceiling. */
export const audit = (files, legacy = LEGACY) => {
  const bad = [], hand = [];
  for (const { rel, text } of files) {
    const lines = text.split(/\r?\n/);
    const decl = lines.findIndex((l) => HAND.test(l));
    if (decl >= 0) hand.push(rel);
    if (IMPORTS_LIB.test(text)) {
      const local = lines.findIndex((l) => LOCAL.test(l));
      if (local >= 0) bad.push(`${rel}:${local + 1} imports scripts/lib/expect.ts and still declares a local harness: ${lines[local].trim().slice(0, 80)}`);
    } else if (decl >= 0 && !legacy.includes(rel)) {
      bad.push(`${rel}:${decl + 1} declares its own harness, over the hand-harness ceiling of ${legacy.length}: import { harness } from scripts/lib/expect.ts`);
    }
  }
  for (const rel of legacy) if (!hand.includes(rel)) bad.push(`${rel} is in LEGACY but declares no hand harness now: remove its line (the ceiling goes down)`);
  return { bad, hand };
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-check-harness-'));
try {
  /** Run a fixture body (ES module source, `harness` in scope) and return { code, out, lines }. */
  const fixture = (name, body, env = {}) => {
    const file = path.join(tmp, `${name}.mjs`);
    fs.writeFileSync(file, `import { harness } from ${JSON.stringify(LIB_URL)};\n${body}\n`);
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8', env: { ...process.env, ...env } });
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    return { code: r.status, out, stdout: r.stdout ?? '', lines: (r.stdout ?? '').split(/\r?\n/).filter(Boolean), file };
  };
  const libThere = fs.existsSync(LIB);
  fact(libThere, 'scripts/lib/expect.ts exists');

  // 1
  const c1 = fixture('c1', "const h = harness('x'); h.expect(true, 'a'); h.expect(true, 'b'); h.expect(false, 'c broke'); h.done();");
  fact(c1.lines.filter((l) => /^FAIL  c broke$/.test(l)).length === 1 && c1.lines.filter((l) => /^\s*FAIL\b/.test(l)).length === 1,
    'case 1: exactly one FAIL line, `FAIL  c broke`', c1.out.slice(0, 300));
  fact(c1.lines.at(-1) === 'RESULT {"check":"x","held":2,"failed":1,"skipped":0}', 'case 1: the last line is the RESULT line', JSON.stringify(c1.lines.at(-1)));
  fact(c1.code === 1, 'case 1: exit 1', String(c1.code));

  // 2
  const c2 = fixture('c2', "harness('x').done();");
  fact(c2.code === 1 && c2.lines.some((l) => /^FAIL  x: no expectation ran$/.test(l)), 'case 2: no expectation -> `FAIL  x: no expectation ran`, exit 1', `${c2.code} ${c2.out.slice(0, 200)}`);

  // 3
  const skipBody = "const h = harness('x'); h.skip('no LAN on this machine'); h.expect(true, 'held'); h.done();";
  const c3 = fixture('c3', skipBody);
  fact(c3.lines.includes('SKIP  no LAN on this machine') && c3.lines.filter((l) => /^\s*SKIP\b/.test(l)).length === 1, 'case 3: one `SKIP  no LAN on this machine` line', c3.out.slice(0, 200));
  fact(c3.lines.at(-1) === 'RESULT {"check":"x","held":1,"failed":0,"skipped":1}' && c3.code === 0, 'case 3: RESULT skipped 1, exit 0', `${c3.code} ${c3.lines.at(-1)}`);
  // ... and check-all fails it. A throwaway root holds byte copies of check-all.mjs and check-report.mjs and a package.json
  // whose one check runs that fixture, so the runner's own skip policy (not a re-implementation) is what decides.
  {
    const root = path.join(tmp, 'root');
    fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/check-all.mjs'), path.join(root, 'scripts/check-all.mjs'));
    fs.copyFileSync(path.join(ROOT, 'scripts/lib/check-report.mjs'), path.join(root, 'scripts/lib/check-report.mjs'));
    const run = (name, env = {}) => {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { [name]: `node ${JSON.stringify(c3.file)}` } }));
      const r = spawnSync(process.execPath, [path.join(root, 'scripts/check-all.mjs')], {
        cwd: root, encoding: 'utf8', env: { ...process.env, BP_CHECK_ONLY: name, BP_CHECK_RECORD: path.join(tmp, 'record.json'), ...env },
      });
      return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
    };
    const plain = run('check:fixture');
    fact(plain.code === 1 && /^FAIL  check:fixture\b/m.test(plain.out) && /exited 0 but printed SKIP/.test(plain.out) && /SKIP  no LAN on this machine/.test(plain.out),
      'case 3: under check-all a harness skip() is FAILED as an unforgiven SKIP', plain.out.slice(-600));
    // The opt-out: check:python-syntax is forgiven only where check-all finds no python. Hide every PATH directory that holds
    // a python launcher; if that does not hide it on this machine, the visible-python arm (must fail) is what is asserted.
    const PY = ['python', 'python3', 'py'].flatMap((n) => [n, n + '.exe']);
    const hidden = (process.env.PATH ?? '').split(path.delimiter).filter((d) => !PY.some((n) => { try { return fs.statSync(path.join(d, n)).isFile(); } catch { return false; } })).join(path.delimiter);
    const pyVisible = (p) => ['python', 'python3', 'py'].some((c) => spawnSync(c, ['--version'], { stdio: 'ignore', env: { ...process.env, PATH: p, Path: p } }).status === 0);
    const seen = run('check:python-syntax');
    fact(pyVisible(process.env.PATH ?? '') ? seen.code === 1 && /exited 0 but printed SKIP/.test(seen.out) : seen.code === 0,
      'case 3: the opt-out does not forgive check:python-syntax\'s skip where python is on PATH', seen.out.slice(-400));
    if (!pyVisible(hidden)) {
      const opted = run('check:python-syntax', { PATH: hidden, Path: hidden });
      fact(opted.code === 0 && /^PASS  check:python-syntax\b/m.test(opted.out), 'case 3: with python hidden, the opt-out list forgives check:python-syntax\'s skip', opted.out.slice(-400));
    } else console.log('note: python could not be hidden from PATH here; the forgiving arm of the opt-out was not exercised');
  }

  // 4
  const c4 = fixture('c4', "const h = harness('x'); h.expect(true, 'early'); h.done(); setTimeout(() => h.expect(true, 'late thing'), 20);");
  fact(c4.code === 1 && c4.lines.some((l) => l === 'FAIL  x: expectation after done(): late thing'), 'case 4: an expect after done() prints its FAIL and exits 1', `${c4.code} ${c4.out.slice(0, 300)}`);
  // and a check that forgets done() is not green either
  const c4b = fixture('c4b', "const h = harness('x'); h.expect(true, 'only');");
  fact(c4b.code === 1 && c4b.lines.some((l) => /^FAIL  x: done\(\) was never called/.test(l)), 'a harness whose done() never ran exits 1 with a FAIL line', `${c4b.code} ${c4b.out.slice(0, 200)}`);
  // multi-line failure text keeps every line FAIL-anchored
  const c4c = fixture('c4c', "const h = harness('x'); h.expect(false, 'two\\nlines'); h.expect(false, 'with', { d: 1 }); h.done();");
  fact(c4c.lines.filter((l) => /^FAIL\b/.test(l)).length === 3 && c4c.lines.includes('FAIL  with: {"d":1}'), 'a multi-line failure and a detail stay FAIL-anchored', c4c.out.slice(0, 300));

  // 5
  const ov = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-overlays.ts')], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, BP_OVERLAYS_MUTATE: '[["Phone.tsx","height: 44","height: 40"]]' },
  });
  const ovLines = ((ov.stdout ?? '') + (ov.stderr ?? '')).split(/\r?\n/).filter(Boolean);
  const ovRes = ovLines.filter((l) => l.startsWith('RESULT '));
  const ovFail = ovLines.filter((l) => /^FAIL  /.test(l));
  fact(ov.status === 1 && ovFail.length >= 1 && !ovLines.some((l) => /^ {2}\S/.test(l)) && ovRes.length === 1 && JSON.parse(ovRes[0].slice(7)).failed === ovFail.length,
    'case 5: check-overlays\' mutation control exits 1 and every failure line starts `FAIL  `', `exit ${ov.status}: ${ovLines.slice(0, 4).join(' | ')}`);
  const c5 = fixture('c5', "const h = harness('x'); for (let i = 1; i <= 40; i++) h.note('note ' + i); for (let i = 1; i <= 30; i++) h.expect(false, 'expectation #' + i + ' broke'); for (let i = 0; i < 62; i++) h.expect(true, 'ok'); h.done();");
  const rep = failReport('check:x', c5.out);
  fact(Array.from({ length: 30 }, (_, i) => `FAIL  expectation #${i + 1} broke`).every((l) => rep.split(/\r?\n/).includes(l)), 'case 5: failReport over a 30-failure harness output keeps all 30', rep.slice(0, 200));

  // 6 (static half): every migrated check reports through the harness
  for (const rel of MIGRATED) {
    const text = fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : '';
    fact(IMPORTS_LIB.test(text) && /\bharness\(\s*['"]/.test(text) && /\.done\(|\bdone\(/.test(text), `case 6: ${rel} imports the harness and calls done()`);
  }

  // 7 + 8 over the tree (tracked and new files)
  const ls = (args) => spawnSync('git', ['ls-files', ...args], { cwd: ROOT, encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
  const rels = [...new Set([...ls([]), ...ls(['--others', '--exclude-standard'])])].filter((r) => CHECK_FILE.test(r) && fs.existsSync(path.join(ROOT, r)));
  const tree = rels.map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }));
  const now = audit(tree);
  fact(rels.length > 100, `the scan found the check files (${rels.length})`);
  for (const b of now.bad) fact(false, 'hand-harness ratchet', b);
  // the seeded controls: a new hand harness, and a migrated file that kept its local one
  const decl = 'const expect' + ' = (ok: boolean, what: string) => { if (ok) held++; };';
  const seeded = audit([...tree, { rel: 'scripts/check-seeded-hand.ts', text: `let held = 0;\n${decl}\n` }]);
  fact(seeded.bad.some((b) => b.startsWith('scripts/check-seeded-hand.ts:2 ') && /over the hand-harness ceiling/.test(b)), 'case 7: a seeded new hand harness fails, named as over the ceiling', seeded.bad.join(' | '));
  const both = audit([...tree, { rel: 'scripts/check-seeded-both.ts', text: `import { harness } from './lib/expect.ts';\nconst h = harness('y');\n${decl}\n` }]);
  fact(both.bad.some((b) => b.startsWith('scripts/check-seeded-both.ts:3 ') && /still declares a local harness/.test(b)), 'case 8: a file importing the harness that keeps a local one fails, named with its line', both.bad.join(' | '));
  const gone = audit(tree, [...LEGACY, 'scripts/check-not-a-file.ts']);
  fact(gone.bad.some((b) => b.startsWith('scripts/check-not-a-file.ts is in LEGACY')), 'a LEGACY entry with no hand harness fails (the ceiling only goes down)');
  console.log(`check-harness: ${now.hand.length} hand harnesses of ${rels.length} check files (ceiling ${LEGACY.length}); ${MIGRATED.length} migrated`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`check-harness: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
