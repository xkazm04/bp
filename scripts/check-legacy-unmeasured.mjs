// Checks that the shaped and bold prototypes never state a fact for a lens that was not measured
// (docs/blueprint-ui.md: lenses are data, 'unmeasured' is a health of its own):
//   1. bl() (src/variants/base/legacy.ts) on a feature with NO facet: no field may carry a default that
//      reads as a measurement ('PUBLIC' data, 'none' environment, value 1, ...). Unknown = '' (or 0 for the
//      1..5 value, which sits outside its scale). openBugs counts stay 0 (a count has no unknown), so the
//      census counts only the other fields.
//   2. content() of all 12 shaped and bold built-in channels on that feature: the only part is 'NOT MEASURED',
//      and there is no stamp.
//   3. the other arm: on a feature whose facets are all present and healthy, no channel says NOT MEASURED, and
//      with ONE facet present only that lens speaks.
//   4. aggregate() of all 12 channels (base measuredAggregate): a place whose features are all unmeasured says
//      only NOT MEASURED; a mixed place counts its measured features only and ends with 'N not measured', and
//      without that trailing part reads exactly as the measured-only place does (the reconcile property).
//   5. one sensitive-and-unreviewed predicate (base sensitiveUnreviewed): over every data class x review, both
//      security stamps and aggregates, bold's bay rail count and its Perimeter wording agree with it, and no
//      file in bold/ or shaped/ spells the conjunction inline (comments stripped); the data-class and design
//      ordinals live in base once.
// The built-in lens list is DERIVED from bl()'s own shape (Object.keys), never hand-kept: a 7th lens joins
// every assertion here at once. Only the measured arm's sample VALUES must be named by hand, and a lens with
// no entry there is reported by name.
// Run: node scripts/check-legacy-unmeasured.mjs   (src-hooks transpile mode; exit 1 on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { registerSrcHooks } from './lib/src-hooks.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerSrcHooks(ROOT, { transpile: true }); // the variants' import graph reaches .tsx: the checks' loader transpiles it
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { bl } = await imp('apps/web/src/variants/base/legacy.ts');
const shaped = (await imp('apps/web/src/variants/shaped/channels.ts')).CHANNELS;
const bold = (await imp('apps/web/src/variants/bold/channels.ts')).CHANNELS;

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const feature = (lens) => ({ id: 'f', slug: 'f', name: 'F', stage: 'live', lens });
const live = { rolloutPct: 0, progressPct: 0, value: () => undefined };
const NM = 'NOT MEASURED';

// ---- 1. the field census on a feature with no facet
const empty = bl(feature({}));
// The built-in lenses are DERIVED from bl()'s own shape, not hand-kept here: a 7th lens added to
// src/variants/base/legacy.ts joins all 42 assertions below at once. A hand list left them behind it.
const LENSES = Object.keys(empty);
check(`bl() names at least 6 built-in lenses (got ${LENSES.length}: ${LENSES.join(', ')})`, LENSES.length >= 6);
const flat = [];
for (const [lens, o] of Object.entries(empty)) for (const [k, v] of Object.entries(o)) {
  if (k === 'health' || k === 'openBugs') continue; // health is 'unmeasured' already; counts stay 0
  flat.push([lens + '.' + k, v]);
}
// a field "asserts a value" when it is a non-empty string other than the vocabulary's own 'unknown', or the rating `value` (1..5 scale) is not 0
const asserts = flat.filter(([k, v]) => (typeof v === 'string' && v !== '' && v !== 'unknown') || (k === 'business.value' && v !== 0));
check('bl(no facet): no field asserts a value', asserts.length === 0, `${asserts.length} of ${flat.length}: ` + asserts.map(([k, v]) => k + '=' + JSON.stringify(v)).join(', '));
check('bl(no facet): every health is unmeasured', LENSES.every((l) => empty[l]?.health === 'unmeasured'));

