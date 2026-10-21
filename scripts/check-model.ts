// Pins what the model says about facets NOBODY MEASURED (packages/core/src/model/**). The facet reader returns ''
// and null for an absent value, so every word the model builds out of those values must stay distinguishable from
// a real reading - the rule the A/B facet-reader fix left to its consumers.
//   (a) lens.ts headlineSummary: a place's headline is computed over the features that carry the field, so it
//       names that denominator whenever it is smaller than the place, and never when the place is whole;
//   (b) aggregates.ts stageParts: the parts account for every feature of the place, so a feature being retired
//       or one with no stage recorded on the date shown is visible instead of silently missing;
//   (c) sim.ts scopeWords: an order scoped to a place the map does not have reads as its slug, in every branch
//       (the domain branch already did; its milestone sibling threw), and a known place still reads as its name;
//   (d) sim.ts SimToast.tone: every path that reports a FAILURE carries tone 'bad' or 'warn', a breach that
//       clears carries 'ok', a burst reads as the worst tone it held back, and no plain confirmation is 'bad';
//   (e) time.ts: hhmmUTC / dayHhmmUTC / ymdUTC read the same whatever the host's zone, mark the zone unless the
//       caller's surface captions it, and answer the absent mark for an instant nobody recorded - plus a source
//       guard, so no file under packages/core/src/model hand-slices a clock time out of an ISO string again;
//   (f) scan-sim.ts: a sample job that ended 'failed' carries a non-zero exit code and its error, as a real run
//       does through jobs.server.ts, and a clean one still ends done / exit 0;
//   (g) product.ts/constants.ts: `?scale=N` is clamped to the product lines that LINES actually declares, so the
//       ceiling and the table cannot drift apart (they were two hand-written 8s);
//   (h) every multi-segment source path a model comment names resolves from the REPO ROOT, as git ls-files
//       prints it - a file anchor that points nowhere is worse than silence, because a reader follows it.
// Run: node scripts/check-model.ts   (Node's type stripping; scripts/overlays-loader.mjs transpiles src/** on the fly)
// Control: BP_MODEL_MUTATE='[["lens.ts"," (\x27 + n + \x27 of \x27","(\x27 + n + \x27 OF \x27"]]' rewrites source text as
// it loads ([file suffix, find, replace] literals), so an assertion can be seen red on a seeded defect.
// Exit 1 on any failure.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_MODEL_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const { buildModel } = await impCore('src/model/sample.ts');
const { headlineSummary } = await impCore('src/model/lens.ts');

const M = buildModel(1, () => Date.parse('2026-10-08T09:00:00Z'), null) as Any;
const P = M.P;
const PLACES: { id: string; feats: Any[] }[] = [...M.L.rooms, ...M.L.wings, ...M.L.bays, ...M.L.blds];

// ---------------------------------------------------------------- (a) a place headline names what it measured
{
  let n = 0, partial = 0, whole = 0;
  const bad: string[] = [];
  for (const d of P.lenses) {
    const f = d.headline; if (!f) continue;
    for (const pl of PLACES) {
      const s = headlineSummary(d, pl.feats);
      if (!s) continue;
      n++;
      let have = 0;
      for (const g of pl.feats) if (g.lens[d.id]?.v[f.key] !== undefined) have++;
      if (have < pl.feats.length) {
        partial++;
        if (!s.includes('(' + have + ' of ' + pl.feats.length + ')')) bad.push(`${d.id}.${f.key}/${pl.id}: "${s}" was measured on ${have} of ${pl.feats.length}`);
      } else {
        whole++;
        if (/\(\d+ of \d+\)/.test(s)) bad.push(`${d.id}.${f.key}/${pl.id}: "${s}" covers the whole place, so it must not name a denominator`);
      }
    }
  }
  expect(n > 100 && partial > 50 && whole > 50, `(a) the sample must exercise both arms: ${n} place headlines, ${partial} partial, ${whole} whole`);
  expect(!bad.length, `(a) ${bad.length} of ${n} place headlines do not say what they measured:\n      ` + bad.slice(0, 4).join('\n      '));
  console.log(`headlines   ${n} place headlines / ${partial} over part of the place / ${whole} over all of it / ${bad.length} silent`);
}

