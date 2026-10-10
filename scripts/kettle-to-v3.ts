// Converts the Kettle sample (src/data/kettle.json) into the app-structure v3 standard (3.1 additions:
// metric values on about 30 features, and the invoice-ocr feature with experience, core and variations):
//   src/data/kettle.app-structure.json   the map (context-map.json v3)
//   src/data/kettle.events.jsonl         its append-only events log
// Run: node scripts/kettle-to-v3.ts  (Node's type stripping; no build step). Deterministic: the only
// "random" values come from a PRNG seeded by record slugs, so every run writes the same bytes.
//
// Before writing, it proves two things and fails loudly otherwise:
//  1. replaying the stage events reproduces all weekly `snapshots` counts stored in the sample;
//  2. the reference evaluator over the converted facets (feature passed as context) reproduces the
//     sample's stored health on every built-in lens, for every feature.
// Spec: docs/standard/app-structure-v3.md. The custom lens manifest is docs/standard/lenses-custom/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lensHealth } from '../src/lib/standard/health.ts';
import type {
  AppStructure, Capability, Context, Domain, Facet, FacetValues, Feature, FeatureBoundField, Group, Health, Kpi, LensEntry,
  LensManifest, Milestone, Stage, StructureEvent,
} from '../src/lib/standard/types.ts';
import { FLATTEN, type LensObject } from './sample-facets.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const OUT_MAP = 'src/data/kettle.app-structure.json';
const OUT_EVENTS = 'src/data/kettle.events.jsonl';
const BUILTIN = ['business', 'design', 'development', 'operations', 'security', 'quality'] as const;
const COST_LENS = 'com.kettle.cost';

// ------------------------------------------------------------------------------- the sample's shape
interface SampleFeature {
  id: string; name: string; summary: string; domain: string; capability: string; stage: Stage; priority: 'P0' | 'P1' | 'P2' | 'P3';
  kind: 'customer' | 'internal' | 'business' | 'platform'; milestone: string | null; surfaces: string[]; dependsOn: string[];
  usedBy: string[]; history: { stage: Stage; date: string }[]; stageSince: string; created: string; owner: string; builtBy: string[];
  business: LensObject; design: LensObject; development: LensObject; operations: LensObject; security: LensObject; quality: LensObject;
  parts: { name: string; done: boolean }[] | null; notes: { by: string; date: string; text: string }[]; health: Health; flags: string[];
  blockedBy: string[];
}
interface SampleActivity { at: string; type: string; feature: string; actor: string; text: string; from?: string; to?: string; severity?: string }
interface Sample {
  product: {
    name: string; tagline: string; asOf: string; team: string; stack: Record<string, string>;
    business: { studios: number; members: number; mrrUsd: number; mrrGrowthPct30d: number; churnPct30d: number };
  };
  stages: Stage[];
  people: { id: string; name: string; kind: string; field: string; title: string }[];
  milestones: { id: string; name: string; date: string; state: 'done' | 'active' | 'planned'; goal: string }[];
  domains: { id: string; name: string; summary: string; capabilities: string[] }[];
  capabilities: { id: string; domain: string; name: string; features: string[] }[];
  features: SampleFeature[];
  activity: SampleActivity[];
  snapshots: { week: string; counts: Record<Stage, number>; total: number }[];
}

const kettle = read('src/data/kettle.json') as Sample;
const AS_OF = kettle.product.asOf;
const TODAY = AS_OF.slice(0, 10);

