// The release train's Undo targets the decision the person just made (apps/web/src/components/ledger/train/plan.ts
// undoTargets, Decide.tsx runDecision, useLedger.ts LedgerUi.last), not the item the focus advanced to after it (A/1's
// keep-moving). Undo reverts what the person SAID, never follows how they are LOOKING. Cases:
//   1. a decision answered `triaged ['p-1']` records LedgerUi.last = {ids ['p-1'], decision 'accepted'}; a 409 or a thrown
//      call leaves it unchanged;
//   2. last = p-1 (accepted) and the targets the advanced focus ['p-2' done]: undoTargets -> ['p-1'] and the U path
//      sends triage(['p-1'], 'reopen');
//   3. an explicit target that can be undone (['p-3' rework]) wins over last;
//   4. a batch answered triaged ['p-1','p-3'], skipped ['p-2'] records only what moved;
//   5. last whose release has left draft: undoTargets -> [] and the bar's Undo reason reads "Locked: the release left draft";
//   6. a reopen of last that lands clears it; a second U says "Nothing to undo" with no call (one step deep);
//   7. a server render of Decide over ['p-2' done] with last = p-1: Undo is live and names it ("Undo accept · p-1"), and
//      the compact compare strip shows Undo too;
//   8. a product switch (useLedgerUi(other)) and a scope switch (switchScope) clear last.
// Run: node scripts/check-train-undo.ts  (Node's type stripping; scripts/overlays-loader.mjs transpiles the src).
// Exit 1 on any failure.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
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
const U = await imp('components/ledger/useLedger.ts');
const P = await imp('components/ledger/train/plan.ts');
const D = await imp('components/ledger/train/Decide.tsx');
const { setLedgerUi, useLedgerUi, EMPTY_UI } = U;

let passed = 0;
const failures: string[] = [];
const ok = (c: boolean, what: string) => { if (c) passed++; else failures.push(what); };
const cases = new Map<number, boolean>();
const caseOk = (n: number, c: boolean, what: string) => { ok(c, 'case ' + n + ': ' + what); cases.set(n, (cases.get(n) ?? true) && c); };
const fn = (o: Any, f: string) => typeof o?.[f] === 'function';

// ------------------------------------------------------------------------------------------- the fixture
const M = buildModel(1, () => 0, null), LENS: string = M.P.lenses[0].id;
const at = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString();
let pn = 0, mid = 0;
const proposals: Any[] = [], measurements: Any[] = [];
const prop = (id: string, status: string, extra: Any = {}) => {
  const p = { id, run_id: 'r-exec', feature: 'kettle', lens: LENS, metric: 'mx', title: 'Item ' + id, body: '', standard: 'house:x', expected_delta: 1, size: 'S', risk: 1, kind: 'fix', status, pack_id: 'k-1', commit_sha: 'abcdef1234567', created_at: at(++pn), updated_at: at(pn), ...extra };
  proposals.push(p); return p;
};
const read = (id: string) => {
  measurements.push({ id: ++mid, run_id: 'r-exec', feature: 'kettle', lens: LENS, metric: 'mx', value: 10, unit: 'ms', method: 'probe', measured_at: at(100 + mid), proposal_id: id, phase: 'before' });
  measurements.push({ id: ++mid, run_id: 'r-exec', feature: 'kettle', lens: LENS, metric: 'mx', value: 20, unit: 'ms', method: 'probe', measured_at: at(100 + mid), proposal_id: id, phase: 'after' });
};
prop('p-1', 'accepted', { triaged_from: 'done' }); read('p-1');   // just accepted (the store's answer has arrived)
prop('p-2', 'done'); read('p-2');                                 // the next waiting item: where the focus advanced to
prop('p-3', 'rework', { triaged_from: 'done', triage_note: 'again' }); read('p-3');
prop('p-L', 'accepted', { triaged_from: 'done', release_id: 'rel-1' }); read('p-L');
const releases: Any[] = [{ id: 'rel-1', version: '1.2.0', branch: 'release/1.2.0', status: 'building', created_at: at(500), updated_at: at(500) }];
const T: Any = { slug: 'synthetic', ctx: {}, proposals, byId: new Map(proposals.map((p) => [p.id, p])), packs: [], releases, measurements, shots: [], jobs: [], lenses: M.P.lenses };
const none = new Set<string>();
// before the decision: p-1 still waits (case 1 sends the accept the rest of the cases see answered)
const T0: Any = { ...T, byId: new Map([...T.byId, ['p-1', { ...T.byId.get('p-1'), status: 'done', triaged_from: undefined }]]) };

