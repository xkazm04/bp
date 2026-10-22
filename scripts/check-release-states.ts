// Pins the release tab's state table (apps/web/src/components/ledger/train/release/releaseState.ts): the one place
// that says what a person can do with a release. Nothing else read it, so a later change that narrowed RELEASE_STATE or
// standOf, or dropped a hint, passed every gate and the tab silently lost an affordance (or regained the stall the
// `standOf` stand was written to remove).
// The module is pure but lives under apps/web, so this check sits in scripts/ (a .ts under train/ may not import
// node:fs or scripts/lib, scripts/check-train-quality.mjs) and loads it through scripts/lib/src-hooks.mjs.
// Matrix: 6 release statuses x 6 job states (no job, queued, running, done, failed, cancelled).
// Run: node scripts/check-release-states.ts   (Node type stripping; exit 1 on any failure)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerSrcHooks } from './lib/src-hooks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerSrcHooks(ROOT);
const M = await import(pathToFileURL(path.join(ROOT, 'apps/web/src/components/ledger/train/release/releaseState.ts')).href);
const { RELEASE_STATE, STEPS, STEP_WORD, ACTION, JOB_TONE, standOf, standLine, safeUrl, failedStep } = M;

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); }
};

const STATUSES = ['draft', 'building', 'pr-open', 'merged', 'tagged', 'failed'];
const JOB_STATES = ['queued', 'running', 'done', 'failed', 'cancelled'];
const STANDS = ['ok', 'running', 'stalled', 'failed'];
const job = (status: string, step = 'build'): any => ({ status, step, kind: 'release' });
const jobs: [string, any][] = [['none', undefined], ...JOB_STATES.map((s): [string, any] => [s, job(s)])];

// --- the table covers every status, and says all of: step, words, actions, locked
check('RELEASE_STATE has exactly the six statuses', JSON.stringify(Object.keys(RELEASE_STATE).sort()) === JSON.stringify([...STATUSES].sort()), Object.keys(RELEASE_STATE).join(','));
for (const s of STATUSES) {
  const st = RELEASE_STATE[s];
  check(`${s}: has a step, an actions array, a locked flag and a hint`, !!st && Number.isInteger(st.step) && Array.isArray(st.actions) && typeof st.locked === 'boolean' && typeof st.hint === 'function');
  if (!st) continue;
  const words = st.hint('1.2.3', 2);
  check(`${s}: hint is a non-empty sentence`, typeof words === 'string' && words.trim().length > 10, JSON.stringify(words));
}
check('steps: failed is -1, every other status indexes STEPS', RELEASE_STATE.failed.step === -1 && STATUSES.filter((s) => s !== 'failed').every((s) => STEPS[RELEASE_STATE[s].step] === s));
check('every step has its word', STEPS.every((s: string) => typeof STEP_WORD[s] === 'string' && STEP_WORD[s].length > 0));
check('only a draft is unlocked', STATUSES.every((s) => RELEASE_STATE[s].locked === (s !== 'draft')));
check('each status offers its actions: draft build / pr-open pr+sampleMerge+finishAsk / merged finish / failed retry',
  RELEASE_STATE.draft.actions.join() === 'build' && RELEASE_STATE['pr-open'].actions.join() === 'pr,sampleMerge,finishAsk' && RELEASE_STATE.merged.actions.join() === 'finish' && RELEASE_STATE.failed.actions.join() === 'retry');
check('building and tagged offer nothing, by design', RELEASE_STATE.building.actions.length === 0 && RELEASE_STATE.tagged.actions.length === 0);
check('every offered action (bar the PR link) has a button label', STATUSES.every((s) => RELEASE_STATE[s].actions.every((a: string) => a === 'pr' || typeof ACTION[a]?.label('1.2.3') === 'string' && ACTION[a].label('1.2.3').length > 0)));
check('draft hint counts its items (singular and plural)', RELEASE_STATE.draft.hint('1', 1).includes('1 item:') && RELEASE_STATE.draft.hint('1', 3).includes('3 items:'));
check('merged and tagged hints carry the version', RELEASE_STATE.merged.hint('9.8.7', 1).includes('v9.8.7') && RELEASE_STATE.tagged.hint('9.8.7', 1).includes('v9.8.7'));