// ---------------------------------------------------------------- (b) the stage parts account for every feature
{
  const { stageParts, AggCache } = await impCore('src/model/aggregates.ts');
  const bad: string[] = [];
  let seen = 0, gaps = 0;
  for (const t of ['2024-01-01', '2025-07-01', P.asOf]) {
    const agg = new AggCache(P);
    for (const pl of PLACES) {
      const c = agg.countsOf(t + '|' + pl.id, pl.feats, t, 14);
      if (c.live + c.flagged + c.build + c.paper + c.dep + c.none !== c.n) bad.push(`${pl.id}@${t}: the counts themselves do not add up to ${c.n}`);
      if (c.dep + c.none > 0) gaps++;
      for (const short of [false, true]) {
        seen++;
        const parts: string[] = stageParts(c, short);
        const nums = parts.slice(1).reduce((a: number, x: string) => a + (parseInt(x, 10) || 0), 0);
        if (nums !== c.n) bad.push(`${pl.id}@${t}${short ? ' (short)' : ''}: ${JSON.stringify(parts)} accounts for ${nums} of ${c.n} (retiring ${c.dep}, not drawn ${c.none})`);
      }
    }
  }
  expect(gaps > 20, `(b) the sample must exercise the arm: only ${gaps} place readings carry a retired or not-yet-drawn feature`);
  expect(!bad.length, `(b) ${bad.length} of ${seen} stage summaries leave a feature out:\n      ` + bad.slice(0, 4).join('\n      '));
  console.log(`stageParts  ${seen} place summaries / ${gaps} with a retired or not-yet-drawn feature / ${bad.length} unaccounted`);
}

// ---------------------------------------------------------------- (c) an order scoped to a place the map lacks
{
  const sim = M.sim;
  const read = (scope: Any): string => {
    try { return sim.scopeWords({ id: 'O-99', by: 'mara', lens: 'general', scope, text: '', since: '', n: 0, vf: [], user: true }); }
    catch (e) { return 'THREW: ' + (e as Error).message; }
  };
  for (const key of ['milestone', 'domain'] as const) {
    const slug = 'no-such-' + key, w = read({ [key]: slug });
    expect(w === slug, `(c) an order scoped to an unknown ${key} must read as its slug, not ${JSON.stringify(w)}`);
  }
  const ms = P.MS[Object.keys(P.MS)[0]], dm = P.base.domains[0];
  expect(read({ milestone: ms.id }) === ms.name + ' (' + ms.id + ')', `(c) a known milestone still reads as its name: ${JSON.stringify(read({ milestone: ms.id }))}`);
  expect(read({ domain: dm.id }) === dm.name, `(c) a known domain still reads as its name: ${JSON.stringify(read({ domain: dm.id }))}`);
  console.log(`scopeWords  unknown milestone -> ${JSON.stringify(read({ milestone: 'no-such-milestone' }))} / known -> ${JSON.stringify(read({ milestone: ms.id }))}`);
}

