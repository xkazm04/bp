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
//       prints it - a file anchor that points nowhere is worse than silence, because a reader follows it;
//   (i) morning.ts kindWords: every event kind the watch can be handed has plain words, taken from the three
//       vocabularies that produce them (PULSE_OF, the map's own activity types, the kinds the played hour
//       emits) rather than from the KIND table itself, and the table words nothing no vocabulary declares.
//   (l) the UI half of (d): every failure toast in the files that have been toned passes a 'bad' / 'warn' tone to Engine.toast.
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

// ---------------------------------------------------------------- (i) every event kind the watch is handed has words
{
  const { kindWords, WATCH_KINDS, sampleWatchEvents } = await impCore('src/model/morning.ts');
  const { PULSE_OF } = await impCore('src/model/constants.ts');
  const ev = (type: string) => [{ k: 0, at: '', place: null, type, text: '' }];
  /** Unworded: kindWords falls back to the generic noun, which is what a kind nobody worded looks like. */
  const unworded = (type: string) => kindWords(ev(type)) === '1 event';
  expect(unworded('a-kind-nobody-declared'), `(i) the fallback must still read generically: ${JSON.stringify(kindWords(ev('a-kind-nobody-declared')))}`);

  // ground truth 1: every kind the replay can carry (PULSE_OF is Record<ReplayType, _>, so tsc keeps it complete)
  const replay = Object.keys(PULSE_OF);
  const mute1 = replay.filter(unworded);
  expect(replay.length >= 16 && !mute1.length, `(i) ${mute1.length} of ${replay.length} ReplayType kinds have no plain words: ${JSON.stringify(mute1)}`);

  // ground truth 2: every kind the loaded map's own activity rows carry (a free string in the schema)
  const mapKinds = [...new Set(M.P.base.activity.map((a: Any) => a.type))] as string[];
  const mute2 = mapKinds.filter(unworded);
  expect(mapKinds.length > 4 && !mute2.length, `(i) ${mute2.length} of ${mapKinds.length} kinds in the map's activity have no plain words: ${JSON.stringify(mute2)}`);

  // ground truth 3: every kind that actually reaches a WatchEvent in the sample, replayed hour included
  M.sim.setSpeed(60);
  for (let i = 0; i < 2000 && M.sim.t < 3600; i++) M.sim.advance(90);
  const watched = [...new Set((sampleWatchEvents(M) as Any[]).map((e) => e.type))];
  const mute3 = watched.filter(unworded);
  expect(watched.length > 4 && !mute3.length, `(i) ${mute3.length} of ${watched.length} kinds the watch is handed have no plain words: ${JSON.stringify(mute3)}`);

  // and the table the code declares is covered by the two vocabularies it claims to be about
  const dead = WATCH_KINDS.filter((k: string) => !replay.includes(k) && !mapKinds.includes(k) && !['reading', 'measured', 'proposed', 'executing', 'committed', 'note', 'error'].includes(k));
  expect(!dead.length, `(i) KIND words kinds no vocabulary in this tree declares: ${JSON.stringify(dead)}`);
  expect(kindWords(ev('commit').concat(ev('commit'))) === '2 code changes', `(i) the plural form: ${JSON.stringify(kindWords(ev('commit').concat(ev('commit'))))}`);
  console.log(`watch words ${WATCH_KINDS.length} worded / ${replay.length} replay kinds / ${mapKinds.length} map kinds / ${watched.length} reaching the watch / 0 mute`);
}

// ---------------------------------------------------------------- (j) a shot nobody reported on is not a clean shot
{
  const { shotErrors, shotErrorsReported } = await impCore('src/model/live.ts');
  const none = {}, noField = { report: {} }, zero = { report: { consoleErrors: 0 } }, listZero = { report: { consoleErrors: [] } };
  const three = { report: { consoleErrors: 3 } }, list = { report: { consoleErrors: ['a', 'b'] } };
  expect(shotErrorsReported(none) === null && shotErrorsReported(noField) === null, `(j) a shot with no report, or a report with no console field, must read null: ${shotErrorsReported(none)} / ${shotErrorsReported(noField)}`);
  expect(shotErrorsReported(zero) === 0 && shotErrorsReported(listZero) === 0, `(j) a measured zero must read 0, not null: ${shotErrorsReported(zero)} / ${shotErrorsReported(listZero)}`);
  expect(shotErrorsReported(three) === 3 && shotErrorsReported(list) === 2, `(j) a count and a list both read as their size: ${shotErrorsReported(three)} / ${shotErrorsReported(list)}`);
  expect([none, noField, zero, listZero, three, list].every((s) => shotErrors(s) === (shotErrorsReported(s) ?? 0)), '(j) shotErrors stays the 0-fallback of shotErrorsReported');
  console.log('shot errors: absent / measured-zero / measured told apart');
}