// ---- 2. content() on a feature with no facet
const bare = feature({});
const VARIANTS = [['shaped', shaped], ['bold', bold]];
// A lens bl() names but a variant has no channel for is the first thing a 7th lens hits: report it by name
// instead of crashing on `undefined.content` (the loops below are derived from LENSES, so they all reach it).
for (const [vn, ch] of VARIANTS) for (const l of LENSES) check(`${vn} has a channel for the '${l}' lens`, typeof ch[l]?.content === 'function');
const chans = VARIANTS.map(([vn, ch]) => [vn, ch, LENSES.filter((l) => typeof ch[l]?.content === 'function')]);
let said = 0;
for (const [vn, ch, ls] of chans) for (const l of ls) {
  const c = ch[l].content(bare, live);
  const ok = c.parts.length === 1 && c.parts[0] === NM && c.stamp === undefined;
  if (!ok) said++;
  check(`${vn}.${l}.content(no facet) is only ${NM}`, ok, JSON.stringify(c));
}

// ---- 3. the measured arm
const VALUES = {
  business: { value: 4, customerRequests30d: 3, revenueLink: 'direct', mrrImpactUsd: 2000 },
  design: { status: 'hi-fi', a11y: 'pass' },
  development: { status: 'in-dev', progressPct: 40, aiAuthoredPct: 20, openPRs: 2, unitCoveragePct: 71 },
  operations: { environment: 'production', p95ms: 120, alerting: true },
  security: { dataClass: 'payment', review: 'passed' },
  quality: { status: 'passing', e2eTests: 10, e2ePassing: 9, openBugsP1: 1 },
};
// VALUES is the one place a new lens must still be named by hand, so say so instead of failing obscurely
// in the measured arm (an absent entry would read as a lens that says nothing when everything is measured).
for (const l of LENSES) check(`the measured arm has sample values for the '${l}' lens`, !!VALUES[l], 'add it to VALUES in this check');
const lensOf = (l) => ({ h: 'good', v: VALUES[l], whyFields: [], facet: l });
const full = feature(Object.fromEntries(LENSES.filter((l) => VALUES[l]).map((l) => [l, lensOf(l)])));
for (const [vn, ch, ls] of chans) for (const l of ls.filter((x) => VALUES[x])) {
  const c = ch[l].content(full, live);
  check(`${vn}.${l}.content(measured) speaks`, c.parts.length > 0 && !c.parts.includes(NM) && c.parts.every((p) => p !== ''), JSON.stringify(c));
}
const one = feature({ security: lensOf('security') });
for (const [vn, ch, ls] of chans) for (const l of ls) {
  const c = ch[l].content(one, live), nm = c.parts.length === 1 && c.parts[0] === NM;
  check(`${vn}.${l}.content(only security measured)`, l === 'security' ? !nm : nm, JSON.stringify(c));
}

// ---- 4. aggregates count measured facets only
const legacy = await imp('apps/web/src/variants/base/legacy.ts');
const { railParts } = await imp('apps/web/src/variants/bold/decor.ts');
const { perimeterNote } = await imp('apps/web/src/variants/bold/panels.tsx');
const MV = { ...VALUES, design: { status: 'polished', a11y: 'pass' }, development: { aiAuthoredPct: 80, status: 'in-progress' }, quality: { status: 'passed', e2eTests: 4, e2ePassing: 4 } };
const m = feature(Object.fromEntries(LENSES.filter((l) => MV[l]).map((l) => [l, { h: 'good', v: MV[l], whyFields: [], facet: l }])));
const u = feature({});
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bdev = bold.development.aggregate([m, u]).parts;
check('bold development [m, u] averages measured facets only: parts[1] is "80% agent-written"', bdev[1] === '80% agent-written', JSON.stringify(bdev));
check('bold development [m, u] ends with "1 not measured"', bdev[bdev.length - 1] === '1 not measured', JSON.stringify(bdev));
const sdev = shaped.development.aggregate([m, u]).parts;
check('shaped development [m, u] says "80% agent code"', sdev.includes('80% agent code'), JSON.stringify(sdev));
const sdes = shaped.design.aggregate([m, u]).parts;
check('shaped design [polished m, u]: parts[0] is "1 of 1 designed"', sdes[0] === '1 of 1 designed', JSON.stringify(sdes));
for (const [vn, ch, ls] of chans) for (const l of ls) {
  const a = ch[l].aggregate([u]);
  check(`${vn}.${l}.aggregate([unmeasured]) is only ${NM}`, eq(a, { parts: [NM] }), JSON.stringify(a));
}
for (const [vn, ch, ls] of chans) for (const l of ls) {
  const mixed = ch[l].aggregate([m, u]).parts, alone = ch[l].aggregate([m]).parts;
  check(`${vn}.${l}.aggregate reconciles: [m, u] = [m] + "1 not measured"`, mixed[mixed.length - 1] === '1 not measured' && eq(mixed.slice(0, -1), alone) && !alone.some((p) => / not measured$|^NOT MEASURED$/.test(p)), JSON.stringify({ mixed, alone }));
}

