// The three variants, in index-page order. Each folder owns its expression and UI overrides.
import { subtle } from './subtle';
import { shaped } from './shaped';
import { bold } from './bold';
import type { Variant, VariantId } from './types';

export const VARIANTS: readonly Variant[] = [subtle, shaped, bold];
export const VARIANT_IDS: readonly VariantId[] = VARIANTS.map((v) => v.id);

export function getVariant(id: string): Variant | null {
  return VARIANTS.find((v) => v.id === id) ?? null;
}