// ---------------------------------------------------------------- (k) a rollout nobody measured is not a rollout of 0 or 100
{
  const feats: Any[] = M.L.feats ?? PLACES.flatMap((pl) => pl.feats);
  let measured = 0, absentLive = 0, absentOther = 0;
  const bad: string[] = [];
  for (const f of new Map<string, Any>(feats.map((x: Any) => [x.id, x])).values()) {
    const m = M.sim.rolloutMeasured(f), o = M.sim.rolloutOf(f);
    if (m != null) { measured++; if (o !== m) bad.push(`${f.id} measured ${m} but rolloutOf says ${o}`); }
    else if (M.P.isLive?.(f) ?? ['live', 'flagged'].includes(f.stage)) { absentLive++; if (o !== 100) bad.push(`${f.id} absent+live reads ${o}`); }
    else { absentOther++; if (o !== 0) bad.push(`${f.id} absent reads ${o}`); }
  }
  expect(measured > 50 && absentLive + absentOther > 20 && absentOther > 0, `(k) the sample must exercise measured and absent (absent-live is the stub below): ${measured} measured / ${absentLive} absent-live / ${absentOther} absent-other`);
  expect(!bad.length, `(k) rolloutOf must stay the fallback-bearing form of rolloutMeasured: ` + bad.slice(0, 4).join(' | '));
  const bare = { id: 'F-bare', stage: 'live', lens: {} };
  expect(M.sim.rolloutMeasured(bare) === null && M.sim.rolloutOf(bare) === 100, `(k) a live feature with empty facets: measured ${M.sim.rolloutMeasured(bare)}, plain ${M.sim.rolloutOf(bare)}`);
  console.log(`rollout     ${measured} measured / ${absentLive} absent on a live stage / ${absentOther} absent elsewhere, told apart`);
}

// ---------------------------------------------------------------- (l) a toast that reports a failure says so in its chrome
// Engine.toast takes a tone since 088f3ad and #toast paints it; the model half is pinned in (d). This is the UI half: every
// `.toast(` call in the files listed below whose headline names a failure or a refusal passes a 'bad' / 'warn' tone, and no
// confirmation does. A file joins TONED_FILES in the commit that tones it, so the list is the figure.
{
  const { blankComments } = await import('./lib/source.ts');
  /** The argument sources of every `.toast(...)` call in `src`, split at depth-0 commas (strings and nesting respected). */
  const toastCalls = (src: string): { line: number; args: string[] }[] => {
    const out: { line: number; args: string[] }[] = [];
    for (const m of src.matchAll(/\.toast\(/g)) {
      let i = m.index! + m[0].length, depth = 0, quote = '', cur = '';
      const args: string[] = [];
      for (; i < src.length; i++) {
        const c = src[i];
        if (quote) { cur += c; if (c === String.fromCharCode(92)) { cur += src[++i] ?? ''; } else if (c === quote) quote = ''; continue; }
        if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        if (c === ')' || c === ']' || c === '}') { if (!depth) break; depth--; }
        if (c === ',' && !depth) { args.push(cur.trim()); cur = ''; continue; }
        cur += c;
      }
      if (cur.trim()) args.push(cur.trim());
      out.push({ line: src.slice(0, m.index).split('\n').length, args });
    }
    return out;
  };
  const FAILS = /\b(failed|Refused|Could not|did not start|not start|Nothing moved|Nothing to decide|No scan store)/;
  const judge = (file: string, src: string): { calls: number; failing: number; bad: string[] } => {
    const bad: string[] = [];
    const cs = toastCalls(src);
    let failing = 0;
    for (const c of cs) {
      const fail = FAILS.test(c.args[0] ?? ''), tone = c.args[4] ?? '';
      if (fail) { failing++; if (!/'(bad|warn)'/.test(tone) || /'ok'/.test(tone)) bad.push(`${file}:${c.line} ${c.args[0].slice(0, 60)} carries no bad/warn tone (${tone || 'none'})`); }
      else if (/'bad'/.test(tone)) bad.push(`${file}:${c.line} ${(c.args[0] ?? '').slice(0, 60)} is no failure but reads bad`);
    }
    return { calls: cs.length, failing, bad };
  };
  // the instrument judged on constructed sources: a toned failure, an untoned one, a ternary headline, a confirmation, a comment
  const t = judge('x', blankComments("E.toast('Refused', why(e), undefined, undefined, 'bad');\nE.toast(n ? 'Some scans did not start' : 'Scan not started', a.join(';'));\n// E.toast('Scan failed', 'x')\nE.toast('Scanning ' + n, 'x');"));
  expect(t.calls === 3 && t.failing === 2 && t.bad.length === 1 && /x:2 /.test(t.bad[0]), `(l) the toast reader must see 3 calls (comment ignored), 2 failing, 1 untoned at line 2: ${JSON.stringify(t)}`);
  const eng = fs.readFileSync(path.join(ROOT, 'apps/web/src/engine/Engine.ts'), 'utf8');
  expect(/\n\s*toast\(strong: string, text: string, action\?: [^)]*fid\?: string, tone\?: ToastTone\)/.test(blankComments(eng)), '(l) Engine.toast has no tone parameter, so no caller can tone a failure');
  const TONED_FILES: string[] = ['apps/web/src/components/ScanMenu.tsx', 'apps/web/src/components/ledger/train/Decide.tsx'];
  let calls = 0, failing = 0;
  const bad: string[] = [];
  for (const f of TONED_FILES) { const r = judge(f, blankComments(fs.readFileSync(path.join(ROOT, f), 'utf8'))); calls += r.calls; failing += r.failing; bad.push(...r.bad); }
  expect(!bad.length, `(l) ${bad.length} of ${failing} failure toasts in ${TONED_FILES.length} files carry no tone:\n      ` + bad.join('\n      '));
  console.log(`toast tone  ${failing} failure toasts of ${calls} in ${TONED_FILES.length} files / ${bad.length} untoned`);
}

if (failures.length) {
  console.log(`\ncheck-model: ${failures.length} failed, ${held} held`);
  for (const f of failures) console.log('FAIL  ' + f);
  process.exit(1);
}
console.log(`\ncheck-model: ${held} expectations held`);
