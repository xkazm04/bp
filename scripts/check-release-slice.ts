// Checks that the Release tab can ship a chosen slice of the accepted queue (the pre-draft choice in Package.tsx, its ids
// passed through VersionBox -> actions.ts createRelease and suggestRelease), on the Kettle sim and on a live product over
// the real routes (scripts/lib/train-planes.ts builds both from one seed, as check-train-parity does):
//   - the fixture: 45 accepted items with no pack, one of them shipped as v0.1.0 first (so a v* tag exists to bump from:
//     the sim's tagged release, the live repo's git tag), leaving 44 free; the 44th says `capability: new`;
//   - suggest with no ids -> a minor bump (0.2.0: the new capability is among the free items); with the 3 chosen fixes ->
//     a patch bump (0.1.1): an unchosen new capability does not force minor; ids that are not item ids -> 400;
//   - createRelease with the 3 chosen ids -> a draft of exactly those 3 (added and the release's items), and 41 accepted
//     items left without a release;
//   - a second draft asking for a free item and one already drafted -> 1 added, the other skipped `in-release`, and
//     releaseState.ts draftWords says it ("Drafted 1 of the 2 asked for. Left out: ...");
//   - releaseState.ts: chosenOf (the chosen in package order, all when none), acceptedAge ("accepted 4 d ago"; no time ->
//     said in words), and VersionBox's suggestKey moves with the choice.
// The live plane needs lens-scan's store.mjs (release-create): missing is a FAILURE where check-train-parity requires it,
// else a SKIP that says so. Run: node scripts/check-release-slice.ts. Exit 1 on any failure.
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Planes } from './lib/train-planes.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const outOf = async (f: () => Promise<unknown>): Promise<{ ok: true; value: Any } | { ok: false; status: number; message: string; body: Any }> => {
  try { return { ok: true, value: await f() }; } catch (e) { const x = e as Any; return { ok: false, status: x?.status, message: x?.message ?? '', body: x?.body }; }
};

// ------------------------------------------------------------------ the pure half
const RS = await import(pathToFileURL(path.join(SRC, 'components/ledger/train/release/releaseState.ts')).href) as Any;
const VB = await import(pathToFileURL(path.join(SRC, 'components/ledger/train/release/VersionBox.tsx')).href) as Any;
{
  const xs = ['a', 'b', 'c', 'd'].map((id) => ({ p: { id } }));
  check('chosenOf: nothing chosen -> every item', RS.chosenOf(xs, new Set()).map((x: Any) => x.p.id).join() === 'a,b,c,d');
  check('chosenOf: the chosen ones in package order', RS.chosenOf(xs, new Set(['d', 'b'])).map((x: Any) => x.p.id).join() === 'b,d');
  const now = Date.parse('2026-11-03T12:00:00.000Z');
  check('acceptedAge: "accepted 4 d ago" from triaged_at', RS.acceptedAge({ triaged_at: '2026-10-30T12:00:00.000Z' }, now) === 'accepted 4 d ago', RS.acceptedAge({ triaged_at: '2026-10-30T12:00:00.000Z' }, now));
  const unk = RS.acceptedAge({}, now);
  check('acceptedAge: no time -> said in words, no number', /not recorded/.test(unk) && !/\d/.test(unk), unk);
  check('draftWords: all added', RS.draftWords(3, 3, []) === 'Drafted all 3 items.', RS.draftWords(3, 3, []));
  const m = { T: { slug: 'p', releases: [] }, items: xs };
  check('suggestKey moves with the choice', VB.suggestKey(m) !== VB.suggestKey(m, ['b']) && VB.suggestKey(m, ['b']) !== VB.suggestKey(m, ['b', 'c']));
}

