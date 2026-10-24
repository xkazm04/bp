// The release train's one decision planner (apps/web/src/components/ledger/train/plan.ts): every surface that offers,
// counts, refuses or sends a triage decision - decide() (the buttons and the A/R/S/U keys), the decision bar's counts,
// the note editor and the Release tab's Undo - reads planDecision / decisionCounts, so they cannot disagree. Cases:
//   1. U on a waiting item is refused locally ("Nothing to undo") and decide() makes no triage call;
//   2. Undo on a rework item another proposal rebuilt is refused ("Rebuilt as <id>") by the planner, and the bar's
//      Undo carries that reason (before: only the Release tab knew the rule, the bar sent and the store refused);
//   3. accept over a moved + a failed item asks a note (can 2, flagged 1); with the note it sends both;
//   4. pending items are dropped from a send; all pending is `pending` (no call);
//   5. past the triage cap is `over-cap` in triageCapText's own words;
//   6. decisionCounts gives the bar's numbers, and a server render of DecisionBar prints them;
//   7. the Release tab's Undo on an item of a release past draft is aria-disabled with its reason (Btn reason);
//   8. source guard: the three surfaces import no decision rule from rules.ts; plan.ts is the train's one importer of
//      canDecide / noteRequired.
// Run: node scripts/check-train-plan.ts  (Node's type stripping; scripts/overlays-loader.mjs transpiles the src).
// Exit 1 on any failure.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { blankComments } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src'), TRAIN = path.join(SRC, 'components/ledger/train');
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
const { triageCapText } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/scan/types.ts')).href) as Any;
const { initialState } = await imp('engine/state.ts');
const { EngineCtx, VariantCtx, LiveCtx } = await imp('components/hooks.ts');
const { getVariant } = await imp('variants/registry.ts');
const { useLedger, setLedgerUi, EMPTY_UI } = await imp('components/ledger/useLedger.ts');
const P = await imp('components/ledger/train/plan.ts');
const D = await imp('components/ledger/train/Decide.tsx');
const { DecisionBar } = await imp('components/ledger/train/DecisionBar.tsx');
const { Package } = await imp('components/ledger/train/release/Package.tsx');
const { evidenceOf, readingsBy } = await imp('components/ledger/train/release/releaseState.ts');

let passed = 0;
const failures: string[] = [];
const ok = (c: boolean, what: string) => { if (c) passed++; else failures.push(what); };
const cases = new Map<number, boolean>();
const caseOk = (n: number, c: boolean, what: string) => { ok(c, 'case ' + n + ': ' + what); cases.set(n, (cases.get(n) ?? true) && c); };
const has = (f: string) => typeof P[f] === 'function';

// ------------------------------------------------------------------------------------------- the fixture
const M = buildModel(1, () => 0, null), LENS: string = M.P.lenses[0].id;
const at = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString();
let pn = 0, mid = 0;
const proposals: Any[] = [], measurements: Any[] = [];
const prop = (id: string, status: string, extra: Any = {}) => {
  const p = { id, run_id: 'r-exec', feature: 'kettle', lens: LENS, metric: 'mx', title: 'Item ' + id, body: '', standard: 'house:x', expected_delta: 1, size: 'S', risk: 1, kind: 'fix', status, pack_id: 'k-1', commit_sha: 'abcdef1234567', created_at: at(++pn), updated_at: at(pn), ...extra };
  proposals.push(p); return p;
};
const read = (id: string, before: number, after: number) => {
  measurements.push({ id: ++mid, run_id: 'r-exec', feature: 'kettle', lens: LENS, metric: 'mx', value: before, unit: 'ms', method: 'probe', measured_at: at(100 + mid), proposal_id: id, phase: 'before' });
  measurements.push({ id: ++mid, run_id: 'r-exec', feature: 'kettle', lens: LENS, metric: 'mx', value: after, unit: 'ms', method: 'probe', measured_at: at(100 + mid), proposal_id: id, phase: 'after' });
};
prop('p-done', 'done'); read('p-done', 10, 20);
prop('p-moved', 'done'); read('p-moved', 10, 20);
prop('p-failed', 'failed');
prop('p-1', 'done'); read('p-1', 10, 20);
prop('p-2', 'done'); read('p-2', 10, 20);
prop('p-rework-rebuilt', 'rework', { triaged_from: 'done', triage_note: 'try again' });
prop('p-rebuild', 'done', { attempt_of: 'p-rework-rebuilt' }); read('p-rebuild', 10, 20);
prop('p-w1', 'done'); read('p-w1', 10, 20);
prop('p-w2', 'done'); read('p-w2', 10, 20);
prop('p-w3', 'done'); read('p-w3', 10, 10);  // flat: flagged
prop('p-locked', 'accepted', { release_id: 'rel-1', triaged_from: 'done' }); read('p-locked', 10, 20);
for (let i = 0; i < 201; i++) prop('p-many-' + i, 'done');
const releases: Any[] = [{ id: 'rel-1', version: '1.2.0', branch: 'release/1.2.0', status: 'building', created_at: at(500), updated_at: at(500) }];
const T: Any = { slug: 'synthetic', ctx: {}, proposals, byId: new Map(proposals.map((p) => [p.id, p])), packs: [], releases, measurements, shots: [], jobs: [], lenses: M.P.lenses };
const none = new Set<string>();

