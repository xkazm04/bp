// The ledger's guards against a decision going somewhere the person did not mean, driven through the real components
// (apps/web/src/components/ledger). One section per card; each says which of its expectations are RED (the card's
// acceptance, failing on the tree the card was written against) and which are GUARDS (already true, must stay true).
//   1. DW-76 a decline reason stays with its finding (LedgerPage's Body, BriefDrawer.tsx and its Decision):
//        RED    N on A, type a reason, Esc, J to B, N: B's reason box opens empty
//        RED    N on A, type a reason, J to B (focus moves, no Esc), N: B's reason box opens empty
//        GUARD  N on A opens A's reason box and shows what is typed; Esc closes it; J moves the drawer to B
//   2. DW-75 the backlog's Dispatch bar says what the filters hide (variants/Triage.tsx DispatchBar over the real useLedger):
//        RED    2 selected, a lens filter hides 1: the bar's aria-live label says "1 hidden by filters" (as DecisionBar does)
//        GUARD  both selected findings shown: the label reads "2 selected" and names nothing hidden
//   3. DW-77 Tag (and Finish from merged) ask before they start (train/release/ReleaseView.tsx useReleaseActions, on the
//      Kettle sim's train, every release job a press starts counted):
//        RED    a draft of 2 items that all landed: one press of Tag (button) or one T starts no tag job and shows an inline
//               confirm naming v0.1.0 and its 2 items; the confirm (its first button, or T again) starts exactly one
//        RED    a merged release (RELEASE_STATE offers `finish` outright there): the same for Finish
//        GUARD  the landed draft offers Tag and no Build, the merged one Finish; a draft that did not land starts one
//               build on one press of Build (no ask)
//   4. DW-73 the phone's decision bar has no dead Release -> (train/DecisionBar.tsx under LedgerPage's Body, In packs):
//        RED    phone: the bar shows no Release -> button, or a tap on it does something (a page, a toast, changed words)
//        GUARD  desktop: the bar keeps Release -> and a press opens the Release tab; the phone ledger renders the bar
// Rig. No DOM renderer is in this tree, and renderToString keeps no state between renders, so the components run under a
// small reconciler of the check's own: each function component is called with a stand-in React dispatcher (state, memo,
// refs, effects, context, external stores) over hook slots owned by an instance, and an instance is kept across renders
// exactly when React keeps a fiber: the same element type at the same place in its parent's output, with the same key
// (its index among its siblings when it has none). A changed type or key unmounts the old instance (its effects cleaned
// up) and mounts a fresh one with fresh state; an element no longer rendered unmounts. Every pass renders from the root,
// as a parent's update re-renders its children. Only the components a section reads are expanded (here LedgerPage ->
// Body -> BriefDrawer and everything inside it); the rest stay elements, so their state is not this check's business.
// Keys go to Body's own onKeyDown (the page's keymap); typing goes through the textarea's onChange and onKeyDown props.
// So a carried-over reason here is the state React would carry over, and a fix that keys the drawer (or its Decision) by
// the finding, or resets the reason when the finding changes, reads as fixed.
// Run: node scripts/check-ledger-guards.ts   (scripts/overlays-loader.mjs transpiles src/**/*.tsx). Exit 1 on any miss.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_LEDGER_GUARDS_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const g = globalThis as Any;
g.window ??= { innerWidth: 1400, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
g.document ??= { activeElement: null, body: {} };
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const req = createRequire(path.join(ROOT, 'package.json'));
const React: Any = req('react');
const RI: Any = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const json = (status: number, body: Any) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
g.fetch = async (url: string) => json(404, { error: 'check-ledger-guards: unstubbed ' + url });

// ------------------------------------------------------------------------------------------------ the reconciler rig
const isEl = (x: Any) => !!x && typeof x === 'object' && '$$typeof' in x && 'props' in x;
const same = (a: Any[] | undefined, b: Any[] | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A function component's type, through memo(). */
const fnOf = (t: Any): Any => (typeof t === 'function' ? t : t && typeof t === 'object' && typeof t.type === 'function' ? t.type : null);
interface Inst { type: Any; slots: Any[]; kids: Map<string, Inst> }
/** Mount `root` (an element) and keep it: `expand(type, inside)` says which components are rendered (inside: under an
 *  expanded component that asked for its whole subtree, see `deep`). */
function app(root: Any, ctx: Map<Any, Any>, expandIf: (type: Any) => boolean, deep: (type: Any) => boolean = () => false) {
  let dirty = false, effects: (() => void)[] = [];
  const errors: string[] = [];
  const top: Inst = { type: null, slots: [], kids: new Map() };
  const h = { tree: null as Any, errors, settle, unmount: () => drop(top) };
  function drop(inst: Inst) {
    for (const k of inst.kids.values()) drop(k);
    inst.kids.clear();
    for (const s of inst.slots) if (s?.eff && typeof s.cleanup === 'function') s.cleanup();
  }
  function call(inst: Inst, props: Any) {
    let i = 0;
    const eff = (fn: () => Any, deps?: Any[]) => {
      const k = i++, s = inst.slots[k];
      if (s && deps && same(s.deps, deps)) return;
      const prev = s?.cleanup;
      inst.slots[k] = { deps, cleanup: undefined, eff: true };
      effects.push(() => { if (typeof prev === 'function') prev(); inst.slots[k].cleanup = fn(); });
    };
    const D: Any = {
      useReducer(red: Any, arg: Any, init?: Any) {
        const k = i++;
        if (!inst.slots[k]) { const st: Any = { v: init ? init(arg) : arg }; st.set = (a: Any) => { const n = red(st.v, a); if (!Object.is(n, st.v)) { st.v = n; dirty = true; } }; inst.slots[k] = st; }
        return [inst.slots[k].v, inst.slots[k].set];
      },
      useState: (init: Any) => D.useReducer((s: Any, a: Any) => (typeof a === 'function' ? a(s) : a), init, (x: Any) => (typeof x === 'function' ? x() : x)),
      useMemo(fn: () => Any, deps: Any[]) { const k = i++, s = inst.slots[k]; if (s && same(s.deps, deps)) return s.v; inst.slots[k] = { v: fn(), deps }; return inst.slots[k].v; },
      useCallback: (fn: Any, deps: Any[]) => D.useMemo(() => fn, deps),
      useRef(v: Any) { const k = i++; return (inst.slots[k] ??= { current: v }); },
      useEffect: eff, useLayoutEffect: eff, useInsertionEffect: eff,
      useContext: (c: Any) => (ctx.has(c) ? ctx.get(c) : c._currentValue),
      useSyncExternalStore(_sub: Any, get: () => Any) { i++; return get(); },
      useId: () => ':r' + i++ + ':',
      useImperativeHandle() { i++; },
      useDebugValue() {}, useTransition: () => [false, (f: () => void) => f()], useDeferredValue: (v: Any) => v,
    };
    const prev = RI.H;
    RI.H = D;
    try { return fnOf(inst.type)(props); } finally { RI.H = prev; }
  }
  /** Render `inst` and expand its output: the children it keeps re-render, the ones it no longer renders unmount. */
  function renderInst(inst: Inst, props: Any, inside: boolean): Any {
    let out: Any;
    try { out = call(inst, props); } catch (e) { errors.push((fnOf(inst.type)?.name || '?') + ': ' + (e as Error).message); out = null; }
    const seen = new Set<string>();
    const tree = expand(out, inst, '', seen, inside || deep(inst.type));
    for (const [k, kid] of inst.kids) if (!seen.has(k)) { drop(kid); inst.kids.delete(k); }
    return tree;
  }
  function expand(node: Any, parent: Inst, at: string, seen: Set<string>, inside: boolean): Any {
    if (Array.isArray(node)) return node.map((x, j) => expand(x, parent, at + '/' + (isEl(x) && x.key != null ? 'k:' + x.key : 'i:' + j), seen, inside));
    if (!isEl(node)) return node;
    if (fnOf(node.type)) {
      if (!inside && parent !== top && !expandIf(node.type)) return node;
      const id = at + '#' + (node.key != null ? 'k:' + node.key : '');
      seen.add(id);
      let inst = parent.kids.get(id);
      if (inst && inst.type !== node.type) { drop(inst); parent.kids.delete(id); inst = undefined; }
      if (!inst) { inst = { type: node.type, slots: [], kids: new Map() }; parent.kids.set(id, inst); }
      return renderInst(inst, node.props, inside);
    }
    if (node.props?.children === undefined) return node;
    // a host element, a provider or a fragment: its children sit under its own place (a lone child is index 0)
    const kids = node.props.children;
    const ex = Array.isArray(kids) ? expand(kids, parent, at + '>', seen, inside) : expand(kids, parent, at + '>/i:0', seen, inside);
    return { ...node, props: { ...node.props, children: ex } };
  }
  function pass() {
    effects = [];
    dirty = false;
    const seen = new Set<string>();
    h.tree = expand(root, top, '', seen, false);
    const run = effects;
    effects = [];
    for (const e of run) { try { e(); } catch (er) { errors.push('effect: ' + (er as Error).message); } }
  }
  /** Re-render until state stops changing (external stores are re-read each pass), let timers run, and again. */
  async function settle(ms = 5) {
    pass();
    for (let n = 0; dirty && n < 20; n++) pass();
    await wait(ms);
    pass();
    for (let n = 0; dirty && n < 20; n++) pass();
  }
  return h;
}
/** Every element in the tree, with its ancestors; element-valued props are walked too. */
function each(node: Any, fn: (el: Any, up: Any[]) => void, up: Any[] = []) {
  if (Array.isArray(node)) { for (const x of node) each(x, fn, up); return; }
  if (!isEl(node)) return;
  fn(node, up);
  for (const v of Object.values(node.props ?? {})) if (isEl(v) || Array.isArray(v)) each(v, fn, [...up, node]);
}
const textOf = (node: Any): string => (Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : isEl(node) ? textOf(node.props?.children) : '');
const find = (tree: Any, pred: (el: Any) => boolean) => { let hit: Any = null; each(tree, (el) => { if (!hit && pred(el)) hit = el; }); return hit; };
const ev = (more: Any = {}) => ({ preventDefault() {}, stopPropagation() {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...more });
/** The page itself as a key's target: not typing, not a control, not inside a panel that keeps its own keys. */
const pageTarget = { tagName: 'SECTION', isContentEditable: false, closest: () => null, hasAttribute: () => false };

// ------------------------------------------------------------------------------------------------ the sample (Kettle)
const { buildModel } = await impCore('src/model/sample.ts');
const { initialState } = await imp('engine/state.ts');
const { EngineCtx, VariantCtx } = await imp('components/hooks.ts');
const { getVariant } = await imp('variants/registry.ts');
const M = buildModel(1, () => 0, null);
const toasts: Any[] = [];
function engine(over: Any = {}) {
  const S = { ...initialState(1, M.P.asOf), ready: true, page: 'ledger', lv: 'triage', phone: false, ...over };
  return {
    M, S, U: 1, store: { get: () => S, subscribe: () => () => {} }, dirty() {}, onFrame: () => () => {},
    setPage(page: string, lv?: string) { S.page = page; if (lv) S.lv = lv; }, flyToFeature() {}, openFeature() {}, setHl() {}, setTarget() {},
    lensAgg: () => ({ parts: [] }), channel: () => null, toast: (...a: Any[]) => toasts.push(a), refuseReadOnly() {},
  };
}
const ctxOf = (E: Any) => new Map<Any, Any>([[EngineCtx, E], [VariantCtx, getVariant('subtle')]]);

// ================================================================================================ 1. DW-76
{
  const { LedgerPage } = await imp('components/ledger/LedgerPage.tsx');
  const { BriefDrawer } = await imp('components/ledger/BriefDrawer.tsx');
  const { setLedgerUi, EMPTY_UI } = await imp('components/ledger/useLedger.ts');
  const REASON = 'check-ledger-guards: the reason typed for the first finding';
  /** One run from a fresh page: J (focus the first row: A), N, type, then `leave` (Esc, or nothing), J (to B), N. */
  async function run(name: string, escFirst: boolean) {
    setLedgerUi(() => ({ ...EMPTY_UI }));
    const A = app(React.createElement(LedgerPage, { lensButton: null, lensPanel: null }), ctxOf(engine()),
      (t) => fnOf(t)?.name === 'Body' || fnOf(t) === fnOf(BriefDrawer), (t) => fnOf(t) === fnOf(BriefDrawer));
    await A.settle();
    const section = () => find(A.tree, (el) => typeof el.props?.onKeyDown === 'function' && el.props['aria-label'] === 'Findings ledger');
    const drawer = () => find(A.tree, (el) => el.props?.['data-role'] === 'lg-brief');
    const box = () => find(drawer(), (el) => el.type === 'textarea');
    const idOf = () => textOf(find(drawer(), (el) => el.type === 'h4')?.props.children).replace(/^Brief · /, '');
    const key = async (k: string) => { section()?.props.onKeyDown(ev({ key: k, target: pageTarget })); await A.settle(); };
    await key('j');
    const a = idOf();
    expect(A.errors.length === 0 && !!section() && !!drawer() && a.length > 0 && !box(),
      `GUARD ${name}: the page did not render its Backlog with the focused finding's brief and no reason box (${A.errors.join('; ') || (section() ? '' : 'no page section; ') + (drawer() ? 'drawer ' + a : 'no drawer')})`);
    await key('n');
    box()?.props.onChange({ target: { value: REASON } });
    await A.settle();
    expect(!!box() && box().props.value === REASON, `GUARD ${name}: N on ${a} did not open a reason box that shows what is typed (${box() ? JSON.stringify(box().props.value) : 'no box'})`);
    if (escFirst) {
      box()?.props.onKeyDown(ev({ key: 'Escape' }));
      await A.settle();
      expect(!box(), `GUARD ${name}: Esc in the reason box did not close it`);
    }
    await key('j');
    const b = idOf();
    expect(b.length > 0 && b !== a, `GUARD ${name}: J did not move the drawer from ${a} to another finding (${b || 'no drawer'})`);
    await key('n');
    expect(!!box(), `GUARD ${name}: N on ${b} opened no reason box`);
    expect(!!box() && box().props.value === '', `${name}: N on ${b} opens a reason box already holding the reason typed for ${a} (${JSON.stringify(box()?.props.value)}): one Enter declines ${b} for good with it`);
    A.unmount();
  }
  await run('DW-76 N, type, Esc, J, N', true);
  await run('DW-76 N, type, J (no Esc), N', false);
  setLedgerUi(() => ({ ...EMPTY_UI }));
}

// ================================================================================================ 2. DW-75
{
  const { DispatchBar } = await imp('components/ledger/variants/Triage.tsx');
  const { setLedgerUi, useLedger, useLedgerUi, EMPTY_UI } = await imp('components/ledger/useLedger.ts');
  // the backlog's bar over the real useLedger (Kettle's findings), as Body hands it over: <DispatchBar L={L} />
  let L: Any = null;
  function Backlog() { L = useLedger(useLedgerUi('kettle'), setLedgerUi); return React.createElement(DispatchBar, { L }); }
  setLedgerUi(() => ({ ...EMPTY_UI }));
  const A = app(React.createElement(Backlog), ctxOf(engine()), (t) => fnOf(t) === fnOf(DispatchBar));
  await A.settle();
  const live = () => find(find(A.tree, (el) => el.props?.['aria-label'] === 'Dispatch'), (el) => !!el.props?.['aria-live'] && el.props['aria-live'] !== 'off');
  const label = () => textOf(live()?.props.children);
  // two dispatchable findings of two lenses, both rows of the table as it opens
  const x = L?.rows?.find((f: Any) => f.can), y = x && L.rows.find((f: Any) => f.can && f.p.lens !== x.p.lens);
  expect(A.errors.length === 0 && !!x && !!y && !!live(), `GUARD DW-75: the backlog bar did not render over two dispatchable findings of two lenses (${A.errors.join('; ') || (x && y ? 'no aria-live label' : 'no such findings')})`);
  if (x && y) {
    setLedgerUi((u: Any) => ({ ...u, sel: new Set([x.p.id, y.p.id]) }));
    await A.settle();
    expect(/^2 selected/.test(label()) && !/hidden/.test(label()), `GUARD DW-75: with both selected findings shown the live label names no hidden ones (${JSON.stringify(label())})`);
    setLedgerUi((u: Any) => ({ ...u, lens: new Set([x.p.lens]) }));
    await A.settle();
    const shown = L.rows.some((f: Any) => f.p.id === x.p.id) && !L.rows.some((f: Any) => f.p.id === y.p.id);
    expect(shown && L.ui.sel.size === 2, `GUARD DW-75: the lens filter did not keep ${x.p.id} and hide ${y.p.id} with both still selected`);
    expect(/\b1 hidden by filters\b/.test(label()), `DW-75: 2 selected, 1 of them hidden by the lens filter, and the Dispatch bar's live label says nothing of it (${JSON.stringify(label())}): D would build a finding the person cannot see`);
  }
  A.unmount();
  setLedgerUi(() => ({ ...EMPTY_UI }));
}

// ================================================================================================ 3. DW-77
{
  const { ReleaseView } = await imp('components/ledger/train/release/ReleaseView.tsx');
  const { ScanCtxCtx } = await imp('components/hooks.ts');
  const { SAMPLE_ITEMS } = await impCore('src/model/train-sim.ts');
  const KETTLE: Any = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
  /** A fresh Kettle model whose sim holds a release of two accepted items: `landed` puts them on the sample's main (the
   *  path Tag takes), `merged` walks the release to merged (the sim's PR merged). Every job a release action starts is counted. */
  async function release(name: string, opts: { landed: boolean; merged?: boolean }) {
    const Mx = buildModel(1, () => 0, null), sim: Any = Mx.scanSim;
    // seeded as the app's model binding seeds it (scripts/lib/train-planes.ts newSim: Kettle's order, manifests and values)
    sim.bind({ order: KETTLE.features.map((f: Any) => f.slug), manifest: (l: string) => KETTLE.lenses.find((x: Any) => x.id === l)?.manifest, value: (f: string, l: string, k: string) => { const v = KETTLE.facets[f]?.[l]?.values?.[k]; return typeof v === 'number' ? v : undefined; } });
    const snap = sim.snapshot();
    const idOf = (k: string): string => { const it = SAMPLE_ITEMS.find((x: Any) => x.key === k); return snap.proposals.find((p: Any) => p.title === it.title && p.pack_id === it.pack && (it.attemptOf ? !!p.attempt_of : !p.attempt_of))?.id; };
    const two = [idOf('des1-booking'), idOf('des1-waitlist')];
    const started = { build: 0, tag: 0, finish: 0 };
    let relId = '';
    try {
      sim.triage({ ids: two, decision: 'accept' });
      relId = sim.createRelease('0.1.0', two).release.id;
      sim.setTrainToggles({ ghOff: false, conflict: false, gateFails: false, landed: opts.landed });
      if (opts.merged) { sim.train.setRel(relId, { status: 'pr-open', pr_url: 'https://github.com/kettle/kettle/pull/7' }); sim.sampleMerge(relId); }
    } catch (e) { expect(false, `GUARD DW-77 ${name}: the sample release could not be set up (${(e as Error).message})`); return null; }
    for (const k of Object.keys(started) as (keyof typeof started)[]) {
      const orig = sim[k + 'Release'].bind(sim);
      sim[k + 'Release'] = (...a: Any[]) => { started[k]++; return orig(...a); };
    }
    const E = { ...engine(), M: Mx };
    const ctx = ctxOf(E);
    ctx.set(ScanCtxCtx, { slug: null, sim });
    const A = app(React.createElement(ReleaseView, { phone: false }), ctx, (t) => fnOf(t)?.name === 'ActionsRow', (t) => fnOf(t)?.name === 'ActionsRow');
    await A.settle(30);
    await A.settle(30);
    const view = () => find(A.tree, (el) => el.props?.['data-role'] === 'tr-rel');
    const acts = () => find(A.tree, (el) => /\btr-rel-acts\b/.test(String(el.props?.className ?? '')));
    const buttons = () => { const out: Any[] = []; each(acts(), (el) => { if (el.type === 'button') out.push(el); }); return out; };
    const btn = (re: RegExp) => buttons().find((b) => re.test(textOf(b.props.children)));
    const press = async (b: Any) => { if (b && !b.props.disabled) b.props.onClick?.(ev()); await A.settle(30); };
    const key = async (k: string) => { view()?.props.onKeyDown(ev({ key: k, target: { tagName: 'DIV', closest: () => null } })); await A.settle(30); };
    const status = () => sim.snapshot().releases.find((r: Any) => r.id === relId)?.status;
    return { A, sim, started, relId, acts, buttons, btn, press, key, status, text: () => textOf(acts()?.props.children) };
  }
  const named = (text: string, n: number) => /v0\.1\.0/.test(text) && new RegExp('\\b' + n + '\\b[^.]*item').test(text);

  // Tag by its button: the first press asks (naming v0.1.0 and the 2 items), the ask's go button starts exactly one tag job
  {
    const R = await release('Tag (button)', { landed: true });
    if (R) {
      const tag = R.btn(/^Tag v0\.1\.0/);
      expect(R.A.errors.length === 0 && R.status() === 'draft' && !!tag && !R.btn(/^Build/), `GUARD DW-77 Tag (button): a landed draft does not offer Tag v0.1.0 (and no Build) (${R.A.errors.join('; ') || R.status() + ': ' + R.buttons().map((b: Any) => textOf(b.props.children)).join(' | ')})`);
      await R.press(tag);
      expect(R.started.tag === 0, `DW-77 Tag (button): one press of Tag started ${R.started.tag} tag job(s) on v0.1.0 at once, with no question asked`);
      const ask = R.text();
      expect(R.started.tag === 0 && named(ask, 2) && R.buttons().length >= 2, `DW-77 Tag (button): after one press no inline confirm names v0.1.0 and its 2 items (${JSON.stringify(ask)})`);
      const first = R.started.tag;
      if (first === 0) await R.press(R.buttons()[0]);
      expect(first === 0 && R.started.tag === 1, `DW-77 Tag (button): confirming the ask did not start exactly one tag job (${R.started.tag})`);
      R.A.unmount();
    }
  }
  // Tag by its key: a stray T starts nothing and asks; a second T confirms, one tag job
  {
    const R = await release('Tag (T key)', { landed: true });
    if (R) {
      await R.key('t');
      expect(R.started.tag === 0, `DW-77 Tag (T key): one T started ${R.started.tag} tag job(s) on v0.1.0 at once, with no question asked`);
      expect(R.started.tag === 0 && named(R.text(), 2), `DW-77 Tag (T key): after one T no inline confirm names v0.1.0 and its 2 items (${JSON.stringify(R.text())})`);
      const first = R.started.tag;
      if (first === 0) await R.key('t');
      expect(first === 0 && R.started.tag === 1, `DW-77 Tag (T key): T, then T again on the confirm, did not start exactly one tag job (${R.started.tag})`);
      R.A.unmount();
    }
  }
  // Finish from merged (the state table offers it outright): the first press asks too, the second finishes once
  {
    const R = await release('Finish (merged)', { landed: false, merged: true });
    if (R) {
      const fin = R.btn(/^Finish/);
      expect(R.A.errors.length === 0 && R.status() === 'merged' && !!fin, `GUARD DW-77 Finish (merged): a merged release does not offer Finish (${R.A.errors.join('; ') || R.status() + ': ' + R.buttons().map((b: Any) => textOf(b.props.children)).join(' | ')})`);
      await R.press(fin);
      expect(R.started.finish === 0, `DW-77 Finish (merged): one press of Finish started ${R.started.finish} finish job(s) on v0.1.0 at once, with no question asked`);
      expect(R.started.finish === 0 && named(R.text(), 2), `DW-77 Finish (merged): after one press no inline confirm names v0.1.0 and its 2 items (${JSON.stringify(R.text())})`);
      const first = R.started.finish;
      if (first === 0) await R.press(R.buttons()[0]);
      expect(first === 0 && R.started.finish === 1, `DW-77 Finish (merged): confirming the ask did not start exactly one finish job (${R.started.finish})`);
      R.A.unmount();
    }
  }
  // GUARD Build on a draft that did not land: one press starts one build (no ask)
  {
    const R = await release('Build', { landed: false });
    if (R) {
      const build = R.btn(/^Build release v0\.1\.0/);
      expect(R.A.errors.length === 0 && !!build && !build.props.disabled && !R.btn(/^Tag/), `GUARD DW-77 Build: a draft that has not landed does not offer an enabled Build release v0.1.0 (and no Tag) (${R.A.errors.join('; ') || R.buttons().map((b: Any) => textOf(b.props.children) + (b.props.disabled ? ' (disabled)' : '')).join(' | ')})`);
      await R.press(build);
      expect(R.started.build === 1 && R.started.tag === 0, `GUARD DW-77 Build: one press of Build started ${R.started.build} build job(s), expected 1`);
      R.A.unmount();
    }
  }
}

// ================================================================================================ 4. DW-73
{
  const { LedgerPage } = await imp('components/ledger/LedgerPage.tsx');
  const { DecisionBar } = await imp('components/ledger/train/DecisionBar.tsx');
  const { Btn } = await imp('components/ledger/train/ui/Controls.tsx');
  const { setLedgerUi, EMPTY_UI } = await imp('components/ledger/useLedger.ts');
  /** The In packs page as the phone (Phone.tsx: `<LedgerPage phone />`) or the desktop hosts it, its decision bar
   *  rendered with the handler Body gives it; Release -> pressed, and whatever it does recorded. */
  async function bar(phone: boolean) {
    const E: Any = engine({ phone }), pages: string[] = [];
    const setPage = E.setPage;
    E.setPage = (p: string, lv?: string) => { pages.push(p + (lv ? '/' + lv : '')); setPage(p, lv); };
    setLedgerUi(() => ({ ...EMPTY_UI, scope: 'packs', status: new Set() }));
    const A = app(React.createElement(LedgerPage, { lensButton: null, lensPanel: null, phone }), ctxOf(E),
      (t) => fnOf(t)?.name === 'Body' || fnOf(t) === fnOf(DecisionBar));
    await A.settle(20);
    const region = () => find(A.tree, (el) => el.props?.['data-role'] === 'tr-bar');
    const release = find(region(), (el) => fnOf(el.type) === fnOf(Btn) && /→\s*$/.test(textOf(el.props.children)));
    const hasBar = !!region(), before = textOf(A.tree), toasts0 = toasts.length;
    if (release) { release.props.onClick?.(ev()); await A.settle(20); }
    const did = pages.length > 0 || toasts.length > toasts0 || textOf(A.tree) !== before;
    const out = { errors: A.errors.slice(), hasBar, release: !!release, did, pages: pages.slice() };
    A.unmount();
    setLedgerUi(() => ({ ...EMPTY_UI }));
    return out;
  }
  const desk = await bar(false);
  expect(desk.errors.length === 0 && desk.hasBar && desk.release && desk.pages.includes('ledger/release'),
    `GUARD DW-73 desktop: the decision bar's Release -> is gone or does not open the Release tab (${desk.errors.join('; ') || JSON.stringify(desk)})`);
  const ph = await bar(true);
  expect(ph.errors.length === 0 && ph.hasBar, `GUARD DW-73 phone: the phone ledger rendered no decision bar (${ph.errors.join('; ') || 'no tr-bar'})`);
  expect(!ph.release || ph.did, `DW-73 phone: the decision bar shows a Release -> button and a tap on it does nothing (no page, no toast, no words change)`);
}

if (failures.length) { console.error(`check-ledger-guards: ${failures.length} failed (${held} held)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`check-ledger-guards: ${held} expectations held`);
process.exit(0);
