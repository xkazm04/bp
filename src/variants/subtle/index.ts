// Variant 1, "subtle: patterns". Every tile keeps its rectangle and its stage fill; each lens is a
// small glyph in a fixed slot and a line type along the tile's top edge. See NOTES.md.
import type { Variant } from '../types';
import { subtleExpression } from './expression';
import { SubtleLegend } from './Legend';
import './styles.css';

export const subtle: Variant = {
  id: 'subtle',
  name: 'Subtle · patterns',
  description: 'Every tile keeps its rectangle; lenses differ by line patterns, hairline marks and small icons in fixed slots.',
  expression: subtleExpression,
  ui: { Legend: SubtleLegend },
};
export default subtle;
