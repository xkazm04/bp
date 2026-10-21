// Pins src/engine/store.ts, the external store every React selector in the app reads through
// useSyncExternalStore (src/components/hooks.ts). It is 27 lines and no gate executed one of them before this
// file, although a mistake in it mis-renders every panel at once.
//
// The subscriber contract, which React's own subscribe/unsubscribe-inside-an-effect timing makes load-bearing:
//   - a change to no key notifies nobody (Object.is per key of the patch, so the store never re-renders on a
//     set that changes nothing);
//   - a listener added DURING a notification is not called by it (it did not subscribe to this change);
//   - a listener removed DURING a notification is not called by it (its component is unmounting);
//   - a functional patch sees the state as of its own call.
// The first two pull in opposite directions - iterating the live set breaks one, a plain snapshot breaks the
// other - so both arms are asserted, and a fix for one that regresses the other is red here.
// Run: node scripts/check-engine-store.ts   (Node's type stripping; store.ts imports nothing)
// Control: BP_ENGINE_STORE_SEED=live replays the old live-set loop; =snapshot replays a plain snapshot.
import { createStore, type Store } from '../apps/web/src/engine/store.ts';

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string, got?: string) => { if (ok) held++; else failures.push(what + (got === undefined ? '' : ` (got ${got})`)); };
const SEED = process.env.BP_ENGINE_STORE_SEED ?? '';

/** The two shapes this check exists to forbid, so each assertion can be seen red on the real contract. */
function seeded<S extends object>(initial: S): Store<S> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = (typeof patch === 'function' ? patch(state) : patch) as Partial<S>;
      let changed = false;
      for (const k in p) if (!Object.is((p as S)[k as keyof S], state[k as keyof S])) { changed = true; break; }
      if (!changed) return;
      state = { ...state, ...p };
      if (SEED === 'live') { for (const fn of subs) fn(); } else { for (const fn of [...subs]) fn(); }
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
const make = SEED ? seeded : createStore;

// ------------------------------------------------------------------ a set that changes nothing notifies nobody
{
  const s = make({ a: 1, b: 'x' as string | null });
  let n = 0;
  s.subscribe(() => { n++; });
  s.set({ a: 1 });
  s.set({ a: 1, b: 'x' });
  s.set({});
  expect(n === 0, 'a patch that changes no value still notified the subscribers', String(n));
  s.set({ b: null });
  expect(n === 1 && s.get().b === null, 'a patch that does change a value did not notify once', `${n} notifications, b = ${String(s.get().b)}`);
  // a fresh object of equal shape is a change: Object.is, not deep equality (setTarget relies on this)
  const t = { ids: {}, n: 0 };
  const s2 = make({ tgt: t });
  let m = 0;
  s2.subscribe(() => { m++; });
  s2.set({ tgt: t });
  expect(m === 0, 'the same object re-set notified', String(m));
  s2.set({ tgt: { ids: {}, n: 0 } });
  expect(m === 1, 'an equal-but-new object did not notify (identity is the rule)', String(m));
}

// ------------------------------------------- a listener added during a notification is not called by it
{
  const s = make({ a: 0 });
  const order: string[] = [];
  let added = false;
  s.subscribe(() => { order.push('first'); if (!added) { added = true; s.subscribe(() => order.push('added')); } });
  s.subscribe(() => order.push('second'));
  s.set({ a: 1 });
  expect(order.join(',') === 'first,second', 'a listener subscribed during a notification was called by that same notification', order.join(','));
  s.set({ a: 2 });
  expect(order.join(',') === 'first,second,first,second,added', 'the late listener is not called on the NEXT change either', order.join(','));
}

// --------------------------------------- a listener removed during a notification is not called by it
{
  const s = make({ a: 0 });
  const order: string[] = [];
  let off: (() => void) | null = null;
  s.subscribe(() => { order.push('unmounter'); off?.(); });
  off = s.subscribe(() => order.push('unmounted'));
  s.subscribe(() => order.push('after'));
  s.set({ a: 1 });
  expect(order.join(',') === 'unmounter,after', 'a listener unsubscribed during a notification was still called by it', order.join(','));
}

// ------------------------------------------------------------------ a functional patch sees the current state
{
  const s = make({ n: 5 });
  s.set((st) => ({ n: st.n + 1 }));
  s.set((st) => ({ n: st.n * 2 }));
  expect(s.get().n === 12, 'a functional patch did not see the state as of its own call', String(s.get().n));
  let calls = 0;
  s.subscribe(() => { calls++; });
  s.set((st) => ({ n: st.n }));
  expect(calls === 0, 'a functional patch that returns the same value notified', String(calls));
}

// ------------------------------------------------------------------ unsubscribe is idempotent and scoped
{
  const s = make({ a: 0 });
  let n = 0;
  const off = s.subscribe(() => { n++; });
  s.subscribe(() => { n += 10; });
  off(); off();
  s.set({ a: 1 });
  expect(n === 10, 'unsubscribe removed the wrong listener, or calling it twice removed another', String(n));
}

if (failures.length) { console.log(failures.map((f) => 'FAIL ' + f).join('\n')); console.log(`check-engine-store: ${failures.length} failed, ${held} held${SEED ? ` [seeded: ${SEED}]` : ''}`); process.exit(1); }
console.log(`check-engine-store: ${held} expectations held${SEED ? ` [seeded: ${SEED}]` : ''}`);
