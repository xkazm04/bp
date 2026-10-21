// Pins the scan launcher's half of the seam between the plan's right-click menu (src/components/ScanMenu.tsx)
// and the scan API: what the UI SAYS when a scan does not start, and what it DRAWS when one ends.
//
//   1. refusalText (src/lib/scan/actions.ts), run for every rejection shape the routes, the Kettle sim and
//      `fetch` itself can throw at it. ScanMenu's run() puts the reply straight into a toast
//      (`name + ': ' + refusalText(reason)`), so a shape with no sentence of its own used to put the fetch
//      implementation's words on screen: "Failed to fetch" on Chrome, "Load failed" on Safari, a NetworkError
//      sentence on Firefox, a bare "HTTP 500", the internal route URL of a status-0 answer, or the literal
//      "undefined". The forbidden list is engine/copy.ts's DEV_WORDS, the same registry the canvas's
//      saveFailWords is held to - one rule, now with both implementations pinned.
// Run: node scripts/check-scan-client.ts   (Node's type stripping; actions.ts imports its siblings with
//      extensions so Node loads it as-is, as client.ts and scan-views.ts already did)
// Control: BP_SCAN_CLIENT_SEED=refusal restores the old one-line `REFUSAL[msg] ?? msg`, so assertion 1 is
//      seen red on the exact strings the reader used to be shown.
import path from 'node:path';
import { readStripped } from './lib/source.ts';
import { DEV_WORDS } from '../apps/web/src/engine/copy.ts';
import type { ScanScope } from '../packages/core/src/scan/jobs.ts';
import { refusalText as fixed } from '../apps/web/src/lib/scan/actions.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
const SEED = process.env.BP_SCAN_CLIENT_SEED ?? '';
const REFUSAL_SEED: Record<string, string> = {
  'unknown-lens': 'that lens is not enabled in the map',
  'no-scan-method': 'that lens has no scan method (no built-in and no manifest scan block)',
  'bad-scope': 'the scope names a place or feature the map does not have',
  'queue-full': '16 scans are already queued',
};
const old = (e: unknown): string => {
  const msg = (e as Error | undefined)?.message || String(e);
  return REFUSAL_SEED[msg] ?? msg;
};
const refusalText = SEED === 'refusal' ? old : fixed;

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string, got?: string) => { if (ok) held++; else failures.push(what + (got === undefined ? '' : ` (got ${JSON.stringify(got)})`)); };

// --------------------------------------------- 1. every rejection shape that reaches a toast gets a sentence
const err = (message: string, extra: Record<string, unknown> = {}): unknown => Object.assign(new Error(message), extra);
const SHAPES: { name: string; e: unknown }[] = [
  { name: 'the fetch never left the browser (Chrome)', e: new TypeError('Failed to fetch') },
  { name: 'the fetch never left the browser (Safari)', e: new TypeError('Load failed') },
  { name: 'the fetch never left the browser (Firefox)', e: new TypeError('NetworkError when attempting to fetch resource.') },
  { name: 'the request timed out', e: err('The operation was aborted due to timeout', { name: 'TimeoutError' }) },
  { name: 'the page aborted the request', e: err('signal is aborted without reason', { name: 'AbortError' }) },
  { name: 'the route refused with a known code', e: err('bad-scope', { status: 400 }) },
  { name: 'the queue is full', e: err('queue-full', { status: 429 }) },
  { name: 'the route refused and said why in words', e: err('that lens has no manifest scan block on disk', { status: 400 }) },
  { name: 'the route refused and sent no body', e: err('HTTP 500', { status: 500 }) },
  { name: 'the answer was a shape the client could not read', e: err('/api/products/kettle/scans answered an unexpected shape: id', { status: 0 }) },
  { name: 'nothing to scan with (no product, no sim)', e: err('Nothing to scan with: no live product and no sample sim', { status: 503 }) },
  { name: 'something threw that is not an Error', e: 'boom' },
  { name: 'a rejection with no reason at all', e: undefined },
];
for (const s of SHAPES) {
  const text = refusalText(s.e);
  const dev = DEV_WORDS.filter((d) => text.includes(d));
  expect(dev.length === 0, `"${s.name}": the toast shows a developer string (${dev.join(', ')})`, text);
  expect(text.length > 12, `"${s.name}": the toast has no sentence to show`, text);
  expect(!/^HTTP \d+$/.test(text), `"${s.name}": the toast is a bare HTTP status`, text);
  expect(!text.includes('/api/'), `"${s.name}": the toast leaks an internal route URL`, text);
}
// the shapes that carry no usable words of their own must name a cause and a remedy
const lost = refusalText(new TypeError('Failed to fetch'));
expect(/never reached/.test(lost) && /server/.test(lost), 'a request that never left the browser does not name the connection as the cause', lost);
const late = refusalText(err('The operation was aborted due to timeout', { name: 'TimeoutError' }));
expect(/in time/.test(late) && /may still/.test(late), 'a timeout does not say the scan may have been queued anyway', late);
const unreadable = refusalText(err('x', { status: 0 }));
expect(/could not read/.test(unreadable), 'an unreadable answer does not say so', unreadable);
expect(refusalText(err('HTTP 500', { status: 500 })).includes('500'), 'a refusal with no words of its own does not name its status');
// the words someone wrote for a reader must survive untouched
for (const [code, words] of Object.entries(REFUSAL_SEED)) expect(refusalText(err(code, { status: 400 })) === words, `the explanation of "${code}" was lost`, refusalText(err(code, { status: 400 })));
expect(refusalText(err('that lens has no manifest scan block on disk', { status: 400 })) === 'that lens has no manifest scan block on disk', 'the route\'s own refusal text was discarded');
expect(refusalText(err('Nothing to scan with: no live product and no sample sim', { status: 503 })).startsWith('Nothing to scan with'), 'actions.ts\' own 503 sentence was discarded');

