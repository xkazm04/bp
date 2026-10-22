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
import fs from 'node:fs';
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

// --------------------------------------------- 1b. the project list's alert says the same things
// `refreshProjects` built its own sentence from `(e as Error).message`, so ProjectsDialog's role="alert" and
// the switcher's title read "Could not read the project list: Failed to fetch" - a third implementation of
// the rule refusalText and saveFailWords already carry, and the one on the surface a reader reaches when
// nothing else works. Both now come from refusal.ts' causeWords.
const { causeWords } = await import('../apps/web/src/lib/scan/refusal.ts');
for (const s of SHAPES) {
  const text = 'Could not read the project list: ' + causeWords(s.e);
  const dev = DEV_WORDS.filter((d) => text.includes(d));
  expect(dev.length === 0, `the project list's alert for "${s.name}" shows a developer string (${dev.join(', ')})`, text);
  expect(!text.includes('/api/'), `the project list's alert for "${s.name}" leaks an internal route URL`, text);
}
expect(/did not answer in time/.test(causeWords(err('x', { name: 'TimeoutError' }))), 'a timed-out list read does not say so');
expect(!/may still run the scan/.test(causeWords(err('x', { name: 'TimeoutError' }))), 'the cause carries a scan-only remedy into every other surface');
expect(causeWords(err('that root is not a directory', { status: 400 })) === 'that root is not a directory', 'the route\'s own refusal text was discarded');
// every rejection this context throws carries a status, or causeWords cannot tell a refusal from a lost connection
const projectsSrc = readStripped(path.join(SRC, 'lib/scan/projects.ts')).replace(/\r\n/g, '\n');
expect(/throw Object\.assign\(new Error\(j\?\.error \|\| 'HTTP ' \+ r\.status\), \{ status: r\.status \}\)/.test(projectsSrc), 'a project write rejects with no status, so its cause reads as a lost connection');
expect(/'Could not read the project list: ' \+ causeWords\(e\)/.test(projectsSrc), 'the project list builds its alert from something other than causeWords');
expect(!/\(e as Error\)\.message/.test(projectsSrc), 'projects.ts puts an Error.message in front of a reader again');