const peek = (): Any => { let x: Any; setLedgerUi((u: Any) => { x = u; return u; }); return x; };
const reset = (last: Any = null) => setLedgerUi((u: Any) => ({ ...u, pending: new Map(), note: null, last }));
const io = (answer: () => Promise<Any>, last?: Any) => {
  const calls: [string[], string][] = [], toasts: string[] = [];
  return {
    calls, toasts,
    io: { triage: (ids: string[], d: string) => { calls.push([ids, d]); return answer(); }, toast: (t: string, b: string) => toasts.push(t + ' | ' + b), set: setLedgerUi, later: () => 0, ...(last === undefined ? {} : { last }) },
  };
};
const run = async (raw: string[], d: string, o: { io: Any }, note?: string, t: Any = T) => { if (fn(D, 'runDecision')) await D.runDecision(t, none, raw, d, note, 'bar', o.io); };
const last1 = { ids: ['p-1'], decision: 'accepted' };

// ------------------------------------------------------------------------------------------- 1. recorded from the answer
{
  reset();
  await run(['p-1'], 'accept', io(async () => ({ decision: 'accepted', triaged: ['p-1'], skipped: [] })), undefined, T0);
  caseOk(1, JSON.stringify(peek()?.last) === JSON.stringify(last1), 'a 200 triaged [p-1] records last = {ids [p-1], decision accepted} (' + JSON.stringify(peek()?.last) + ')');
  await run(['p-2'], 'accept', io(async () => { throw { status: 409, body: { decision: 'accepted', triaged: [], skipped: [{ id: 'p-2', status: 'done', reason: 'note-required' }] } }; }));
  caseOk(1, JSON.stringify(peek()?.last) === JSON.stringify(last1), 'a 409 leaves last unchanged (' + JSON.stringify(peek()?.last) + ')');
  await run(['p-2'], 'accept', io(async () => { throw new Error('network'); }));
  caseOk(1, JSON.stringify(peek()?.last) === JSON.stringify(last1), 'a thrown call leaves last unchanged');
  // GUARD: a 200 that moved nothing is not a decision to undo
  await run(['p-2'], 'accept', io(async () => ({ decision: 'accepted', triaged: [], skipped: [{ id: 'p-2', status: 'done' }] })));
  ok(JSON.stringify(peek()?.last) === JSON.stringify(last1), 'guard: a 200 that moved nothing leaves last unchanged');
}

// ------------------------------------------------------------------------------------------- 2. U after the advance
{
  const t = fn(P, 'undoTargets') ? P.undoTargets(T, last1, ['p-2']) : null;
  caseOk(2, JSON.stringify(t) === '["p-1"]', 'undoTargets(last p-1, targets [p-2 done]) -> [p-1] (' + JSON.stringify(t) + ')');
  reset(last1);
  const o = io(async () => ({ decision: 'reopened', triaged: ['p-1'], skipped: [] }), last1);
  await run(['p-2'], 'reopen', o);
  caseOk(2, o.calls.length === 1 && JSON.stringify(o.calls[0]) === '[["p-1"],"reopen"]', 'the U path sends triage([p-1], reopen) (' + JSON.stringify(o.calls) + ')');
}

// ------------------------------------------------------------------------------------------- 3. an explicit target wins
{
  const t = fn(P, 'undoTargets') ? P.undoTargets(T, last1, ['p-3']) : null;
  caseOk(3, JSON.stringify(t) === '["p-3"]', 'undoTargets(last p-1, targets [p-3 rework]) -> [p-3] (' + JSON.stringify(t) + ')');
  // GUARD: with no last, undo is the explicit targets' as before
  const g2 = fn(P, 'undoTargets') ? P.undoTargets(T, null, ['p-3']) : null;
  ok(JSON.stringify(g2) === '["p-3"]', 'guard: no last -> the explicit undoable targets (' + JSON.stringify(g2) + ')');
}

// ------------------------------------------------------------------------------------------- 4. only what moved
{
  reset();
  await run(['p-1', 'p-2', 'p-3'], 'descope', io(async () => ({ decision: 'descoped', triaged: ['p-1', 'p-3'], skipped: [{ id: 'p-2', status: 'done' }] })), 'n');
  caseOk(4, JSON.stringify(peek()?.last) === '{"ids":["p-1","p-3"],"decision":"descoped"}', 'a batch records only what moved (' + JSON.stringify(peek()?.last) + ')');
}

// ------------------------------------------------------------------------------------------- render helpers
const live = { slug: 'synthetic', product: { status: 'live', events: '', jobs: [], scan: { runs: [], measurements, proposals, activity: [], shots: [], coverage: [], packs: [], releases } } };
const S = { ...initialState(1, M.P.asOf), ready: true, page: 'ledger', lv: 'triage' };
const E = { M, S, U: 1, store: { get: () => S, subscribe: () => () => {} }, dirty() {}, onFrame: () => () => {}, setPage() {}, flyToFeature() {}, openFeature() {}, lensAgg: () => ({ parts: [] }), channel: () => null, toast() {} };
const render = (el: Any): string => { try { return renderToStaticMarkup(h(VariantCtx.Provider, { value: getVariant('subtle') }, h(EngineCtx.Provider, { value: E }, h(LiveCtx.Provider, { value: live }, el)))).replace(/<!-- -->/g, ''); } catch (e) { console.log('(render threw: ' + String((e as Error).message).split('\n')[0] + ')'); return ''; } };
const buttons = (html: string): string[] => html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
const undoBtn = (html: string) => buttons(html).find((b) => /\bUndo\b/.test(b.replace(/<[^>]+>/g, ' ')));
const reasonOf = (b: string | undefined): string | undefined => {
  if (!b) return undefined;
  const open = b.slice(0, b.indexOf('>') + 1), id = /aria-describedby="([^"]+)"/.exec(open)?.[1];
  if (!/aria-disabled="true"/.test(open) || !id) return undefined;
  return new RegExp('id="' + id.replace(/[:]/g, '\\$&') + '"[^>]*>([^<]+)<').exec(b)?.[1];
};
const Decide = D.Decide;
render(h(Decide, { ids: [] })); // the module store now belongs to product 'synthetic'

