// Checks that apps/web/src/lib/scan/actions.ts keeps its promise for the release train and the waves: "Same results,
// same refusals (Error + status + body)" on the Kettle sim and on a live product. One table of rows; each row runs
// through actions.ts twice, with ctx { slug: null, sim } and with ctx { slug, sim: null } over the real routes
// (scripts/lib/train-planes.ts builds both planes from one seed), and each plane's answer, normalised by the row
// (status always; then named body fields; free text by presence unless the row says otherwise), must equal what the
// row wants. A difference fails naming the row, the plane and the fields.
//   - seed: the live store is written FROM the sim's snapshot, and every id a row names resolves in both planes before
//     the row runs (else the check fails naming the row);
//   - the tail rows run on a second pair, seeded from a sim driven to the end of its train (every pack closed);
//   - coverage: every exported async function in actions.ts's 'the release train' and 'waves' sections (read from the
//     source, comments stripped) is called by at least one row, or named in EXEMPT with a reason; an export with
//     neither fails naming it (proved in-process on the source plus one appended export);
//   - self-proof, every run: BP_OVERLAYS_MUTATE seeds train-sim.ts's bad-release refusal as a 422, and the child must
//     fail naming the row 'buildRelease bad id' and the plane 'sim'.
// The live plane needs lens-scan's store.mjs (triage and release-create run it): a missing install is a FAILURE wherever
// check-scan-jobs requires it (BP_LENS_SCAN_DIR named, BP_REQUIRE_LENS_SCAN=1, CI, or the declared registry on this
// machine); elsewhere the check says SKIP. Run: node scripts/check-train-parity.ts (scripts/overlays-loader.mjs transpiles
// the sources). Exit 1 on any failure. ~15 s.
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripComments } from './lib/source.ts';
import type { Planes } from './lib/train-planes.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_OVERLAYS_MUTATE || '[]') } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string, detail = '') => { if (ok) held++; else failures.push(what + (detail ? ': ' + detail : '')); };

// ------------------------------------------------------------------ coverage: the exports the rows must call
const ACTIONS = path.join(ROOT, 'apps/web/src/lib/scan/actions.ts');
const SECTIONS = ['the release train', 'waves'];
/** Exports that no row calls, each with the reason. */
const EXEMPT: Record<string, string> = {};
/** The exported async functions of actions.ts's train and waves sections (split at the `// ---- <name>` lines). */
function trainExports(text: string): string[] | null {
  const marks = [...text.matchAll(/^\/\/ -{8,} (.+)$/gm)], out: string[] = [];
  let found = 0;
  marks.forEach((m, i) => {
    if (!SECTIONS.includes(m[1].trim())) return;
    found++;
    const body = text.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : text.length);
    for (const x of stripComments(body).matchAll(/export\s+async\s+function\s+(\w+)/g)) out.push(x[1]);
  });
  return found === SECTIONS.length ? out : null;
}
const uncovered = (exports: string[], called: ReadonlySet<string>) => exports.filter((e) => !called.has(e) && !EXEMPT[e]);