// ---------------------------------------------------------------- (d) a failure never arrives in success chrome
{
  const { SwarmSim } = await impCore('src/model/sim.ts');
  const { SWARM } = await impCore('src/data/sample.ts');
  const run = (live: boolean) => {
    const m = buildModel(1, () => Date.parse('2026-10-08T09:00:00Z'), null) as Any;
    const sim = live ? new SwarmSim(m.P, SWARM, () => Date.parse('2026-10-08T09:00:00Z'), { live: true, wall: () => Date.parse('2026-10-08T09:00:00Z') }) : m.sim;
    const seen: Any[] = [];
    sim.listen({ changed() {}, event() {}, toast(t: Any) { seen.push(t); } });
    return { sim, seen, M: m };
  };

  // the two refusals a reader can provoke: nothing to sign the order with
  {
    const { sim, seen } = run(false);
    const open = sim.openDecs()[0];
    expect(sim.keepAnswer(open.id, 0, null) === false && seen.at(-1)?.tone === 'warn', `(d) "Not kept" (nobody to sign) carries tone ${JSON.stringify(seen.at(-1)?.tone)}`);
    const p = sim.previewOrder({ ids: { [sim.P.features[0].id]: 1 }, n: 1, label: 'here' }, 'hold', null);
    sim.commit(p, null);
    expect(seen.at(-1)?.strong.startsWith('Order not written') && seen.at(-1)?.tone === 'warn', `(d) "Order not written" carries tone ${JSON.stringify(seen.at(-1)?.tone)}`);
  }
  // a live product's store refusing an answer made here
  {
    const { sim, seen } = run(true);
    const d0 = sim.openDecs()[0];
    sim.decide(d0.id, 0);
    sim.settle(d0.base, 'The store refused it', true);
    expect(seen.at(-1)?.strong === 'The store refused it' && seen.at(-1)?.tone === 'bad', `(d) a refused live answer carries tone ${JSON.stringify(seen.at(-1)?.tone)}`);
  }
  // the recorded hour: breaches opened and cleared, and every plain confirmation in between
  {
    const { sim, seen } = run(false);
    sim.setSpeed(60);   // at or under 60x each event toasts on its own; above it they burst (asserted after)
    for (let i = 0; i < 2000 && sim.t < 3600; i++) sim.advance(90);
    const breach = seen.filter((t) => /breached$/.test(t.strong)), cleared = seen.filter((t) => t.strong === 'Breach cleared');
    expect(breach.length > 0, '(d) the recorded hour must open at least one breach for this arm to mean anything');
    expect(breach.every((t) => t.tone === 'bad'), `(d) ${breach.filter((t) => t.tone !== 'bad').length} of ${breach.length} breach toasts do not read 'bad'`);
    expect(cleared.every((t) => t.tone === 'ok'), `(d) ${cleared.filter((t) => t.tone !== 'ok').length} of ${cleared.length} cleared-breach toasts do not read 'ok'`);
    const wrong = seen.filter((t) => t.tone === 'bad' && !/breached$/.test(t.strong) && t.action);
    expect(!wrong.length, `(d) a toast that offers an action reads as a failure: ${JSON.stringify(wrong.map((t) => t.strong))}`);
    const tones = new Set(seen.map((t) => t.tone ?? 'neutral'));
    console.log(`toast tones ${seen.length} toasts over the recorded hour / ${breach.length} breaches / tones ${[...tones].sort().join(', ')}`);
  }
  // held back and shown as one: the summary reads as the worst thing it covers
  {
    const { sim, seen } = run(false);
    sim.setSpeed(240);
    sim.seek(3600);
    const burst = seen.filter((t) => / updates$/.test(t.strong));
    expect(burst.length > 0 && burst.some((t) => t.tone === 'bad'), `(d) a burst of held-back toasts must read as the worst in it: ${JSON.stringify(burst.map((t) => [t.strong, t.tone]))}`);
    console.log(`toast burst ${burst.length} summary toast(s) / tones ${JSON.stringify(burst.map((t) => t.tone ?? 'neutral'))}`);
  }
}