// ------------------------------------------------------------------ the two planes
const manifestText = (() => { try { return fs.readFileSync(path.join(ROOT, '.ai', 'manifest.yaml'), 'utf8'); } catch { return ''; } })();
const declared = /^registry:[ \t]*\r?\n(?:[ \t]+[^\r\n]*\r?\n)*?[ \t]+local:[ \t]*(\S+)/m.exec(manifestText)?.[1].replace(/^['"]|['"]$/g, '');
const required = process.env.BP_REQUIRE_LENS_SCAN !== '0' && (process.env.BP_REQUIRE_LENS_SCAN === '1' || !!process.env.CI || process.env.BP_LENS_SCAN_DIR !== undefined || (!!declared && fs.existsSync(path.resolve(ROOT, declared))));

const { openPlanes } = await import('./lib/train-planes.ts') as typeof import('./lib/train-planes.ts');
const P: Planes = await openPlanes(ROOT);
try {
  if (!P.storeScript) {
    if (required) check('lens-scan store.mjs is found for the live plane', false, 'set BP_LENS_SCAN_DIR, or BP_REQUIRE_LENS_SCAN=0 to waive');
    else console.log('SKIP check-release-slice planes: lens-scan store.mjs is not installed and nothing here requires it');
  } else {
    const probe = P.newSim();
    const proposeRun: string = probe.snapshot().runs.find((r: Any) => r.phase === 'propose')?.id;
    probe.dispose();
    const day = 86400000, at = (d: number) => new Date(P.clock.now - d * day).toISOString();
    const ids = Array.from({ length: 45 }, (_, i) => 'sl' + String(i).padStart(2, '0'));
    const findings = ids.map((id, i) => ({
      id, run_id: proposeRun, feature: 'email-password-sign-in', lens: 'development', metric: 'buildErrors', title: 'slice item ' + id, standard: 'none', kind: 'fix',
      ...(i === 44 ? { body: 'A new export.\ncapability: new' } : {}), status: 'accepted', triaged_from: 'done', triaged_by: 'user:sample', triaged_at: at(45 - i),
      commit_sha: (i + 1).toString(16).padStart(40, 'a'), created_at: at(60), updated_at: at(45 - i),
    }));
    const sim = P.newSim(findings);
    // ship sl00 as v0.1.0 on the sim first, so the next version bumps from a tag
    const settle = async (job: Any) => { for (let i = 0; i < 60; i++) { const j = sim.jobs().find((x: Any) => x.id === job.id); if (j.status !== 'running' && j.status !== 'queued') return j; P.clock.now += 1000; await sleep(260); } return null; };
    sim.createRelease('0.1.0', ['sl00']);
    await settle(sim.buildRelease('rel-0.1.0'));
    const fin = await settle(sim.finishRelease('rel-0.1.0'));
    check('fixture: v0.1.0 shipped sl00 on the sim', fin?.status === 'done' && sim.snapshot().releases.find((r: Any) => r.id === 'rel-0.1.0')?.status === 'tagged', JSON.stringify(fin));
    const live = P.liveFrom('slice', sim.snapshot());
    const g = spawnSync('git', ['tag', 'v0.1.0'], { cwd: live.root, encoding: 'utf8' });
    check('fixture: the live repo carries the tag v0.1.0', g.status === 0, g.stderr);
    const three = ['sl02', 'sl03', 'sl04'];
    for (const pl of [{ name: 'sim', ctx: { slug: null, sim }, snap: () => sim.snapshot() }, { name: 'live', ctx: live.ctx, snap: () => P.snapshotOf(live.file) }]) {
      const A = P.actions, free = () => pl.snap().proposals.filter((p: Any) => p.status === 'accepted' && !p.release_id);
      check(`[${pl.name}] 44 accepted items wait without a release`, free().length === 44, String(free().length));
      const all = await outOf(() => A.suggestRelease(pl.ctx));
      check(`[${pl.name}] suggest over every free item -> 0.2.0 (the new capability among them)`, all.ok && all.value.version === '0.2.0' && all.value.from === 'v0.1.0', JSON.stringify(all));
      const some = await outOf(() => A.suggestRelease(pl.ctx, three));
      check(`[${pl.name}] suggest over the 3 chosen fixes -> 0.1.1: an unchosen new capability does not force minor`, some.ok && some.value.version === '0.1.1' && /^3 accepted items/.test(some.value.reason), JSON.stringify(some));
      const bad = await outOf(() => A.suggestRelease(pl.ctx, ['bad id;']));
      check(`[${pl.name}] suggest with ids that are not item ids -> 400`, !bad.ok && bad.status === 400, JSON.stringify(bad));
      const made = await outOf(() => A.createRelease(pl.ctx, '0.1.1', three));
      check(`[${pl.name}] create with the 3 chosen -> a draft of exactly those 3`, made.ok && made.value.added.join() === three.join() && made.value.release.items.map((p: Any) => p.id).sort().join() === three.join() && made.value.release.status === 'draft', JSON.stringify(made).slice(0, 300));
      check(`[${pl.name}] 41 accepted items left without a release`, free().length === 41, String(free().length));
      const again = await outOf(() => A.createRelease(pl.ctx, '0.1.2', ['sl05', 'sl02']));
      const sk = again.ok ? again.value.skipped : [];
      check(`[${pl.name}] a draft asking for a drafted item -> it is skipped in-release, the free one added`, again.ok && again.value.added.join() === 'sl05' && sk.length === 1 && sk[0].id === 'sl02' && sk[0].reason === 'in-release', JSON.stringify(again).slice(0, 300));
      const words = again.ok ? RS.draftWords(2, again.value.added.length, sk.map((s: Any) => ({ id: s.id, why: 'already in another release' }))) : '';
      check(`[${pl.name}] the box reads the answer back`, words === 'Drafted 1 of the 2 asked for. Left out: sl02 (already in another release).', words);
    }
  }
} finally { await P.reap(); }

console.log(failed ? `check-release-slice: ${failed} failed, ${passed} passed` : `check-release-slice: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