// ------------------------------------------------------------------ the rows
type Out = { ok: true; value: Any } | { ok: false; status: number; message: string; body: Any };
/** One plane's names for what a row refers to: sample item ids (the same on both planes) and the waves it made. */
interface Ref { id(key: string): string; wave: Record<string, string> }
interface Row {
  name: string;
  call: (A: Any, ctx: Any, r: Ref) => Promise<unknown>;
  /** The ids that must exist on both planes before the row runs. */
  needs?: (r: Ref) => { proposals?: string[]; releases?: string[]; waves?: string[] };
  /** gh signed out for this row (the sim's ghOff toggle; FAKE_GH_OUT=1 for the live routes). */
  ghOut?: boolean;
  see: (o: Out, r: Ref) => unknown;
  want: (r: Ref) => unknown;
  keep?: (o: Out, r: Ref) => void;
}
/** A refusal's status, and whether it says why. */
const refusal = (o: Out, more: (o: Extract<Out, { ok: false }>) => object = () => ({})) => (o.ok ? { ok: true } : { status: o.status, error: !!o.message, ...more(o) });
const skips = (l: unknown) => (Array.isArray(l) ? l.map((s: Any) => ({ id: s.id, status: s.status, ...(s.reason ? { reason: s.reason } : {}) })) : l);
/** A triage refusal: the Error's text (client.ts makes it the route's `error`), what moved and what was skipped. */
const triageRefusal = (o: Out) => (o.ok ? { ok: true, triaged: o.value?.triaged } : { status: o.status, error: o.message, triaged: o.body?.triaged, skipped: skips(o.body?.skipped) });
const pkg = (name: string, ids: string[], model = 'opus', effort = 'high') => ({ name, model, effort, ids });
const FINDINGS = ['q1', 'q2', 'q3', 'q4'];

