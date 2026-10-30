#!/usr/bin/env node
// SYNTHETIC decision history for the rules backtest (hackathon pack "Rules you set once"), so replaying a standing rule
// over "your past decisions" has a record worth replaying on the throwaway demo product. Every row it writes is labelled:
// its run is `syn-history` (rules.server.ts SYNTHETIC_RUN = 'syn-'), the run's note says SYNTHETIC, each decision note
// starts "[synthetic]", and the Rules panel counts and marks them. Nothing here is a real decision.
//
//   node scripts/seed-rules-history.mjs [--dir .demo/kettle-live] [--n 96] [--now <iso>]
//
// The owner it simulates is consistent, so a rule can earn (or lose) trust against it:
//   - backlog (tier 3) findings outside payments: approved 9 times in 10; the declines are design polish they did not want
//   - payments (plans + billing): declined unless it is a security or stop-ship finding: a hold there mostly agrees
//   - stop-ship (tier 0) findings: always approved, after a look; a grant without a tier floor would have taken them alone
//   - urgent and normal (tier 1-2): approved about 3 times in 4
// Also 4 OPEN (proposed) findings in payments, booking and scheduling, so a rule acts on something the moment it is set.
// Idempotent: it deletes its own rows (run_id LIKE 'syn-%') and writes them again; the same --now writes the same rows.
// Needs the store scripts/scan-demo.mjs seeds (run it first).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { seeded } from './lib/prng.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const DIR = opt('--dir') ? path.resolve(opt('--dir')) : path.join(ROOT, '.demo', 'kettle-live');
const N = Number(opt('--n') ?? 96), NOW = Date.parse(opt('--now') ?? new Date().toISOString());
if (!(N > 0 && N <= 1000) || !Number.isFinite(NOW)) { console.error('usage: seed-rules-history.mjs [--dir d] [--n 1..1000] [--now iso]'); process.exit(2); }
const DB = path.join(DIR, '.ai', 'lens-scan', 'scan.db');
if (!fs.existsSync(DB)) { console.error(`no store at ${DB}: run node scripts/scan-demo.mjs first`); process.exit(1); }
const map = JSON.parse(fs.readFileSync(path.join(DIR, '.ai', 'lens-scan', 'app-structure.json'), 'utf8'));

const RUN = 'syn-history', BY = 'user:owner';
const rnd = seeded('rules-history');
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const LENSES = ['security', 'design', 'performance', 'development', 'quality', 'operations'].filter((l) => map.lenses.some((x) => x.id === l && x.enabled !== false));
const PAYMENTS = new Set(['payments.plans-products', 'payments.billing']);
const RISK = { security: ['authz', 'secret', 'data'], design: ['ux'], performance: ['perf'], development: ['debt', 'reliability'], quality: ['reliability', 'debt'], operations: ['reliability'] };
const TITLES = {
  security: ['Escape member input in the {f} template', 'Check the caller owns the record in {f}', 'Move the {f} API key out of the client bundle', 'Rate-limit the {f} endpoint', 'Stop logging card fingerprints in {f}'],
  design: ['Give {f} a visible focus ring', 'Tighten the empty state of {f}', 'Raise the contrast of the {f} labels to AA', 'Align the {f} buttons to the 8 px grid', 'Rewrite the {f} error copy in plain words'],
  performance: ['Cache the {f} lookup for 60 s', 'Drop the N+1 query behind {f}', 'Lazy-load the {f} images', 'Batch the {f} writes in one transaction', 'Trim the {f} bundle by splitting the chart code'],
  development: ['Extract the {f} rules into one module', 'Type the {f} payloads end to end', 'Delete the dead {f} feature flag', 'Replace the hand-rolled {f} retry with the job queue', 'Cover {f} with a contract test'],
  quality: ['Add the missing {f} edge-case tests', 'Fix the flaky {f} e2e step', 'Assert the {f} totals in a property test', 'Seed {f} fixtures from the schema'],
  operations: ['Alert when {f} errors pass 1%', 'Add a runbook entry for {f}', 'Trace {f} across the job queue', 'Make the {f} deploy roll back on a failed probe'],
};
const tierOf = () => { const x = rnd(); return x < 0.07 ? 0 : x < 0.22 ? 1 : x < 0.5 ? 2 : 3; };