// --------------------------------------------------------------------------------------- helpers
/** FNV-1a, 32 bit. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** mulberry32 seeded by a string: the only source of synthetic variation. */
function seeded(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const kebab = (s: string) => s.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
const pad = (n: number) => String(n).padStart(2, '0');
/** A deterministic time of day on a date, between `from` and `to` hours (UTC). */
const timeOn = (date: string, seed: string, from = 8, to = 18) => {
  const r = seeded(seed);
  return `${date}T${pad(from + Math.floor(r() * (to - from)))}:${pad(Math.floor(r() * 60))}:00Z`;
};
function unique<T>(xs: T[]): T[] { return [...new Set(xs)]; }
function fail(msg: string): never { console.error(`\nFAIL: ${msg}`); process.exit(1); }
const byId = new Map(kettle.features.map((f) => [f.id, f]));

// ---------------------------------------------------------------------------------- product tree
/** Readable domain slugs; the sample's code is kept in `id`. */
const DOMAIN_SLUG: Record<string, string> = {
  IAM: 'identity', STU: 'studio-setup', SCH: 'scheduling', BKG: 'booking', PAY: 'payments', MEM: 'member-experience',
  INS: 'instructor-tools', COM: 'communications', GRO: 'growth', ANA: 'analytics', INT: 'integrations', AIA: 'assistant',
  PLT: 'platform',
};
const domainName = new Map(kettle.domains.map((d) => [d.id, d.name]));
const domains: Domain[] = kettle.domains.map((d, i) => {
  const slug = DOMAIN_SLUG[d.id] ?? fail(`no slug for domain ${d.id}`);
  return { slug, id: d.id, name: d.name, summary: d.summary, order: i + 1, source: 'declared' };
});

const capSlug = new Map(kettle.capabilities.map((c) => [c.id, `${DOMAIN_SLUG[c.domain]}.${kebab(c.name)}`]));
const capabilities: Capability[] = kettle.capabilities.map((c) => ({
  slug: capSlug.get(c.id)!, id: c.id, domain: DOMAIN_SLUG[c.domain], name: c.name,
  order: kettle.capabilities.filter((x) => x.domain === c.domain).indexOf(c) + 1, source: 'declared',
}));

const featSlug = new Map(kettle.features.map((f) => [f.id, kebab(f.name)]));
if (new Set(featSlug.values()).size !== kettle.features.length) fail('feature slugs collide');
const slugOf = (id: string) => featSlug.get(id) ?? fail(`unknown feature ${id}`);

const msSlug = new Map(kettle.milestones.map((m) => [m.id, kebab(m.name)]));
const MS_STATUS = { done: 'shipped', active: 'active', planned: 'planned' } as const;
const milestones: Milestone[] = kettle.milestones.map((m) => ({
  slug: msSlug.get(m.id)!, id: m.id, name: m.name, status: MS_STATUS[m.state], target_date: m.date, goal: m.goal,
}));

// -------------------------------------------------------------------------------------- code tree
// Synthesized ("two trees, linked"): one context per domain x stack surface that has features, grouped
// by stack layer. No real files exist, so file_paths stay empty, except on the OCR worker context added
// for invoice-ocr below, which lists the v3.1 code layout (spec 6.7) as an illustration.
const GROUPS: (Group & { surfaces: string[] })[] = [
  { id: 'grp-member-apps', name: 'Member apps', color: 'teal', domain: 'feature', surfaces: ['web-member', 'mobile'] },
  { id: 'grp-admin-web', name: 'Admin web', color: 'blue', domain: 'feature', surfaces: ['web-admin'] },
  { id: 'grp-api', name: 'API', color: 'violet', domain: 'shared', surfaces: ['api'] },
  { id: 'grp-workers', name: 'Workers & jobs', color: 'amber', domain: 'infrastructure', surfaces: ['workers'] },
  { id: 'grp-data', name: 'Data', color: 'green', domain: 'data', surfaces: ['db'] },
  { id: 'grp-integrations', name: 'Integrations', color: 'pink', domain: 'integration', surfaces: ['integrations'] },
  { id: 'grp-platform', name: 'Platform', color: 'slate', domain: 'infrastructure', surfaces: ['infra'] },
];
/** Surface -> context-name suffix and v2 context category. */
const SURFACE: Record<string, { suffix: string; category: string }> = {
  'web-member': { suffix: 'member-web', category: 'ui' },
  mobile: { suffix: 'mobile', category: 'ui' },
  'web-admin': { suffix: 'admin-web', category: 'ui' },
  api: { suffix: 'api', category: 'api' },
  workers: { suffix: 'workers', category: 'lib' },
  db: { suffix: 'data', category: 'data' },
  integrations: { suffix: 'integrations', category: 'api' },
  infra: { suffix: 'infra', category: 'config' },
};
const SURFACE_ORDER = GROUPS.flatMap((g) => g.surfaces);
const ctxName = (domain: string, surface: string) =>
  `${DOMAIN_SLUG[domain]}-${(SURFACE[surface] ?? fail(`unknown surface ${surface}`)).suffix}`;

const contexts: Context[] = [];
for (const d of kettle.domains) {
  const used = new Set(kettle.features.filter((f) => f.domain === d.id).flatMap((f) => f.surfaces));
  for (const s of SURFACE_ORDER) {
    if (!used.has(s)) continue;
    const g = GROUPS.find((x) => x.surfaces.includes(s))!;
    contexts.push({
      id: `ctx-${ctxName(d.id, s)}`, name: ctxName(d.id, s), group: g.name, group_id: g.id, category: SURFACE[s].category,
      business_feature: d.name, description: `${d.name}: ${kettle.product.stack[s]}.`, file_paths: [],
    });
  }
}
// v3.1: the OCR worker behind invoice-ocr, laid out as <domain>/<context>/<feature>/ with the shared core in
// the feature folder and one customizations/<variation>/ folder per bank that only adds to it.
const OCR_CTX = 'payments-ocr';
const OCR_DIR = 'src/payments/ocr/invoice-ocr';
contexts.splice(contexts.findIndex((c) => c.name === ctxName('PAY', 'workers')) + 1, 0, {
  id: `ctx-${OCR_CTX}`, name: OCR_CTX, group: 'Workers & jobs', group_id: 'grp-workers', category: 'lib',
  business_feature: domainName.get('PAY'), description: `${domainName.get('PAY')}: OCR worker that turns photographed invoices into payments.`,
  file_paths: [
    `${OCR_DIR}/extract.ts`, `${OCR_DIR}/schema.ts`, `${OCR_DIR}/confidence.ts`, `${OCR_DIR}/review-queue.ts`,
    `${OCR_DIR}/customizations/vltava-bank/fields.ts`, `${OCR_DIR}/customizations/vltava-bank/spd-qr.ts`,
    `${OCR_DIR}/customizations/nordhavn-sparebank/fields.ts`, `${OCR_DIR}/customizations/nordhavn-sparebank/kid.ts`,
    `${OCR_DIR}/customizations/banco-alameda/fields.ts`,
  ],
});
const groups: Group[] = GROUPS.map(({ surfaces: _s, ...g }) => ({ ...g, context_count: contexts.filter((c) => c.group === g.name).length }));

// --------------------------------------------------------------------------------------- features
// Kind: the sample's kind says who a feature serves; the standard's (Personas) kind says what shape it
// is. Integrations (the integrations domain, or integrations as the first surface) -> integration;
// platform -> ops; customer and internal (member and staff flows) -> user_flow; business -> capability.
// The sample's own kind is kept per feature in extensions (audience).
function kindOf(f: SampleFeature): string {
  if (f.domain === 'INT' || f.surfaces[0] === 'integrations') return 'integration';
  return { platform: 'ops', customer: 'user_flow', internal: 'user_flow', business: 'capability' }[f.kind];
}

const features: Feature[] = kettle.features.map((f) => {
  const ctxs = unique(f.surfaces.map((s) => ctxName(f.domain, s)));
  const out: Feature = {
    slug: slugOf(f.id), id: f.id, name: f.name, summary: f.summary, kind: kindOf(f),
    tier: f.priority === 'P0' || f.priority === 'P1' ? 'major' : 'standard',
    status: 'active', // the sample archives nothing; a deprecated feature still runs, so it is active
    capability: capSlug.get(f.capability) ?? fail(`unknown capability ${f.capability}`),
    contexts: ctxs, primary_context: ctxName(f.domain, f.surfaces[0]),
    stage: f.stage, stage_since: f.stageSince, priority: f.priority,
  };
  if (f.milestone) out.milestone = msSlug.get(f.milestone) ?? fail(`unknown milestone ${f.milestone}`);
  if (f.dependsOn.length) out.depends_on = f.dependsOn.map(slugOf);
  if (f.blockedBy.length) out.blocked_by = f.blockedBy.map(slugOf);
  out.owner = f.owner;
  if (f.builtBy.length) out.built_by = f.builtBy;
  out.surfaces = f.surfaces;
  out.created = f.created;
  if (f.parts?.length) out.parts = f.parts.map((p) => ({ name: p.name, done: p.done }));
  if (f.notes.length) out.notes = f.notes.map((n) => ({ by: n.by, date: n.date, text: n.text }));
  return out;
});

// v3.1: one feature the sample does not have, to carry experience / core / variations (spec 6.3, 6.6).
// It is not in kettle.json, so it has no stored health to agree with, and the sample's weekly snapshots
// (which predate it) are replayed over the sample's own features only.
const OCR = 'invoice-ocr';
const OCR_HISTORY: { stage: Stage; date: string }[] = [{ stage: 'specified', date: '2026-09-15' }, { stage: 'in-dev', date: '2026-09-29' }];
const ocrFeature: Feature = {
  slug: OCR, id: 'PAY-17', name: 'Paper invoice to payment (OCR)',
  summary: 'Photograph a paper invoice in the app; its payment fields are read, checked and handed to bank debit.',
  kind: 'user_flow', tier: 'standard', status: 'active', capability: capSlug.get('PAY.2')!,
  contexts: [OCR_CTX, ctxName('PAY', 'api'), ctxName('PAY', 'mobile'), ctxName('PAY', 'web-member')], primary_context: OCR_CTX,
  stage: 'in-dev', stage_since: OCR_HISTORY[1].date, priority: 'P2',
  depends_on: [slugOf('PAY-10'), slugOf('PAY-13')], owner: 'mara', built_by: ['forge-2'],
  surfaces: ['mobile', 'web-member', 'api', 'workers'], created: OCR_HISTORY[0].date,
  parts: [
    { name: 'OCR engine spike', done: true }, { name: 'Core schema and field extraction', done: true },
    { name: 'Confidence review queue', done: false }, { name: 'Vltava Bank variation', done: false },
  ],
  notes: [{ by: 'mara', date: '2026-10-02', text: 'Three banks asked for it; we build one core and let each bank only add fields and parameters on top.' }],
  tags: ['ocr', 'invoices', 'bank-variations'],
  experience:
    'A member on an invoiced plan (corporate and family plans, and the studios that still post paper invoices) gets a printed ' +
    'invoice at the front desk or by mail. To pay it they open their own banking app and retype the payee, the IBAN, the amount ' +
    'and the payment reference by hand. One wrong digit in the reference and the payment lands unmatched: studio staff chase it ' +
    'by email and match it by hand in payout reconciliation, and Kettle only learns the invoice was paid when the bank statement ' +
    'arrives, often three to five days later.',
  core: {
    tech: [
      'OCR engine: on-device text recognition, server fallback for low-quality photos',
      'Field extraction that maps recognised text blocks to the core schema',
      'Per-field confidence scores; IBAN checksum and amount cross-check',
      'Confidence review queue: staff confirm fields below the threshold',
      'Hand-off to bank debit (SEPA) once every field is confirmed',
    ],
    schema: [
      'payee name', 'payee IBAN', 'BIC (optional)', 'amount and currency', 'due date', 'payment reference',
      'invoice number', 'issue date',
    ],
  },
  variations: [
    { slug: 'vltava-bank', name: 'Vltava Bank', audience: 'Vltava Bank (fictional, Czech retail bank)',
      extends: ['variable symbol and constant symbol fields', 'reads the QR Platba (SPD) code before falling back to OCR', 'CZK amounts with a decimal comma'],
      params: ['confidence threshold 0.92 per field', 'formats: PDF, JPEG, HEIC', 'an SPD payload wins over OCR text'], stage: 'in-dev' },
    { slug: 'nordhavn-sparebank', name: 'Nordhavn Sparebank', audience: 'Nordhavn Sparebank (fictional, Norwegian savings bank)',
      extends: ['KID payment reference with its mod-10 / mod-11 check digit', 'eFaktura hand-off instead of a manual transfer'],
      params: ['confidence threshold 0.95 (the KID check digit confirms the reference)', 'formats: PDF, JPEG', 'at most 2 pages'], stage: 'specified' },
    { slug: 'banco-alameda', name: 'Banco Alameda', audience: 'Banco Alameda (fictional, Portuguese bank)',
      extends: ['Multibanco entity and reference fields', 'payee NIF (tax number)'],
      params: ['confidence threshold 0.90', 'formats: JPEG, PNG, PDF', 'the reference must be 9 digits'], stage: 'idea' },
  ],
};
features.splice(features.findIndex((f) => f.id === 'PAY-16') + 1, 0, ocrFeature);
const featureBySlug = new Map(features.map((f) => [f.slug, f]));

// ----------------------------------------------------------------------------------------- facets
// The flattening (scalars, FLATTEN) is scripts/sample-facets.ts, shared with scripts/check-builtin-health.ts.

/** When a feature's lens values were taken: its latest activity in the feed, else its latest known change. */
const lastActivity = new Map<string, string>();
for (const a of kettle.activity) if (!lastActivity.has(a.feature) || a.at > lastActivity.get(a.feature)!) lastActivity.set(a.feature, a.at);
function measuredAt(f: SampleFeature): string {
  const act = lastActivity.get(f.id);
  if (act) return act;
  const commit = f.development.lastCommit as string | null;
  const d = commit && commit > f.stageSince ? commit : f.stageSince;
  return timeOn(d, `${f.id}:measured`);
}

// The cost lens: monthly run cost from operations.costUsdMonth (a facet only where it costs something),
// plus the SMS and model spend the sample implies: SMS reminders is the SMS bill (up 3.1x, duplicate
// waitlist promotions), dunning texts members about failed payments, the class-description writer calls
// a model. smsUsd across features sums to the sms-spend KPI, which the lens reads as projectSmsUsd.
const SMS_USD: Record<string, number> = { 'COM-02': 2610, 'PAY-09': 90 };
const LLM_USD: Record<string, number> = { 'AIA-02': 48 };
const SMS_TOTAL = Object.values(SMS_USD).reduce((a, b) => a + b, 0);

const facets: Record<string, Record<string, Facet>> = {};
for (const f of kettle.features) {
  const byLens: Record<string, Facet> = {};
  const at = measuredAt(f);
  for (const id of BUILTIN) byLens[id] = { ...FLATTEN[id](f[id]), measured_at: at, source: 'sample' };
  const cost = f.operations.costUsdMonth as number;
  if (cost > 0) {
    const values: FacetValues = { monthlyUsd: cost };
    if (SMS_USD[f.id] !== undefined) values.smsUsd = SMS_USD[f.id];
    if (LLM_USD[f.id] !== undefined) values.llmUsd = LLM_USD[f.id];
    byLens[COST_LENS] = { values, measured_at: at, source: 'sample' };
  }
  facets[slugOf(f.id)] = byLens;
}

// v3.1 metrics (spec 8.7): what a first /lens-scan over Payments, Booking and Member experience would have
// written, as the latest value per metric, merged into the same facets (history would live in the scan
// store, not here). Only features with code get them; a metric the scan could not take is omitted, never 0:
// probes need running code behind an API, the harness needs a built screen, a11y-unknown screens get no
// axe count. The values are seeded and chosen not to change any health the sample stores (check 2 below):
// metric rules come after the existing rules, and a value that would trip one is only written where the
// sample already sits at that health or worse.
const SCAN_AT = '2026-10-08T07:40:00Z';
const SCANNED_DOMAINS = ['PAY', 'BKG', 'MEM'];
const UI = ['web-member', 'web-admin', 'mobile'];
const rank: Record<string, number> = { good: 0, watch: 1, bad: 2 };
const atLeast = (h: Health, floor: 'watch' | 'bad') => (rank[h] ?? -1) >= rank[floor];
let metricFeatures = 0, metricValues = 0;
for (const f of kettle.features) {
  const dv = f.development, sv = f.security, gv = f.design;
  if (!SCANNED_DOMAINS.includes(f.domain) || dv.status === 'not-started') continue;
  const byLens = facets[slugOf(f.id)];
  const ui = f.surfaces.some((s) => UI.includes(s));
  const put = (lens: string, values: FacetValues) => {
    Object.assign(byLens[lens].values ??= {}, values);
    const at = byLens[lens].measured_at;
    if (!at || at < SCAN_AT) byLens[lens].measured_at = SCAN_AT;
    metricValues += Object.keys(values).length;
  };
  metricFeatures++;
  // development: static footprint, probes for built API code, judgement on duplication and standards
  let r = seeded(`${f.id}:metrics:development`);
  const loc = (dv.linesOfCode as number) > 0 ? (dv.linesOfCode as number) : Math.round(300 + r() * 2000);
  const debt = (dv.techDebt as number | null) ?? 0, cov = dv.unitCoveragePct as number | null;
  const d: FacetValues = { loc, files: Math.max(2, Math.round(loc / (80 + r() * 80))), depCount: 2 + Math.floor(r() * 16) };
  if (ui) d.bundleKb = round(loc * (0.008 + r() * 0.01), 1);
  if (f.surfaces.includes('api') && ['in-review', 'merged', 'done'].includes(dv.status as string)) {
    const p50 = Math.round(40 + r() * 220);
    d.p50Ms = p50; d.p95Ms = Math.round(p50 * (1.8 + r() * 1.4)); // at most ~830 ms: under the 1000 ms budget
  }
  d.dupSites = Math.floor(r() * 5) + (debt >= 2 ? 3 : 0);
  d.testRatioPct = cov !== null ? Math.round(cov * (0.5 + r() * 0.3)) : Math.round(15 + r() * 30);
  d.standardsPct = Math.round(92 - debt * 9 - r() * 12);
  put('development', d);
  // security: scan findings (judgement, separate from the review's openFindings), secrets, unsafe sinks
  if (sv.review !== 'not-started') {
    r = seeded(`${f.id}:metrics:security`);
    const s: FacetValues = {
      findingsCritical: 0,
      findingsHigh: atLeast(sv.health, 'watch') && r() < 0.5 ? 1 : 0,
      findingsMedium: Math.floor(r() * 3), findingsLow: Math.floor(r() * 5),
      secretHits: 0, unsafeSinks: Math.floor(r() * 2) + (f.surfaces.includes('web-admin') ? 1 : 0),
      standardsPct: Math.round(70 + r() * 25 - (sv.review === 'pending' ? 8 : 0)),
    };
    put('security', s);
  }
  // design: harness metrics on built screens, static and judgement ones on any designed screen
  if (gv.status !== 'n/a' && ['hi-fi', 'implemented', 'polished'].includes(gv.status as string)) {
    r = seeded(`${f.id}:metrics:design`);
    const g: FacetValues = {
      undesignedStates: Math.floor(r() * 4) + (gv.status === 'hi-fi' ? 1 : 0), rawLiterals: Math.floor(r() * 30),
      standardsPct: Math.round(65 + r() * 30),
    };
    if (ui && gv.status !== 'hi-fi') {
      if (gv.a11y === 'pass') g.axeViolations = 0;
      else if (gv.a11y === 'partial') g.axeViolations = 1 + Math.floor(r() * 4);
      else if (gv.a11y === 'fail') g.axeViolations = 5 + Math.floor(r() * 8);
      g.minTextPx = atLeast(gv.health, 'watch') && r() < 0.5 ? 11 : 12 + (r() < 0.5 ? 0 : 1);
      g.consoleErrors = Math.floor(r() * 3);
    }
    put('design', g);
  }
}
// invoice-ocr: a fresh feature with no sample lens objects, so its facets are written here in full. Here
// the metric rules decide: the OCR call is over the latency budget, and the receipt preview text is 11 px.
facets[OCR] = {
  business: { values: { value: 3, confidence: 'hypothesis', customerRequests30d: 6, revenueLink: 'retention' } },
  development: { values: {
    status: 'in-progress', progressPct: 35, aiAuthoredPct: 70, humanReviewed: false, openPRs: 2, unitCoveragePct: 58, techDebt: 1,
    linesOfCode: 2100, lastCommit: '2026-10-07', stalled: false,
    loc: 2100, files: 19, bundleKb: 38.5, depCount: 7, p50Ms: 520, p95Ms: 1450, dupSites: 2, testRatioPct: 41, standardsPct: 72,
  } },
  security: { values: {
    dataClass: 'payment', review: 'pending', openFindings: 0,
    findingsCritical: 0, findingsHigh: 1, findingsMedium: 2, findingsLow: 3, secretHits: 0, unsafeSinks: 1, standardsPct: 68,
  } },
  design: { values: {
    status: 'hi-fi', a11y: 'unknown', specDrift: false,
    axeViolations: 0, undesignedStates: 3, rawLiterals: 14, minTextPx: 11, consoleErrors: 1, standardsPct: 64,
  } },
  operations: { values: { environment: 'preview', incidents30d: 0, alerting: false, runbook: false } },
  quality: { values: { status: 'testing', e2eTests: 2, e2ePassing: 1, e2ePassPct: 50, openBugsP1: 0, openBugsP2: 1, openBugsP3: 2 } },
};
for (const facet of Object.values(facets[OCR])) Object.assign(facet, { measured_at: SCAN_AT, source: 'sample' });
metricFeatures++;
metricValues += 9 + 7 + 6;

// Overrides for planted stories. They must not change the built-in health the sample stores (the
// acceptance check below), so the one in force on a built-in lens confirms the rules, the expired one is
// ignored, and the one that changes a verdict sits on the custom lens.
const OVERRIDES: { feature: string; lens: string; health: 'good' | 'watch' | 'bad'; by: string; why: string; until: string }[] = [
  { feature: 'PAY-09', lens: 'security', health: 'bad', by: 'jonas',
    why: 'Retries card charges on payment data and is live for 25% of studios with the review unfinished. Held at bad until the review report is signed, even if the ticket closes first.',
    until: '2026-10-23' },
  { feature: 'BKG-03', lens: 'operations', health: 'watch', by: 'priya',
    why: 'INC-212 hotfix holds; the real fix for the promote race is in a PR. Watch, not page, until it ships.',
    until: '2026-10-05' }, // expired: the SEV2 of 2026-10-05 put it back on the rules (bad)
  { feature: 'COM-02', lens: COST_LENS, health: 'watch', by: 'priya',
    why: 'The bill is mostly duplicate waitlist-promotion SMS. The dedupe fix is in review; accepted at watch until it ships.',
    until: '2026-10-20' },
];
for (const o of OVERRIDES) {
  const facet = facets[slugOf(o.feature)][o.lens] ?? fail(`override on a missing facet ${o.feature}/${o.lens}`);
  facet.override = { health: o.health, by: o.by, why: o.why, until: o.until };
}

// ------------------------------------------------------------------------------------------- KPIs
const MEASURED = '2026-10-08T06:00:00Z';
const B = kettle.product.business;
const kpis: Kpi[] = [];
const base = (slug: string, lo: number, hi: number, d = 1) => round(lo + seeded(`${slug}:baseline`)() * (hi - lo), d);
const now = (value: number, env = 'production') => ({ value, measured_at: MEASURED, env });

// project level
kpis.push(
  { slug: 'mrr', name: 'Monthly recurring revenue', scope: { project: true }, category: 'value', lens: 'business', unit: 'USD',
    direction: 'up', baseline: Math.round(B.mrrUsd / (1 + B.mrrGrowthPct30d / 100)), target: 175000, target_date: '2026-12-31',
    warn_at: 140000, crit_at: 130000, current: now(B.mrrUsd), status: 'active', tier: 'primary', measure_kind: 'derived' },
  { slug: 'mrr-growth-30d', name: 'MRR growth (30 days)', scope: { project: true }, category: 'value', lens: 'business', unit: '%',
    direction: 'up', baseline: base('mrr-growth-30d', 4.5, 6.0), target: 8, target_date: '2026-12-31', warn_at: 4, crit_at: 2,
    current: now(B.mrrGrowthPct30d), status: 'active', tier: 'primary', measure_kind: 'derived' },
  { slug: 'churn-30d', name: 'Member churn (30 days)', scope: { project: true }, category: 'value', lens: 'business', unit: '%',
    direction: 'down', baseline: base('churn-30d', 2.3, 2.9), target: 1.5, target_date: '2026-12-31', warn_at: 2.5, crit_at: 3.5,
    current: now(B.churnPct30d), status: 'active', tier: 'primary', measure_kind: 'derived' },
  { slug: 'paying-studios', name: 'Paying studios', scope: { project: true }, category: 'traffic', lens: 'business', unit: 'studios',
    direction: 'up', baseline: B.studios - Math.round(base('paying-studios', 18, 32, 0)), target: 500, target_date: '2026-12-31',
    warn_at: 400, crit_at: 380, current: now(B.studios), status: 'active', tier: 'primary', measure_kind: 'derived' },
  { slug: 'active-members', name: 'Active members', scope: { project: true }, category: 'traffic', lens: 'business', unit: 'members',
    direction: 'up', baseline: B.members - Math.round(base('active-members', 2500, 4200, 0)), target: 75000, target_date: '2026-12-31',
    warn_at: 55000, crit_at: 50000, current: now(B.members), status: 'active', tier: 'secondary', measure_kind: 'derived' },
);
// the stories
const pay09 = byId.get('PAY-09')!, bkg03 = byId.get('BKG-03')!;
kpis.push(
  { slug: 'dunning-recovery-rate', name: 'Recovered failed payments', scope: { feature: slugOf(pay09.id) }, category: 'value',
    lens: 'business', unit: '%', direction: 'up', baseline: 31, target: 60, target_date: '2026-10-22', warn_at: 40, crit_at: 25,
    current: now(47.5), status: 'active', tier: 'primary', measure_kind: 'derived' },
  { slug: 'waitlist-promote-p95', name: 'Waitlist auto-promote p95 latency', scope: { feature: slugOf(bkg03.id) },
    category: 'technical', lens: 'operations', unit: 'ms', direction: 'down', baseline: 420, target: 500, target_date: '2026-10-22',
    warn_at: 800, crit_at: 1500, current: now(bkg03.operations.p95ms as number), status: 'active', tier: 'primary', measure_kind: 'probe' },
  { slug: 'sms-spend', name: 'SMS spend (month to date)', scope: { project: true }, category: 'technical', lens: COST_LENS,
    unit: 'USD', direction: 'down', baseline: Math.round(SMS_TOTAL / 3.1), target: 1200, target_date: '2026-10-31', warn_at: 1500,
    crit_at: 2500, current: now(SMS_TOTAL), status: 'active', tier: 'primary', measure_kind: 'billing' },
);
// on the code tree: a group and a context, so a feature also inherits KPIs through its contexts
const prodApiP95 = kettle.features.filter((f) => f.operations.environment === 'production' && f.surfaces.includes('api'))
  .map((f) => f.operations.p95ms as number).sort((a, b) => a - b);
kpis.push(
  { slug: 'api-p95-latency', name: 'API p95 latency', scope: { group: 'API' }, category: 'technical', lens: 'operations', unit: 'ms',
    direction: 'down', baseline: base('api-p95-latency', 380, 440, 0), target: 400, warn_at: 500, crit_at: 800,
    current: now(prodApiP95[Math.min(prodApiP95.length - 1, Math.floor(prodApiP95.length * 0.5))]), status: 'active', tier: 'secondary',
    measure_kind: 'probe' },
  { slug: 'job-queue-peak-wait', name: 'Job queue peak wait (06:45 burst)', scope: { context: ctxName('PLT', 'workers') },
    category: 'technical', lens: 'operations', unit: 's', direction: 'down', baseline: 41, target: 30, target_date: '2026-11-15',
    warn_at: 60, crit_at: 120, current: now(94), status: 'active', tier: 'secondary', measure_kind: 'probe' },
);
// per feature: availability of live, top-priority, member- or revenue-facing features (operations)
for (const f of kettle.features) {
  if (f.stage !== 'live' || f.priority !== 'P0' || !(f.kind === 'customer' || f.kind === 'business')) continue;
  const o = f.operations, t = o.sloTarget as number, s = slugOf(f.id);
  kpis.push({ slug: `${s}-availability`, name: `${f.name} availability`, scope: { feature: s }, category: 'technical',
    lens: 'operations', unit: '%', direction: 'up', baseline: round(Math.min(99.99, (o.sloActual as number) - base(s, 0.02, 0.15, 2)), 2),
    target: t, warn_at: t, crit_at: round(t - (100 - t), 2), current: now(o.sloActual as number), status: 'active', tier: 'secondary',
    measure_kind: 'probe' });
}
// adoption of top-value, revenue-linked live features with room to grow (business)
for (const f of kettle.features) {
  const b = f.business, a = b.adoptionPct as number | null;
  if (f.stage !== 'live' || a === null || a >= 80 || (b.value as number) < 5 || !['direct', 'retention'].includes(b.revenueLink as string)) continue;
  const s = slugOf(f.id), target = Math.min(95, Math.ceil((a * 1.3) / 5) * 5);
  kpis.push({ slug: `${s}-adoption`, name: `${f.name} adoption`, scope: { feature: s }, category: 'traffic', lens: 'business',
    unit: '%', direction: 'up', baseline: Math.round(a * (0.7 + 0.2 * seeded(`${s}:adoption`)())), target, target_date: '2026-12-31',
    warn_at: Math.round(target * 0.6), crit_at: Math.round(target * 0.35), current: now(a), status: 'active', tier: 'secondary',
    measure_kind: 'derived' });
}
// end-to-end pass rate of the Payments GA work that has tests (quality)
for (const f of kettle.features) {
  const q = f.quality, n = q.e2eTests as number;
  if (f.milestone !== 'M2' || n < 3) continue;
  const s = slugOf(f.id), pass = round(((q.e2ePassing as number) / n) * 100, 1);
  const env = f.operations.environment === 'production' ? 'production' : 'staging';
  kpis.push({ slug: `${s}-e2e-pass-rate`, name: `${f.name} end-to-end pass rate`, scope: { feature: s }, category: 'quality',
    lens: 'quality', unit: '%', direction: 'up', baseline: Math.min(pass, base(`${s}-e2e`, 60, 90, 0)), target: 100,
    target_date: '2026-10-22', warn_at: 95, crit_at: 80, current: now(pass, env), status: 'active', tier: 'secondary',
    measure_kind: 'derived' });
}

// ----------------------------------------------------------------------------------------- lenses
const builtinFiles = new Map(BUILTIN.map((id) => [id, fs.readFileSync(path.join(ROOT, `docs/standard/lenses/${id}.json`), 'utf8')]));
const costManifest = read(`docs/standard/lenses-custom/${COST_LENS}.json`) as LensManifest;
const lenses: LensEntry[] = [
  ...BUILTIN.map((id): LensEntry => {
    const manifest = JSON.parse(builtinFiles.get(id)!) as LensManifest;
    return { id, version: manifest.version, source: 'builtin', enabled: true, manifest };
  }),
  { id: COST_LENS, version: costManifest.version, source: 'project', enabled: true, manifest: costManifest },
];

// ------------------------------------------------------------------------------------------- map
const audience: Record<string, string> = Object.fromEntries(features.map((f) => [f.slug, byId.get(f.id!)?.kind ?? 'customer']));
const map: AppStructure = {
  $schema: 'app-structure/3',
  version: 3,
  generator: 'kettle-sample',
  generated_at: AS_OF,
  declared: true,
  provenance: { source: 'src/data/kettle.json', converter: 'scripts/kettle-to-v3.ts' },
  project: { slug: 'kettle', name: kettle.product.name, description: kettle.product.tagline, kind: 'code' },
  taxonomy: {
    context_categories: ['ui', 'api', 'lib', 'data', 'test', 'config'],
    group_domains: ['feature', 'infrastructure', 'shared', 'integration', 'data'],
    feature_kinds: ['user_flow', 'capability', 'integration', 'ops'],
    feature_tiers: ['major', 'standard'],
  },
  stats: {
    groups: groups.length, contexts: contexts.length, domains: domains.length, capabilities: capabilities.length,
    features: features.length, milestones: milestones.length, kpis: kpis.length, lenses: lenses.length,
  },
  groups, contexts, domains, capabilities, features, milestones, kpis, lenses, facets,
  extensions: {
    'com.kettle.sample': {
      note: 'Sample data: Kettle is a fictional product; every person, number and event here is synthetic.',
      tagline: kettle.product.tagline,
      team: kettle.product.team,
      people: kettle.people.map((p) => ({ id: p.id, name: p.name, kind: p.kind, field: p.field, title: p.title })),
      product: { business: kettle.product.business, stack: kettle.product.stack },
      activity: kettle.activity.map((a) => ({ ...a, feature: slugOf(a.feature) })),
      audience,
      metrics_note: 'Metric values (v3.1 metric fields) are the latest of a synthetic lens scan over Payments, Booking and Member experience on ' + SCAN_AT + '; a real product keeps their history in <root>/.ai/lens-scan/scan.db.',
      audience_note: 'The sample\'s own feature kind (who it serves: customer, internal, business, platform). features[].kind is the standard\'s shape: integration if in the integrations domain or integrations-first, platform -> ops, customer and internal -> user_flow, business -> capability.',
    },
  },
};

// ---------------------------------------------------------------------------------------- events
// A stage event needs a `from`, so the stage a feature is added at rides on its feature-added event as
// `to` (see the report: the spec has no other place for it). Times come from the activity feed when it
// records the same transition, else a seeded time on the history date.
const events: (StructureEvent & { seq: number })[] = [];
let seq = 0;
const push = (e: StructureEvent) => events.push({ ...e, seq: seq++ });
for (const f of kettle.features) {
  const slug = slugOf(f.id), h = f.history;
  push({ at: timeOn(f.created, `${f.id}:added`, 7, 9), type: 'feature-added', feature: slug, to: h[0].stage, actor: f.owner, source: 'sample' });
  for (let i = 1; i < h.length; i++) {
    const from = h[i - 1].stage, to = h[i].stage;
    const logged = kettle.activity.find((a) => a.type === 'stage' && a.feature === f.id && a.to === to && a.at.startsWith(h[i].date));
    const actor = logged?.actor ?? (to === 'specified' || to === 'deprecated' ? f.owner : f.builtBy[0] ?? f.owner);
    push({ at: logged?.at ?? timeOn(h[i].date, `${f.id}:${to}`, 9, 19), type: 'stage', feature: slug, from, to, actor, source: 'sample' });
  }
}
push({ at: timeOn(OCR_HISTORY[0].date, `${OCR}:added`, 7, 9), type: 'feature-added', feature: OCR, to: OCR_HISTORY[0].stage, actor: 'mara', source: 'sample' });
push({ at: timeOn(OCR_HISTORY[1].date, `${OCR}:in-dev`, 9, 19), type: 'stage', feature: OCR, from: OCR_HISTORY[0].stage, to: OCR_HISTORY[1].stage, actor: 'forge-2', source: 'sample' });
const m1 = kettle.milestones.find((m) => m.id === 'M1')!;
push({ at: `${m1.date}T16:30:00Z`, type: 'milestone', milestone: msSlug.get('M1')!, from: 'active', to: 'shipped', actor: 'mara', source: 'sample' });
push({ at: '2026-09-14T10:12:00Z', type: 'lens-enabled', lens: COST_LENS, actor: 'priya', source: 'sample' });
events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq));
const eventLines = events.map(({ seq: _s, ...e }) => JSON.stringify(e));