// ------------------------------------------------------------------------------------------- 1. U on a waiting item
{
  const pl = has('planDecision') ? P.planDecision(T, ['p-done'], 'reopen', { pending: none }) : null;
  caseOk(1, pl?.kind === 'none-can' && /^Nothing to undo/.test(pl.why ?? ''), 'reopen on a waiting item -> none-can "Nothing to undo..." (' + JSON.stringify(pl) + ')');
  let calls = 0; const toasts: string[] = [];
  if (typeof D.runDecision === 'function') {
    await D.runDecision(T, none, ['p-done'], 'reopen', undefined, 'bar', {
      triage: async () => { calls++; return { decision: 'reopened', triaged: [], skipped: [] }; },
      toast: (t: string, b: string) => toasts.push(t + ' | ' + b), set: setLedgerUi, later: () => 0,
    });
  }
  caseOk(1, typeof D.runDecision === 'function' && calls === 0 && toasts.length === 1 && /Nothing to undo/.test(toasts[0]), 'decide() on it makes 0 triage calls and says why (' + calls + ' calls, ' + JSON.stringify(toasts) + ')');
}
{ // GUARD: a decision that can move still sends, once, with the planner's ids
  let calls = 0, sent: string[] = [];
  if (typeof D.runDecision === 'function') {
    await D.runDecision(T, none, ['p-locked', 'p-1'], 'accept', undefined, 'bar', {
      triage: async (ids: string[]) => { calls++; sent = ids; return { decision: 'accepted', triaged: ['p-1'], skipped: [] }; },
      toast: () => {}, set: setLedgerUi, later: () => 0,
    });
    setLedgerUi((u: Any) => ({ ...u, pending: new Map(), note: null }));
  }
  ok(calls === 1 && sent.includes('p-1'), 'guard: an accept that can move one item sends one call (' + calls + ', ' + JSON.stringify(sent) + ')');
}

// ------------------------------------------------------------------------------------------- 2. rebuilt
{
  const pl = has('planDecision') ? P.planDecision(T, ['p-rework-rebuilt'], 'reopen') : null;
  caseOk(2, pl?.kind === 'none-can' && (pl.why ?? '').startsWith('Rebuilt as p-rebuild'), 'reopen on a rebuilt rework item -> none-can "Rebuilt as p-rebuild" (' + JSON.stringify(pl) + ')');
  const plain = has('planDecision') ? P.planDecision(T, ['p-locked'], 'descope') : null;
  ok(plain?.kind === 'none-can' && /Locked/.test(plain.why ?? ''), 'guard: descope of an item in a release past draft is none-can, locked (' + JSON.stringify(plain) + ')');
}

// ------------------------------------------------------------------------------------------- 3. the note ask
{
  const a = has('planDecision') ? P.planDecision(T, ['p-moved', 'p-failed'], 'accept') : null;
  caseOk(3, a?.kind === 'ask-note' && a.can === 2 && a.flagged === 1, 'accept moved + failed, no note -> ask-note can 2 flagged 1 (' + JSON.stringify(a) + ')');
  const b = has('planDecision') ? P.planDecision(T, ['p-moved', 'p-failed'], 'accept', { note: 'x' }) : null;
  caseOk(3, b?.kind === 'send' && JSON.stringify(b.ids) === '["p-moved","p-failed"]', 'with note "x" -> send both (' + JSON.stringify(b) + ')');
  const c = has('planDecision') ? P.planDecision(T, ['p-moved'], 'accept') : null;
  ok(c?.kind === 'send', 'guard: accepting a moved item needs no note (' + JSON.stringify(c) + ')');
  const r = has('planDecision') ? P.planDecision(T, ['p-locked'], 'reopen', { pending: none }) : null;
  ok(r?.kind === 'none-can', 'guard: undo of an item in a building release is refused (' + JSON.stringify(r) + ')');
}

