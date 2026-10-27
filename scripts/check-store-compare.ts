// Verifies the mirror that packages/core/src/scan/compare.ts claims (and docs/blueprint-ui.md "mirroring store.mjs `compare`"):
// compareOf is "store.mjs `compare`" - an item's `before` and `after` readings ordered (lens, metric, measured_at, id) and its
// shots paired by (theme, size), the latest capture of each phase - and packItems orders a pack "as store.mjs `proposals --pack`".
// scripts/check-release-train.ts proves compareOf against hand-built snapshots; this proves it against the OTHER implementation.
//
// store.mjs is lens-scan's, outside this tree. It is found the way release.server.ts finds it (storeScript(): BP_LENS_SCAN_DIR,
// ~/.claude/skills/lens-scan, then <registry.local>/skills/lens-scan from .ai/manifest.yaml), never at a fixed sibling path, and
// IMPORTED, so its own `openStore` builds the store and its own `compare`/`proposals` answer. One fixture is written into a temp
// store (rows inserted out of order, tied timestamps, two phases per (theme, size), a null theme and size, a null phase, another
// item's rows, an unlinked reading); the rows then become the snapshot compareOf reads, in REVERSED order so its sort has to work.
// The two are compared by row id (readings, shots, pairs, in order), and unknown ids by absence.
// No store.mjs: BP_LENS_SCAN_DIR set, BP_REQUIRE_LENS_SCAN=1 or CI -> FAIL naming what was searched; otherwise a bare checkout
// without its registry prints a SKIP line the runner tallies. BP_REQUIRE_LENS_SCAN=0 waives.
// Run: node scripts/check-store-compare.ts   (Node type stripping; exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = ''): void => { if (ok) passed++; else failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

type Row = Record<string, unknown>;
/** What store.mjs `compare` answers for one item, reduced to ids: [proposal, before ids, after ids, [theme, size, before shot id, after shot id]...]. */
export type Digest = { id: unknown; before: unknown[]; after: unknown[]; shots: unknown[][] };

/** store.mjs's answer for one item, as a Digest. */
export function digestOfStore(c: { proposal: Row; before: Row[]; after: Row[]; shots: Row[] }): Digest {
  return { id: c.proposal.id, before: c.before.map((m) => m.id), after: c.after.map((m) => m.id),
    shots: c.shots.map((s) => [s.theme ?? null, s.size ?? null, (s.before as Row | undefined)?.id ?? null, (s.after as Row | undefined)?.id ?? null]) };
}
/** compareOf's answer for one item, as a Digest. */
export function digestOfMirror(c: { p: Row; before: Row[]; after: Row[]; shots: { theme?: string; size?: string; before?: Row; after?: Row }[] }): Digest {
  return { id: c.p.id, before: c.before.map((m) => m.id), after: c.after.map((m) => m.id),
    shots: c.shots.map((s) => [s.theme ?? null, s.size ?? null, s.before?.id ?? null, s.after?.id ?? null]) };
}

