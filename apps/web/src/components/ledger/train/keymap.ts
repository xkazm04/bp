// The release train's keys, by scope: one table that the key handler, the footer hints and the `?` sheet all read, so
// a key shown is a key bound. Each scope is the ledger tab or panel that owns the focus; `compare` adds its bindings
// on top of the scope it was opened from (packs or backlog) while the panel holds the focus, so its keys must not
// collide with either. Keys are KeyboardEvent.key values (letters lowercase, ' ' is Space), compared
// case-insensitively. Data only and value-free (no value imports): scripts/check-train-quality.mjs imports it through
// Node's type stripping and fails on a key bound twice in one scope.

/** Where the focus is: the packs (triage) table, the backlog table, the compare panel, or the Release tab. */
export type KeyScope = 'packs' | 'backlog' | 'compare' | 'release';

/** What a key does; the scope's handler maps each action onto its own call. */
export type KeyAction =
  | 'next' | 'prev' | 'select' | 'open'
  | 'accept' | 'rework' | 'descope' | 'undo'
  | 'dispatch' | 'dispatchFocused'
  | 'filter' | 'view1' | 'view2' | 'view3'
  | 'theme' | 'mode' | 'wide'
  | 'build' | 'finish'
  | 'help' | 'escape';

/** One action and the keys that trigger it; `label` is the words the footer and the `?` sheet show. */
export interface KeyBinding { keys: readonly string[]; action: KeyAction; label: string }

const move: readonly KeyBinding[] = [
  { keys: ['j', 'ArrowDown'], action: 'next', label: 'next item' },
  { keys: ['k', 'ArrowUp'], action: 'prev', label: 'previous item' },
  { keys: ['x', ' '], action: 'select', label: 'select' },
];
const views: readonly KeyBinding[] = [
  { keys: ['1'], action: 'view1', label: 'triage table' },
  { keys: ['2'], action: 'view2', label: 'feature × lens matrix' },
  { keys: ['3'], action: 'view3', label: 'release' },
];
const help: KeyBinding = { keys: ['?'], action: 'help', label: 'keys' };
const filter: KeyBinding = { keys: ['/'], action: 'filter', label: 'filter' };

/** Every scope's bindings, in the order the `?` sheet lists them. */
export const KEYMAP: Readonly<Record<KeyScope, readonly KeyBinding[]>> = {
  packs: [
    ...move,
    { keys: ['Enter'], action: 'open', label: 'compare · again: full width' },
    { keys: ['a'], action: 'accept', label: 'accept' },
    { keys: ['r'], action: 'rework', label: 'send back to rework' },
    { keys: ['s'], action: 'descope', label: 'descope' },
    { keys: ['u'], action: 'undo', label: 'undo the decision' },
    filter,
    ...views,
    help,
    { keys: ['Escape'], action: 'escape', label: 'close compare, then clear the selection' },
  ],
  backlog: [
    ...move,
    { keys: ['Enter'], action: 'open', label: 'open the feature' },
    { keys: ['d'], action: 'dispatch', label: 'dispatch the selection' },
    { keys: ['a'], action: 'dispatchFocused', label: 'dispatch this finding' },
    filter,
    ...views,
    help,
    { keys: ['Escape'], action: 'escape', label: 'clear the selection' },
  ],
  compare: [
    { keys: ['l'], action: 'theme', label: 'light · dark · both' },
    { keys: ['m'], action: 'mode', label: 'side by side · slider · blink · change map' },
    { keys: ['w'], action: 'wide', label: 'full width' },
  ],
  release: [
    { keys: ['b'], action: 'build', label: 'build the release' },
    { keys: ['f'], action: 'finish', label: 'finish after the merge' },
    ...views,
    help,
    { keys: ['Escape'], action: 'escape', label: 'back to triage' },
  ],
};

/** The action `key` triggers in the first of `scopes` that binds it (a layered scope first: compare over packs), or
 *  null. Letters compare case-insensitively; every other key (Enter, Escape, the arrows, '?', ' ') as it is. */
export function keyAction(scopes: readonly KeyScope[], key: string): KeyAction | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  for (const s of scopes) for (const b of KEYMAP[s]) if (b.keys.some((x) => (x.length === 1 ? x.toLowerCase() : x) === k)) return b.action;
  return null;
}

const NAMES: Readonly<Record<string, string>> = { ' ': 'Space', ArrowDown: '↓', ArrowUp: '↑', Escape: 'Esc', Enter: 'Enter' };
/** A key as the footer and the `?` sheet print it: letters uppercase, Space, the arrows as arrows, Esc. */
export const keyName = (k: string): string => NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k);

/** The footer's short list per scope: the few actions worth a reminder while nothing is selected (the decision and
 *  dispatch buttons carry their own keys; the `?` sheet lists the rest). */
export const SHORT: Readonly<Record<KeyScope, readonly KeyAction[]>> = {
  packs: ['next', 'select', 'open', 'help'],
  backlog: ['next', 'select', 'open', 'help'],
  compare: ['theme', 'mode', 'wide'],
  release: ['build', 'finish', 'help'],
};
