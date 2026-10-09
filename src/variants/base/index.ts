// The base variant: A/1's lens behaviour under the no-recolour rule. The three real variants start as
// re-exports of this and diverge in their own folders.
import type { Variant, VariantId } from '../types';
import { baseExpression } from './expression';

export { baseExpression, BASE_ACCENTS, LENS_ORDER, band, healthCell } from './expression';

/** Build a variant from the base expression under another id and name. */
export function fromBase(id: VariantId, name: string, description: string): Variant {
  return { id, name, description, expression: { ...baseExpression, id, name }, ui: {} };
}
