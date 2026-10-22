// Pins the rules behind the words on the feature sheet and the feature page, which no other gate reaches:
//   - kpiHealth: the direction read off the thresholds, the sign flip, bad before watch, and "no health" cases;
//   - lensKpis / scope precedence: feature, context, group, project, and the narrowest-first order;
//   - metricMove: an up/down move is good or bad by the manifest's `better`, never by the arrow alone;
//   - metricRows: the as-of reading, and the unit precedence (manifest unit, percent and '%' readings add none);
//   - lensRows: tiers, the KPI mark, feature-bound fields left out, metric fields left out of tier 2;
//   - revLabel: A..Z, then AA, AB (spreadsheet columns); plainLine: stage, rollout, builders, trouble.
// Inputs are built here (a field, a KPI, a stub sim) so each rule is pinned alone, not through whatever Kettle holds.
// Run: node apps/web/src/components/sheet/check-rows.ts  (scripts/overlays-loader.mjs transpiles src on the fly).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../../..'), SRC = path.join(ROOT, 'apps/web/src');
register(pathToFileURL(path.join(ROOT, 'scripts/overlays-loader.mjs')).href, { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const { kpiHealth, lensKpis, groupOfIn } = (await import(pathToFileURL(path.join(SRC, 'components/page/bits.tsx')).href)) as Any;
const { lensRows, metricMove, metricRows } = (await import(pathToFileURL(path.join(SRC, 'components/sheet/LensPanel.tsx')).href)) as Any;
const { revLabel, plainLine } = (await import(pathToFileURL(path.join(SRC, 'components/sheet/words.ts')).href)) as Any;

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const is = (got: unknown, want: unknown, what: string) => expect(JSON.stringify(got) === JSON.stringify(want), `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---------------------------------------------------------------- kpiHealth
const kpi = (o: Any): Any => ({ slug: 'k', name: 'K', scope: { project: true }, ...o });
const cur = (value: number) => ({ value });
is(kpiHealth(kpi({ warn_at: 80, crit_at: 60, current: cur(90) })), 'good', 'up (crit below warn), above warn');
is(kpiHealth(kpi({ warn_at: 80, crit_at: 60, current: cur(70) })), 'watch', 'up, between warn and crit');
is(kpiHealth(kpi({ warn_at: 80, crit_at: 60, current: cur(60) })), 'bad', 'up, exactly at crit is bad (at-or-past)');
is(kpiHealth(kpi({ warn_at: 80, crit_at: 60, current: cur(80) })), 'watch', 'up, exactly at warn is watch');
is(kpiHealth(kpi({ warn_at: 200, crit_at: 400, current: cur(100) })), 'good', 'down (crit above warn), below warn');
is(kpiHealth(kpi({ warn_at: 200, crit_at: 400, current: cur(300) })), 'watch', 'down, between warn and crit');
is(kpiHealth(kpi({ warn_at: 200, crit_at: 400, current: cur(450) })), 'bad', 'down, past crit');
is(kpiHealth(kpi({ crit_at: 60, direction: 'up', current: cur(50) })), 'bad', 'one threshold with a stated direction');
is(kpiHealth(kpi({ crit_at: 60, current: cur(50) })), null, 'one threshold and no direction has no health');
is(kpiHealth(kpi({ warn_at: 80, crit_at: 80, current: cur(50) })), null, 'equal thresholds and no direction have no health');
is(kpiHealth(kpi({ warn_at: 80, crit_at: 60 })), null, 'nothing measured has no health');
is(kpiHealth(kpi({ current: cur(5) })), null, 'no thresholds have no health');
is(kpiHealth(kpi({ warn_at: 80, crit_at: 60, direction: 'down', current: cur(90) })), 'bad', 'a stated direction wins over the one the thresholds imply');
// a crit that sits on the warn side of a stated direction is read as the direction says, not repaired
is(kpiHealth(kpi({ warn_at: 80, crit_at: 100, direction: 'up', current: cur(90) })), 'bad', 'up with crit above warn: the stated direction is obeyed, 90 is already past crit');

// ---------------------------------------------------------------- scope precedence (lensKpis)
const groupOf = groupOfIn([{ name: 'ctxA', group: 'G1' }, { name: 'ctxB', group: 'G2' }, { name: 'ctxC' }]);
is([groupOf('ctxA'), groupOf('ctxB'), groupOf('ctxC'), groupOf('nope')], ['G1', 'G2', undefined, undefined], 'groupOfIn maps a context to its group');
const feat: Any = { slug: 'f1', contexts: ['ctxA'] };
const M: Any = { kettleContexts: [], P: { LENS: { L: { fields: [{ key: 'x', source: { kpi: 'read-by-field' } }] } }, base: { kpis: [
  kpi({ slug: 'z-proj', name: 'Z project', lens: 'L', scope: { project: true } }),
  kpi({ slug: 'grp', name: 'B group', lens: 'L', scope: { group: 'G1' } }),
  kpi({ slug: 'ctx', name: 'C context', lens: 'L', scope: { context: 'ctxA' } }),
  kpi({ slug: 'feat', name: 'D feature', lens: 'L', scope: { feature: 'f1' } }),
  kpi({ slug: 'other-feat', name: 'E other feature', lens: 'L', scope: { feature: 'f2' } }),
  kpi({ slug: 'other-ctx', name: 'F other context', lens: 'L', scope: { context: 'ctxB' } }),
  kpi({ slug: 'other-grp', name: 'G other group', lens: 'L', scope: { group: 'G2' } }),
  kpi({ slug: 'other-lens', name: 'H other lens', lens: 'M', scope: { project: true } }),
  kpi({ slug: 'read-by-field', name: 'A read', scope: { feature: 'f2' } }),
] } } };
const ks = lensKpis(M, feat, 'L', groupOf);
is(ks.map((x: Any) => x.k.slug), ['feat', 'ctx', 'grp', 'z-proj', 'read-by-field'].sort((a, b) => {
  const r: Record<string, number> = { feat: 0, ctx: 1, grp: 2, 'z-proj': 3, 'read-by-field': 3 }; const n: Record<string, string> = { feat: 'D feature', ctx: 'C context', grp: 'B group', 'z-proj': 'Z project', 'read-by-field': 'A read' };
  return r[a] - r[b] || n[a].localeCompare(n[b]);
}), 'KPIs apply by scope, narrowest first then by name; other scopes and other lenses are left out; a KPI a field reads applies whatever its scope');
is(ks.map((x: Any) => x.rank), [0, 1, 2, 3, 3], 'ranks run feature 0, context 1, group 2, project 3');
is(ks.find((x: Any) => x.k.slug === 'read-by-field')?.hint, 'read by this lens', 'a KPI a field reads says so in its hint');
is(ks.find((x: Any) => x.k.slug === 'ctx')?.hint, 'context ctxA', 'a context KPI names its context');

// ---------------------------------------------------------------- metricMove
const row = (better: 'up' | 'down', value?: number, prev?: number): Any => ({ field: { key: 'm', metric: { better } }, value, prev });
is(metricMove(row('up', 5, 3)), { dir: 'up', cls: 'good' }, 'up when up is better');
is(metricMove(row('up', 3, 5)), { dir: 'down', cls: 'bad' }, 'down when up is better');
is(metricMove(row('down', 3, 5)), { dir: 'down', cls: 'good' }, 'down when down is better');
is(metricMove(row('down', 5, 3)), { dir: 'up', cls: 'bad' }, 'up when down is better');
is(metricMove(row('up', 5, 5)), { dir: null, cls: '' }, 'no move');
is(metricMove(row('up', 5, undefined)), { dir: null, cls: '' }, 'one reading is no move');
is(metricMove(row('up', undefined, 5)), { dir: null, cls: '' }, 'no current reading is no move');
is(metricMove(row('up', 0, -1)), { dir: 'up', cls: 'good' }, 'a zero reading is a reading, not a missing one');

// ---------------------------------------------------------------- metricRows
const fld = (o: Any): Any => ({ key: 'm', label: 'M', type: 'number', metric: { better: 'up', method: 'static' }, ...o });
const def = (...fields: Any[]): Any => ({ id: 'L', fields, evidence: [], headline: null });
const model = (v: number | undefined): Any => ({ sim: { liveValue: () => v } });
const f1: Any = { id: 'f1' };
const mr = (fd: Any, v: number | undefined, scan?: Any, on?: Any) => metricRows(def(fd), f1, model(v), scan, on)[0];
is(metricRows(def({ key: 'plain', label: 'P', type: 'number' }), f1, model(1), undefined), [], 'a field with no metric is not a metric row');
is([mr(fld({}), 7).value, mr(fld({}), 7).prev, mr(fld({}), 7).pts], [7, undefined, [7]], 'without history the facet value is the single point');
is(mr(fld({}), undefined).pts, [], 'no history and no facet value: no points');
const scan = (vals: number[], unit = 'ms'): Any => ({ measurements: vals.map((value, i) => ({ feature: 'f1', lens: 'L', metric: 'm', value, unit, method: 'probe', measured_at: `2026-04-0${i + 1}T10:00:00Z` })) });
const hist = mr(fld({}), 99, scan([1, 2, 3]));
is([hist.pts, hist.value, hist.prev, hist.method], [[1, 2, 3], 3, 2, 'probe'], 'history wins over the facet: latest reading, previous reading, the reading\'s method');
is(mr(fld({}), 99, scan([1, 2, 3]), { t: '2026-04-02', now: '2026-04-20' }).pts, [1, 2], 'on a past date only readings taken by then count');
is(mr(fld({}), 99, scan([1, 2, 3]), { t: '2026-04-20', now: '2026-04-20' }).pts, [1, 2, 3], 'on the as-of date every reading counts');
is(mr(fld({}), 99, scan([5]), { t: '2026-03-01', now: '2026-04-20' }).pts, [], 'on a past date with no reading yet the facet value is no stand-in');
is(hist.unit, ' ms', "the reading's unit is added when the manifest has none");
is(mr(fld({ unit: 'ms' }), 99, scan([1, 2])).unit, '', "the manifest's unit wins (fmtValue adds it)");
is(mr(fld({ type: 'percent' }), 99, scan([1, 2], 'ms')).unit, '', 'a percent field adds no unit');
is(mr(fld({}), 99, scan([1, 2], '%')).unit, '', "a '%' reading adds no unit");
is(mr(fld({}), 99, scan([1, 2], '')).unit, '', 'a reading with no unit adds none');
is(mr(fld({}), 5).method, 'static', 'without a reading the manifest method stands');

// ---------------------------------------------------------------- lensRows
const lf = (key: string, o: Any = {}): Any => ({ key, label: key.toUpperCase(), type: 'number', ...o });
const d2: Any = { headline: lf('head'), evidence: [lf('ev1'), lf('head')], fields: [lf('rest1'), lf('gone'), lf('met', { metric: { better: 'up', method: 'static' } }), lf('feat', { source: { feature: 'stage' } }), lf('kp', { source: { kpi: 'k1' } })] };
const vals: Record<string, number> = { head: 1, ev1: 2, rest1: 3, met: 4, feat: 5, kp: 6 };
const rows = lensRows(d2, undefined, (k: string) => vals[k]);
is(rows.map((r: Any) => [r.k, r.tier]), [['HEAD', 0], ['EV1', 1], ['REST1', 2], ['KP · KPI', 2]], 'tiers: headline, evidence, the rest; no repeat, no feature-bound field, no metric in tier 2, no empty tier-2 field');
const hot = lensRows(d2, { h: 'bad', whyFields: ['ev1'] }, (k: string) => vals[k]);
is(hot.map((r: Any) => r.c), ['', 'bad', '', ''], 'the rule\'s named field carries the lens health');
is(lensRows({ ...d2, headline: lf('nov') }, undefined, () => undefined).map((r: Any) => r.k), ['NOV', 'EV1', 'HEAD'], 'a tier 0/1 field with no value still shows (as a dash); a tier 2 one does not');

// ---------------------------------------------------------------- revLabel
is([0, 1, 25, 26, 27, 51, 52, 701, 702].map(revLabel), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'], 'revLabel rolls A..Z over to AA, like spreadsheet columns');

// ---------------------------------------------------------------- plainLine
const P: Any = { LENS: { sec: { i: 3, name: 'Security' }, perf: { i: 2, name: 'Performance' } }, P: { ag: { name: 'Bot', kind: 'agent' }, hu: { name: 'Ann', kind: 'human' } } };
const sim = (o: Any = {}): Any => ({ live: false, rolloutOf: () => 100, progOf: () => 41.6, ...o });
const pf = (o: Any): Any => ({ stage: 'live', builtBy: [], trouble: [], ...o });
is(plainLine(P, pf({ stage: 'in-dev' }), sim()).strong, 'Being built, about 42% done.', 'in-dev says how far along, rounded');
is(plainLine(P, pf({ stage: 'flagged' }), sim({ rolloutOf: () => 30 })).strong, 'Live for 30% of studios, behind a switch.', 'a partial flag rollout names studios on the sample');
is(plainLine(P, pf({ stage: 'flagged' }), sim({ live: true, rolloutOf: () => 30 })).strong, 'Live for 30% of users, behind a switch.', 'and users on a live product');
is(plainLine(P, pf({ stage: 'flagged' }), sim({ rolloutOf: () => 100 })).strong.endsWith('.'), true, 'a full rollout falls back to the stage wording');
is(plainLine(P, pf({ stage: 'live' }), sim({ live: true })).strong, 'Live for everyone.', 'a live product names no audience');
is(plainLine(P, pf({ stage: undefined }), sim()).strong, 'Stage unknown.', 'no stage is said so');
is(plainLine(P, pf({ builtBy: ['ag'] }), sim()).rest, ['Built by agent Bot.'], 'one agent builder');
is(plainLine(P, pf({ builtBy: ['ag', 'hu'] }), sim()).rest, ['Built by agent Bot with Ann.'], 'an agent with a human');
is(plainLine(P, pf({ builtBy: ['hu'] }), sim()).rest, ['Built by Ann.'], 'a human alone');
const tr = plainLine(P, pf({ trouble: [{ lens: 'perf', h: 'watch', why: 'slow.' }, { lens: 'sec', h: 'bad', why: 'open port.' }] }), sim());
is([tr.bad, tr.rest], ['Security: open port.', ['To watch: performance.']], 'the first bad lens is the red line, the watch lenses are listed');

if (failures.length) {
  console.error(`check-rows: ${failures.length} failure(s), ${held} held`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-rows: ${held} expectations held (kpiHealth, scope precedence, metricMove, metricRows, lensRows, revLabel, plainLine)`);
