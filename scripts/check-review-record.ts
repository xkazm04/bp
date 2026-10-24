// The Review detail's "Before you decide" record (packages/core/src/scan/record.ts; docs/blueprint-ui.md, "Before you
// decide"): what earlier decisions on the same feature + lens, and on the same attempt chain, came to, and how this
// lens's released changes realised. Stages are read through trackOf (track.ts), so its honesty rules are inherited.
//   1. a declined P1 on f/perf with a note -> priorRecord(scan, P3).same is exactly that entry;
//   2. P2 (other feature) released, baseline 42, expected +10, a current 53 after the release -> lens confirmed 1, judged 1;
//   3. P4 released, no reading since -> lens unknown 1, judged stays 1; recordWords never calls it confirmed or good;
//   4. other proposed rows and P3 itself appear in neither .same nor the lens counts;
//   5. a decision 60 days old still counts (the record reads the whole history, not tracksOf's TRACK_DAYS window);
//   6. P3.attempt_of = P6 (rework, triage note) -> .same carries P6 with its stage and note;
//   7. a lens with no decided proposal -> same [] and lens.n 0, and the words say "No earlier decision under this lens";
//   8. source guard: review.tsx LiveDetail calls priorRecord and recordWords, and a row whose idea was declined
//      before carries a 'declined before' mark in its .rk.
// Run: node scripts/check-review-record.ts (Node's type stripping). Exit 1 on any failure.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const load = async (p: string): Promise<Any> => { try { return await import(pathToFileURL(path.join(ROOT, p)).href); } catch (e) { console.log('(cannot load ' + p + ': ' + String((e as Error).message).split('\n')[0] + ')'); return {}; } };
const R = await load('packages/core/src/scan/record.ts');
const { emptyScan } = await load('packages/core/src/scan/types.ts');
const { TRACK_DAYS } = await load('packages/core/src/scan/track.ts');

const cases = new Map<number, boolean>(), failures: string[] = [];
let passed = 0;
const caseOk = (n: number, ok: boolean, what: string) => {
  if (!cases.has(n)) cases.set(n, true);
  if (ok) passed++; else { cases.set(n, false); failures.push(n + '. ' + what); }
};
const prior = (scan: Any, p: Any): Any => { try { return typeof R.priorRecord === 'function' ? R.priorRecord(scan, p) : null; } catch (e) { console.log('(priorRecord threw: ' + (e as Error).message + ')'); return null; } };
const words = (rec: Any, lens = 'Performance'): Any => { try { return typeof R.recordWords === 'function' && rec ? R.recordWords(rec, lens) : null; } catch { return null; } };
const text = (w: Any): string => (w ? [...(w.same ?? []), w.lens ?? ''].join('\n') : '');
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const NOW = Date.parse('2026-10-20T12:00:00Z');
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86400000).toISOString();
let seq = 0;
const P = (x: Any): Any => ({ run_id: 'r0', lens: 'perf', metric: 'lcp', title: x.id + ' title', standard: 'none', kind: 'fix', created_at: iso(90), updated_at: x.decided_at ?? iso(90), ...x });
const M = (x: Any): Any => ({ id: ++seq, run_id: 'r0', lens: 'perf', metric: 'lcp', unit: 'ms', ...x });
const snap = (proposals: Any[], measurements: Any[] = []): Any => ({ ...(emptyScan ? emptyScan() : { proposals: [], measurements: [], packs: [], releases: [] }), proposals, measurements });

const P1 = P({ id: 'P1', feature: 'f', status: 'declined', decided_at: '2026-10-01T09:00:00Z', decision_note: 'touches checkout' });
const P2 = P({ id: 'P2', feature: 'g', status: 'released', decided_at: '2026-10-05T09:00:00Z', expected_delta: 10, updated_at: '2026-10-08T09:00:00Z' });
const P3 = P({ id: 'P3', feature: 'f', status: 'proposed', created_at: iso(1), updated_at: iso(1) });
const P4 = P({ id: 'P4', feature: 'h', status: 'released', decided_at: '2026-10-06T09:00:00Z', expected_delta: 10, updated_at: '2026-10-09T09:00:00Z' });
const P5 = P({ id: 'P5', feature: 'f', status: 'proposed', created_at: iso(2), updated_at: iso(2) });
const P5b = P({ id: 'P5b', feature: 'g', status: 'proposed', created_at: iso(2), updated_at: iso(2) });
const MS = [
  M({ feature: 'g', value: 42, measured_at: '2026-10-04T09:00:00Z', proposal_id: 'P2', phase: 'before' }),
  M({ feature: 'g', value: 53, measured_at: '2026-10-10T09:00:00Z' }),
  M({ feature: 'h', value: 40, measured_at: '2026-10-05T09:00:00Z', proposal_id: 'P4', phase: 'before' }),
];

