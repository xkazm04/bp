// Checks the Release tab's Tag step (lens-scan `release --landed`, lens-scan 1.15.0) end to end on the Kettle sim and on a
// live product over the real routes and job registry (scripts/lib/train-planes.ts: the fake Claude Code CLI and a fake gh):
//   - a draft of 2 items that already landed (the sim's "accepted items already on main" toggle; on the live repo, a commit
//     per item carrying `Lens-Item: <id>` on main): readLandings says both landed, releaseState.ts landedOutside holds
//     both, and the actions RELEASE_STATE offers through onPath are Tag, not Build; the pre-flight says ok, not block;
//   - tagRelease -> a release job of step tag that ends done only with the row tagged (tag v0.1.0) and both items
//     released (jobs.server.ts settleRelease, train-sim.ts end; release-steps.ts STEP_LANDS.tag);
//   - the sim's stored notes name each item's landing commit and `landed: tagged on main at <head>`, not a pack commit;
//   - a draft with an item that has not landed: Build, not Tag, is offered, and a tag run anyway fails the release naming
//     the item ("not landed"), the job failed;
//   - BP_WRITES=off leaves the tag route live, as every release route (scan/writes.ts: "the Release tab stays live").
// The live plane needs lens-scan's store.mjs (triage, release-create): missing is a FAILURE where check-train-parity
// requires it, else a SKIP that says so. Run: node scripts/check-release-tag.ts. Exit 1 on any failure.
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

const RS = await import(pathToFileURL(path.join(SRC, 'components/ledger/train/release/releaseState.ts')).href) as Any;
const PF = await import(pathToFileURL(path.join(SRC, 'components/ledger/train/release/preflight.ts')).href) as Any;

