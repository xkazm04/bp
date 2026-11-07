// check:bold-schedule - bold's sheet totals are a schedule, not a caption: every total a title block states
// ('3 unreviewed', '2 without alerting') is a clause (words + the predicate or the sum behind it) defined once in
// apps/web/src/variants/bold/schedule.ts. The title block (CHANNELS[lens].aggregate), the bay rail (railParts) and the
// Plan-tab schedule (bold's ui.Legend) are derived from it, and each schedule row walks the plan to its features.
// Cases (challenge card variants-bold-shaped:B):
//   1 security schedule over [payment+passed, payment+pending, personal+not-started, public+not-required, no facet]
//   2 kettle parity: every built-in lens x every building, aggregate === today's strings === the schedule's words (guard + derivation)
//   3 kettle parity: railParts on every bay === today's strings (guard), and railParts reads the clauses (no inline totals)
//   4 a summing clause (asks, PRs, findings) keeps its sum as the words and lists its contributing features (value > 0) in order
//   5 a row press flies to the next match with the highlight, cycling and wrapping; Enter/Space are swallowed
//   6 a row with 0 ids renders aria-disabled and pressing it calls nothing; every schedule text rule is >= 12 px
//   7 General and a lens outside the six built-ins render the shared Legend unchanged (guard; /v/bold's door is check:variant-chunk)
// The browser walk (/v/bold?view=security, Plan flyout, 'unreviewed' row, Enter twice) is manual; this gate needs no server.
// Run: node scripts/check-bold-schedule.ts   (Node's type stripping; scripts/overlays-loader.mjs transpiles src/**)
// Control: BP_BOLD_SCHEDULE_MUTATE='[["schedule.ts","find","replace"]]' rewrites source as it loads, so a case can be seen red.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_BOLD_SCHEDULE_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href).catch((e) => ({ __err: (e as Error).message }));
const sch = await imp('variants/bold/schedule.ts');
const { CHANNELS } = await imp('variants/bold/channels.ts');
const { railParts } = await imp('variants/bold/decor.ts');
const { LENS_NAME } = await imp('variants/bold/palette.ts');
const { bl, measuredOf, sensitiveUnreviewed, NOT_MEASURED } = await imp('variants/base/legacy.ts');
const { isLiveSt } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/index.ts')).href);
const { buildModel } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/sample.ts')).href);

let held = 0, cases = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const fn = (o: Any, k: string) => (o && typeof o[k] === 'function' ? o[k] : null);
const schedule = fn(sch, 'schedule'), goNext = fn(sch, 'goNext');
expect(!sch.__err, 'bold/schedule.ts loads: ' + (sch.__err ?? ''));
const LENSES = ['business', 'design', 'development', 'operations', 'security', 'quality'] as const;
const rowOf = (rows: Any[], key: string) => rows.find((r) => r.key === key);
const rowsOf = (lens: string, feats: Any[]): Any[] => (schedule ? schedule(lens, feats) : []);

let seq = 0;
const feat = (lens: Record<string, { v: Record<string, unknown>; h: string }>, id?: string): Any => ({ id: id ?? 'f' + ++seq, stage: 'live', lens });

