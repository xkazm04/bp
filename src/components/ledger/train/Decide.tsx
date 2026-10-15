// The one decision control of the release train (WP4a implements): Accept, Rework, Descope and Undo for a set of pack
// items, with the note editor the rules ask for (src/lib/train/rules.ts noteRequired), the pending state per item until
// the store's change arrives, and a toast naming what was skipped and why. The decision bar and the compare panel's
// footer both render this; nothing else decides.
import type { TriageDecision } from '@/lib/scan/types';

export interface DecideProps {
  /** The items the controls act on (the selection, else the focused or open item). */
  ids: readonly string[];
  /** A one-line strip (the compare footer) instead of the bar's full set. */
  compact?: boolean;
}

export interface DecideApi {
  /** Apply a decision; a decision that needs a note opens the note editor instead and applies on confirm. */
  decide(ids: readonly string[], decision: TriageDecision, note?: string): Promise<void>;
  /** Items with a decision sent and not yet seen in the store. */
  pending: ReadonlySet<string>;
}

export function useDecide(): DecideApi {
  return { decide: async () => {}, pending: new Set() };
}

export function Decide(props: DecideProps) {
  void props;
  return null;
}