// ------------------------------------------------------------------------------------------- 4. pending
{
  const a = has('planDecision') ? P.planDecision(T, ['p-1', 'p-2'], 'accept', { pending: new Set(['p-1']) }) : null;
  caseOk(4, a?.kind === 'send' && JSON.stringify(a.ids) === '["p-2"]', 'p-1 pending -> send ["p-2"] (' + JSON.stringify(a) + ')');
  const b = has('planDecision') ? P.planDecision(T, ['p-1', 'p-2'], 'accept', { pending: new Set(['p-1', 'p-2']) }) : null;
  caseOk(4, b?.kind === 'pending', 'both pending -> pending (' + JSON.stringify(b) + ')');
  const e = has('planDecision') ? P.planDecision(T, [], 'accept') : null;
  ok(e?.kind === 'empty' && /pack item first/.test(e.why ?? ''), 'guard: nothing targeted -> empty, "focus or select a pack item first" (' + JSON.stringify(e) + ')');
}

// ------------------------------------------------------------------------------------------- 5. the cap
{
  const ids = Array.from({ length: 201 }, (_, i) => 'p-many-' + i);
  const a = has('planDecision') ? P.planDecision(T, ids, 'accept') : null;
  caseOk(5, a?.kind === 'over-cap' && a.why === triageCapText(201), '201 decidable ids -> over-cap in triageCapText(201)\'s words (' + JSON.stringify(a?.kind) + ')');
}

