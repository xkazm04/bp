// The Orders panel's writes, driven (apps/web/src/components/rail/wide/rules.tsx): Set (the writer), Lift / Revoke and
// "Set it again" (a rule's detail) each start one write (setRule / revokeRule in lib/rules/client.ts, a fetch with the human
// token). check-rules.ts holds the doors end to end; this holds what the panel does while a write is out:
//   in flight   the button that started the write is disabled and its label says it is busy; a second tap (only when the
//               button still takes taps) starts no second write
//   refused     the error is announced (role="alert" or aria-live, on it or a container) beside the action bar, not in the
//               scroll area above it, and a retry clears it while the retried write is out
//   two-tap     a grant the replay flags still arms on the first tap (no write) and sets on the second (one write) - GUARD
// No DOM rig exists in this tree and renderToString keeps no state, so the components are driven by a shallow hooks rig: the
// real component function is called with a stand-in React dispatcher (state, memo, refs, effects, context, external stores)
// and its returned element tree is read and clicked through its own onClick props. Child components are not rendered: every
// control asserted here is a host element in the panel's own tree. fetch is stubbed: a preview answers at once (a clean
// backtest, or a stop-ship flag for a grant), a write is held open until the check settles it.
// Writer and RuleDetail are not exported; they are taken from LiveRules' own tree (its `detail` element), so no seam is cut.
// Run: node scripts/check-rules-panel.ts   (scripts/overlays-loader.mjs transpiles src/**/*.tsx). Exit 1 on any miss.
// Control: BP_RULES_PANEL_MUTATE='[["rules.tsx","find","replace"]]' rewrites source text as it loads, as check-overlays does.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_RULES_PANEL_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const req = createRequire(path.join(ROOT, 'package.json'));
const React: Any = req('react');
const RI: Any = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

// ------------------------------------------------------------------------------------------------ fetch, stubbed
const SLUG = 'p';
const AT = '2026-11-01T10:00:00.000Z';
const everything = { kind: 'all', label: 'Everything', features: [] };
const liveOrder = { id: 'O-1', kind: 'hold', text: 'No builds or scans start here', by: 'user:check', at: AT, scope: everything };
const endedOrder = { id: 'O-2', kind: 'hold', text: 'No builds or scans start here', by: 'user:check', at: AT, scope: everything, revokedAt: '2026-11-02T10:00:00.000Z', revokedBy: 'user:check' };
const backtest = (flags: Any[]) => ({ decided: 4, matched: 4, differed: 0, abstained: 0, synthetic: 0, rows: [], flags });
const writes: { method: string; url: string; body: Any; settle: (status: number, body: Any) => void }[] = [];
const json = (status: number, body: Any) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
(globalThis as Any).fetch = async (url: string, init: Any = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  if (url === '/api/companion/human-token') return json(200, { token: 'check-token' });
  if (url.startsWith('/api/products/' + SLUG + '/rules')) {
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === 'GET') return json(200, { rules: [liveOrder, endedOrder], record: { decided: 4, synthetic: 0 } });
    if (method === 'POST' && body?.preview) return json(200, { backtest: backtest(body.kind === 'grant' ? [{ key: 'stop-ship', text: 'it would approve a stop-ship' }] : []), now: { items: 0, features: 0, rows: [] } });
    return new Promise((resolve) => { writes.push({ method, url, body, settle: (s, b) => resolve(json(s, b)) }); });
  }
  return json(404, { error: 'check-rules-panel: unstubbed ' + method + ' ' + url });
};
const settleWrites = (status: number, body: Any) => { for (const w of writes.splice(0)) w.settle(status, body); };
// every write ever started (writes[] holds only the open ones)
const allWrites: { method: string }[] = [];
const origPush = writes.push.bind(writes);
writes.push = (...xs: Any[]) => { allWrites.push(...xs); return origPush(...xs); };
const nWrites = (method: string) => allWrites.filter((w) => w.method === method).length;