// ---------------------------------------------------------------------------------------- checks
// 1. Snapshot replay: a feature's stage on a date is the `to` of its last stage (or feature-added)
//    event at or before that date; features with no event yet do not exist.
function stagesOn(date: string): Map<string, Stage> {
  const s = new Map<string, Stage>();
  for (const e of events) {
    if (e.at.slice(0, 10) > date) break;
    if ((e.type === 'stage' || e.type === 'feature-added') && e.feature && e.to) s.set(e.feature, e.to as Stage);
  }
  return s;
}
let replayOk = 0;
const sampleSlugs = new Set(kettle.features.map((f) => slugOf(f.id)));
for (const snap of kettle.snapshots) {
  const s = new Map([...stagesOn(snap.week)].filter(([slug]) => sampleSlugs.has(slug))); // the snapshots count the sample's features
  const counts = Object.fromEntries(kettle.stages.map((x) => [x, 0])) as Record<Stage, number>;
  for (const v of s.values()) counts[v]++;
  const diff = kettle.stages.filter((x) => counts[x] !== snap.counts[x]);
  if (diff.length || s.size !== snap.total) {
    fail(`snapshot ${snap.week}: replay ${JSON.stringify(counts)} total ${s.size}, stored ${JSON.stringify(snap.counts)} total ${snap.total}`);
  }
  replayOk++;
}
const nowStages = stagesOn(TODAY);
for (const f of features) if (nowStages.get(f.slug) !== f.stage) fail(`replay puts ${f.slug} at ${nowStages.get(f.slug)}, the map says ${f.stage}`);

