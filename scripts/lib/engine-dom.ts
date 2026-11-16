// The smallest browser an Engine (apps/web/src/engine/Engine.ts) can be constructed and driven against in Node, for
// checks that execute the engine (check-trouble-index, check-trouble-route). A canvas whose 2d context draws nothing,
// a document / window pair of event targets (keydown is really dispatched through Engine.bind), matchMedia, a fake
// clock (timers, performance.now, requestAnimationFrame), location and history. scripts/check-engine-harness.ts keeps
// its own, richer copy (it records draw calls and history writes).
//
// Use: call installEngineDom() BEFORE importing Engine.ts (the engine reads window / document at module scope in places),
// with the src loader registered (scripts/overlays-loader.mjs).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface EngineDom {
  /** Move the fake clock, firing due timers in order. */
  advance(ms: number): void;
  /** Advance by `ms`, then run the frames the engine asked for (once). */
  flush(ms?: number): void;
  /** Run frames until the engine stops asking (or `max` rounds), `ms` apart. */
  settle(ms?: number, max?: number): void;
  /** A keydown through the document listener Engine.bind() registered; true when the engine prevented its default. */
  key(k: string, o?: { shift?: boolean }): boolean;
  canvas: Any; ui: Any; root: Any; doc: Any; win: Any;
  now(): number;
}

export function installEngineDom(w = 1280, h = 800): EngineDom {
  let clock = 1000, timerId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let rafQ: ((t: number) => void)[] = [];
  const setT = (fn: () => void, ms = 0) => { const id = ++timerId; timers.set(id, { at: clock + ms, fn }); return id; };
  const clearT = (id: number) => { timers.delete(id); };
  function advance(ms: number) {
    const end = clock + ms;
    for (;;) {
      let nx: [number, { at: number; fn: () => void }] | null = null;
      for (const e of timers) if (e[1].at <= end && (!nx || e[1].at < nx[1].at)) nx = e;
      if (!nx) break;
      timers.delete(nx[0]); clock = Math.max(clock, nx[1].at); nx[1].fn();
    }
    clock = end;
  }
  const grad = () => ({ addColorStop() {} });
  const ctx2d: Any = new Proxy({}, {
    get(t: Any, k: string) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s: string) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return grad;
      if (k === 'createPattern') return () => ({ setTransform() {} });
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return () => {};
    },
    set(t: Any, k: string, v: unknown) { t[k] = v; return true; },
  });
  class El {
    tagName: string; width = 300; height = 150; style: Any; dataset: Any = {}; children: El[] = [];
    private L = new Map<string, Set<(e: Any) => void>>();
    isContentEditable = false; parent: El | null = null;
    constructor(tag: string) {
      this.tagName = tag.toUpperCase();
      const props = new Map<string, string>();
      this.style = new Proxy({ setProperty: (n: string, v: string) => props.set(n, v), getPropertyValue: (n: string) => props.get(n) ?? '' }, { get: (t: Any, k: string) => t[k], set: (t: Any, k: string, v: unknown) => { t[k] = v; return true; } });
    }
    getContext() { return ctx2d; }
    addEventListener(ev: string, fn: (e: Any) => void) { if (!this.L.has(ev)) this.L.set(ev, new Set()); this.L.get(ev)!.add(fn); }
    removeEventListener(ev: string, fn: (e: Any) => void) { this.L.get(ev)?.delete(fn); }
    dispatch(ev: string, e: Any) { for (const f of [...(this.L.get(ev) ?? [])]) f(e); }
    getBoundingClientRect() { return { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight }; }
    setPointerCapture() {}
    closest() { return null; }
    focus() {}
  }
  const root = new El('div'), ui = new El('div'), canvas = new El('canvas'), docEl = new El('html');
  const loc: Any = { pathname: '/', search: '', hash: '' };
  const setHash = (url: string) => { loc.hash = url.slice(url.indexOf('#') >= 0 ? url.indexOf('#') : url.length); };
  const history = { state: null, pushState(_s: unknown, _t: string, url: string) { setHash(url); }, replaceState(_s: unknown, _t: string, url: string) { setHash(url); } };
  const mq = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const TOKENS: Record<string, string> = { '--paper': '#071a33', '--ink': '#dff0ff', '--mint': '#6ff2c8', '--amber': '#ffc35a', '--red': '#ff6a58' };
  const doc: Any = Object.assign(new El('document'), { createElement: (t: string) => new El(t), documentElement: docEl, fonts: { ready: new Promise(() => {}) } });
  const win: Any = Object.assign(new El('window'), { location: loc, innerWidth: w, innerHeight: h, devicePixelRatio: 1, setTimeout: setT, clearTimeout: clearT, setInterval: (fn: () => void) => setT(fn, 1e9), clearInterval: clearT });
  const g = globalThis as Any;
  const def = (k: string, v: unknown) => Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  def('window', win); def('document', doc); def('location', loc); def('history', history); def('matchMedia', mq);
  def('setTimeout', setT); def('clearTimeout', clearT); def('setInterval', (fn: () => void) => setT(fn, 1e9)); def('clearInterval', clearT);
  def('requestAnimationFrame', (fn: (t: number) => void) => { rafQ.push(fn); return rafQ.length; });
  def('cancelAnimationFrame', () => { rafQ = []; });
  def('getComputedStyle', () => ({ getPropertyValue: (n: string) => TOKENS[n] ?? '' }));
  def('MutationObserver', class { observe() {} disconnect() {} });
  def('Image', class { onload: (() => void) | null = null; set src(_v: string) {} });
  def('performance', { now: () => clock });
  def('DOMMatrix', class { m: number[]; constructor(m: number[] = []) { this.m = m; } });
  def('Path2D', class { constructor() { return new Proxy(this, { get: (t: Any, k: string) => (k in t ? t[k] : () => {}) }); } });

  function flush(ms = 20) { advance(ms); const q = rafQ; rafQ = []; for (const f of q) f(clock); }
  function settle(ms = 20, max = 400) { for (let i = 0; i < max && rafQ.length; i++) flush(ms); }
  function key(k: string, o: { shift?: boolean } = {}) {
    let prevented = false;
    doc.dispatch('keydown', { key: k, shiftKey: !!o.shift, target: doc, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, preventDefault() { prevented = true; } });
    return prevented;
  }
  return { advance, flush, settle, key, canvas, ui, root, doc, win, now: () => clock };
}