// ------------------------------------------------------------------------------------------------ the shallow hooks rig
const isEl = (x: Any) => !!x && typeof x === 'object' && '$$typeof' in x && 'props' in x;
const same = (a: Any[] | undefined, b: Any[] | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function mount(type: Any, props: Any, ctx: Map<Any, Any>) {
  const slots: Any[] = [];
  const effErrors: string[] = [];
  let dirty = true;
  const h = { tree: null as Any, threw: null as string | null, effErrors, render, settle, unmount };
  function render() {
    let i = 0;
    const effects: (() => void)[] = [];
    const eff = (fn: () => Any, deps?: Any[]) => {
      const k = i++, s = slots[k];
      if (s && deps && same(s.deps, deps)) return;
      const prev = s?.cleanup;
      slots[k] = { deps, cleanup: undefined, eff: true };
      effects.push(() => { if (typeof prev === 'function') prev(); slots[k].cleanup = fn(); });
    };
    const D: Any = {
      useReducer(red: Any, arg: Any, init?: Any) {
        const k = i++;
        if (!slots[k]) { const st: Any = { v: init ? init(arg) : arg }; st.set = (a: Any) => { const n = red(st.v, a); if (!Object.is(n, st.v)) { st.v = n; dirty = true; } }; slots[k] = st; }
        return [slots[k].v, slots[k].set];
      },
      useState: (init: Any) => D.useReducer((s: Any, a: Any) => (typeof a === 'function' ? a(s) : a), init, (x: Any) => (typeof x === 'function' ? x() : x)),
      useMemo(fn: () => Any, deps: Any[]) { const k = i++, s = slots[k]; if (s && same(s.deps, deps)) return s.v; slots[k] = { v: fn(), deps }; return slots[k].v; },
      useCallback: (fn: Any, deps: Any[]) => D.useMemo(() => fn, deps),
      useRef(v: Any) { const k = i++; return (slots[k] ??= { current: v }); },
      useEffect: eff, useLayoutEffect: eff, useInsertionEffect: eff,
      useContext: (c: Any) => (ctx.has(c) ? ctx.get(c) : c._currentValue),
      useSyncExternalStore(_sub: Any, get: () => Any) { i++; return get(); },
      useId: () => ':r' + i++ + ':',
      useDebugValue() {}, useTransition: () => [false, (f: () => void) => f()], useDeferredValue: (v: Any) => v,
    };
    const prev = RI.H;
    RI.H = D;
    try { h.tree = type(props); h.threw = null; } catch (e) { h.threw = (e as Error).message; } finally { RI.H = prev; }
    dirty = false;
    for (const e of effects) { try { e(); } catch (er) { effErrors.push((er as Error).message); } }
  }
  /** Flush what a tap set (so its effects start their timers), let timers and promises run for `ms`, then re-render until
   *  state stops changing (external stores are re-read each time). */
  async function settle(ms = 10) {
    for (let n = 0; dirty && n < 20; n++) render();
    await wait(ms);
    render();
    for (let n = 0; dirty && n < 20; n++) render();
  }
  function unmount() { for (const s of slots) if (s?.eff && typeof s.cleanup === 'function') s.cleanup(); }
  render();
  for (let n = 0; dirty && n < 20; n++) render();
  return h;
}
/** Every element in the tree, with its ancestors; element-valued props (a Workbench's `detail`) are walked too. */
function each(node: Any, fn: (el: Any, up: Any[]) => void, up: Any[] = []) {
  if (Array.isArray(node)) { for (const x of node) each(x, fn, up); return; }
  if (!isEl(node)) return;
  fn(node, up);
  for (const v of Object.values(node.props ?? {})) if (isEl(v) || Array.isArray(v)) each(v, fn, [...up, node]);
}
const textOf = (node: Any): string => (Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : isEl(node) ? textOf(node.props?.children) : '');
const find = (tree: Any, pred: (el: Any) => boolean) => { let hit: Any = null; each(tree, (el) => { if (!hit && pred(el)) hit = el; }); return hit; };
const cls = (el: Any) => String(el?.props?.className ?? '');
const isBtn = (el: Any) => el.type === 'button';
/** The action bar's last button: the one that writes (its label changes, so it is found by place, not by words). */
const actBtn = (tree: Any) => { let b: Any = null; each(tree, (el, up) => { if (isBtn(el) && up.some((u) => /\bwb-act\b/.test(cls(u)))) b = el; }); return b; };
const btnByText = (tree: Any, re: RegExp) => find(tree, (el) => isBtn(el) && re.test(textOf(el.props.children)));
const tap = (b: Any) => { if (b && !b.props.disabled) b.props.onClick?.({ preventDefault() {}, stopPropagation() {} }); };
/** Where the error is: its own element and its ancestors, so "announced" and "beside the action bar" can be read. */
function errAt(tree: Any, msg: string) {
  let at: Any = null;
  each(tree, (el, up) => { if (!at && typeof el.type === 'string' && textOf(el.props.children).includes(msg) && !find(el.props.children, (c) => typeof c.type === 'string' && textOf(c.props.children).includes(msg))) at = { el, up }; });
  if (!at) return null;
  const chain = [...at.up, at.el];
  return {
    announced: chain.some((e: Any) => e.props?.role === 'alert' || (e.props?.['aria-live'] && e.props['aria-live'] !== 'off')),
    inScroll: chain.some((e: Any) => /\bwb-scroll\b/.test(cls(e))),
  };
}

// ------------------------------------------------------------------------------------------------ the panel
const { buildModel } = await impCore('src/model/sample.ts');
const { initialState } = await imp('engine/state.ts');
const { EngineCtx } = await imp('components/hooks.ts');
const { LiveRules } = await imp('components/rail/wide/rules.tsx');
const M = buildModel(1, () => 0, null);
const S = { ...initialState(1, M.P.asOf), ready: true };
const toasts: Any[] = [];
const E = {
  M, S, linkedRule: null, store: { get: () => S, subscribe: () => () => {} },
  setOrdHi() {}, setTarget() {}, lookAtTarget() {}, flyToFeature() {}, setHl() {}, toast: (...a: Any[]) => toasts.push(a),
};
const ctx = new Map<Any, Any>([[EngineCtx, E]]);
const ERR = 'check-rules-panel: the server refused this write';

const panel = mount(LiveRules, { slug: SLUG }, ctx);
const writerEl = find(panel.tree, (el) => typeof el.type === 'function' && el.type.name === 'Writer');
await panel.settle(30);
const detailEl = find(panel.tree, (el) => typeof el.type === 'function' && el.type.name === 'RuleDetail');
expect(panel.threw === null && !!writerEl && !!detailEl && detailEl.props.r?.id === liveOrder.id,
  `GUARD LiveRules did not hand the writer (empty list) and then O-1's detail (rules read) to its Workbench (${panel.threw ?? (writerEl ? 'Writer' : 'no Writer') + ', ' + (detailEl ? 'RuleDetail ' + detailEl.props.r?.id : 'no RuleDetail')})`);
panel.unmount();

/** One write button, driven: idle -> tap -> in flight (disabled, busy label, a second tap writes nothing) -> refused (the error
 *  announced beside the bar) -> retry (the error cleared while the retry is out). */
async function drive(name: string, h: Any, method: string) {
  await h.settle(10);
  const idle = actBtn(h.tree), idleText = textOf(idle?.props.children);
  expect(h.threw === null && !!idle && !idle.props.disabled, `GUARD ${name}: the button is not there and enabled before the tap (${h.threw ?? (idle ? 'disabled' : 'no button')}; effects: ${h.effErrors.join('; ') || 'ok'})`);
  if (!idle || idle.props.disabled) return;
  const before = nWrites(method);
  tap(idle);
  await h.settle(15);
  expect(nWrites(method) === before + 1, `GUARD ${name}: one tap started ${nWrites(method) - before} ${method} writes, expected 1`);
  const busy = actBtn(h.tree), busyText = textOf(busy?.props.children);
  expect(!!busy && busy.props.disabled === true, `${name}: the button stays enabled while its ${method} is in flight (a double tap writes twice)`);
  expect(!!busy && busyText !== idleText && busyText.length > 0, `${name}: the label does not change while its ${method} is in flight (still ${JSON.stringify(busyText)})`);
  tap(busy);
  await h.settle(15);
  expect(nWrites(method) === before + 1, `${name}: a second tap while the first ${method} is in flight started ${nWrites(method) - before - 1} more write(s)`);
  settleWrites(409, { error: ERR });
  await h.settle(15);
  const at = errAt(h.tree, ERR);
  expect(!!at, `GUARD ${name}: a refused write shows no error`);
  if (at) {
    expect(at.announced, `${name}: the error is not announced (no role="alert" or aria-live on it or its container)`);
    expect(!at.inScroll, `${name}: the error sits in the scroll area (.wb-scroll), not beside the action bar`);
  }
  const again = actBtn(h.tree);
  expect(!!again && !again.props.disabled, `GUARD ${name}: after a refusal the button does not take a retry`);
  tap(again);
  await h.settle(15);
  expect(nWrites(method) === before + 2 || nWrites(method) === before + 3, `GUARD ${name}: the retry started no write`);
  expect(!errAt(h.tree, ERR), `${name}: the old error is still shown while the retry is out (it is never cleared)`);
  settleWrites(409, { error: ERR });
  await h.settle(15);
  h.unmount();
}

if (writerEl && detailEl) {
  // the writer: Everything, Hold, the replay answers, Set
  {
    const w = mount(writerEl.type, { ...writerEl.props, all: [liveOrder, endedOrder] }, ctx);
    tap(btnByText(w.tree, /^Everything$/)); await w.settle(5);
    tap(btnByText(w.tree, /^Hold/)); await w.settle(400);
    await drive('Set (the writer)', w, 'POST');
  }
  // a live order's detail: Lift
  await drive('Lift O-1 (a live rule)', mount(detailEl.type, { ...detailEl.props, r: liveOrder }, ctx), 'DELETE');
  // an ended order's detail: Set it again (enabled once its replay answers)
  {
    const d = mount(detailEl.type, { ...detailEl.props, r: endedOrder }, ctx);
    await d.settle(400);
    await drive('Set it again (an ended rule)', d, 'POST');
  }
  // GUARD the risky grant's two taps: the first arms and writes nothing, the second sets
  {
    const g = mount(writerEl.type, { ...writerEl.props, all: [liveOrder, endedOrder] }, ctx);
    tap(btnByText(g.tree, /^Everything$/)); await g.settle(5);
    tap(btnByText(g.tree, /^Let agents decide/)); await g.settle(400);
    const before = nWrites('POST'), first = actBtn(g.tree);
    expect(!!first && !first.props.disabled && /^Grant /.test(textOf(first.props.children)), `GUARD two-tap: the flagged grant's button is not "Grant ..." and enabled (${first ? JSON.stringify(textOf(first.props.children)) + (first.props.disabled ? ', disabled' : '') : 'none'})`);
    tap(first); await g.settle(15);
    const armed = actBtn(g.tree);
    expect(nWrites('POST') === before && /Tap again/.test(textOf(armed?.props.children)), `GUARD two-tap: the first tap on a flagged grant wrote ${nWrites('POST') - before} rule(s) or did not arm (${JSON.stringify(textOf(armed?.props.children))})`);
    tap(armed); await g.settle(15);
    expect(nWrites('POST') === before + 1, `GUARD two-tap: the second tap on an armed grant started ${nWrites('POST') - before} writes, expected 1`);
    settleWrites(409, { error: ERR });
    await g.settle(15);
    g.unmount();
  }
}

if (failures.length) { console.error(`check-rules-panel: ${failures.length} failed (${held} held)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`check-rules-panel: ${held} expectations held`);
process.exit(0);