// 2. Built-in health: the evaluator over the converted facets equals the sample's stored health.
const BOUND: FeatureBoundField[] = ['stage', 'priority', 'kind', 'tier', 'milestone', 'status'];
const ctxFor = (f: Feature) => ({ feature: Object.fromEntries(BOUND.filter((k) => f[k] !== undefined).map((k) => [k, f[k]])) as Partial<Feature>, kpis });
const HEALTHS: Health[] = ['good', 'watch', 'bad', 'unmeasured', 'na'];
const tally = () => Object.fromEntries(HEALTHS.map((h) => [h, 0])) as Record<Health, number>;
const computed = new Map<string, Map<string, Health>>(); // lens -> feature slug -> health
for (const l of lenses) {
  if (l.source === 'builtin' && JSON.stringify(l.manifest) !== JSON.stringify(JSON.parse(builtinFiles.get(l.id as (typeof BUILTIN)[number])!))) {
    fail(`lens ${l.id}: the manifest copy differs from the catalog`);
  }
  const hs = new Map<string, Health>();
  for (const f of features) hs.set(f.slug, lensHealth(l.manifest, facets[f.slug][l.id], TODAY, ctxFor(f)));
  computed.set(l.id, hs);
}
const misses: string[] = [];
for (const id of BUILTIN) for (const f of kettle.features) {
  const got = computed.get(id)!.get(slugOf(f.id))!;
  if (got !== f[id].health) misses.push(`${id} ${f.id}: stored ${f[id].health}, computed ${got}`);
}
if (misses.length) fail(`built-in health differs from the sample:\n  ${misses.join('\n  ')}`);