// --------------------------------------------- 2. a job that ended still reports it on the plan
// scanViews draws a finished job's outline for LINGER_MS after it ended - all ticks for `done`, the bad colour
// for `failed`. The end came from `Date.parse(j.ended_at ?? '')`, which is NaN when the job carries no end, so
// `end > now` was false and the view was dropped: a run whose process died before jobs.server.ts could write
// ended_at drew NOTHING, exactly the state most in need of saying so. The anchor falls back to the start, which
// is stable across recomputes (`now` would restart the window on every pass and the outline would never go).
const { scanViews, LINGER_MS } = await import('../apps/web/src/lib/scan/scan-views.ts');
const BLD = { id: 'b0', i: 0 };
const TILE = (id: string) => ({ id, wing: { bld: BLD } });
const GEO = {
  P: { base: { features: [{ id: 'f1' }, { id: 'f2' }] }, scale: 1, buildings: [{ sf: '' }] },
  L: { TILE: { f1: TILE('f1'), f2: TILE('f2') }, blds: [BLD], bays: [], rooms: [], wings: [] },
} as never;
const NOW = Date.parse('2026-10-21T12:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();
const mkJob = (p: Record<string, unknown>) => ({ id: 'j', kind: 'measure', lens: 'l', scope: { kind: 'all', label: 'Everything', features: [] }, queued_at: at(-60000), started_at: at(-1000), ...p } as never);
const draw = (j: unknown) => scanViews([j] as never, undefined, GEO, () => '#fff', NOW);
const DRAWN: { name: string; job: Record<string, unknown>; views: number; expires?: number }[] = [
  { name: 'done a second ago', job: { status: 'done', ended_at: at(-1000) }, views: 1, expires: NOW - 1000 + LINGER_MS.done! },
  { name: 'failed with no ended_at, started a second ago', job: { status: 'failed', exit_code: 1, error: 'exit 1' }, views: 1, expires: NOW - 1000 + LINGER_MS.failed! },
  { name: 'done with no ended_at, started a second ago', job: { status: 'done' }, views: 1, expires: NOW - 1000 + LINGER_MS.done! },
  { name: 'done with an unparseable ended_at', job: { status: 'done', ended_at: 'just now' }, views: 1, expires: NOW - 1000 + LINGER_MS.done! },
  { name: 'failed with no ended_at, started an hour ago', job: { status: 'failed', started_at: at(-3600000) }, views: 0 },
  { name: 'cancelled', job: { status: 'cancelled', ended_at: at(-1000) }, views: 0 },
  { name: 'running', job: { status: 'running' }, views: 1 },
  { name: 'queued', job: { status: 'queued' }, views: 1 },
];
for (const c of DRAWN) {
  const r = draw(mkJob(c.job));
  expect(r.views.length === c.views, `a job ${c.name}: the plan draws ${r.views.length} outlines, not ${c.views}`);
  if (c.expires !== undefined) expect(r.next === c.expires, `a job ${c.name}: its outline does not expire one linger after the time it is anchored to`, String(r.next));
  if (c.views && r.views[0]) expect(r.views[0].status === c.job.status, `a job ${c.name}: its view does not carry the job's own status`, String(r.views[0].status));
}

// --------------------------------------------- 3. the menu's permissions warning names a path or no path
// ScanMenu's last footer is the only place the plan tells a reader that choosing a scan runs Claude Code with
// --dangerously-skip-permissions in a directory on their disk. Its root came from the project list with
// `?? ctx.slug`, so while that list was still loading - or after it failed, which it now also does on a
// timeout - the warning named the SLUG as the directory. Two pins, in opposite directions: the root may not
// fall back to the slug, and the warning may not be conditioned on the root, or it would vanish exactly when
// the list has not answered and the reader knows least.
const menu = readStripped(path.join(SRC, 'components/ScanMenu.tsx')).replace(/\r\n/g, '\n');
expect(/const root = ctx\.slug \?/.test(menu), 'ScanMenu no longer resolves a root for the permissions warning (update this check)');
expect(!/\?\.root \?\? ctx\.slug/.test(menu), 'ScanMenu falls back to the slug for the repository path again: a slug is not a directory');
expect(/\{ctx\.slug && <div className="sm-f warn">/.test(menu), 'the permissions warning is conditioned on something other than there being a live product, so it can disappear while the project list loads');
expect(/with permissions skipped/.test(menu), 'the permissions warning lost its words');
expect(/checkout/.test(menu), 'the permissions warning has nothing to say when the root is not known yet');

// --------------------------------------------- 4. no request waits for an answer forever
// A server that accepted the connection and never answers (it died mid-write, or it is wedged on a locked
// store) used to leave every one of these promises pending for the life of the page. Each helper is driven
// against a fetch that honours its signal and otherwise never settles; AbortSignal.timeout is stubbed short so
// the bound can be observed in milliseconds, and the ms each helper ASKED for is checked against the constant.
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
let asked: number[] = [];
let honour = SEED !== 'timeout'; // =timeout gives the stub a fetch that ignores the signal, as an unbounded one did
(AbortSignal as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => { asked.push(ms); return realTimeout(30); };
globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) => new Promise((_res, rej) => {
  const s = init?.signal;
  if (honour && s) s.addEventListener('abort', () => rej(s.reason ?? new Error('aborted')));
})) as typeof fetch;

const client = await import('../apps/web/src/lib/scan/client.ts');
const projects = await import('../apps/web/src/lib/scan/projects.ts');
expect(client.REQUEST_TIMEOUT_MS >= 5000 && client.REQUEST_TIMEOUT_MS <= 60000, 'the request bound is not a sane number of ms', String(client.REQUEST_TIMEOUT_MS));
expect(client.LENS_DRAFT_TIMEOUT_MS > 180000, 'the lens-draft bound is shorter than the route\'s own 3-minute limit', String(client.LENS_DRAFT_TIMEOUT_MS));

const scope: ScanScope = { kind: 'all', label: 'Everything', features: [] };
const HELPERS: { name: string; run: () => Promise<unknown>; ms: number; swallows?: true }[] = [
  { name: 'postScan', run: () => client.postScan('p', 'l', scope), ms: client.REQUEST_TIMEOUT_MS },
  { name: 'postDispatch', run: () => client.postDispatch('p', ['i']), ms: client.REQUEST_TIMEOUT_MS },
  { name: 'deleteJob', run: () => client.deleteJob('p', 'j'), ms: client.REQUEST_TIMEOUT_MS },
  { name: 'executeLens', run: () => client.executeLens('p', 'l'), ms: client.REQUEST_TIMEOUT_MS },
  { name: 'decideProposal', run: () => client.decideProposal('p', 'i', { decision: 'approve' } as never), ms: client.REQUEST_TIMEOUT_MS },
  { name: 'getWaves', run: () => client.getWaves('p'), ms: client.REQUEST_TIMEOUT_MS },
  { name: 'postTriage', run: () => client.postTriage('p', { ids: ['a'], decision: 'accept' }), ms: client.REQUEST_TIMEOUT_MS },
  { name: 'getReleaseSuggestion', run: () => client.getReleaseSuggestion('p'), ms: client.REQUEST_TIMEOUT_MS },
  { name: 'postReleaseBuild', run: () => client.postReleaseBuild('p', 'r'), ms: client.REQUEST_TIMEOUT_MS },
  { name: 'postLensDraft', run: () => client.postLensDraft('p', 'hello'), ms: client.LENS_DRAFT_TIMEOUT_MS },
  { name: 'refreshProjects', run: () => projects.refreshProjects(true), ms: client.REQUEST_TIMEOUT_MS, swallows: true },
  { name: 'addProject', run: () => projects.addProject({ slug: 's', name: 'n', root: 'r' }), ms: client.REQUEST_TIMEOUT_MS },
];
const PENDING = Symbol('pending');
const settle = async (p: Promise<unknown>): Promise<unknown> => {
  const idle = new Promise((r) => setTimeout(() => r(PENDING), 400));
  return Promise.race([p.then((v) => v, (e: unknown) => e), idle]);
};
for (const h of HELPERS) {
  asked = [];
  const out = await settle(h.run());
  expect(out !== PENDING, `${h.name} never gives up: a server that accepted the connection and never answers leaves its promise pending`);
  expect(asked.includes(h.ms), `${h.name} did not bound its request at ${h.ms} ms`, asked.join(','));
  if (out === PENDING) continue;
  if (h.swallows) { expect(out === null, `${h.name} answers something other than "no list" when it gave up`, String(out)); continue; }
  const name = (out as { name?: string }).name;
  expect(name === 'TimeoutError' || name === 'AbortError', `${h.name} rejected with something other than the abort`, String(name));
  // the whole point of the bound: the words the reader gets are a sentence, not the abort's own message
  const text = refusalText(out);
  expect(DEV_WORDS.every((d) => !text.includes(d)) && /in time/.test(text), `${h.name}'s timeout does not reach the reader as a sentence`, text);
}

if (failures.length) { console.log(failures.map((f) => 'FAIL ' + f).join('\n')); console.log(`check-scan-client: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-scan-client: ${held} expectations held (${SHAPES.length} rejection shapes, ${DEV_WORDS.length} developer strings forbidden, ${HELPERS.length} request helpers bounded)`);
