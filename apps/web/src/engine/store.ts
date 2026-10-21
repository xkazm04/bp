// A tiny external store for the *discrete* UI state. React reads it through useSyncExternalStore with
// selectors (see src/components/hooks.ts), so a change to one slice re-renders only the components
// that select it. The camera, the clock, hover position and the lens tween never go through here.
export type Listener = () => void;

export interface Store<S> {
  get(): S;
  set(patch: Partial<S> | ((s: S) => Partial<S>)): void;
  subscribe(fn: Listener): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const subs = new Set<Listener>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k in p) if (!Object.is((p as S)[k], state[k])) { changed = true; break; }
      if (!changed) return;
      state = { ...state, ...p };
      // Notify a SNAPSHOT, and only the listeners still subscribed when their turn comes. React subscribes
      // and unsubscribes inside effects, which can be flushed while this loop runs, so iterating the live set
      // calls a listener added during the notification (for a change it never subscribed to) while a snapshot
      // alone would call one that has just unsubscribed (a component unmounted by this very change). Both
      // halves are needed; scripts/check-engine-store.ts holds them.
      for (const fn of [...subs]) if (subs.has(fn)) fn();
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
