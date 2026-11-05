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

if (failures.length) { console.error(`check-ledger-guards: ${failures.length} failed (${held} held)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`check-ledger-guards: ${held} expectations held`);
process.exit(0);
