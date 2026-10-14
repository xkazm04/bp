// Usage: node scripts/fixtures/kettle-findings.mjs [--check]
//   writes src/data/kettle.findings.json: the Kettle sample's findings, store-shaped `Proposal` rows (src/lib/scan/types.ts)
//   that a /lens-scan run over the sample map would have proposed. The app overlays them with the scan sim's states
//   (src/lib/model/scan-sim.ts) and shows them in the findings ledger. --check regenerates in memory and diffs against
//   the committed file (npm run check:findings), writing nothing.
// Read from the map, not from a list: every ENABLED lens of src/data/kettle.app-structure.json gets findings (a lens
// with metric fields gets metric findings with a before value from the feature's facet and an expected delta in the
// metric's `better` direction; any other lens gets findings with no metric). Features in trouble under a lens are
// drawn first, so the ledger and the plan's flags tell one story. Seeded: the same map gives the same bytes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seeded } from '../lib/prng.ts';
import { loadStructure } from '../../src/lib/standard/load.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAP = 'src/data/kettle.app-structure.json', OUT = 'src/data/kettle.findings.json';
const map = JSON.parse(fs.readFileSync(path.join(ROOT, MAP), 'utf8'));
const st = loadStructure(map, null);
const rnd = seeded('kettle-findings/1');
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const shuffle = (xs) => { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const RUN = 'sample-run-1';
/** The map's as-of moment: findings are created in the week before it, and nothing happens after it. */
const AS_OF = Date.parse(map.generated_at ?? st.asOf + 'T09:00:00Z');
const WEEK = 7 * 864e5, HOUR = 36e5;
/** To the minute, never past the as-of moment. */
const iso = (t) => new Date(Math.floor(Math.min(t, AS_OF) / 6e4) * 6e4).toISOString().replace('.000', '');
const TOTAL = 60;

// ------------------------------------------------------------------------------------------- wording
// Sample text only. A metric's line is keyed by `<lens>/<metric>`, a lens without metrics by its id; anything the
// table lacks (a lens added to the map later) falls back to wording made from the manifest's names.
const METRIC_TEXT = {
  'design/axeViolations': ['Fix the {n} axe violations on {f}', 'accessibility/wcag-aa'],
  'design/undesignedStates': ['Design the empty and error states of {f}', 'design/state-coverage'],
  'design/rawLiterals': ['Replace raw colour literals in {f} with tokens', 'house:design/tokens'],
  'design/minTextPx': ['Raise {f} text to the 12 px floor', 'house:design/text-floor'],
  'design/consoleErrors': ['Clear the console errors on {f}', 'none'],
  'design/standardsPct': ['Bring {f} in line with the design standards', 'house:design/system'],
  'development/loc': ['Remove the dead code paths in {f}', 'none'],
  'development/files': ['Merge the one-function modules of {f}', 'house:code/module-size'],
  'development/bundleKb': ['Split the {f} bundle by route', 'performance/code-splitting'],
  'development/depCount': ['Drop the unused dependencies of {f}', 'supply-chain/minimal-deps'],
  'development/p50Ms': ['Cache the {f} read path', 'performance/caching'],
  'development/p95Ms': ['Index the slow {f} lookup', 'performance/query-indexes'],
  'development/dupSites': ['Fold the duplicated helpers in {f}', 'house:code/one-helper'],
  'development/testRatioPct': ['Cover the {f} edge cases with unit tests', 'testing/unit-coverage'],
  'development/standardsPct': ['Bring {f} in line with the code standards', 'house:code/conventions'],
  'security/findingsCritical': ['Rotate and vault the {f} provider key', 'security/secret-management'],
  'security/findingsHigh': ['Parameterise the {f} queries', 'security/parameterised-queries'],
  'security/findingsMedium': ['Tighten the {f} CORS policy', 'security/cors'],
  'security/findingsLow': ['Set strict headers on {f} responses', 'security/http-headers'],
  'security/secretHits': ['Move the {f} secrets out of the repo', 'security/secret-management'],
  'security/unsafeSinks': ['Escape the {f} HTML sinks', 'security/output-encoding'],
  'security/standardsPct': ['Bring {f} in line with the security standards', 'house:security/baseline'],
};
const LENS_TEXT = {
  business: [['Show the upgrade prompt where {f} hits its plan limit', 'house:business/upsell-at-limit'], ['Track {f} adoption by studio size', 'analytics/event-taxonomy'], ['Cut the steps to first success in {f}', 'none'], ['Answer the top customer request on {f}', 'none']],
  operations: [['Write the runbook for {f} incidents', 'operations/runbooks'], ['Alert on the {f} error rate', 'operations/slo-alerting'], ['Put {f} behind a kill-switch flag', 'operations/feature-flags'], ['Add a health probe for {f}', 'operations/health-checks']],
  quality: [['Cover the {f} happy path end to end', 'testing/e2e-critical-paths'], ['Quarantine the flaky {f} retry test', 'testing/flake-quarantine'], ['Add contract tests for the {f} API', 'testing/contract-tests']],
  'com.kettle.cost': [['Cache the {f} provider calls for ten minutes', 'house:cost/provider-cache'], ['Batch the sends of {f}', 'house:cost/batching'], ['Move the {f} reports to the nightly job', 'house:cost/off-peak']],
};
const NOTES = ['Not before the release.', 'Covered by the platform work next month.', 'The owner wants a design pass first.'];

// ------------------------------------------------------------------------------------------- the lenses
// only metrics Kettle measures on some feature: a lens whose metric fields Kettle never fills (business, operations and
// quality 1.1.0) keeps its non-metric findings rather than dropping out
const LENSES = st.lenses.map((d) => ({ d, metrics: d.fields.filter((x) => x.metric && (x.type === 'integer' || x.type === 'number' || x.type === 'percent') && st.features.some((f) => typeof f.lens[d.id]?.v?.[x.key] === 'number')) }));
if (!LENSES.length) throw new Error(MAP + ': no enabled lens');

/** The feature's numeric facet value for a field, if the map has one. */
const valueOf = (f, lens, key) => { const v = f.lens[lens]?.v?.[key]; return typeof v === 'number' && Number.isFinite(v) ? v : undefined; };
const capOf = (x) => x.max ?? (x.type === 'percent' ? 100 : undefined);
/** A metric move toward the field's target (its `better` direction); null when the value is already there. */
function moveOf(x, v) {
  const t = x.metric.target, int = x.type !== 'number', round = (n) => (int ? Math.round(n) : Math.round(n * 10) / 10);
  if (x.metric.better === 'down') {
    const floor = t ?? x.min ?? 0;
    if (v <= floor) return null;
    const d = -Math.max(int ? 1 : 0.1, round((v - floor) * (0.25 + rnd() * 0.6)));
    return Math.max(d, floor - v);
  }
  if (t !== undefined && v >= t) return null;
  const top = t ?? capOf(x);
  if (top === undefined) return round(Math.max(1, v * (0.05 + rnd() * 0.2)));
  if (v >= top) return null;
  return round(Math.min(top - v, Math.max(int ? 1 : 0.5, (top - v) * (0.4 + rnd() * 0.6))));
}

// troubled features first (bad, then watch), then the rest that the lens measures; never an idea or a retired feature
const BUILT = st.features.filter((f) => f.stage && f.stage !== 'idea' && f.stage !== 'deprecated');
function candidates(lens) {
  const h = (f) => f.lens[lens]?.h, rank = { bad: 0, watch: 1, good: 2 };
  const fs = shuffle(BUILT.filter((f) => h(f) in rank));
  return fs.sort((a, b) => rank[h(a)] - rank[h(b)]);
}

// a lens with metrics counts double (it has more to say), by largest remainder; three slots go to the baseline story
const BASE_N = 3, W = LENSES.map((l) => (l.metrics.length ? 2 : 1)), WS = W.reduce((a, b) => a + b, 0);
const share = W.map((w) => ((TOTAL - BASE_N) * w) / WS), quota = share.map(Math.floor);
for (const i of share.map((s, i) => [s - Math.floor(s), i]).sort((a, b) => b[0] - a[0]).slice(0, TOTAL - BASE_N - quota.reduce((a, b) => a + b, 0)).map(([, i]) => i)) quota[i]++;

const SIZES = [['XS', 0.15], ['S', 0.3], ['M', 0.3], ['L', 0.18], ['XL', 0.07]];
const size = () => { let r = rnd(); for (const [s, p] of SIZES) if ((r -= p) < 0) return s; return 'M'; };
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const unitOf = (x) => (x.unit ? ' ' + x.unit : x.type === 'percent' ? '%' : '');

/** One finding (status and times are set later). `full`: the move goes all the way to the metric's target (a baseline). */
function finding(f, L, x, title, standard, full = false) {
  const d = L.d, v = x ? valueOf(f, d.id, x.key) : undefined;
  const delta = x && v !== undefined ? (full && x.metric.target !== undefined ? x.metric.target - v : moveOf(x, v)) : undefined;
  const why = f.lens[d.id]?.why;
  const t = title.replace('{f}', f.name).replace('{n}', v !== undefined ? fmt(v) : 'open');
  const body = [
    '## Summary', `${t}. ${why ? `The ${d.name} lens reads: ${why}.` : `Found by the ${d.name} pass of the sample scan.`}`, '',
    '## Impact', x && v !== undefined && delta != null
      ? `${x.label ?? x.key} goes from ${fmt(v)} to ${fmt(v + delta)}${unitOf(x)} on ${f.name}${x.metric.target !== undefined ? ` (target ${fmt(x.metric.target)})` : ''}.`
      : `Moves ${f.name} toward good under ${d.name}.`, '',
    '## Evaluation', x ? `Re-measure ${x.key} (${x.metric.method ?? 'judgement'}) after the change; done when it reads ${v !== undefined && delta != null ? fmt(v + delta) : 'the target'} or better.` : `The ${d.name} lens is judged again on the next scan.`,
  ].join('\n');
  return {
    feature: f.slug, lens: d.id, ...(x ? { metric: x.key } : {}), title: t, body, standard,
    ...(delta != null ? { expected_delta: delta } : {}), size: size(), risk: ri(1, 10), kind: 'fix',
  };
}

const items = [];
const used = new Set();
LENSES.forEach((L, i) => {
  const want = quota[i], pool = candidates(L.d.id);
  for (let k = 0, n = 0; n < want && k < pool.length * 2; k++) {
    const f = pool[k % pool.length];
    if (L.metrics.length) {
      // a metric this feature can still improve on, not proposed for it already
      const xs = shuffle(L.metrics).filter((x) => { const v = valueOf(f, L.d.id, x.key); return v !== undefined && moveOf({ ...x }, v) !== null && !used.has(f.slug + '/' + L.d.id + '/' + x.key); });
      const x = xs[0]; if (!x) continue;
      used.add(f.slug + '/' + L.d.id + '/' + x.key);
      const [title, standard] = METRIC_TEXT[L.d.id + '/' + x.key] ?? [(x.metric.better === 'down' ? 'Cut ' : 'Raise ') + (x.label ?? x.key) + ' on {f}', 'none'];
      items.push(finding(f, L, x, title, standard)); n++;
    } else {
      if (used.has(f.slug + '/' + L.d.id)) continue;
      used.add(f.slug + '/' + L.d.id);
      const [title, standard] = pick(LENS_TEXT[L.d.id] ?? [['Improve {f} under ' + L.d.name, 'none']]);
      items.push(finding(f, L, null, title, standard)); n++;
    }
  }
});

// the baseline story: one upgrade of a metric with a target and its propagation to two more features. The metric is the
// targeted one that the most features (not proposed for it yet) fall short of, so all three carry a real move
const improvable = (L, x) => BUILT.filter((f) => { const v = valueOf(f, L.d.id, x.key); return v !== undefined && moveOf(x, v) !== null && !used.has(f.slug + '/' + L.d.id + '/' + x.key); });
const BX = LENSES.flatMap((L) => L.metrics.filter((x) => x.metric.target !== undefined).map((x) => ({ L, x, fs: improvable(L, x) })))
  .filter((c) => c.fs.length >= 3).sort((a, b) => b.fs.length - a.fs.length)[0];
let baseline = null;
const children = [];
if (BX) {
  const { L, x } = BX, all = shuffle(BX.fs);
  const standard = METRIC_TEXT[L.d.id + '/' + x.key]?.[1] ?? '';
  const house = standard.startsWith('house:') ? standard : 'house:' + L.d.id + '/' + x.key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  baseline = { ...finding(all[0], L, x, `House baseline: ${x.label ?? x.key} at ${fmt(x.metric.target)}${unitOf(x)}, starting with {f}`, house, true), kind: 'baseline-upgrade', size: 'M', risk: 5 };
  for (const f of all.slice(1, 3)) children.push({ ...finding(f, L, x, `Apply the ${(x.label ?? x.key).toLowerCase()} baseline to {f}`, house, true), kind: 'propagation', size: 'XS', risk: ri(1, 3) });
}

// ------------------------------------------------------------------------------------------- states and times
// mostly proposed; the rest spread over every later state, so each ledger column and chip has rows
const fixes = shuffle(items);
const STATES = [['approved', 6], ['executing', 5], ['done', 4], ['failed', 2], ['declined', 2]];
let at = 0;
for (const [s, n] of STATES) for (let k = 0; k < n && at < fixes.length; k++) fixes[at++].status = s;
for (; at < fixes.length; at++) fixes[at].status = 'proposed';
const hex = () => Array.from({ length: 8 }, () => '0123456789abcdef'[ri(0, 15)]).join('');

function stamp(p, created) {
  p.run_id = RUN;
  p.created_at = iso(created);
  let t = created;
  if (p.status !== 'proposed') {
    t = Math.min(AS_OF - HOUR, created + ri(1, 20) * HOUR);
    p.decided_by = 'blueprint'; p.decided_at = iso(t);
    if (p.status === 'declined') p.decision_note = pick(NOTES);
    if (p.status === 'executing' || p.status === 'done' || p.status === 'failed') t = Math.min(AS_OF, t + ri(1, 6) * HOUR);
    if (p.status === 'done') {
      p.result_sha = hex();
      const v = p.metric ? valueOf(st.features.find((f) => f.slug === p.feature), p.lens, p.metric) : undefined;
      if (v !== undefined && p.expected_delta !== undefined) p.after_value = Math.round((v + p.expected_delta) * 10) / 10;
    }
  }
  p.updated_at = iso(t);
  return p;
}
// creation times spread over the week before the as-of date, then sorted; the baseline comes before its children
const out = fixes.map((p) => stamp(p, AS_OF - WEEK + Math.floor(rnd() * (WEEK - 2 * HOUR))));
if (baseline) {
  const t0 = AS_OF - WEEK + Math.floor(rnd() * (WEEK / 2));
  baseline.status = 'done';
  out.push(stamp(baseline, t0));
  for (const c of children) { c.status = 'proposed'; out.push(stamp(c, t0 + ri(8, 30) * HOUR)); }
}
out.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
const ORDER = ['id', 'run_id', 'feature', 'lens', 'metric', 'title', 'body', 'standard', 'expected_delta', 'size', 'risk', 'kind', 'parent_id', 'status', 'decided_by', 'decided_at', 'decision_note', 'after_value', 'result_sha', 'created_at', 'updated_at'];
out.forEach((p, i) => { p.id = 'kf-' + String(i + 1).padStart(3, '0'); });
if (baseline) for (const c of children) c.parent_id = baseline.id;
const rows = out.map((p) => Object.fromEntries(ORDER.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])));
const text = JSON.stringify(rows, null, 2) + '\n';