// ---- 5. one sensitive-and-unreviewed predicate
const CLASSES = ['public', 'internal', 'personal', 'payment'], REVIEWS = ['not-required', 'not-started', 'pending', 'passed', 'findings'];
const sim = { rolloutOf: () => 50 }, live50 = { rolloutPct: 50, progressPct: 0, value: () => undefined };
const num = (parts, re) => { const p = (parts ?? []).find((x) => re.test(x)); return p ? Number(p.match(/^(\d+)/)?.[1] ?? NaN) : 0; };
for (const dc of CLASSES) for (const rv of REVIEWS) {
  const f = feature({ security: { h: 'good', v: { dataClass: dc, review: rv, openFindings: rv === 'findings' ? 2 : 0 }, whyFields: [], facet: 'security' } });
  const truth = (dc === 'payment' || dc === 'personal') && (rv === 'pending' || rv === 'not-started');
  const su = typeof legacy.sensitiveUnreviewed === 'function' ? legacy.sensitiveUnreviewed(f) : undefined;
  const readers = {
    base: su,
    boldStamp: bold.security.content(f, live50).stamp === 'Live, unreviewed',
    shapedStamp: shaped.security.content(f, live50).stamp === 'Live, not reviewed',
    boldAgg: num(bold.security.aggregate([f]).parts, / unreviewed$/) === 1,
    shapedAgg: num(shaped.security.aggregate([f]).parts, / sensitive unreviewed$/) === 1,
    rail: typeof railParts === 'function' ? num(railParts('security', [f], sim), / UNREVIEWED$/) === 1 : undefined,
    perimeter: typeof perimeterNote === 'function' ? / without a review$/.test(perimeterNote(f)) : undefined,
  };
  check(`sensitiveUnreviewed(${dc}, ${rv}) = ${truth}, and every reader agrees`, Object.values(readers).every((v) => v === truth), JSON.stringify(readers));
}
const { blankComments } = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/source.ts')).href);
const walkDir = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDir(path.join(d, e.name)) : [path.join(d, e.name)]));
const VDIR = path.join(ROOT, 'apps/web/src/variants');
const srcFiles = ['bold', 'shaped'].flatMap((v) => walkDir(path.join(VDIR, v))).filter((p) => /\.tsx?$/.test(p));
const inline = [], tables = [];
for (const p of srcFiles) {
  const lines = blankComments(fs.readFileSync(p, 'utf8')).split('\n'), rel = path.relative(VDIR, p).split(path.sep).join('/');
  lines.forEach((ln, i) => {
    if (/=== '(pending|not-started)'/.test(ln) && /'payment'|'personal'|dataClass|\bsensitive\b|>= ?2\b/.test(ln)) inline.push(rel + ':' + (i + 1));
    if (/\b(SENS|CLASSN|FIDELITY|DSTEP)\b\s*[:=]/.test(ln)) tables.push(rel + ':' + (i + 1));
  });
}
check('no file in bold/ or shaped/ spells the sensitive-and-unreviewed conjunction inline', inline.length === 0, inline.join(', '));
check('the data-class and design ordinals live in base once (no SENS / CLASSN / FIDELITY / DSTEP table in bold/ or shaped/)', tables.length === 0, tables.join(', '));

console.log(`check-legacy-unmeasured: bl census ${asserts.length} of ${flat.length} fields assert a value; ${said} of ${chans.reduce((n, [, , ls]) => n + ls.length, 0)} channels say more than ${NM} with no facet; ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
