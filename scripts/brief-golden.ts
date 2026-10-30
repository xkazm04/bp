#!/usr/bin/env node
// The decision brief's golden file: fixed inputs (a map slice and a store of decided rows) and the exact brief
// packages/core/src/scan/brief.ts computes for six subjects - an approve-shaped card, a repeat of a decline, an agent's
// draft, a feature not on the plan, a lens with no decisions yet, and a like idea declined on another feature (ask). It is the sync contract outside bp: Personas' card (or any
// port of brief.ts) runs the same inputs and must produce these bytes (docs/concepts/decision-brief/personas-adoption.md).
// bp's side is held by check:decision-brief, which fails when the committed file is not what brief.ts computes now.
// Its home is packages/schema/golden/decision-brief.json, beside the contract's other artifacts (packages/schema/
// contract.json, moved 2026-10-30, roadmap S2). The old path docs/concepts/decision-brief/golden.json stays a
// byte-identical copy (MIRRORS), because ports copied it from there and pin its sha256; check:contract and
// check:decision-brief hold the two equal.
//   node scripts/brief-golden.ts           print whether the committed files are current (exit 1 when not)
//   node scripts/brief-golden.ts --write   rewrite packages/schema/golden/decision-brief.json and its mirror
import fs from 'node:fs';
import path from 'node:path';
import { briefFor, briefMapOf, type BriefSubject } from '../packages/core/src/scan/brief.ts';
import { emptyScan, type Proposal, type Run, type Pack } from '../packages/core/src/scan/types.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
export const GOLDEN = path.join(ROOT, 'packages/schema/golden/decision-brief.json');
/** The old home, kept byte for byte (Personas' brief.golden.test.ts pins it). */
export const MIRRORS = [path.join(ROOT, 'docs/concepts/decision-brief/golden.json')];

const map = {
  domains: [{ slug: 'booking', id: 'BKG', name: 'Booking & Attendance' }, { slug: 'payments', id: 'PAY', name: 'Payments' }],
  capabilities: [{ slug: 'booking.core', name: 'Booking', domain: 'booking' }, { slug: 'booking.waits', name: 'Waitlists', domain: 'booking' }, { slug: 'payments.billing', name: 'Billing', domain: 'payments' }],
  features: [
    { slug: 'book-a-class', id: 'BKG-01', name: 'Book a class', capability: 'booking.core', stage: 'live' },
    { slug: 'cancel', id: 'BKG-02', name: 'Cancel', capability: 'booking.core', depends_on: ['book-a-class'] },
    { slug: 'waitlist', id: 'BKG-04', name: 'Waitlist', capability: 'booking.waits', depends_on: ['book-a-class'] },
    { slug: 'card-payments', id: 'PAY-07', name: 'Card payments', capability: 'payments.billing', stage: 'live' },
    { slug: 'receipts', id: 'PAY-08', name: 'Receipts', capability: 'payments.billing', depends_on: ['card-payments'] },
  ],
  lenses: [{ id: 'security', name: 'Security' }, { id: 'development', name: 'Development' }, { id: 'performance', name: 'Performance' }],
};
const P = (x: Partial<Proposal> & { id: string }): Proposal => ({ run_id: 'r1', feature: 'cancel', lens: 'security', title: x.id, standard: 'none', kind: 'fix', status: 'approved',
  created_at: '2026-10-01T09:00:00.000Z', updated_at: '2026-10-05T09:00:00.000Z', decided_at: '2026-10-05T09:00:00.000Z', decided_by: 'user:owner', ...x });
const runs: Run[] = [{ id: 'e1', started_at: '2026-10-06T09:00:00.000Z', updated_at: '2026-10-06T09:24:00.000Z', ended_at: '2026-10-06T09:24:00.000Z', phase: 'execute', status: 'done', lenses: ['security'], model: 'sonnet' }];
const packs: Pack[] = [{ id: 'k-sec-1', lens: 'security', n: 1, branch: 'pack/sec-1', base_ref: 'main', base_sha: '0', run_id: 'e1', status: 'triaged', created_at: '2026-10-06T09:00:00.000Z', updated_at: '2026-10-07T09:00:00.000Z' }];
const proposals: Proposal[] = [
  P({ id: 'h1', feature: 'waitlist', title: 'Add rate limits to the waitlist API', standard: 'api/rate-limits', tier: 1, status: 'accepted', pack_id: 'k-sec-1' }),
  P({ id: 'h2', title: 'Ask staff to sign in again before refunds', tier: 1, status: 'released', pack_id: 'k-sec-1' }),
  P({ id: 'h3', title: 'Rotate the signing key monthly', tier: 1, status: 'declined', decided_at: '2026-10-08T09:00:00.000Z', decision_note: 'Not while the auth rewrite is open.' }),
  P({ id: 'h4', feature: 'card-payments', lens: 'development', title: 'Add retries to checkout payment calls', standard: 'reliability/retry-backoff', tier: 2, status: 'declined',
    decided_at: '2026-10-10T09:00:00.000Z', decision_note: 'No retries until idempotency keys land.' }),
  P({ id: 'o1', feature: 'book-a-class', title: 'Add rate limits to the booking API', standard: 'api/rate-limits', tier: 1, risk_class: 'reliability', status: 'proposed' }),
  P({ id: 'o2', feature: 'card-payments', lens: 'development', title: 'Add retry to checkout payment calls', standard: 'reliability/retry-backoff', tier: 2, risk_class: 'money', status: 'proposed' }),
];
const subjects: [string, BriefSubject][] = [
  ['an approve-shaped card', { id: 'o1', feature: 'book-a-class', title: 'Add rate limits to the booking API', lens: 'security', standard: 'api/rate-limits', tier: 1, risk_class: 'reliability' }],
  ['a repeat of a decline', { id: 'o2', feature: 'card-payments', title: 'Add retry to checkout payment calls', lens: 'development', standard: 'reliability/retry-backoff', tier: 2, risk_class: 'money' }],
  ["an agent's draft", { feature: 'card-payments', title: 'add retry to checkout' }],
  ['not on the plan', { feature: 'ghost', title: 'Tidy the ghost page', lens: 'security' }],
  ['no precedent under its lens', { feature: 'receipts', title: 'Show the receipt total in bold', lens: 'performance' }],
  ['a like idea declined elsewhere (asks, never flips)', { feature: 'receipts', title: 'Retry the receipt email on failure', lens: 'development', standard: 'reliability/retry-backoff', tier: 2 }],
];

/** The golden document, as brief.ts computes it now. */
export function golden(): string {
  const scan = { ...emptyScan(), runs, packs, proposals }, m = briefMapOf(map);
  const cases = subjects.map(([name, subject]) => ({ name, subject, brief: briefFor(subject, scan, m) }));
  return JSON.stringify({ note: 'Generated by scripts/brief-golden.ts --write. Inputs and the exact briefs packages/core/src/scan/brief.ts computes; a port must reproduce them byte for byte.', inputs: { map, scan: { runs, packs, proposals } }, cases }, null, 2) + '\n';
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const now = golden();
  if (process.argv.includes('--write')) for (const f of [GOLDEN, ...MIRRORS]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, now); console.log('wrote ' + path.relative(ROOT, f)); }
  else {
    const same = [GOLDEN, ...MIRRORS].every((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') === now);
    console.log(same ? 'the brief golden and its mirror are current' : 'the brief golden is stale: node scripts/brief-golden.ts --write');
    process.exit(same ? 0 : 1);
  }
}
