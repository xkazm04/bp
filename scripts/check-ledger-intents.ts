// The ledger's one in-flight rule (apps/web/src/components/ledger/intents.ts): "this finding was sent from status S;
// show it as moving until the store says otherwise". Dispatch, wave dispatch and triage all hold it in the LedgerUi
// module store and settle it by the authority (the store's status), never by "something changed". Cases:
//   1. paint over a proposed and an approved finding, showing approved: both read approved and are in flight;
//   2. an unrelated proposals change (another finding flips) settles nothing: the intents for a and b stay;
//   3. the store reports a in another status: a settles (committed), b, still at its sent-from status, stays;
//   4. attempt 1 fails after attempt 2 re-painted b: revert(attempt 1) drops only attempt-1 entries still at their
//      sent-from status; b, owned by attempt 2, is untouched;
//   5. an intent older than the bound with the store silent: expire() releases it and returns its id for the
//      "may still have landed" toast (Decide.tsx boundPending's rule for triage);
//   6. intents set through setLedgerUi survive a remount: a fresh component's useLedger reads the finding approved and
//      not dispatchable while it is in flight;
//   7. source (comments blanked): useLedger.ts has no component-state overlay and no clear-on-any-change effect;
//      dispatchIds and dispatchWave both go through the shared send helper over the intents module; Decide.tsx
//      prunes its pending set with the shared settle().
// GUARDS (behaviour that must not change): a finding with no intent reads its store status and stays dispatchable;
// settle with nothing to drop returns the very same map (a no-op store write).
// Run: node scripts/check-ledger-intents.ts  (Node's type stripping; scripts/overlays-loader.mjs transpiles the src).
// Exit 1 on any failure.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { blankComments } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src'), LEDGER = path.join(SRC, 'components/ledger');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const g = globalThis as Any;
g.window ??= { devicePixelRatio: 1 };
const imp = async (p: string): Promise<Any> => { try { return await import(pathToFileURL(path.join(SRC, p)).href); } catch (e) { console.log('(cannot load ' + p + ': ' + String((e as Error).message).split('\n')[0] + ')'); return {}; } };
const req = createRequire(path.join(ROOT, 'package.json'));
const React: Any = req('react'), { renderToStaticMarkup }: Any = req('react-dom/server');
const h = React.createElement;
const { buildModel } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/sample.ts')).href) as Any;
const { initialState } = await imp('engine/state.ts');
const { EngineCtx, VariantCtx, LiveCtx } = await imp('components/hooks.ts');
const { getVariant } = await imp('variants/registry.ts');
const { useLedger, setLedgerUi, EMPTY_UI } = await imp('components/ledger/useLedger.ts');
const I = await imp('components/ledger/intents.ts');

let passed = 0;
const failures: string[] = [];
const ok = (c: boolean, what: string) => { if (c) passed++; else failures.push(what); };
const cases = new Map<number, boolean>();
const caseOk = (n: number, c: boolean, what: string) => { ok(c, 'case ' + n + ': ' + what); cases.set(n, (cases.get(n) ?? true) && c); };
const has = (f: string) => typeof I[f] === 'function';
const of = (o: Record<string, string>) => (id: string) => o[id];

// ------------------------------------------------------------------------------------------- 1. paint
const T0 = 1_000_000;
const p1 = has('paint') ? I.paint(new Map(), ['a', 'b'], of({ a: 'proposed', b: 'approved' }), { attempt: 1, at: T0, shows: 'approved' }) : new Map();
{
  const a = p1.get('a'), b = p1.get('b');
  caseOk(1, a?.from === 'proposed' && b?.from === 'approved' && a?.attempt === 1, 'paint records each id at its sent-from status (' + JSON.stringify([...p1]) + ')');
  caseOk(1, has('overlay') && I.overlay('proposed', a) === 'approved' && I.overlay('approved', b) === 'approved', 'a reads approved, b approved');
  caseOk(1, has('inFlight') && I.inFlight('proposed', a) === true && I.inFlight('approved', b) === true, 'both in flight');
}