const manifestText = (() => { try { return fs.readFileSync(path.join(ROOT, '.ai', 'manifest.yaml'), 'utf8'); } catch { return ''; } })();
const declared = /^registry:[ \t]*\r?\n(?:[ \t]+[^\r\n]*\r?\n)*?[ \t]+local:[ \t]*(\S+)/m.exec(manifestText)?.[1].replace(/^['"]|['"]$/g, '');
const required = process.env.BP_REQUIRE_LENS_SCAN !== '0' && (process.env.BP_REQUIRE_LENS_SCAN === '1' || !!process.env.CI || process.env.BP_LENS_SCAN_DIR !== undefined || (!!declared && fs.existsSync(path.resolve(ROOT, declared))));

const { openPlanes } = await import('./lib/train-planes.ts') as typeof import('./lib/train-planes.ts');
const P: Planes = await openPlanes(ROOT);
const writes0 = process.env.BP_WRITES;
try {
  if (!P.storeScript) {
    if (required) check('lens-scan store.mjs is found for the live plane', false, 'set BP_LENS_SCAN_DIR, or BP_REQUIRE_LENS_SCAN=0 to waive');
    else console.log('SKIP check-release-tag: lens-scan store.mjs is not installed and nothing here requires it');
  } else {
    const { SAMPLE_ITEMS } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/train-sim.ts')).href) as Any;
    const sim = P.newSim();
    const idOf = (k: string): string => { const it = SAMPLE_ITEMS.find((x: Any) => x.key === k); return sim.snapshot().proposals.find((p: Any) => p.title === it.title && p.pack_id === it.pack && (it.attemptOf ? !!p.attempt_of : !p.attempt_of))?.id; };
    const two = [idOf('des1-booking'), idOf('des1-waitlist')], late = idOf('des2-kiosk');
    sim.triage({ ids: [...two, late], decision: 'accept' });
    sim.createRelease('0.1.0', two);
    const live = P.liveFrom('tagged', sim.snapshot());
    const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=bp-check', '-c', 'user.email=bp-check@localhost', '-c', 'commit.gpgsign=false', ...a], { cwd: live.root, encoding: 'utf8' });
    for (const id of two) git('commit', '-q', '--allow-empty', '-m', `fix: ${id}\n\nLens-Item: ${id}`);
    sim.setTrainToggles({ ghOff: false, conflict: false, gateFails: false, landed: true });

    const planes = [
      { name: 'sim', ctx: { slug: null, sim }, snap: () => sim.snapshot(), jobs: () => sim.jobs(), tick: async () => { P.clock.now += 1000; await sleep(260); } },
      { name: 'live', ctx: live.ctx, snap: () => P.snapshotOf(live.file), jobs: () => P.jobs.list('tagged'), tick: () => sleep(100) },
    ];
    const settle = async (pl: typeof planes[number], id: string) => { for (let i = 0; i < 150; i++) { const j = pl.jobs().find((x: Any) => x.id === id); if (j && j.status !== 'running' && j.status !== 'queued') return j; await pl.tick(); } return null; };
    const pkgOf = (snap: Any, rel: string) => snap.proposals.filter((p: Any) => p.release_id === rel).map((p: Any) => ({ p, verdict: 'moved', flagged: false }));
    const offered = (status: string, all: boolean) => (RS.RELEASE_STATE[status].actions as string[]).filter((a) => RS.onPath(a, all)).join();

    for (const pl of planes) {
      const A = P.actions, l = await A.readLandings(pl.ctx), snap = pl.snap(), rel = snap.releases.find((r: Any) => r.id === 'rel-0.1.0');
      const items = pkgOf(snap, 'rel-0.1.0'), on = RS.landedOutside(items, rel, l), all = RS.allLanded({ items, landed: on });
      check(`[${pl.name}] both draft items read landed on main`, l.state === 'known' && on.size === 2 && all, JSON.stringify(l).slice(0, 300));
      check(`[${pl.name}] a draft of landed items offers Tag instead of Build`, offered(rel.status, all) === 'tag', offered(rel.status, all));
      const pre = PF.preflightOf(rel, items, { ready: true, gh: 'signed-in' }, { landed: on, base: 'main' });
      check(`[${pl.name}] the pre-flight says the landed package is ready to tag, no block`, pre.find((c: Any) => c.id === 'landed')?.verdict === 'ok' && !pre.some((c: Any) => c.verdict === 'block'), JSON.stringify(pre));
      const j = await A.tagRelease(pl.ctx, 'rel-0.1.0');
      check(`[${pl.name}] tagRelease -> a release job of step tag`, j.kind === 'release' && j.step === 'tag' && j.release === 'rel-0.1.0', JSON.stringify(j));
      const end = await settle(pl, j.id), after = pl.snap(), r = after.releases.find((x: Any) => x.id === 'rel-0.1.0');
      const shipped = after.proposals.filter((p: Any) => two.includes(p.id));
      check(`[${pl.name}] the job ends done with the row tagged v0.1.0 and every item released`, end?.status === 'done' && r?.status === 'tagged' && r?.tag === 'v0.1.0' && shipped.length === 2 && shipped.every((p: Any) => p.status === 'released'),
        JSON.stringify({ job: end?.status, error: end?.error, rel: r?.status, items: shipped.map((p: Any) => p.status) }));
      if (pl.name === 'sim') check('[sim] the stored notes name each landing commit and where it was tagged, no pack commit', !!r?.notes && two.every((id) => r.notes.includes(`landed as ${l.items[id].sha.slice(0, 7)} on main`)) && /landed: tagged on main at [0-9a-f]{7}/.test(r.notes) && !/from pack/.test(r.notes), r?.notes);
    }

    // an item that has not landed: Build is offered; a tag run anyway fails the release naming it
    sim.setTrainToggles({ ghOff: false, conflict: false, gateFails: false, landed: false });
    for (const pl of planes) {
      const A = P.actions;
      await A.createRelease(pl.ctx, '0.1.1', [late]);
      const l = await A.readLandings(pl.ctx), snap = pl.snap(), rel = snap.releases.find((r: Any) => r.id === 'rel-0.1.1');
      const items = pkgOf(snap, 'rel-0.1.1'), on = RS.landedOutside(items, rel, l), all = RS.allLanded({ items, landed: on });
      check(`[${pl.name}] a draft whose item has not landed offers Build, not Tag`, !all && offered('draft', all) === 'build', `${on.size} landed`);
      const j = await A.tagRelease(pl.ctx, 'rel-0.1.1'), end = await settle(pl, j.id), r = pl.snap().releases.find((x: Any) => x.id === 'rel-0.1.1');
      check(`[${pl.name}] a tag over an unlanded item fails the release naming it, the job failed`, end?.status === 'failed' && r?.status === 'failed' && /not landed/.test(r?.error ?? '') && (r?.error ?? '').includes(late), JSON.stringify({ job: end?.status, error: end?.error, rel: r?.status, why: r?.error }));
    }

    // BP_WRITES=off: the release routes stay live (scan/writes.ts), the tag's with them
    process.env.BP_WRITES = 'off';
    const dry = await P.actions.preflightRelease(live.ctx, 'rel-0.1.1', 'tag').then((v: Any) => ({ ok: true, v }), (e: Any) => ({ ok: false, status: e.status }));
    check('BP_WRITES=off leaves the tag route live, as build and finish (the Release tab stays live)', dry.ok === true, JSON.stringify(dry));
  }
} finally {
  if (writes0 === undefined) delete process.env.BP_WRITES; else process.env.BP_WRITES = writes0;
  await P.reap();
}

console.log(failed ? `check-release-tag: ${failed} failed, ${passed} passed` : `check-release-tag: ${passed} checks passed`);
process.exit(failed ? 1 : 0);