// --------------------------------------------- 1c. a stored lens that is dropped leaves a trace
// parseTempLenses is the only place a lens somebody added can leave this browser. Every invalid entry, every
// repeated id and a whole stored value that is not a JSON list were dropped with `continue` and no record, so
// the lens was simply absent from the panel afterwards - indistinguishable from never having added it. The
// reason was already computed by tempEntryProblem and discarded.
const { parseTempLenses, TEMP_LENS_KEY } = await import('../apps/web/src/lib/scan/temp-lens.ts');
const warned: string[] = [];
const realWarn = console.warn;
console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(' ')); };
const manifest: Record<string, unknown> = { ...(JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/schema/schema/fixtures/valid-steps-lens.json'), 'utf8')) as Record<string, unknown>), id: 'tmp.one' };
const good = { id: 'tmp.one', version: manifest.version as string, source: 'project', enabled: true, created_at: '2026-10-21T10:00:00Z', temporary: true, manifest };
const DROPS: { name: string; raw: string; kept: number; says: RegExp }[] = [
  { name: 'not JSON at all', raw: '{not json', kept: 0, says: /not JSON/ },
  { name: 'JSON but not a list', raw: '{"id":"tmp.one"}', kept: 0, says: /not a list/ },
  { name: 'an entry with no version', raw: JSON.stringify([{ ...good, version: '' }]), kept: 0, says: /tmp\.one.*no version/ },
  { name: 'an entry that is not an object', raw: JSON.stringify(['tmp.one']), kept: 0, says: /entry 1.*not an object/ },
  { name: 'two entries with one id', raw: JSON.stringify([good, { ...good, created_at: '2026-10-21T11:00:00Z' }]), kept: 1, says: /second entry with this id/ },
];
for (const d of DROPS) {
  warned.length = 0;
  const kept = parseTempLenses(d.raw);
  expect(kept.length === d.kept, `a stored value that is ${d.name}: ${kept.length} entries were kept, not ${d.kept}`);
  expect(warned.length === 1, `a stored value that is ${d.name} left ${warned.length} records of the drop, not 1`);
  expect(d.says.test(warned.join(' ')), `a stored value that is ${d.name}: the record does not say which entry or why`, warned.join(' '));
  expect(warned.join(' ').includes(TEMP_LENS_KEY), `a stored value that is ${d.name}: the record does not name the storage key it came from`, warned.join(' '));
}
warned.length = 0;
const kept1 = parseTempLenses(JSON.stringify([good]));
expect(kept1.length === 1 && warned.length === 0, 'a stored value with nothing wrong with it was dropped or warned about', kept1.length + ' kept, warned: ' + warned.join(' '));
warned.length = 0;
expect(parseTempLenses(null).length === 0 && warned.length === 0, 'empty storage warns', warned.join(' '));
console.warn = realWarn;

// --------------------------------------------- 1d. every stream listener parses inside a guard
// useLiveProduct has five SSE listeners and each parses the event's data. `jobs`, `map` and the server's named
// `error` wrapped the parse and skipped an unreadable event; `snapshot` and `delta` did not, so one malformed
// event threw out of the listener - the EventSource stays open, the status stays 'live', and the page's
// readings freeze with nothing anywhere to say they have. One rule, five sites, three of them obeying it.
const clientSrc = readStripped(path.join(SRC, 'lib/scan/client.ts')).replace(/\r\n/g, '\n');
const listeners = [...clientSrc.matchAll(/src\.addEventListener\('(\w+)'[\s\S]*?\n {6}\}\);/g)];
expect(listeners.length === 5, `useLiveProduct has ${listeners.length} stream listeners, not the 5 this check knows (update it)`);
for (const m of listeners) {
  const name = m[1], bodyText = m[0];
  const parses = (bodyText.match(/JSON\.parse/g) ?? []).length;
  const guarded = (bodyText.match(/try \{[^}]*JSON\.parse/g) ?? []).length;
  expect(parses > 0, `the '${name}' listener no longer parses its event (update this check)`);
  expect(guarded === parses, `the '${name}' listener parses ${parses} times and guards ${guarded}: one malformed event throws out of the listener and the stream freezes silently`);
  // ...and a skipped event leaves a record: every catch hands the event's own name to skipped()
  const catches = (bodyText.match(/catch\b/g) ?? []).length;
  const recorded = (bodyText.match(new RegExp(`catch \\(e\\) \\{ skipped\\('${name}', e\\)`, 'g')) ?? []).length;
  expect(catches > 0 && recorded === catches, `the '${name}' listener has ${catches} catch blocks and ${recorded} record the skipped event: an unreadable event leaves no trace`);
}
// skipped() is the one place the record is made: a warning that names the event, rate-limited per name
const skippedFn = clientSrc.match(/const skipped = [\s\S]*?\n\};/)?.[0] ?? '';
expect(/console\.warn\(/.test(skippedFn) && /\$\{event\}/.test(skippedFn) && /n === 1 \|\| n % \d+ === 0/.test(skippedFn), 'skipped() no longer warns with the event name behind a per-name rate limit');

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

// --------------------------------------------- 5. one request per route, and every exported helper is used
// postLensDraft had no caller because `send` took no signal and LensChat re-implemented the request; postLens
// was superseded by postProjectLens. Every function helper client.ts exports must have a consumer in the web
// app, and a caller's signal must cancel a lens-draft turn (not wait out the 200 s bound).
const consumers = (name: string): number => {
  let n = 0;
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, d.name);
      if (d.isDirectory()) walk(f);
      else if (/\.tsx?$/.test(d.name) && f !== path.join(SRC, 'lib/scan/client.ts') && new RegExp(`\\b${name}\\b`).test(readStripped(f))) n++;
    }
  };
  walk(SRC);
  return n;
};
const helperNames = [...clientSrc.matchAll(/export (?:async )?(?:const|function) ((?:post|patch|delete|execute|get)[A-Z]\w*)/g)].map((m) => m[1]);
expect(helperNames.length >= 10, `found ${helperNames.length} exported request helpers (update this check)`);
for (const h of helperNames) expect(consumers(h) > 0, `client.ts exports ${h} and nothing in the web app calls it`);
expect(!/fetch\(\s*'\/api\/lens-draft'/.test(readStripped(path.join(SRC, 'components/ledger/lens/LensChat.tsx'))), 'LensChat.tsx makes its own /api/lens-draft request instead of calling postLensDraft');
{
  const ac = new AbortController();
  asked = [];
  const p = settle(client.postLensDraft('p', 'hello', undefined, 'project', ac.signal));
  setTimeout(() => ac.abort(), 5);
  const out = await p;
  expect(out !== PENDING && (out as { name?: string }).name === 'AbortError', 'aborting the signal passed to postLensDraft does not reject the turn with an AbortError', String((out as { name?: string })?.name ?? out));
}

// --------------------------------------------- 6. a list that did not answer is not "no scan store"
// useLiveProduct took `missing` from the project list's `live` flag, and a failed or timed-out list read became
// `[]` before it got there, so a product with a perfectly good store read as having none. The list has three
// outcomes (live, not live, no answer) and the status for each is pinned here; the stream settles the unknown.
const mk = (slug: string, live: boolean) => ({ slug, name: slug, root: '/r', live, readiness: {} }) as never;
const verdict = (list: unknown, slug = 'p') => projects.statusOfStore(projects.storeFromList(list as never, slug));
expect(verdict([mk('p', true)]) === 'live', 'a list that says the product has a store does not read live', verdict([mk('p', true)]));
expect(verdict([mk('p', false)]) === 'missing', 'a list that says the product has no store does not read missing (the genuine first-run state)', verdict([mk('p', false)]));
expect(verdict([mk('other', true)]) === 'missing', 'a product absent from an answered list does not read missing', verdict([mk('other', true)]));
expect(verdict(null) === 'loading', 'a list that did not answer does not leave the status loading (it must not claim there is no store)', verdict(null));
expect(!/refreshProjects\(\)\.then\(\(l\) => l \?\? /.test(clientSrc), 'client.ts turns a failed project list into an empty one again');
expect(/storeFromList\(/.test(clientSrc) && /statusOfStore\(/.test(clientSrc), 'useLiveProduct no longer takes its store verdict from projects.ts storeFromList / statusOfStore');

if (failures.length) { console.log(failures.map((f) => 'FAIL ' + f).join('\n')); console.log(`check-scan-client: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-scan-client: ${held} expectations held (${SHAPES.length} rejection shapes, ${DEV_WORDS.length} developer strings forbidden, ${HELPERS.length} request helpers bounded)`);