// ------------------------------------------------------------------------------------------- 5. locked
{
  const lastL = { ids: ['p-L'], decision: 'accepted' };
  const t = fn(P, 'undoTargets') ? P.undoTargets(T, lastL, ['p-2']) : null;
  caseOk(5, JSON.stringify(t) === '[]', 'last in a building release -> undoTargets [] (' + JSON.stringify(t) + ')');
  reset(lastL);
  const why = reasonOf(undoBtn(render(h(Decide, { ids: ['p-2'] }))));
  caseOk(5, why === 'Locked: the release left draft', 'the bar\'s Undo reason reads "Locked: the release left draft" (' + why + ')');
}

// ------------------------------------------------------------------------------------------- 6. one step deep
{
  reset(last1);
  await run(['p-2'], 'reopen', io(async () => ({ decision: 'reopened', triaged: ['p-1'], skipped: [] }), last1));
  caseOk(6, peek()?.last === null, 'a reopen of last that lands clears it (' + JSON.stringify(peek()?.last) + ')');
  const o = io(async () => ({ decision: 'reopened', triaged: [], skipped: [] }), null);
  await run(['p-2'], 'reopen', o);
  caseOk(6, o.calls.length === 0 && o.toasts.length === 1 && /Nothing to undo/.test(o.toasts[0]), 'a second U says "Nothing to undo" with no call (' + o.calls.length + ' calls, ' + JSON.stringify(o.toasts) + ')');
}

// ------------------------------------------------------------------------------------------- 7. the button names it
{
  reset(last1);
  const b = undoBtn(render(h(Decide, { ids: ['p-2'] })));
  const open = b ? b.slice(0, b.indexOf('>') + 1) : '', text = (b ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  caseOk(7, !!b && !/aria-disabled="true"/.test(open) && /Undo accept · p-1/.test(text) && /Undo accept · p-1/.test(open), 'the bar\'s Undo is live and names p-1 in label and title (' + (b ?? 'no button').slice(0, 200) + ')');
  const c = undoBtn(render(h(Decide, { ids: ['p-2'], compact: true })));
  caseOk(7, !!c && !/aria-disabled="true"/.test(c.slice(0, c.indexOf('>') + 1)), 'the compact compare strip shows a live Undo (' + (c ?? 'no button').slice(0, 120) + ')');
  // GUARD: an explicit undoable target and no last keeps the plain "Undo"
  reset(null);
  const p = undoBtn(render(h(Decide, { ids: ['p-3'] })));
  ok(!!p && !/·/.test(p.replace(/<[^>]+>/g, ' ')) && !/aria-disabled="true"/.test(p.slice(0, p.indexOf('>') + 1)), 'guard: an undoable explicit target with no last renders the plain live "Undo"');
  // GUARD: the compact strip still hides Undo when there is nothing to undo
  ok(!undoBtn(render(h(Decide, { ids: ['p-2'], compact: true }))), 'guard: the compact strip hides Undo with nothing to undo');
}

// ------------------------------------------------------------------------------------------- 8. resets
{
  reset(last1);
  const s = fn(U, 'switchScope') ? U.switchScope(peek(), 'backlog') : null;
  caseOk(8, !!s && s.scope === 'backlog' && s.last === null, 'switchScope clears last (' + JSON.stringify(s?.last) + ')');
  caseOk(8, 'last' in EMPTY_UI && EMPTY_UI.last === null, 'EMPTY_UI.last is null');
  reset(last1);
  function Other() { useLedgerUi('another-product'); return null; }
  render(h(Other));
  caseOk(8, (peek()?.last ?? null) === null, 'a product switch clears last (' + JSON.stringify(peek()?.last) + ')');
}

const red = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !cases.get(n));
console.log('acceptance cases: ' + (8 - red.length) + ' of 8 hold' + (red.length ? ' (red: ' + red.join(', ') + ')' : ''));
if (failures.length) { for (const f of failures) console.log('FAIL ' + f); console.log(failures.length + ' failed, ' + passed + ' held'); process.exit(1); }
console.log('train undo targets: ' + passed + ' assertions held');