// --- the 6 x 6 matrix
const seen = new Set<string>();
let cells = 0;
for (const s of STATUSES) for (const [jn, j] of jobs) {
  cells++;
  const cell = `${s} x ${jn}`;
  const stand = standOf({ status: s }, j);
  seen.add(stand);
  check(`${cell}: standOf is one of the four stands`, STANDS.includes(stand), String(stand));
  const line = standLine(stand, { status: s, version: '1.2.3' }, j, 2);
  check(`${cell}: standLine says something`, typeof line === 'string' && line.length > 10, JSON.stringify(line));
  // a cell must not be both actionless and claiming work: "running" (or a building row with nothing running is a stall,
  // which says so) with no way out and no live job would leave the tab stuck
  const claimsWork = stand === 'running' || /working|is working/i.test(line);
  const actionless = RELEASE_STATE[s].actions.length === 0;
  const live = jn === 'queued' || jn === 'running';
  check(`${cell}: not both actionless and claiming work without a live job`, !(actionless && claimsWork && !live), line);
  // stand by definition
  const want = live ? 'running' : s === 'failed' ? 'failed' : s === 'building' ? 'stalled' : 'ok';
  check(`${cell}: stand is ${want}`, stand === want, stand);
  if (stand === 'stalled') check(`${cell}: a stall names that nothing is running and how to start again`, /nothing is running/.test(line) && /draft or failed/.test(line) && !/Claude Code is working/.test(line), line);
  else check(`${cell}: a non-stall reads the table's own hint`, line === RELEASE_STATE[s].hint('1.2.3', 2), line);
}
check('the matrix is 36 cells', cells === 36, String(cells));
check('all four stands are reachable', STANDS.every((s) => seen.has(s)), [...seen].join(','));
check('standOf: no release is ok', standOf(undefined, undefined) === 'ok' && standOf(undefined, job('running')) === 'ok');
check('standLine: no release is empty', standLine('ok', undefined, undefined, 0) === '');

// the stall's words differ by what stopped the job
const stallWords = [undefined, job('cancelled'), job('failed'), job('done')].map((j) => standLine('stalled', { status: 'building', version: '1' }, j, 1));
check('a stall says four different things for no job / cancelled / failed / done', new Set(stallWords).size === 4, JSON.stringify(stallWords));
check('stall words: names the cause', /No build job/.test(stallWords[0]) && /cancelled/.test(stallWords[1]) && /failed/.test(stallWords[2]) && /without moving/.test(stallWords[3]));

// failedStep: a failed Finish fails at the tagged step, anything else at building
check('failedStep: finish -> tagged step, else building', failedStep(job('failed', 'finish')) === STEPS.indexOf('tagged') && failedStep(job('failed', 'build')) === STEPS.indexOf('building') && failedStep(undefined) === STEPS.indexOf('building'));

// --- JOB_TONE is total over JobStatus, with a tone the stylesheet knows
const TONES = ['idle', 'ok', 'err', 'warn'];
check('JOB_TONE covers every job status, no extras', JSON.stringify(Object.keys(JOB_TONE).sort()) === JSON.stringify([...JOB_STATES].sort()), Object.keys(JOB_TONE).join(','));
check('JOB_TONE values are tones the log css has', JOB_STATES.every((s) => TONES.includes(JOB_TONE[s])));
check('JOB_TONE: failed is red, cancelled amber, done mint', JOB_TONE.failed === 'err' && JOB_TONE.cancelled === 'warn' && JOB_TONE.done === 'ok');

// --- safeUrl: http(s) only
for (const u of ['https://github.com/a/b/pull/1', 'http://x.test/', 'HTTPS://X.TEST/']) check(`safeUrl keeps ${u}`, safeUrl(u) === u);
for (const u of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x/', '//evil.test/', ' https://x/', 'file:///etc/passwd', '', undefined]) check(`safeUrl refuses ${JSON.stringify(u)}`, safeUrl(u) === null);

console.log(`\ncheck-release-states: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