// ------------------------------------------------------------------------------------------- 2. unrelated change
{
  const s = has('settle') ? I.settle(p1, of({ a: 'proposed', b: 'approved', c: 'declined' })) : null;
  caseOk(2, !!s && s.has('a') && s.has('b'), 'another finding flipping settles neither a nor b');
  ok(s === p1, 'guard: settle with nothing to drop returns the same map (no store write)');
}

// ------------------------------------------------------------------------------------------- 3. the authority answers
{
  const s = has('settle') ? I.settle(p1, of({ a: 'approved', b: 'approved' })) : null;
  caseOk(3, !!s && !s.has('a') && s.has('b'), 'a settles as committed once the store shows it approved; b stays (' + JSON.stringify(s && [...s.keys()]) + ')');
  const gone = has('settle') ? I.settle(p1, of({ b: 'approved' })) : null;
  caseOk(3, !!gone && !gone.has('a') && gone.has('b'), 'a row gone from the store settles too');
}

// ------------------------------------------------------------------------------------------- 4. compare-and-swap revert
{
  const p2 = has('paint') ? I.paint(p1, ['b'], of({ b: 'approved' }), { attempt: 2, at: T0 + 1, shows: 'approved' }) : new Map();
  const r = has('revert') ? I.revert(p2, 1, of({ a: 'proposed', b: 'approved' })) : null;
  caseOk(4, !!r && !r.has('a') && r.get('b')?.attempt === 2, 'revert(1) drops a, leaves b to attempt 2 (' + JSON.stringify(r && [...r]) + ')');
  const moved = has('revert') ? I.revert(p1, 1, of({ a: 'executing', b: 'approved' })) : null;
  caseOk(4, !!moved && moved.has('a') && !moved.has('b'), 'an entry the store already moved is not reverted (only those still at their sent-from status)');
  const some = has('revert') ? I.revert(p1, 1, of({ a: 'proposed', b: 'approved' }), ['b']) : null;
  caseOk(4, !!some && some.has('a') && !some.has('b'), 'revert limited to ids (the unsent ones) leaves the sent ones');
}

// ------------------------------------------------------------------------------------------- 5. the bound
{
  const m = has('paint') ? I.paint(p1, ['c'], of({ c: 'proposed' }), { attempt: 3, at: T0 + 50_000, shows: 'approved' }) : new Map();
  const bound = I.INTENT_BOUND_MS;
  const e = has('expire') ? I.expire(m, T0 + (bound ?? 0) + 1, bound) : null;
  caseOk(5, typeof bound === 'number' && bound >= 30_000, 'the bound is generous (>= 30 s)');
  caseOk(5, !!e && JSON.stringify([...e.expired].sort()) === '["a","b"]' && !e.intents.has('a') && e.intents.has('c'), 'expire releases the old ones and names them; the fresh one stays (' + JSON.stringify(e && e.expired) + ')');
}