// ---------------------------------------------------------------- (e) one UTC clock, and nothing hand-sliced
{
  const { hhmmUTC, dayHhmmUTC, ymdUTC, NO_TIME, msOfInstant } = await impCore('src/model/time.ts');
  const ISO = '2026-10-08T14:05:09Z', MS = Date.parse(ISO);
  for (const t of [ISO, MS, new Date(MS)]) {
    expect(hhmmUTC(t) === '14:05 UTC', `(e) hhmmUTC(${typeof t}) = ${JSON.stringify(hhmmUTC(t))}`);
    expect(dayHhmmUTC(t) === 'OCT 08 14:05 UTC', `(e) dayHhmmUTC(${typeof t}) = ${JSON.stringify(dayHhmmUTC(t))}`);
    expect(ymdUTC(t) === '2026-10-08', `(e) ymdUTC(${typeof t}) = ${JSON.stringify(ymdUTC(t))}`);
  }
  expect(hhmmUTC(ISO, { zone: false }) === '14:05', `(e) a surface that captions the zone itself: ${JSON.stringify(hhmmUTC(ISO, { zone: false }))}`);
  expect(hhmmUTC(ISO, { seconds: true }) === '14:05:09 UTC', `(e) with seconds: ${JSON.stringify(hhmmUTC(ISO, { seconds: true }))}`);
  // a time nobody recorded must not come out looking like one that was
  for (const bad of [undefined, null, '', 'not a time', NaN, Infinity]) {
    const out = [hhmmUTC(bad), dayHhmmUTC(bad), ymdUTC(bad)];
    expect(out.every((x) => x === NO_TIME), `(e) ${JSON.stringify(bad)} reads as ${JSON.stringify(out)}, not ${JSON.stringify(NO_TIME)}`);
    expect(Number.isNaN(msOfInstant(bad)), `(e) msOfInstant(${JSON.stringify(bad)}) is not NaN`);
  }
  // one UTC midnight either side of a local-zone boundary: the words may not move with the host
  expect(hhmmUTC('2026-01-01T00:30:00Z') === '00:30 UTC' && ymdUTC('2026-01-01T00:30:00Z') === '2026-01-01', '(e) a UTC instant near midnight must not read in the host zone');

  // the guard: nothing under the model hand-formats a clock time any more
  const dir = path.join(ROOT, 'packages/core/src/model');
  // comments stripped first, or a file that TALKS about the rule and breaks it reads as compliant
  const blank = (x: string) => x.replace(/[^\n]/g, ' ');
  const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])(\/\/.*)$/gm, (_m, a, b) => a + blank(b));
  const hits: string[] = [];
  let walked = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.ts$/.test(name)) continue;
    walked++;
    const src = strip(fs.readFileSync(path.join(dir, name), 'utf8'));
    src.split('\n').forEach((ln, i) => {
      if (name !== 'time.ts' && (/\.slice\(\s*11\s*,/.test(ln) || /getUTCHours|getUTCMinutes/.test(ln))) hits.push(`packages/core/src/model/${name}:${i + 1}  ${ln.trim()}`);
    });
  }
  expect(walked > 10, `(e) the guard walked ${walked} model files`);
  expect(!hits.length, `(e) ${hits.length} site(s) hand-format a clock time instead of calling hhmmUTC:\n      ` + hits.join('\n      '));
  console.log(`utc clock   ${walked} model files guarded / ${hits.length} hand-sliced clock times / hhmmUTC(ISO) = ${JSON.stringify(hhmmUTC(ISO))}`);
}

// ---------------------------------------------------------------- (f) a failed job exits non-zero, as a real one does
{
  const { ScanSim } = await impCore('src/model/scan-sim.ts');
  const structure = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8')) as Any;
  const manifests = new Map<string, Any>(structure.lenses.map((l: Any) => [l.id, l.manifest]));
  const mapValue = (f: string, l: string, k: string): number | undefined => { const v = structure.facets[f]?.[l]?.values?.[k]; return typeof v === 'number' ? v : undefined; };
  let clock = Date.parse('2026-10-15T12:00:00.000Z');
  const sim = new ScanSim({ now: () => clock, findings: [] });
  sim.bind({ order: structure.features.map((f: Any) => f.slug), manifest: (l: string) => manifests.get(l), value: mapValue });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const settle = async (id: string) => {
    for (let i = 0; i < 40; i++) {
      const j = sim.jobs().find((x: Any) => x.id === id);
      if (j && j.status !== 'running' && j.status !== 'queued') return j;
      clock += 1000; await sleep(260);
    }
    return sim.jobs().find((x: Any) => x.id === id);
  };
  const free = sim.snapshot().proposals.filter((p: Any) => p.status === 'done' || p.status === 'failed').map((p: Any) => p.id);
  sim.triage({ ids: free, decision: 'accept', note: 'accepted for this check' });
  sim.createRelease('0.1.0');

  // the gate fails: the release and its job both fail
  sim.setTrainToggles({ ghOff: false, conflict: false, gateFails: true });
  const bad = await settle(sim.buildRelease('rel-0.1.0').id);
  expect(bad?.status === 'failed', `(f) the gate-failing build must end 'failed', not ${JSON.stringify(bad?.status)}`);
  expect(!!bad?.error, `(f) a failed job must carry its error: ${JSON.stringify(bad?.error)}`);
  expect(typeof bad?.exit_code === 'number' && bad.exit_code !== 0, `(f) a failed job exits ${JSON.stringify(bad?.exit_code)}; the workbench paints the figure red only when it is non-zero, so 0 reads as a clean run`);

  // and the clean path still exits 0 (check-scan-jobs pins the same shape on the real server)
  sim.setTrainToggles({ ghOff: false, conflict: false, gateFails: false });
  const ok = await settle(sim.buildRelease('rel-0.1.0').id);
  expect(ok?.status === 'done' && ok.exit_code === 0 && !ok.error, `(f) a clean build must still end done / exit 0: ${JSON.stringify([ok?.status, ok?.exit_code, ok?.error])}`);
  console.log(`job exits   gate fails -> ${bad?.status} exit ${bad?.exit_code} / clean -> ${ok?.status} exit ${ok?.exit_code}`);
}