/** The simulated owner's verdict (see the header). */
function verdict(f, lens, tier) {
  if (tier === 0) return 'approve';
  if (PAYMENTS.has(f.capability)) return lens === 'security' ? 'approve' : rnd() < 0.85 ? 'decline' : 'approve';
  if (tier === 3) return lens === 'design' && rnd() < 0.3 ? 'decline' : rnd() < 0.96 ? 'approve' : 'decline';
  return rnd() < 0.75 ? 'approve' : 'decline';
}
/** The open findings (id, feature, lens, title, tier, risk_class). */
const OPEN = [
  ['syn-open-1', 'card-payments', 'security', 'Stop logging card fingerprints in Card payments', 2, 'secret'],
  ['syn-open-2', 'book-a-class', 'design', 'Give Book a class a visible focus ring', 3, 'ux'],
  ['syn-open-3', 'waitlist-with-auto-promote', 'quality', 'Fix the double-promote race in the waitlist', 0, 'reliability'],
  ['syn-open-4', 'recurring-class-schedule', 'performance', 'Drop the N+1 query behind Recurring class schedule', 2, 'perf'],
];
const DECLINE_WHY = ['not now: the redesign replaces it', 'too risky for the payments path this month', 'the gain is not worth the churn', 'duplicate of an item already built'];

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');
const ver = db.prepare('PRAGMA user_version').get().user_version;
if (ver < 4) { console.error(`store is v${ver}; the history needs v4 (tier, risk_class)`); process.exit(1); }
const iso = (ms) => new Date(ms).toISOString();
const rows = [];
const feats = map.features.filter((f) => typeof f.slug === 'string');
// payments carries a quarter of the record, so a rule over it has evidence to stand on
const payFeats = feats.filter((f) => PAYMENTS.has(f.capability)), restFeats = feats.filter((f) => !PAYMENTS.has(f.capability));
for (let i = 0; i < N; i++) {
  const f = rnd() < 0.25 ? pick(payFeats) : pick(restFeats), lens = pick(LENSES), tier = tierOf();
  const v = verdict(f, lens, tier), at = NOW - Math.floor((i + 1) * (42 * 86400000) / (N + 1)) - Math.floor(rnd() * 3600000);
  rows.push({
    id: `syn-${(i + 1).toString().padStart(3, '0')}`, feature: f.slug, lens, title: pick(TITLES[lens] ?? TITLES.development).replace('{f}', f.name),
    tier, risk_class: pick(RISK[lens] ?? ['debt']), status: v === 'approve' ? 'accepted' : 'declined', // decided and closed: none of it is open backlog or waits for triage
    decided_at: iso(at), created_at: iso(at - 86400000), note: v === 'approve' ? '[synthetic] approved' : '[synthetic] ' + pick(DECLINE_WHY),
  });
}

db.exec('BEGIN IMMEDIATE');
try {
  db.prepare("DELETE FROM proposals WHERE run_id LIKE 'syn-%'").run();
  db.prepare("DELETE FROM runs WHERE id LIKE 'syn-%'").run();
  db.prepare(`INSERT INTO runs (id, started_at, updated_at, ended_at, phase, status, lenses, scope, note) VALUES (?, ?, ?, ?, 'propose', 'done', ?, NULL, ?)`)
    .run(RUN, iso(NOW - 43 * 86400000), iso(NOW), iso(NOW - 43 * 86400000), JSON.stringify(LENSES), 'SYNTHETIC decision history for the rules backtest (scripts/seed-rules-history.mjs): no row of this run is a real decision');
  const ins = db.prepare(`INSERT INTO proposals (id, run_id, feature, lens, title, standard, kind, status, decided_by, decided_at, decision_note, created_at, updated_at, origin, tier, risk_class)
    VALUES (?, ?, ?, ?, ?, 'none', 'fix', ?, ?, ?, ?, ?, ?, 'scan', ?, ?)`);
  for (const r of rows) ins.run(r.id, RUN, r.feature, r.lens, r.title, r.status, BY, r.decided_at, r.note, r.created_at, r.decided_at, r.tier, r.risk_class);
  // OPEN findings (proposed, undecided), so the rules have something to act on now: one in each kind of place a demo rule
  // governs (payments, booking, scheduling), a backlog one and a stop-ship among them. Same run, so labelled the same way.
  const open = db.prepare(`INSERT INTO proposals (id, run_id, feature, lens, title, standard, kind, status, created_at, updated_at, origin, tier, risk_class)
    VALUES (?, ?, ?, ?, ?, 'none', 'fix', 'proposed', ?, ?, 'scan', ?, ?)`);
  const at = iso(NOW - 3600000);
  for (const [id, feature, lens, title, tier, risk] of OPEN) if (map.features.some((f) => f.slug === feature)) open.run(id, RUN, feature, lens, title, at, at, tier, risk);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.close(); }
const dec = rows.filter((r) => r.status === 'declined').length;
console.log(`seeded ${rows.length} SYNTHETIC decisions (${rows.length - dec} approved, ${dec} declined; ${rows.filter((r) => r.tier === 0).length} stop-ship) and ${OPEN.length} open findings into ${DB} under run ${RUN}`);