const MAIN: Row[] = [
  { name: 'listWaves at the start', call: (A, c) => A.listWaves(c), see: (o) => (o.ok ? { ok: true, n: o.value.length } : refusal(o)), want: () => ({ ok: true, n: 0 }) },
  { name: 'suggestRelease with no tag', call: (A, c) => A.suggestRelease(c), see: (o) => (o.ok ? { ok: true, version: o.value.version, from: o.value.from } : refusal(o)), want: () => ({ ok: true, version: '0.1.0', from: 'none' }) },
  { name: 'triageItems accept a failed item with no note', needs: (r) => ({ proposals: [r.id('des1-waiver')] }), call: (A, c, r) => A.triageItems(c, [r.id('des1-waiver')], 'accept'),
    see: triageRefusal, want: (r) => ({ status: 409, error: 'nothing moved', triaged: [], skipped: [{ id: r.id('des1-waiver'), status: 'failed', reason: 'note-required' }] }) },
  { name: 'triageItems accept a done item', needs: (r) => ({ proposals: [r.id('des1-booking')] }), call: (A, c, r) => A.triageItems(c, [r.id('des1-booking')], 'accept'),
    see: (o) => (o.ok ? { ok: true, decision: o.value.decision, triaged: o.value.triaged } : refusal(o)), want: (r) => ({ ok: true, decision: 'accepted', triaged: [r.id('des1-booking')] }) },
  { name: 'createRelease bad version', call: (A, c) => A.createRelease(c, 'v0.1'), see: (o) => refusal(o), want: () => ({ status: 400, error: true }) },
  { name: 'createRelease of an item that is not accepted', needs: (r) => ({ proposals: [r.id('des1-card')] }), call: (A, c, r) => A.createRelease(c, '0.1.0', [r.id('des1-card')]),
    see: (o) => refusal(o), want: () => ({ status: 409, error: true }) },
  { name: 'createRelease 0.1.0', call: (A, c) => A.createRelease(c, '0.1.0'),
    see: (o) => (o.ok ? { ok: true, id: o.value.release.id, status: o.value.release.status, added: o.value.added } : refusal(o)), want: (r) => ({ ok: true, id: 'rel-0.1.0', status: 'draft', added: [r.id('des1-booking')] }) },
  { name: 'triageItems accept a second item', needs: (r) => ({ proposals: [r.id('des1-waitlist')] }), call: (A, c, r) => A.triageItems(c, [r.id('des1-waitlist')], 'accept'),
    see: (o) => (o.ok ? { ok: true, triaged: o.value.triaged } : refusal(o)), want: (r) => ({ ok: true, triaged: [r.id('des1-waitlist')] }) },
  { name: 'createRelease of a version that has a release', needs: () => ({ releases: ['rel-0.1.0'] }), call: (A, c) => A.createRelease(c, '0.1.0'), see: (o) => refusal(o), want: () => ({ status: 409, error: true }) },
  { name: 'buildRelease bad id', call: (A, c) => A.buildRelease(c, 'rel-x;calc'), see: (o) => refusal(o), want: () => ({ status: 400, error: true }) },
  { name: 'buildRelease unknown release', call: (A, c) => A.buildRelease(c, 'rel-9.9.9'), see: (o) => refusal(o), want: () => ({ status: 404, error: true }) },
  { name: 'finishRelease of a draft', needs: () => ({ releases: ['rel-0.1.0'] }), call: (A, c) => A.finishRelease(c, 'rel-0.1.0'), see: (o) => refusal(o), want: () => ({ status: 409, error: true }) },
  // the build's pre-flight: ready with nothing queued on both planes (the live dry run never asks gh, so no ghOut row)
  { name: 'preflightRelease of a draft', needs: () => ({ releases: ['rel-0.1.0'] }), call: (A, c) => A.preflightRelease(c, 'rel-0.1.0'),
    see: (o) => (o.ok ? { ok: true, ready: o.value.ready } : refusal(o)), want: () => ({ ok: true, ready: true }) },
  { name: 'preflightRelease bad id', call: (A, c) => A.preflightRelease(c, 'rel-x;calc'), see: (o) => refusal(o), want: () => ({ status: 400, error: true }) },
  { name: 'buildRelease with gh signed out', ghOut: true, needs: () => ({ releases: ['rel-0.1.0'] }), call: (A, c) => A.buildRelease(c, 'rel-0.1.0'),
    see: (o) => (o.ok ? { ok: true } : { status: o.status, error: o.message }), want: () => ({ status: 412, error: 'gh not authenticated' }) },
  { name: 'commitDiff bad sha', call: (A, c) => A.commitDiff(c, 'xyz'), see: (o) => refusal(o), want: () => ({ status: 400, error: true }) },
  { name: 'commitDiff unknown commit', call: (A, c) => A.commitDiff(c, 'deadbeef'), see: (o) => refusal(o), want: () => ({ status: 404, error: true }) },
  { name: 'cancelJob unknown job', call: (A, c) => A.cancelJob(c, 'j-none'), see: (o) => refusal(o), want: () => ({ status: 404, error: true }) },
  { name: 'createWave a draft', needs: () => ({ proposals: FINDINGS.slice(0, 3) }), call: (A, c) => A.createWave(c, { name: 'First', packages: [pkg('Deep', ['q1', 'q2']), pkg('Quick', ['q3'], 'sonnet', 'low')] }),
    see: (o) => (o.ok ? { ok: true, status: o.value.status, packages: o.value.packages.map((p: Any) => p.id) } : refusal(o)), want: () => ({ ok: true, status: 'draft', packages: ['pk-1', 'pk-2'] }),
    keep: (o, r) => { if (o.ok) r.wave.first = o.value.id; } },
  { name: 'createWave with a finding in another draft wave', needs: (r) => ({ waves: [r.wave.first] }), call: (A, c) => A.createWave(c, { name: 'Rival', packages: [pkg('X', ['q2', 'q4'])] }),
    see: (o) => refusal(o, (x) => ({ error: typeof x.body?.error === 'string' && !!x.body.error, taken: x.body?.taken })), want: () => ({ status: 409, error: true, taken: ['q2'] }) },
  { name: 'createWave with model gpt', call: (A, c) => A.createWave(c, { name: 'Gpt', packages: [pkg('X', ['q4'], 'gpt')] }),
    see: (o) => refusal(o, (x) => ({ error: /model/.test(String(x.body?.error ?? '')) })), want: () => ({ status: 400, error: true }) },
  { name: 'dispatchWave unknown wave', call: (A, c) => A.dispatchWave(c, 'w-none'), see: (o) => refusal(o), want: () => ({ status: 404, error: true }) },
  { name: 'dispatchWave unknown package', needs: (r) => ({ waves: [r.wave.first] }), call: (A, c, r) => A.dispatchWave(c, r.wave.first, ['pk-9']), see: (o) => refusal(o), want: () => ({ status: 400, error: true }) },
  { name: 'dispatchWave the draft', needs: (r) => ({ waves: [r.wave.first] }), call: (A, c, r) => A.dispatchWave(c, r.wave.first),
    see: (o) => (o.ok ? { ok: true, jobs: o.value.jobs.length, status: o.value.wave.status } : refusal(o)), want: () => ({ ok: true, jobs: 2, status: 'dispatched' }) },
  { name: 'updateWave of a dispatched wave', needs: (r) => ({ waves: [r.wave.first] }), call: (A, c, r) => A.updateWave(c, r.wave.first, { name: 'z' }), see: (o) => refusal(o), want: () => ({ status: 409, error: true }) },
  { name: 'deleteWave of a dispatched wave', needs: (r) => ({ waves: [r.wave.first] }), call: (A, c, r) => A.deleteWave(c, r.wave.first), see: (o) => refusal(o), want: () => ({ status: 409, error: true }) },
];
// the end of the train: every pack closed, des1-card descoped in closed k-des-1 (store.mjs refuses its reopen: pack-closed)
const TAIL: Row[] = [
  { name: 'triageItems reopen in a closed pack', needs: (r) => ({ proposals: [r.id('des1-card')] }), call: (A, c, r) => A.triageItems(c, [r.id('des1-card')], 'reopen'),
    see: triageRefusal, want: (r) => ({ status: 409, error: 'nothing moved', triaged: [], skipped: [{ id: r.id('des1-card'), status: 'descoped', reason: 'pack-closed' }] }) },
];

