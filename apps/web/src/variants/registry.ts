// The three variants, in index-page order. Each folder owns its expression and UI overrides.
// `/` draws with subtle (adopted 2026-10-09), so subtle is the one variant imported statically; shaped and bold are
// prototypes behind one dynamic import() each, so their channels, panels, decor and CSS are chunks of their own that
// load only on /v/shaped and /v/bold. Pages that only NAME a variant (the /variants cards, /v/<id>'s metadata and
// params) read VARIANT_META, never a variant module. scripts/check-variant-chunk.ts holds all of this.
import { subtle } from './subtle';
import type { Variant, VariantId, VariantMeta } from './types';

/** id, name and description of every variant, in index order: the literals of each <id>/index.ts (the check compares). */
export const VARIANT_META: readonly VariantMeta[] = [
  { id: 'subtle', name: 'Subtle · patterns', description: 'Every tile keeps its rectangle; lenses differ by line patterns, hairline marks and small icons in fixed slots.' },
  { id: 'shaped', name: 'Shaped · reshape and icons', description: 'Each lens reshapes the tile and brings its own icons, words and one accent colour; density follows the reader.' },
  { id: 'bold', name: 'Bold · decoration and content', description: 'Each lens brings its own decoration, accent, words and reader: an artboard-simple design sheet, a terminal-dense development sheet, a plain-money ledger.' },
];
export const VARIANT_IDS: readonly VariantId[] = VARIANT_META.map((m) => m.id);

export function getMeta(id: string): VariantMeta | null {
  return VARIANT_META.find((m) => m.id === id) ?? null;
}

// the doors: one dynamic import per prototype
const DOORS: Record<Exclude<VariantId, 'subtle'>, () => Promise<Variant>> = {
  shaped: () => import('./shaped').then((m) => m.shaped),
  bold: () => import('./bold').then((m) => m.bold),
};
const loaded = new Map<string, Variant>([[subtle.id, subtle]]);
const pending = new Map<string, Promise<Variant | null>>();

/** A variant already in memory: subtle always, a prototype once loadVariant has resolved it; else null. */
export function getVariant(id: string): Variant | null {
  return loaded.get(id) ?? null;
}

/** The variant for an id, loading its chunk on first use; null for an unknown id. A failed load may be retried. */
export function loadVariant(id: string): Promise<Variant | null> {
  const v = loaded.get(id);
  if (v) return Promise.resolve(v);
  const door = Object.hasOwn(DOORS, id) ? DOORS[id as keyof typeof DOORS] : null;
  if (!door) return Promise.resolve(null);
  let p = pending.get(id);
  if (!p) {
    p = door().then((x) => { loaded.set(id, x); return x; }, (err) => { pending.delete(id); throw err; });
    pending.set(id, p);
  }
  return p;
}