// ------------------------------------------------------------------------------------------- write or check
if (process.argv.includes('--check')) {
  const have = fs.readFileSync(path.join(ROOT, OUT), 'utf8').replace(/\r\n/g, '\n');
  if (have !== text) {
    const a = have.split('\n'), b = text.split('\n'), i = a.findIndex((l, k) => l !== b[k]);
    console.error(`DRIFT: ${OUT} is not what scripts/fixtures/kettle-findings.mjs generates (first difference at line ${i + 1}; regenerate with node scripts/fixtures/kettle-findings.mjs)`);
    process.exit(1);
  }
  console.log(`ok: ${OUT} reproduces exactly (${rows.length} findings)`);
  process.exit(0);
}
fs.writeFileSync(path.join(ROOT, OUT), text);
const count = (k) => rows.reduce((a, p) => ((a[p[k]] = (a[p[k]] ?? 0) + 1), a), {});
console.log(`wrote ${OUT}: ${rows.length} findings over ${new Set(rows.map((p) => p.feature)).size} features`);
console.log(`  by lens ${JSON.stringify(count('lens'))}`);
console.log(`  by status ${JSON.stringify(count('status'))}`);
console.log(`  by kind ${JSON.stringify(count('kind'))}; with a metric ${rows.filter((p) => p.metric).length}`);
