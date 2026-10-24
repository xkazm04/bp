// Checks the one rule "a triage body names at most MAX_TRIAGE ids" at every site that holds it:
//   - one value, scan/types.ts, that the server (release.server.ts) and the sample sim (train-sim.ts) take from there
//     instead of each keeping its own 200;
//   - the sample sim refuses MAX_TRIAGE + 1 ids with a 400 and accepts MAX_TRIAGE (the route's behaviour on Kettle);
//   - the ledger's decision path (train/plan.ts, read by Decide.tsx) asks triageCapText before it plans a send, so a pack larger than the
//     cap gets a sentence in the operator's words, not the route's developer sentence in a toast.
// Run: node scripts/check-triage-cap.ts  (Node's type stripping). Exit 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScanSim } from '../packages/core/src/model/scan-sim.ts';
import * as types from '../packages/core/src/scan/types.ts';
import { blankComments } from './lib/source.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };
const src = (rel: string): string => blankComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const t = types as unknown as { MAX_TRIAGE?: unknown; triageCapText?: (n: number) => string | null };

const cap = t.MAX_TRIAGE;
check('scan/types.ts exports MAX_TRIAGE as a positive integer', typeof cap === 'number' && Number.isInteger(cap) && cap > 0, String(cap));
const N = typeof cap === 'number' ? cap : 200;

check('triageCapText: null at the cap', typeof t.triageCapText === 'function' && t.triageCapText(N) === null);
const over = typeof t.triageCapText === 'function' ? t.triageCapText(N + 1) : null;
check('triageCapText: a sentence past the cap, naming the cap and the count', typeof over === 'string' && over.includes(String(N)) && over.includes(String(N + 1)), String(over));
check('triageCapText: the sentence is not the route\'s body-shape sentence', typeof over === 'string' && !over.includes('ids: string[]'), String(over));

// the sample sim is the route's twin on Kettle: past the cap is a 400, at the cap is not
const ids = (n: number) => Array.from({ length: n }, (_, i) => 'x' + i);
const sim = new ScanSim({ now: () => Date.UTC(2026, 9, 21), findings: [] });
const status = (n: number): number | undefined => { try { sim.triage({ ids: ids(n), decision: 'accept' }); return undefined; } catch (e) { return (e as { status?: number }).status; } };
check('sample sim: MAX_TRIAGE + 1 ids -> 400', status(N + 1) === 400, String(status(N + 1)));
check('sample sim: MAX_TRIAGE ids is not a 400 (unknown ids are skipped, not refused)', status(N) !== 400, String(status(N)));

// one value: the server and the sim import it, neither keeps a number of its own
const server = src('packages/core/src/server/release.server.ts'), sim2 = src('packages/core/src/model/train-sim.ts');
check('release.server.ts takes MAX_TRIAGE from scan/types (no literal of its own)', !/MAX_TRIAGE\s*=\s*\d/.test(server) && /MAX_TRIAGE[^;]*scan\/types/.test(server));
check('train-sim.ts takes its cap from scan/types (no literal 200)', !/MAX_IDS\s*=\s*\d/.test(sim2) && /MAX_TRIAGE[^;]*scan\/types/.test(sim2));

// the client: the decision path asks before it sends
// (the cap is the decision planner's, train/plan.ts: it asks before it plans a send, and Decide.tsx sends only a plan)
const plan0 = src('apps/web/src/components/ledger/train/plan.ts'), plan = plan0.slice(Math.max(0, plan0.indexOf('function planDecision')));
const ask = plan.search(/triageCapText\s*\(/), planned = plan.search(/kind:\s*'send'/);
check('plan.ts asks triageCapText before it plans a send', ask >= 0 && planned >= 0 && ask < planned, `ask@${ask} send@${planned}`);
const decide = src('apps/web/src/components/ledger/train/Decide.tsx');
const plans = decide.search(/\bplanDecision\s*\(/), send = decide.search(/\.triage\s*\(/);
check('Decide.tsx plans the decision before it sends one', plans >= 0 && send >= 0 && plans < send, `plan@${plans} send@${send}`);

console.log(`triage-cap: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