if (import.meta.main) {
  // compare.ts is relative-importing and type-only elsewhere, so it loads as it is; release.server.ts needs the source hooks
  const HOOKS = './lib/src-hooks.mjs';
  ((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
  const { compareOf, packItems } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/scan/compare.ts')).href) as typeof import('../packages/core/src/scan/compare.ts');
  const RS = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/server/release.server.ts')).href) as typeof import('../packages/core/src/server/release.server.ts');
  const script = RS.storeScript();
  const named = process.env.BP_LENS_SCAN_DIR;
  const required = process.env.BP_REQUIRE_LENS_SCAN !== '0' && (process.env.BP_REQUIRE_LENS_SCAN === '1' || !!process.env.CI || named !== undefined);

  // the differ is shown to see a difference without store.mjs at all
  const d0: Digest = { id: 'a', before: [1, 2], after: [3], shots: [['dark', 'lg', 1, 2]] };
  check('control: digests of identical answers are equal, and a reordered reading or a swapped shot is a difference',
    JSON.stringify(d0) === JSON.stringify(structuredClone(d0)) && JSON.stringify(d0) !== JSON.stringify({ ...d0, before: [2, 1] })
    && JSON.stringify(d0) !== JSON.stringify({ ...d0, shots: [['dark', 'lg', 2, 1]] }));

  if (!script) {
    check('lens-scan store.mjs is found (BP_LENS_SCAN_DIR, ~/.claude/skills/lens-scan or the manifest\'s registry.local)', !required,
      'searched ' + (named !== undefined ? `BP_LENS_SCAN_DIR=${named}` : RS.lensScanDirs().join(' and ')) + ' - none holds scripts/store.mjs; BP_REQUIRE_LENS_SCAN=0 waives');
    if (!required) console.log('SKIP compareOf and packItems against store.mjs (lens-scan not installed here and nothing requires it; set BP_LENS_SCAN_DIR)');
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-store-compare-'));
    let open: { close: () => void } | null = null;
    try {
      const S = await import(pathToFileURL(script).href) as {
        openStore: (p: string) => { prepare: (sql: string) => { run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] }; close: () => void };
        compare: (db: unknown, o: { ids?: string[]; pack?: string }) => Parameters<typeof digestOfStore>[0][];
        proposals: (db: unknown, o: { pack?: string }) => Row[];
        clean: (r: Row) => Row;
      };
      const db = S.openStore(path.join(dir, 'scan.db'));
      open = db;
      const T = (h: number, m = 0): string => `2026-10-14T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
      db.prepare("INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('r1', ?, ?, 'measure', 'done', '[\"dev\"]')").run(T(0), T(0));
      db.prepare("INSERT INTO packs (id, lens, n, branch, base_ref, base_sha, run_id, status, created_at, updated_at) VALUES ('k1', 'dev', 1, 'pack/k-1', 'main', 'abc', 'r1', 'open', ?, ?)").run(T(0), T(0));
      const prop = db.prepare("INSERT INTO proposals (id, run_id, feature, lens, metric, title, kind, status, expected_delta, pack_id, created_at, updated_at) VALUES (?, 'r1', 'f', 'dev', 'cov', 't', 'fix', 'done', 5, ?, ?, ?)");
      // created_at ties: p2 and p1 share a minute, so the id breaks the tie; p0 is created LAST but sorts first by id, so an id-only order differs
      prop.run('p2', 'k1', T(1), T(1)); prop.run('p1', 'k1', T(1), T(1)); prop.run('p0', 'k1', T(5), T(5)); prop.run('px', null, T(2), T(2));
      const meas = db.prepare('INSERT INTO measurements (run_id, feature, lens, metric, value, measured_at, proposal_id, phase) VALUES (\'r1\', \'f\', ?, ?, ?, ?, ?, ?)');
      // p1 before: stored out of order across lens, metric and time, with a tie on (lens, metric, measured_at)
      meas.run('dev', 'cov', 60, T(3), 'p1', 'before'); meas.run('dev', 'cov', 50, T(1), 'p1', 'before'); meas.run('design', 'z', 1, T(9), 'p1', 'before');
      meas.run('dev', 'aaa', 7, T(5), 'p1', 'before'); meas.run('dev', 'cov', 55, T(1), 'p1', 'before'); meas.run('dev', 'cov', 58, T(2), 'p1', 'before');
      meas.run('dev', 'cov', 70, T(4), 'p1', 'after'); meas.run('dev', 'cov', 65, T(4), 'p1', 'after'); meas.run('dev', 'cov', 60, T(2), 'p1', 'after'); meas.run('dev', 'bbb', 2, T(1), 'p1', 'after');
      // other rows that must not appear: another item's, an unlinked reading, a linked one with no phase
      meas.run('dev', 'cov', 99, T(1), 'p2', 'before'); meas.run('dev', 'cov', 98, T(6), null, null); meas.run('dev', 'cov', 97, T(6), 'p1', null);
      const shot = db.prepare("INSERT INTO shots (run_id, feature, path, size, theme, captured_at, proposal_id, phase) VALUES ('r1', 'f', 'p.png', ?, ?, ?, ?, ?)");
      shot.run('lg', 'dark', T(1), 'p1', 'before'); shot.run('lg', 'dark', T(3), 'p1', 'before'); shot.run('lg', 'dark', T(2), 'p1', 'after'); shot.run('lg', 'dark', T(4), 'p1', 'after');
      shot.run('lg', 'light', T(1), 'p1', 'before'); shot.run('sm', 'light', T(2), 'p1', 'after'); shot.run('sm', 'light', T(2), 'p1', 'after'); shot.run(null, null, T(1), 'p1', 'after');
      shot.run('lg', 'dark', T(9), 'p1', null); shot.run('lg', 'dark', T(9), 'p2', 'after');

      const snapshot = { // the rows as the wire carries them (store.mjs `clean`: no nulls), in REVERSED order
        proposals: db.prepare('SELECT * FROM proposals').all().map(S.clean).reverse(),
        measurements: db.prepare('SELECT * FROM measurements').all().map(S.clean).reverse(),
        shots: db.prepare('SELECT * FROM shots').all().map(S.clean).reverse(),
      } as unknown as Parameters<typeof compareOf>[0];

      const ids = ['p1', 'p2', 'p0', 'px'];
      const theirs = S.compare(db, { ids }).map(digestOfStore);
      const mine = ids.map((id) => compareOf(snapshot, id)).filter((c): c is NonNullable<typeof c> => c !== null)
        .map((c) => digestOfMirror(c as unknown as Parameters<typeof digestOfMirror>[0]));
      const p1 = theirs.find((d) => d.id === 'p1');
      check('the fixture is not vacuous: p1 has 6 before and 4 after readings and 4 shot pairs in store.mjs\'s answer',
        p1?.before.length === 6 && p1.after.length === 4 && p1.shots.length === 4, JSON.stringify(p1));
      for (const id of ids) {
        const a = theirs.find((d) => d.id === id), b = mine.find((d) => d.id === id);
        check(`compareOf(${id}) equals store.mjs compare: readings in (lens, metric, measured_at, id) order and the latest shot of each phase per (theme, size)`,
          !!a && !!b && JSON.stringify(a) === JSON.stringify(b), `store ${JSON.stringify(a)} vs compareOf ${JSON.stringify(b)}`);
      }
      check('an id the store does not hold is absent from store.mjs compare and null from compareOf',
        S.compare(db, { ids: ['nope'] }).length === 0 && compareOf(snapshot, 'nope') === null);
      const packStore = S.proposals(db, { pack: 'k1' }).map((p) => p.id).join(), packMine = packItems(snapshot, 'k1').map((p) => p.id).join();
      check('packItems orders a pack as store.mjs proposals --pack does (created_at, id)', packStore.length > 0 && packStore === packMine, `${packStore} vs ${packMine}`);
    } finally {
      try { open?.close(); } catch { /* already closed */ }
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  }
  console.log(`\ncheck-store-compare: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