// ------------------------------------------------------------------------- today's strings (the parity oracle)
// Verbatim copies of bold's aggregate bodies and railParts as they stood before the schedule (52808cf3): the
// derived versions must say exactly what these said, on every building and every bay of the kettle fixture.
const count = (fs: Any[], p: (f: Any) => boolean) => fs.filter(p).length;
const kUsd = (n: number) => (n >= 1000 ? '$' + (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k' : '$' + n);
const OLD_AGG: Record<string, (fs: Any[]) => string[]> = {
  business: (fs) => {
    const rq = fs.reduce((s, f) => s + (bl(f).business.customerRequests30d || 0), 0);
    const mrr = fs.reduce((s, f) => s + (bl(f).business.revenueLink === 'direct' ? bl(f).business.mrrImpactUsd || 0 : 0), 0);
    return [rq + ' customer asks', kUsd(mrr) + '/mo direct revenue', count(fs, (f) => bl(f).business.value >= 4) + ' high value'];
  },
  design: (fs) => [count(fs, (f) => bl(f).design.status === 'polished' || bl(f).design.status === 'implemented') + ' built to design', count(fs, (f) => bl(f).design.status === 'none' && f.stage !== 'idea') + ' without design', count(fs, (f) => bl(f).design.a11y === 'fail') + ' fail accessibility'],
  development: (fs) => {
    const prs = fs.reduce((s, f) => s + (bl(f).development.openPRs || 0), 0);
    return [count(fs, (f) => bl(f).development.humanReviewed === false) + ' unreviewed', Math.round(fs.reduce((s, f) => s + bl(f).development.aiAuthoredPct, 0) / Math.max(1, fs.length)) + '% agent-written', prs + ' open PRs', count(fs, (f) => (bl(f).development.unitCoveragePct ?? Infinity) < 50) + ' thin coverage'];
  },
  operations: (fs) => [count(fs, (f) => bl(f).operations.environment === 'production') + ' in production', count(fs, (f) => bl(f).operations.environment === 'production' && !bl(f).operations.alerting) + ' without alerting', fs.reduce((s, f) => s + (bl(f).operations.incidents30d || 0), 0) + ' incidents · 30 d'],
  security: (fs) => [count(fs, (f) => bl(f).security.dataClass === 'payment') + ' card data', count(fs, (f) => bl(f).security.dataClass === 'personal') + ' personal data', count(fs, sensitiveUnreviewed) + ' unreviewed', fs.reduce((s, f) => s + bl(f).security.openFindings, 0) + ' findings'],
  quality: (fs) => {
    const t = fs.reduce((s, f) => s + bl(f).quality.e2eTests, 0), p = fs.reduce((s, f) => s + bl(f).quality.e2ePassing, 0);
    return [p + '/' + t + ' e2e passing', fs.reduce((s, f) => s + bl(f).quality.openBugs.p1, 0) + ' open P1', count(fs, (f) => bl(f).quality.status === 'untested' && isLiveSt(f.stage)) + ' live untested'];
  },
};
const oldAggregate = (lens: string, feats: Any[]): string[] => {
  const { measured, missing } = measuredOf(feats, lens);
  if (!measured.length) return [NOT_MEASURED];
  const a = OLD_AGG[lens](measured);
  return missing ? [...a, missing + ' not measured'] : a;
};
function oldRail(lens: string, feats: Any[], sim: { rolloutOf(f: Any): number }): string[] {
  if (lens === 'design') return [];
  const { measured: fs, missing } = measuredOf(feats, lens);
  if (!fs.length) return [NOT_MEASURED];
  const tail = missing ? [missing + ' NOT MEASURED'] : [];
  switch (lens) {
    case 'business': {
      const asks = fs.reduce((s: number, f: Any) => s + (bl(f).business.customerRequests30d || 0), 0);
      const mrr = fs.reduce((s: number, f: Any) => s + (bl(f).business.revenueLink === 'direct' ? bl(f).business.mrrImpactUsd || 0 : 0), 0);
      return [asks + (asks === 1 ? ' customer ask' : ' customer asks'), ...(mrr ? [kUsd(mrr) + ' a month'] : []), ...(missing ? [missing + ' not measured'] : [])];
    }
    case 'development': {
      const pr = fs.reduce((s: number, f: Any) => s + (bl(f).development.openPRs || 0), 0), ur = fs.reduce((s: number, f: Any) => s + (bl(f).development.humanReviewed === false ? 1 : 0), 0);
      const ai = Math.round(fs.reduce((s: number, f: Any) => s + bl(f).development.aiAuthoredPct, 0) / fs.length);
      return [feats.length + ' FEAT', pr + ' PR', 'AI ' + ai + '%', ...(ur ? [ur + ' UNREVIEWED'] : []), ...tail];
    }
    case 'operations': {
      const live = fs.filter((f: Any) => bl(f).operations.environment === 'production').length;
      let roll = 0, nf = 0; for (const f of fs) if (bl(f).operations.flag && isLiveSt(f.stage)) { roll += sim.rolloutOf(f); nf++; }
      const inc = fs.reduce((s: number, f: Any) => s + (bl(f).operations.incidents30d || 0), 0);
      return [live + '/' + fs.length + ' LIVE', ...(nf ? [Math.round(roll / nf) + '% OUT'] : []), ...(inc ? [inc + ' INC'] : []), ...tail];
    }
    case 'security': {
      const card = fs.filter((f: Any) => bl(f).security.dataClass === 'payment').length, pers = fs.filter((f: Any) => bl(f).security.dataClass === 'personal').length;
      const un = fs.filter(sensitiveUnreviewed).length;
      if (!card && !pers) return ['NO SENSITIVE DATA', ...tail];
      return [...(card ? [card + ' CARD'] : []), ...(pers ? [pers + ' PERSONAL'] : []), ...(un ? [un + ' UNREVIEWED'] : []), ...tail];
    }
    case 'quality': {
      const t = fs.reduce((a: number, f: Any) => a + bl(f).quality.e2eTests, 0), pp = fs.reduce((a: number, f: Any) => a + bl(f).quality.e2ePassing, 0), p1 = fs.reduce((a: number, f: Any) => a + bl(f).quality.openBugs.p1, 0);
      return [pp + '/' + t + ' E2E', ...(p1 ? [p1 + ' P1'] : []), ...tail];
    }
  }
  return [];
}
/** The title block's parts as the schedule states them: its clause words, the unmeasured row when it counts any. */
const scheduleParts = (lens: string, feats: Any[]): string[] => {
  const rows = rowsOf(lens, feats), un = rowOf(rows, 'unmeasured');
  if (!rows.length) return ['(no schedule)'];
  if (un && un.ids.length === feats.length) return [NOT_MEASURED];
  return rows.filter((r) => r.key !== 'unmeasured' || r.ids.length).map((r) => r.words);
};

const red: string[] = [];
const runCase = (n: number, body: () => void) => { cases++; const before = failures.length; body(); if (failures.length > before) red.push(String(n)); };

// ---- 1. the security schedule
runCase(1, () => {
  const sec = (dataClass: string, review: string, id: string) => feat({ security: { v: { dataClass, review, openFindings: review === 'findings' ? 2 : 0 }, h: 'good' } }, id);
  const fs5 = [sec('payment', 'passed', '1'), sec('payment', 'pending', '2'), sec('personal', 'not-started', '3'), sec('public', 'not-required', '4'), feat({}, '5')];
  const rows = rowsOf('security', fs5);
  const ids = (k: string) => (rowOf(rows, k)?.ids ?? ['missing']).join(',');
  const got = ['card', 'personal', 'unreviewed', 'unmeasured'].map((k) => k + '=[' + ids(k) + ']').join(' ');
  expect(got === 'card=[1,2] personal=[3] unreviewed=[2,3] unmeasured=[5]', 'security rows walk to card [1,2], personal [3], unreviewed [2,3], not measured [5]: ' + got);
  const words = rows.map((r) => r.words).join(' | ');
  expect(words === '2 card data | 1 personal data | 2 unreviewed | 0 findings | 1 not measured', 'the rows speak the title block words, the unmeasured row last: ' + words);
  const off = rows.filter((r) => r.key !== 'findings' && Number(/^(\d+)/.exec(r.words)?.[1]) !== r.ids.length);
  expect(rows.length > 0 && off.length === 0, 'every counting clause says as many as it walks to: ' + off.map((r) => r.key + ' says ' + r.words + ', walks ' + r.ids.length).join('; '));
  expect(rows.every((r) => typeof r.key === 'string' && typeof r.words === 'string' && Array.isArray(r.ids)), 'a row is { key, words, ids }');
});

// ---- 2 + 3. kettle parity
const sims: Any[] = [];
runCase(2, () => {
  for (const scale of [1, 3]) {
    const M = buildModel(scale, () => 0, null); sims.push(M);
    for (const lens of LENSES) for (const B of M.L.blds) {
      const now = CHANNELS[lens].aggregate(B.feats).parts.join(' | '), old = oldAggregate(lens, B.feats).join(' | ');
      expect(now === old, `GUARD scale ${scale} ${lens} ${B.id}: the title block says today's words (${old}), not ${now}`);
      const derived = scheduleParts(lens, B.feats).join(' | ');
      expect(derived === now, `scale ${scale} ${lens} ${B.id}: the schedule's words are the title block's (${now}), not ${derived}`);
    }
  }
});
runCase(3, () => {
  for (const M of sims) for (const lens of LENSES) for (const Bay of M.L.bays) {
    const now = railParts(lens, Bay.feats, M.sim).join(' | '), old = oldRail(lens, Bay.feats, M.sim).join(' | ');
    expect(now === old, `GUARD ${lens} bay ${Bay.cap?.id ?? Bay.code}: the rail says today's words (${old}), not ${now}`);
  }
  const src = fs.readFileSync(path.join(SRC, 'variants/bold/decor.ts'), 'utf8');
  const body = /export function railParts[\s\S]*?\n}\n/.exec(src)?.[0] ?? '';
  const inline = ['customerRequests30d', 'mrrImpactUsd', 'openPRs', 'humanReviewed', "environment === 'production'", 'incidents30d', "dataClass === 'payment'", "dataClass === 'personal'", 'sensitiveUnreviewed', 'e2ePassing', 'openBugs'].filter((t) => body.includes(t));
  expect(!!body && inline.length === 0, 'railParts reads its totals from the schedule clauses, not from inline predicates: ' + (inline.join(', ') || (body ? 'ok' : 'railParts not found')));
  const chs = fs.readFileSync(path.join(SRC, 'variants/bold/channels.ts'), 'utf8');
  const aggs = [...chs.matchAll(/aggregate\(fs\)[^{]*\{([\s\S]*?)\n {2}\},/g)].map((m) => m[1]);
  expect(aggs.length === 6 && aggs.every((a) => /tally\(|clauseWords\(/.test(a) && !/reduce\(|count\(/.test(a)), `every channel aggregate is the schedule's words (${aggs.length} aggregates found, inline: ${aggs.filter((a) => /reduce\(|count\(/.test(a)).length})`);
});

// ---- 4. summing clauses
runCase(4, () => {
  const biz = (asks: number, mrr: number, id: string) => feat({ business: { v: { customerRequests30d: asks, revenueLink: mrr ? 'direct' : 'none', mrrImpactUsd: mrr, value: 3 }, h: 'good' } }, id);
  const b = rowsOf('business', [biz(3, 0, 'a'), biz(0, 0, 'b'), biz(5, 1200, 'c'), biz(1, 0, 'd')]);
  const asks = rowOf(b, 'asks'), mrr = rowOf(b, 'mrr');
  expect(asks?.words === '9 customer asks' && asks?.ids.join(',') === 'a,c,d', 'asks: the sum is the words (9), the askers a,c,d (in plan order) are the ids: ' + JSON.stringify(asks));
  expect(mrr?.words === '$1.2k/mo direct revenue' && mrr?.ids.join(',') === 'c', 'direct revenue: $1.2k from c alone: ' + JSON.stringify(mrr));
  const dev = (prs: number, id: string) => feat({ development: { v: { openPRs: prs, aiAuthoredPct: 50 }, h: 'good' } }, id);
  const prs = rowOf(rowsOf('development', [dev(2, 'p'), dev(0, 'q'), dev(4, 'r')]), 'prs');
  expect(prs?.words === '6 open PRs' && prs?.ids.join(',') === 'p,r', 'open PRs: 6, from p and r: ' + JSON.stringify(prs));
  const sec = (n: number, id: string) => feat({ security: { v: { dataClass: 'internal', review: n ? 'findings' : 'passed', openFindings: n }, h: 'good' } }, id);
  const fi = rowOf(rowsOf('security', [sec(0, 'x'), sec(3, 'y'), sec(1, 'z')]), 'findings');
  expect(fi?.words === '4 findings' && fi?.ids.join(',') === 'y,z', 'findings: 4, from y and z: ' + JSON.stringify(fi));
});

// ---- 5. a row press walks
runCase(5, () => {
  const flown: Any[] = [];
  const E: Any = { flyToFeature: (id: string, hl: boolean) => flown.push([id, hl]) };
  let c: Any = null; const seen: Any[] = [];
  for (let i = 0; i < 3; i++) { c = goNext ? goNext(E, ['2', '3'], c) : 'missing'; seen.push(c); }
  expect(seen.join(',') === '2,3,2' && JSON.stringify(flown) === '[["2",true],["3",true],["2",true]]', 'three presses on [2,3] fly 2, 3, then wrap to 2, each with the highlight: ' + JSON.stringify(flown));
  const fresh = goNext ? goNext(E, ['2', '3'], 'gone') : 'missing';
  expect(fresh === '2', 'a cursor that left the row starts over at its first feature: ' + fresh);
  let src = ''; try { src = fs.readFileSync(path.join(SRC, 'variants/bold/Schedule.tsx'), 'utf8'); } catch { /* missing */ }
  expect(/onKeyDown=\{[^}]*(?:'Enter'|"Enter")[^}]*(?:' '|" ")[^}]*swallow\(e\)/.test(src) && /onClick=\{go\}/.test(src), 'Schedule.tsx rows press on click, Enter and Space, and swallow the key (stopImmediatePropagation) so the engine handler does not also act');
});

// ---- 6 + 7. server render
const req = createRequire(path.join(ROOT, 'package.json'));
const React: Any = req('react'), { renderToString }: Any = req('react-dom/server');
const { EngineCtx, VariantCtx } = await imp('components/hooks.ts');
const { initialState } = await imp('engine/state.ts');
const shared = await imp('components/Legend.tsx');
const boldV = (await imp('variants/bold/index.ts')).bold;
const f1 = feat({ security: { v: { dataClass: 'payment', review: 'pending' }, h: 'bad' } }), f2 = feat({});
const LENS: Any = { security: { id: 'security', name: 'Security', short: 'SEC', i: 0 }, 'com.kettle.cost': { id: 'com.kettle.cost', name: 'Cost', short: 'CST', i: 1 } };
const P: Any = { features: [f1, f2], base: { features: [f1, f2] }, lenses: Object.values(LENS), LENS, F: { [f1.id]: f1, [f2.id]: f2 }, asOf: '2026-10-01' };
const M: Any = { P, L: { TILE: { [f1.id]: {}, [f2.id]: {} } } };
const render = (C: Any, view: string): string => {
  const S = { ...initialState(1, P.asOf), ready: true, view };
  const E: Any = { M, S, store: { get: () => S, subscribe: () => () => {} }, flyToFeature() {}, lensIds: ['security'], lensAccent: () => 'x', channel: () => null, live: () => ({ rolloutPct: 0, progressPct: 0 }) };
  try { return renderToString(React.createElement(VariantCtx.Provider, { value: boldV ?? {} }, React.createElement(EngineCtx.Provider, { value: E }, React.createElement(C, { view })))); }
  catch (e) { return 'THREW ' + (e as Error).message; }
};
const BoldLegend = boldV?.ui?.Legend ?? shared.Legend;
runCase(6, () => {
  const html = render(BoldLegend, 'security');
  const btns = html.match(/<button[^>]*>/g) ?? [];
  const btn = (label: RegExp) => btns.find((b) => label.test(b)) ?? '';
  const zero = btn(/aria-label="0 personal data: 0 features on this plan"/), card = btn(/aria-label="1 card data: 1 feature on this plan, go to next"/);
  expect(/aria-disabled="true"/.test(zero), 'the 0-id "personal data" row is an aria-disabled button: ' + (zero || '(no such button) ' + html.slice(0, 200)));
  expect(!!card && !/aria-disabled/.test(card), 'the 1-id "card data" row is an enabled button labelled "1 card data: 1 feature on this plan, go to next"');
  expect(/1 not measured: 1 feature on this plan/.test(html), 'the facet-less feature is on the "not measured" row');
  expect(html.includes(LENS_NAME.security.no) && html.includes(LENS_NAME.security.nm), 'the schedule is headed with the sheet number and the reader (F-501 Perimeter)');
  const flown: Any[] = [];
  const n0 = goNext ? goNext({ flyToFeature: (id: string) => flown.push(id) }, [], null) : 'missing';
  expect(n0 === null && flown.length === 0, 'pressing a row with no features calls nothing');
  const css = fs.readFileSync(path.join(SRC, 'variants/bold/styles.css'), 'utf8');
  const rules = [...css.matchAll(/[^}]*\.bd-sch[^{]*\{[^}]*\}/g)].map((m) => m[0]);
  const small = rules.flatMap((r) => [...r.matchAll(/font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/g)].filter((m) => Number(m[1]) < 12).map(() => r.trim().slice(0, 60)));
  expect(rules.length > 0 && rules.some((r) => /font/.test(r)) && small.length === 0, 'every schedule text rule (.bd-sch) in bold/styles.css is >= 12 px: ' + (small.join(' | ') || (rules.length ? 'ok' : 'no .bd-sch rule')));
  expect(!/#[0-9a-f]{3,8}\b/i.test(rules.join('\n')), 'the schedule rules use tokens, no raw colours');
});
runCase(7, () => {
  for (const view of ['general', 'com.kettle.cost']) {
    const a = render(BoldLegend, view), b = render(shared.Legend, view);
    expect(!a.startsWith('THREW') && a === b, `GUARD bold under ${view} renders the shared Legend unchanged` + (a === b ? '' : ': ' + a.slice(0, 160) + ' vs ' + b.slice(0, 160)));
  }
});

if (failures.length) { console.error('check:bold-schedule FAILED (cases red: ' + red.join(',') + ' of ' + cases + ')\n' + failures.map((f) => '  - ' + f).join('\n') + `\n(${held} held)`); process.exit(1); }
console.log(`check:bold-schedule ok: ${cases} cases, ${held} expectations held`);