// ------------------------------------------------------------------------------------------- 6. the bar's counts
const live = { slug: 'synthetic', product: { status: 'live', events: '', jobs: [], scan: { runs: [], measurements, proposals, activity: [], shots: [], coverage: [], packs: [], releases } } };
const S = { ...initialState(1, M.P.asOf), ready: true, page: 'ledger', lv: 'triage' };
const E = { M, S, U: 1, store: { get: () => S, subscribe: () => () => {} }, dirty() {}, onFrame: () => () => {}, setPage() {}, flyToFeature() {}, openFeature() {}, lensAgg: () => ({ parts: [] }), channel: () => null, toast() {} };
const render = (el: Any): string => { try { return renderToStaticMarkup(h(VariantCtx.Provider, { value: getVariant('subtle') }, h(EngineCtx.Provider, { value: E }, h(LiveCtx.Provider, { value: live }, el)))); } catch (e) { console.log('(render threw: ' + String((e as Error).message).split('\n')[0] + ')'); return ''; } };
function Bar({ targets }: { targets: string[] }) { const L = useLedger({ ...EMPTY_UI, scope: 'packs' }, setLedgerUi); return h(DecisionBar, { L, targets, onRelease() {}, hint: null }); }
const btnOf = (html: string, label: RegExp): string | undefined => (html.match(/<button\b[\s\S]*?<\/button>/g) ?? []).find((b) => label.test(b.replace(/<[^>]+>/g, ' ')));
const reasonOf = (b: string | undefined): string | undefined => {
  if (!b) return undefined;
  const open = b.slice(0, b.indexOf('>') + 1), id = /aria-describedby="([^"]+)"/.exec(open)?.[1];
  if (!/aria-disabled="true"/.test(open) || /\sdisabled(=|\s|>)/.test(open) || !id) return undefined;
  return new RegExp('id="' + id.replace(/[:]/g, '\\$&') + '"[^>]*>([^<]+)<').exec(b)?.[1];
};
{
  const targets = ['p-w1', 'p-w2', 'p-w3', 'p-locked'];
  const c = has('decisionCounts') ? P.decisionCounts(T, targets) : null;
  caseOk(6, c?.accept === 3 && c?.flagged === 1 && c?.locked === 1, 'decisionCounts over 3 waiting (1 flagged) + 1 locked -> accept 3, flagged 1, locked 1 (' + JSON.stringify(c && { accept: c.accept, flagged: c.flagged, locked: c.locked }) + ')');
  const html = typeof DecisionBar === 'function' ? render(h(Bar, { targets })).replace(/<!-- -->/g, '') : '';
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  caseOk(6, /Accept 3\b/.test(text) && /1 needs a note/.test(text) && /1 locked/.test(text), 'DecisionBar prints "Accept 3", "1 needs a note" and "1 locked" (' + text.slice(0, 200) + ')');
  // the source of those numbers is the planner: the bar holds no count of its own
  const bar = fs.existsSync(path.join(TRAIN, 'DecisionBar.tsx')) ? blankComments(fs.readFileSync(path.join(TRAIN, 'DecisionBar.tsx'), 'utf8')) : '';
  caseOk(6, /decisionCounts\(/.test(bar) && !/isFlagged\(|isWaiting\(|releaseIn\(/.test(bar), 'DecisionBar reads decisionCounts and derives no flagged / locked count itself');

  // case 2, rendered: the bar's Undo over the rebuilt item carries the planner's reason
  const h2 = typeof DecisionBar === 'function' ? render(h(Bar, { targets: ['p-rework-rebuilt'] })) : '';
  const why = reasonOf(btnOf(h2, /\bUndo\b/));
  caseOk(2, !!why && why.startsWith('Rebuilt as p-rebuild'), 'the bar\'s Undo for a rebuilt item is aria-disabled with "Rebuilt as p-rebuild" (' + why + ')');
}

// ------------------------------------------------------------------------------------------- 7. the Release tab's Undo
{
  const rel = releases[0], p = T.byId.get('p-locked');
  let html = '';
  if (typeof Package === 'function' && typeof evidenceOf === 'function') {
    const m = { T, rel, jobs: [], items: [evidenceOf(p, readingsBy(measurements), M.P.lenses)], free: 0, history: [] };
    html = render(h(Package, { m, phone: false }));
  }
  const b = btnOf(html, /\bUndo\b/), why = reasonOf(b);
  caseOk(7, why === 'Locked: the release left draft', 'Package\'s Undo on an item of a building release: aria-disabled, focusable, described by "Locked: the release left draft" (' + why + '; ' + (b ?? 'no button').slice(0, 160) + ')');
  // GUARD: an accepted item of a draft release can still be undone from the Release tab
  const drel = { ...rel, status: 'draft' }, T2 = { ...T, releases: [drel] };
  let h2 = '';
  if (typeof Package === 'function' && typeof evidenceOf === 'function') h2 = render(h(Package, { m: { T: T2, rel: drel, jobs: [], items: [evidenceOf(p, readingsBy(measurements), M.P.lenses)], free: 0, history: [] }, phone: false }));
  const b2 = btnOf(h2, /\bUndo\b/);
  ok(!!b2 && !/aria-disabled|\sdisabled(=|\s|>)/.test(b2.slice(0, b2.indexOf('>') + 1)), 'guard: Undo on an item of a draft release stays a live button');
}

// ------------------------------------------------------------------------------------------- 8. source guard
{
  const RULES = /import\s*\{([^}]*)\}\s*from\s*'@bp\/core\/train\/rules'/;
  const names = (f: string): string[] => { const src = fs.existsSync(f) ? blankComments(fs.readFileSync(f, 'utf8')) : ''; const m = RULES.exec(src); return m ? m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '')).filter(Boolean) : []; };
  const DECISION = ['canDecide', 'isFlagged', 'noteRequired', 'isWaiting'];
  for (const f of ['Decide.tsx', 'DecisionBar.tsx', 'release/Package.tsx']) {
    const bad = names(path.join(TRAIN, f)).filter((n) => DECISION.includes(n));
    caseOk(8, fs.existsSync(path.join(TRAIN, 'plan.ts')) && !bad.length, f + ' imports no decision rule from rules.ts (' + bad.join(', ') + ')');
  }
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []);
  const importers = walk(TRAIN).filter((f) => names(f).some((n) => n === 'canDecide' || n === 'noteRequired')).map((f) => path.relative(TRAIN, f).split(path.sep).join('/'));
  caseOk(8, JSON.stringify(importers) === '["plan.ts"]', 'plan.ts is the one importer of canDecide / noteRequired in components/ledger/train (' + importers.join(', ') + ')');
}

const red = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !cases.get(n));
console.log('acceptance cases: ' + (8 - red.length) + ' of 8 hold' + (red.length ? ' (red: ' + red.join(', ') + ')' : ''));
if (failures.length) { for (const f of failures) console.log('FAIL ' + f); console.log(failures.length + ' failed, ' + passed + ' held'); process.exit(1); }
console.log('train decision planner: ' + passed + ' assertions held');