// 1. same feature + lens: exactly the declined P1, with its date and note
{
  const r = prior(snap([P1, P3]), P3);
  caseOk(1, !!r && eq(r.same, [{ id: 'P1', stage: 'declined', at: '2026-10-01', note: 'touches checkout' }]), 'same == [P1 declined 2026-10-01 "touches checkout"] (' + JSON.stringify(r?.same) + ')');
  const w = words(r);
  caseOk(1, /Declined 2026-10-01/.test(text(w)) && /touches checkout/.test(text(w)), 'recordWords names the decline, its date and its note (' + text(w) + ')');
}

// 2-4. the lens's realised outcomes, read through trackOf
const full = snap([P1, P2, P3, P4, P5, P5b], MS);
const rf = prior(full, P3);
{
  caseOk(2, rf?.lens?.confirmed === 1 && rf?.lens?.judged === 1, 'P2 released and measured 53 >= 52 after release -> confirmed 1, judged 1 (' + JSON.stringify(rf?.lens) + ')');
  caseOk(3, rf?.lens?.unknown === 1 && rf?.lens?.judged === 1, 'P4 released, no reading since -> unknown 1, judged stays 1 (' + JSON.stringify(rf?.lens) + ')');
  const only4 = prior(snap([P3, P4], MS), P3), w4 = text(words(only4));
  caseOk(3, !!only4 && only4.lens?.unknown === 1 && w4.length > 0 && !/confirmed|good/i.test(w4), 'with only P4, the words never call it confirmed or good (' + w4 + ')');
  const wf = text(words(rf));
  caseOk(3, /\b1 confirmed\b/.test(wf) && !/\b2 confirmed\b/.test(wf) && /\b1 unknown\b/.test(wf), 'the words count 1 confirmed and 1 unknown, never 2 confirmed (' + wf + ')');
  const ids = (rf?.same ?? []).map((x: Any) => x.id);
  caseOk(4, !!rf && !ids.includes('P3') && !ids.includes('P5') && !ids.includes('P5b'), 'no proposed row and not P3 itself in .same (' + ids.join(', ') + ')');
  caseOk(4, rf?.lens?.n === 3, 'the lens counts the 3 decided rows (P1, P2, P4) only, no proposed one (' + rf?.lens?.n + ')');
}

// 5. a decision older than TRACK_DAYS still counts
{
  const old = P({ id: 'P7', feature: 'f', status: 'declined', decided_at: iso(60), decision_note: 'too risky' });
  const r = prior(snap([old, P3]), P3);
  caseOk(5, TRACK_DAYS === 14 && !!r && r.same?.length === 1 && r.same[0].id === 'P7' && r.lens?.n === 1, 'a decline 60 days old is in .same and the lens count (' + JSON.stringify(r) + ')');
}

// 6. the attempt chain: P3.attempt_of = P6 (rework, triage note), even on another feature's row
{
  const P6 = P({ id: 'P6', feature: 'k', lens: 'dev', status: 'rework', decided_at: '2026-09-20T09:00:00Z', triaged_at: '2026-09-25T09:00:00Z', triage_note: 'tests fail' });
  const p3 = { ...P3, attempt_of: 'P6' };
  const r = prior(snap([P6, p3]), p3), e = (r?.same ?? []).find((x: Any) => x.id === 'P6');
  caseOk(6, !!e && e.stage === 'rework' && e.note === 'tests fail', 'same carries P6 rework "tests fail" (' + JSON.stringify(r?.same) + ')');
}

// 7. nothing decided under the lens
{
  const r = prior(snap([P3, P5]), P3), w = words(r);
  caseOk(7, !!r && eq(r.same, []) && r.lens?.n === 0, 'same [] and lens.n 0 (' + JSON.stringify(r) + ')');
  caseOk(7, w?.lens === 'No earlier decision under this lens', 'the words say so (' + w?.lens + ')');
}

// 8. source guard
{
  const f = path.join(ROOT, 'apps/web/src/components/rail/wide/review.tsx');
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const i = src.indexOf('function LiveDetail('), j = src.indexOf('\nfunction ', i + 1);
  const body = i >= 0 ? src.slice(i, j > i ? j : undefined) : '';
  caseOk(8, /priorRecord\(/.test(body) && /recordWords\(/.test(body), 'LiveDetail calls priorRecord and recordWords');
  caseOk(8, /Before you decide/.test(body), 'LiveDetail renders a "Before you decide" section');
  const rk = /<span className="rk">[\s\S]*?<\/span>\s*\n/.exec(src)?.[0] ?? '';
  caseOk(8, /declined before/.test(rk), 'a row whose idea was declined before carries a "declined before" mark in its .rk');
}

const red = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !cases.get(n));
console.log('acceptance cases: ' + (8 - red.length) + ' of 8 hold' + (red.length ? ' (red: ' + red.join(', ') + ')' : ''));
if (failures.length) { for (const f of failures) console.log('FAIL ' + f); console.log(failures.length + ' failed, ' + passed + ' held'); process.exit(1); }
console.log('review record: ' + passed + ' assertions held');