// ------------------------------------------------------------------------------------------- 6. survives a remount
{
  const M = buildModel(1, () => 0, null), LENS: string = M.P.lenses[0].id, feat: string = M.P.base.features[0].slug;
  const at = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString();
  const prop = (id: string, status: string, i: number) => ({ id, run_id: 'r', feature: feat, lens: LENS, title: 'Item ' + id, body: '', standard: 'house:x', size: 'S', risk: 1, kind: 'fix', status, created_at: at(i), updated_at: at(i) });
  const proposals = [prop('f-a', 'proposed', 1), prop('f-b', 'proposed', 2)];
  const live = { slug: 'synthetic', product: { status: 'live', events: '', jobs: [], scan: { runs: [], measurements: [], proposals, activity: [], shots: [], coverage: [], packs: [], releases: [] } } };
  const S = { ...initialState(1, M.P.asOf), ready: true, page: 'ledger', lv: 'triage' };
  const E = { M, S, U: 1, store: { get: () => S, subscribe: () => () => {} }, dirty() {}, onFrame: () => () => {}, setPage() {}, flyToFeature() {}, openFeature() {}, lensAgg: () => ({ parts: [] }), channel: () => null, toast() {} };
  let seen: Any = null;
  function Fresh() { const L = useLedger({ ...EMPTY_UI, scope: 'backlog' }, setLedgerUi); seen = { a: L.byId.get('f-a'), b: L.byId.get('f-b') }; return null; }
  if (typeof setLedgerUi === 'function') setLedgerUi((u: Any) => ({ ...u, intents: new Map([['f-a', { from: 'proposed', shows: 'approved', attempt: 9, at: Date.now() }]]) }));
  try { renderToStaticMarkup(h(VariantCtx.Provider, { value: getVariant('subtle') }, h(EngineCtx.Provider, { value: E }, h(LiveCtx.Provider, { value: live }, h(Fresh))))); } catch (e) { console.log('(render threw: ' + String((e as Error).message).split('\n')[0] + ')'); }
  caseOk(6, seen?.a?.status === 'approved' && seen?.a?.can === false, 'a fresh useLedger reads the in-flight finding approved and not dispatchable (' + JSON.stringify(seen?.a && { status: seen.a.status, can: seen.a.can }) + ')');
  ok(seen?.b?.status === 'proposed' && seen?.b?.can === true, 'guard: a finding with no intent reads its store status and stays dispatchable');
  if (typeof setLedgerUi === 'function') setLedgerUi((u: Any) => ({ ...u, intents: new Map() }));
}

// ------------------------------------------------------------------------------------------- 7. source
{
  // imports are read from the raw text: the header's `waves/*` opens a block comment for the blanking regex
  const raw = fs.readFileSync(path.join(LEDGER, 'useLedger.ts'), 'utf8'), L = blankComments(raw);
  caseOk(7, !/\bsetOver\(/.test(L), 'useLedger.ts has no setOver( (no component-state overlay)');
  caseOk(7, !/useEffect\(\(\) => \{[^}]*\}, \[src\.proposals\]\)/.test(L), 'useLedger.ts has no [src.proposals] clearing effect');
  caseOk(7, /^import .* from '\.\/intents';$/m.test(raw),'useLedger.ts imports the intents module');
  const body = (name: string, next: string) => { const i = L.indexOf('const ' + name + ' = useCallback'); const j = L.indexOf(next, i + 1); return i < 0 ? '' : L.slice(i, j < 0 ? undefined : j); };
  const helper = body('sendIntent', 'const dispatchIds');
  caseOk(7, /\bpaint\(/.test(helper) && /\brevert\(/.test(helper), 'the send helper paints and reverts through the intents module');
  caseOk(7, /\bsendIntent\(/.test(body('dispatchIds', 'const waveTags')), 'dispatchIds goes through the send helper');
  caseOk(7, /\bsendIntent\(/.test(body('dispatchWave', 'const showInTable')), 'dispatchWave goes through the send helper');
  const D = blankComments(fs.readFileSync(path.join(LEDGER, 'train/Decide.tsx'), 'utf8'));
  // the train components reach the ledger through ../useLedger (check:train-quality's allowlist), which re-exports it
  caseOk(7, /^import \{[^}]*\bsettle\b[^}]*\} from '\.\.\/useLedger';$/m.test(D) && /^export \{ settle \} from '\.\/intents';$/m.test(raw) &&/\bsettle\(\s*(?:u|ui)\.pending/.test(D) && !/\.filter\(\(\[id, s\]\) => T\.byId\.get\(id\)\?\.status !== s\)/.test(D), 'Decide.tsx prunes pending with the shared settle()');
}

const red = [...cases].filter(([, v]) => !v).map(([k]) => k);
console.log('cases: ' + (cases.size - red.length) + ' of ' + cases.size + ' hold' + (red.length ? ' (red: ' + red.join(', ') + ')' : ''));
if (failures.length) { for (const f of failures) console.log('FAIL ' + f); console.log(failures.length + ' failed, ' + passed + ' held'); process.exit(1); }
console.log('ledger intents: ' + passed + ' assertions held');