// ---------------------------------------------------------------- (g) ?scale is clamped to the lines that exist
{
  const { clampScale, lineSuffix } = await impCore('src/model/product.ts');
  const { LINES } = await impCore('src/model/constants.ts');
  const n = LINES.length;
  expect(clampScale(String(n)) === n && clampScale(String(n + 1)) === n && clampScale('999') === n,
    `(g) ?scale must clamp to LINES.length (${n}): ${JSON.stringify([clampScale(String(n)), clampScale(String(n + 1)), clampScale('999')])}`);
  expect(clampScale('0') === 1 && clampScale('-3') === 1 && clampScale(null) === 1 && clampScale('x') === 1,
    `(g) ?scale must floor at one line: ${JSON.stringify([clampScale('0'), clampScale('-3'), clampScale(null), clampScale('x')])}`);
  // the clamp and the table must agree: every line the clamp admits has a name and a suffix letter
  const bad = Array.from({ length: clampScale('999') }, (_x, b) => b).filter((b) => !LINES[b] || !LINES[b][0] || !/^-[A-Z]$/.test(lineSuffix(2, b) === '' ? '-X' : lineSuffix(clampScale('999'), b)));
  expect(!bad.length, `(g) lines the clamp admits with no entry in LINES: ${JSON.stringify(bad)}`);
  const letters = new Set(LINES.map((l: Any) => l[1]));
  expect(letters.size === n, `(g) LINES must carry ${n} distinct suffix letters, has ${letters.size}`);
  console.log(`scale clamp LINES.length ${n} / clampScale('999') ${clampScale('999')} / distinct letters ${letters.size}`);
}

// ---------------------------------------------------------------- (h) every path a model comment names resolves
{
  const dir = path.join(ROOT, 'packages/core/src/model');
  // a multi-segment path with a source extension, anywhere in the file's prose or its code
  const PATHISH = /[A-Za-z0-9_@.[\]-]*[A-Za-z0-9_\]-]\/[A-Za-z0-9_@./[\]-]*\.(?:ts|tsx|mjs|json)/g;
  const miss: string[] = [];
  let walked = 0, anchors = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.ts$/.test(name)) continue;
    walked++;
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n');
    lines.forEach((ln, i) => {
      const prose = /^\s*(\/\/|\*|\/\*)/.test(ln) || ln.includes('// ');
      if (!prose) return;
      for (const m of ln.match(PATHISH) ?? []) {
        if (m.startsWith('.') || m.startsWith('@bp/')) continue;   // a real import specifier, resolved by tsc
        anchors++;
        // the repo's own anchor law: a path a comment names is repo-root relative, as git ls-files prints it
        if (!fs.existsSync(path.join(ROOT, m))) miss.push(`packages/core/src/model/${name}:${i + 1}  ${m}`);
      }
    });
  }
  expect(walked > 10 && anchors > 4, `(h) the guard walked ${walked} model files and found ${anchors} path anchors`);
  expect(!miss.length, `(h) ${miss.length} of ${anchors} paths named in a model comment do not resolve from the repo root:\n      ` + miss.join('\n      '));
  console.log(`doc anchors ${walked} model files / ${anchors} paths named in prose / ${miss.length} dangling`);
}

if (failures.length) {
  console.log(`\ncheck-model: ${failures.length} failed, ${held} held`);
  for (const f of failures) console.log('FAIL  ' + f);
  process.exit(1);
}
console.log(`\ncheck-model: ${held} expectations held`);