const SCORE: Record<string, number> = { good: 0, watch: 1, bad: 2 };
const worstOf = (hs: Health[]): Health => {
  const m = hs.filter((h) => h in SCORE);
  return m.length ? m.reduce((a, h) => (SCORE[h] > SCORE[a] ? h : a)) : 'unmeasured';
};

// ----------------------------------------------------------------------------------------- write
fs.writeFileSync(path.join(ROOT, OUT_MAP), `${JSON.stringify(map, null, 2)}\n`);
fs.writeFileSync(path.join(ROOT, OUT_EVENTS), `${eventLines.join('\n')}\n`);

// ---------------------------------------------------------------------------------------- report
const fmt = (t: Record<Health, number>) => HEALTHS.map((h) => `${h} ${String(t[h]).padStart(3)}`).join('  ');
const count = <T>(xs: T[], k: (x: T) => string) => xs.reduce<Record<string, number>>((a, x) => ((a[k(x)] = (a[k(x)] ?? 0) + 1), a), {});
console.log(`wrote ${OUT_MAP} and ${OUT_EVENTS} (as of ${AS_OF})`);
console.log(`  groups ${groups.length}, contexts ${contexts.length}, domains ${domains.length}, capabilities ${capabilities.length}, features ${features.length}, milestones ${milestones.length}, kpis ${kpis.length}, lenses ${lenses.length}`);
console.log(`  facets ${Object.values(facets).reduce((a, x) => a + Object.keys(x).length, 0)} (cost ${Object.values(facets).filter((x) => x[COST_LENS]).length}), overrides ${OVERRIDES.length}, events ${eventLines.length} ${JSON.stringify(count(events, (e) => e.type))}`);
console.log(`  metrics: ${metricValues} values on ${metricFeatures} features (scan ${SCAN_AT}); ${OCR}: ${ocrFeature.variations!.length} variations`);
console.log(`  feature kinds ${JSON.stringify(count(features, (f) => f.kind!))}, tiers ${JSON.stringify(count(features, (f) => f.tier!))}`);
console.log(`  kpis by lens ${JSON.stringify(count(kpis, (k) => k.lens ?? '-'))}`);
console.log(`\nsnapshot replay: ${replayOk} / ${kettle.snapshots.length} weeks match the stored counts exactly; stages on ${TODAY} match all ${features.length} features`);
console.log(`\nhealth on ${TODAY} (lensHealth over the converted facets, feature as context) vs the sample's stored health:`);
for (const l of lenses) {
  const got = tally();
  for (const h of computed.get(l.id)!.values()) got[h]++;
  console.log(`  ${l.id.padEnd(16)} v3     ${fmt(got)}`);
  if (l.source === 'builtin') {
    const stored = tally();
    for (const f of kettle.features) stored[f[l.id as (typeof BUILTIN)[number]].health]++;
    console.log(`  ${''.padEnd(16)} sample ${fmt(stored)}   agree ${kettle.features.length - misses.length} / ${kettle.features.length} (v3 also counts ${OCR}, which the sample lacks)`);
  }
}
const overall6 = tally(), overall7 = tally(), storedOverall = tally();
for (const f of features) {
  overall6[worstOf(BUILTIN.map((id) => computed.get(id)!.get(f.slug)!))]++;
  overall7[worstOf(lenses.filter((l) => l.enabled).map((l) => computed.get(l.id)!.get(f.slug)!))]++;
}
for (const f of kettle.features) storedOverall[f.health]++;
console.log(`  ${'overall'.padEnd(16)} v3 six built-ins     ${fmt(overall6)}`);
console.log(`  ${''.padEnd(16)} v3 all enabled (7)  ${fmt(overall7)}`);
console.log(`  ${''.padEnd(16)} sample stored       ${fmt(storedOverall)}`);
const costOf = (slug: string) => computed.get(COST_LENS)!.get(slug);
console.log(`\noverrides: ${OVERRIDES.map((o) => `${slugOf(o.feature)}/${o.lens} ${o.health} until ${o.until} -> ${computed.get(o.lens)!.get(slugOf(o.feature))}`).join('; ')}`);
console.log(`cost lens: ${features.filter((f) => ['watch', 'bad'].includes(costOf(f.slug)!)).map((f) => `${f.slug} ${costOf(f.slug)}`).join(', ')}`);
