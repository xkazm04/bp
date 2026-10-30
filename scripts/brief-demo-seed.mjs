#!/usr/bin/env node
// DEMO DATA (labelled): a decision history for the decision brief (packages/core/src/scan/brief.ts), added to the throwaway
// live product scripts/scan-demo.mjs seeds. scan-demo's store carries one decline note and no tier or risk_class, which is
// the honest thin case; this adds what a product with some history looks like, so the brief has something to say:
//   - six tier-1 security findings decided two weeks ago, five approved (accepted, released, built) and one declined
//     with a note, and one finished security execute run with its pack (two items in 24 minutes);
//   - two declines of retry ideas under one standard, the latest with the owner's words ("No retries until idempotency
//     keys land"), so an agent's draft "add retry to checkout" hears them back;
//   - three OPEN proposals: "Add rate limits to the booking API" (the A9 card), and two that repeat a declined idea -
//     "Retry the payment webhook on timeout" and "Rotate the session keys every week" (Review: Decline 2 repeats).
// Every row id starts `brief-`; a rerun replaces them (idempotent). It writes the store directly, as scan-demo does: this
// is a seed, not a product path (lens-scan's store.mjs owns transitions on a real store).
//   node scripts/brief-demo-seed.mjs [--dir .demo/kettle-live] [--now <iso>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const DIR = opt('--dir') ? path.resolve(opt('--dir')) : path.join(ROOT, '.demo', 'kettle-live');
const DB = path.join(DIR, '.ai', 'lens-scan', 'scan.db');
if (!fs.existsSync(DB)) { console.error(`no store at ${DB}: run node scripts/scan-demo.mjs first`); process.exit(2); }
const NOW = opt('--now') ? Date.parse(opt('--now')) : Date.now();
if (!Number.isFinite(NOW)) { console.error('--now is not an ISO instant'); process.exit(2); }
const ago = (days, hours = 0) => new Date(NOW - days * 86400000 - hours * 3600000).toISOString();

const HIST = 'brief-run-hist', OPEN = 'brief-run-open', EXEC = 'brief-run-exec';
const runs = [
  { id: HIST, phase: 'propose', status: 'done', lenses: ['security', 'development'], started_at: ago(16), ended_at: ago(16, -1), model: 'demo' },
  { id: EXEC, phase: 'execute', status: 'done', lenses: ['security'], started_at: ago(13), ended_at: new Date(Date.parse(ago(13)) + 24 * 60000).toISOString(), model: 'sonnet' },
  { id: OPEN, phase: 'propose', status: 'done', lenses: ['security', 'development'], started_at: ago(0, 3), ended_at: ago(0, 2), model: 'demo' },
];
const owner = 'user:owner';
/** [id, run, feature, lens, title, standard, status, tier, risk_class, decided days ago, note, pack] */
const rows = [
  ['brief-h1', HIST, 'email-password-sign-in', 'security', 'Rate-limit the sign-in endpoint', 'api/rate-limits', 'released', 1, 'authz', 15, null, null],
  ['brief-h2', HIST, 'waitlist-with-auto-promote', 'security', 'Add rate limits to the waitlist API', 'api/rate-limits', 'accepted', 1, 'reliability', 15, null, 'k-sec-1'],
  ['brief-h3', HIST, 'staff-roles-permissions', 'security', 'Ask staff to sign in again before changing roles', 'authz/step-up', 'accepted', 1, 'authz', 14, null, null],
  ['brief-h4', HIST, 'background-job-queue', 'security', 'Scrub card numbers from job logs', 'secrets/log-redaction', 'done', 1, 'secret', 14, null, 'k-sec-1'],
  ['brief-h5', HIST, 'book-a-class', 'security', 'Validate class ids on the booking endpoint', 'input/validation', 'approved', 1, 'data', 12, null, null],
  ['brief-h6', HIST, 'email-password-sign-in', 'security', 'Rotate the session signing key monthly', 'secrets/key-rotation', 'declined', 1, 'secret', 12, 'Not while the auth rewrite is open.', null],
  ['brief-h8', HIST, 'background-job-queue', 'development', 'Retry failed card captures in the job queue', 'reliability/retry-backoff', 'declined', 2, 'money', 9, 'Same as checkout: idempotency first.', null],
  ['brief-h7', HIST, 'card-payments', 'development', 'Add retries to checkout payment calls', 'reliability/retry-backoff', 'declined', 2, 'money', 5, 'No retries until idempotency keys land: a retried charge is a double charge.', null],
];
const open = [
  ['brief-o1', OPEN, 'book-a-class', 'security', 'Add rate limits to the booking API', 'api/rate-limits', 1, 'reliability', 'S', 4,
    '## Summary\nThe booking API accepts unlimited requests per member, so one script can hold every class.\n\n## Expected impact\nBursts above 20 requests a minute per member are refused with 429.'],
  ['brief-o2', OPEN, 'card-payments', 'development', 'Retry the payment webhook on timeout', 'reliability/retry-backoff', 2, 'money', 'S', 6,
    '## Summary\nA webhook that times out is dropped; retrying it three times with backoff would recover most of them.'],
  ['brief-o3', OPEN, 'email-password-sign-in', 'security', 'Rotate the session keys every week', 'secrets/key-rotation', 2, 'secret', 'S', 5,
    '## Summary\nSession signing keys never rotate; a weekly rotation limits how long a leaked key works.'],
];

const db = new DatabaseSync(DB, { timeout: 5000 });
try {
  db.exec('BEGIN');
  db.exec("DELETE FROM proposals WHERE id LIKE 'brief-%'; DELETE FROM packs WHERE id = 'k-sec-1'; DELETE FROM runs WHERE id LIKE 'brief-%'");
  const r = db.prepare('INSERT INTO runs (id, started_at, updated_at, ended_at, phase, status, lenses, model, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const x of runs) r.run(x.id, x.started_at, x.ended_at, x.ended_at, x.phase, x.status, JSON.stringify(x.lenses), x.model, 'brief demo seed');
  db.prepare("INSERT INTO packs (id, lens, n, branch, base_ref, base_sha, run_id, status, created_at, updated_at) VALUES ('k-sec-1', 'security', 1, 'pack/sec-1', 'main', '0000000', ?, 'triaged', ?, ?)")
    .run(EXEC, ago(13), ago(12));
  const p = db.prepare(`INSERT INTO proposals (id, run_id, feature, lens, title, standard, kind, status, tier, risk_class, decided_by, decided_at, decision_note,
    pack_id, size, risk, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'fix', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [id, run, f, lens, title, std, status, tier, rc, days, note, pack] of rows) {
    p.run(id, run, f, lens, title, std, status, tier, rc, owner, ago(days), note, pack, 'S', 4, null, ago(16), ago(days));
  }
  for (const [id, run, f, lens, title, std, tier, rc, size, risk, body] of open) {
    const at = id === 'brief-o3' ? ago(0, 1) : ago(0, 2); // newest last, so J walks o1, o2, then o3
    p.run(id, run, f, lens, title, std, 'proposed', tier, rc, null, null, null, null, size, risk, body, at, at);
  }
  db.exec('COMMIT');
} catch (e) { try { db.exec('ROLLBACK'); } catch { /* none open */ } throw e; } finally { db.close(); }
console.log(`seeded ${rows.length} decided rows, ${open.length} open proposals, 1 execute run into ${DB}`);