// ------------------------------------------------------------------ the run
const manifestText = (() => { try { return fs.readFileSync(path.join(ROOT, '.ai', 'manifest.yaml'), 'utf8'); } catch { return ''; } })();
const declared = /^registry:[ \t]*\r?\n(?:[ \t]+[^\r\n]*\r?\n)*?[ \t]+local:[ \t]*(\S+)/m.exec(manifestText)?.[1].replace(/^['"]|['"]$/g, '');
const required = process.env.BP_REQUIRE_LENS_SCAN !== '0' && (process.env.BP_REQUIRE_LENS_SCAN === '1' || !!process.env.CI || process.env.BP_LENS_SCAN_DIR !== undefined || (!!declared && fs.existsSync(path.resolve(ROOT, declared))));

const { openPlanes } = await import('./lib/train-planes.ts') as typeof import('./lib/train-planes.ts');
const P: Planes = await openPlanes(ROOT);
const called = new Set<string>();
/** actions.ts, with every call a row makes recorded for the coverage. */
const A = new Proxy(P.actions, { get: (t, k) => { const v = t[k]; return typeof v === 'function' ? (...a: unknown[]) => { called.add(String(k)); return v(...a); } : v; } });
const outOf = async (f: () => Promise<unknown>): Promise<Out> => {
  try { return { ok: true, value: await f() }; } catch (e) { const x = e as Any; return { ok: false, status: x?.status, message: x?.message ?? '', body: x?.body }; }
};
const json = (x: unknown) => JSON.stringify(x);

try {
  if (!P.storeScript) {
    if (required) expect(false, 'lens-scan store.mjs is found for the live plane (a missing install is a failure where the registry is present)', 'set BP_LENS_SCAN_DIR, or BP_REQUIRE_LENS_SCAN=0 to waive');
    else { console.log('SKIP check-train-parity: lens-scan store.mjs is not installed and nothing here requires it; the live plane cannot run'); await P.reap(); process.exit(0); }
  } else {
    // the seed: proposed findings for the waves on the sim's own propose run, then the sample train over the Kettle map
    const probe = P.newSim();
    const proposeRun: string = probe.snapshot().runs.find((r: Any) => r.phase === 'propose')?.id;
    const at = new Date(P.clock.now).toISOString();
    const findings = FINDINGS.map((id) => ({ id, run_id: proposeRun, feature: 'email-password-sign-in', lens: 'development', title: 'parity finding ' + id, standard: 'none', kind: 'fix', status: 'proposed', created_at: at, updated_at: at }));
    const { SAMPLE_ITEMS } = await import(path.join(ROOT, 'packages/core/src/model/train-sim.ts').replace(/^/, 'file:///').replace(/\\/g, '/')) as Any;
    const keyed = (snap: Any) => {
      const m = new Map<string, string>();
      for (const it of SAMPLE_ITEMS) { const p = snap.proposals.find((x: Any) => x.title === it.title && x.pack_id === it.pack && (it.attemptOf ? !!x.attempt_of : !x.attempt_of)); if (p) m.set(it.key, p.id); }
      return m;
    };
    const pair = (sim: Any, slug: string) => {
      const live = P.liveFrom(slug, sim.snapshot()), keys = keyed(sim.snapshot());
      const id = (k: string) => keys.get(k) ?? 'missing:' + k;
      return {
        sim: { name: 'sim', ctx: { slug: null, sim }, ref: { id, wave: {} } as Ref, snap: () => sim.snapshot(), toggle: sim },
        live: { name: 'live', ctx: live.ctx, ref: { id, wave: {} } as Ref, snap: () => P.snapshotOf(live.file), toggle: sim },
      };
    };
    const runRows = async (rows: Row[], pr: ReturnType<typeof pair>) => {
      for (const row of rows) {
        let missing = '';
        for (const pl of [pr.sim, pr.live]) {
          const n = row.needs?.(pl.ref) ?? {}, s = pl.snap();
          const waves: Any[] = n.waves?.length ? await P.actions.listWaves(pl.ctx) : [];
          const lost = [...(n.proposals ?? []).filter((i) => !s.proposals.some((p: Any) => p.id === i)), ...(n.releases ?? []).filter((i) => !s.releases.some((r: Any) => r.id === i)),
            ...(n.waves ?? []).filter((i) => !i || !waves.some((w) => w.id === i)).map((i) => i || '(no wave made)')];
          if (lost.length) missing += ` [${pl.name}] ${lost.join(', ')}`;
        }
        expect(!missing, `${row.name}: every id it names resolves on both planes before it runs`, missing.trim());
        if (missing) continue;
        const outs: Out[] = [];
        for (const pl of [pr.sim, pr.live]) {
          if (row.ghOut) P.ghOut(pl.toggle, true);
          try { outs.push(await outOf(() => row.call(A, pl.ctx, pl.ref))); } finally { if (row.ghOut) P.ghOut(pl.toggle, false); }
        }
        [pr.sim, pr.live].forEach((pl, i) => {
          const got = row.see(outs[i], pl.ref) as Record<string, unknown>, want = row.want(pl.ref) as Record<string, unknown>;
          const fields = [...new Set([...Object.keys(got ?? {}), ...Object.keys(want ?? {})])].filter((k) => json(got?.[k]) !== json(want?.[k]));
          expect(!fields.length, `${row.name} [${pl.name}]`, `${fields.join(', ')} differ: got ${json(got)}, want ${json(want)}` + (outs[i].ok ? '' : ` (${(outs[i] as Any).status} ${(outs[i] as Any).message})`));
          row.keep?.(outs[i], pl.ref);
        });
      }
    };
    probe.dispose();

    // ---------------------------------------------------------------- the main pair: the sample as seeded
    const main = pair(P.newSim(findings), 'parity');
    expect(main.sim.snap().proposals.length === main.live.snap().proposals.length && main.sim.snap().packs.length === main.live.snap().packs.length && main.live.snap().proposals.length >= 12,
      'seed: the live store holds the sim\'s rows (proposals, packs)', `${main.sim.snap().proposals.length}/${main.live.snap().proposals.length}`);
    await runRows(MAIN, main);

    // ---------------------------------------------------------------- the tail pair: a sim driven to the end of its train
    const tail = P.newSim();
    const k = keyed(tail.snapshot()), T = (keys: string[], d: string, note?: string) => tail.triage(note === undefined ? { ids: keys.map((x) => k.get(x)!), decision: d } : { ids: keys.map((x) => k.get(x)!), decision: d, note });
    T(['des1-booking', 'des1-waitlist', 'des2-kiosk', 'perf1-timetable', 'perf1-heatmap'], 'accept');
    T(['des1-waiver'], 'accept', 'Ships with the gate fixed by hand.');
    T(['des1-card'], 'descope', 'Worse by one state.');
    tail.createRelease('0.1.0');
    const settle = async (job: Any) => { for (let i = 0; i < 60; i++) { const j = tail.jobs().find((x: Any) => x.id === job.id); if (j.status !== 'running' && j.status !== 'queued') return j; P.clock.now += 1000; await sleep(260); } return null; };
    await settle(tail.buildRelease('rel-0.1.0'));
    await settle(tail.finishRelease('rel-0.1.0'));
    const tp = pair(tail, 'tail');
    expect([tp.sim.snap(), tp.live.snap()].every((s) => s.packs.length === 3 && s.packs.every((x: Any) => x.status === 'closed')), 'tail: every pack is closed on both planes',
      [tp.sim.snap(), tp.live.snap()].map((s) => s.packs.map((x: Any) => x.id + ':' + x.status).join()).join(' | '));
    await runRows(TAIL, tp);

    // ---------------------------------------------------------------- coverage
    const text = fs.readFileSync(ACTIONS, 'utf8'), ex = trainExports(text);
    expect(!!ex && ex.length > 0, 'coverage: actions.ts has its \'the release train\' and \'waves\' sections, with exports', String(ex));
    const left = uncovered(ex ?? [], called);
    expect(!left.length, 'coverage: every train and waves export of actions.ts is called by a row or exempt with a reason', 'no row calls ' + left.join(', '));
    const stale = Object.keys(EXEMPT).filter((e) => !(ex ?? []).includes(e) || called.has(e));
    expect(!stale.length, 'coverage: every exemption names an export no row calls', stale.join(', '));
    const added = trainExports(text + '\nexport async function shipIt(ctx: ScanCtx): Promise<void> { void ctx; }\n');
    expect(json(uncovered(added ?? [], called)) === json(['shipIt']), 'coverage: an export added without a row is named', json(uncovered(added ?? [], called)));
  }
} finally { await P.reap(); }

// Self-proof, every run: seed a defect into the source the loader transpiles (BP_OVERLAYS_MUTATE; the loader skips a mutation
// whose text no longer exists, so a child that passes means the mutation stopped biting) and require the child to fail on
// the row that defect breaks, on the plane it broke.
if (!process.env.BP_OVERLAYS_MUTATE && P.storeScript) {
  const seed = [['train-sim.ts', "throw refuse(400, 'bad-release')", "throw refuse(422, 'bad-release')"]];
  const child = spawnSync(process.execPath, [...process.execArgv, import.meta.filename], { env: { ...process.env, BP_OVERLAYS_MUTATE: JSON.stringify(seed) }, encoding: 'utf8', timeout: 180000 });
  expect(child.status === 1 && (child.stdout ?? '').includes('FAIL buildRelease bad id [sim]'),
    'self-proof: train-sim.ts answers a bad release id 422: the check must fail on buildRelease bad id [sim] (child exit ' + child.status + ')', (child.stdout ?? '').split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 3).join(' | '));
}

if (failures.length) { console.log(failures.map((f) => 'FAIL ' + f).join('\n')); console.log(`check-train-parity: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-train-parity: ${held} expectations held`);
process.exit(0);
