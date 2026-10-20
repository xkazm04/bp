// Variant 2, "shaped: reshape and icons". Each lens reshapes the tile outline (ticket, cut corners,
// pill, brackets, checklist edge, artboard), brings its own icon vocabulary, its own words and one
// accent for its marks; density follows the reader. General composes the six icons along each
// fixture's top edge on the plain rectangle. See NOTES.md.
import type { ViewId } from '@/lib/data';
import { manifestChannel } from '../subtle/expression';
import type { LensExpression, Rect, Variant } from '../types';
import { CHANNELS, chipSide, homeRect } from './channels';
import { ShapedLegend } from './Legend';
import { ShapedPanel } from './Panel';
import './styles.css';

const TAB: Record<ViewId, string | undefined> = { general: 'General', business: 'Business', design: 'Design', development: 'Development', operations: 'Operations', security: 'Security', quality: 'Quality' };

export const shapedExpression: LensExpression = {
  id: 'shaped',
  name: 'Shaped',
  channels: CHANNELS,
  // lenses other than the six built-ins are drawn by the manifest-driven subtle channel, in their chip slot
  fallback: manifestChannel,
  composeGeneral(t, ids) {
    // one icon chip per enabled lens set into the top edge, left to right in tab order; ribbons stay calm
    if (t.form !== 'tile') return {};
    const u = t.u, s = chipSide(t);
    if (s < 5 * u) return {};
    const n = ids.length, gap = Math.max(2 * u, s * 0.24), need = n * s + (n - 1) * gap;
    if (need > t.w - 34 * u) return {};
    const y = t.y - s / 2 + 0.5, out: Record<string, Rect> = {};
    ids.forEach((l, i) => { out[l] = { x: t.x + 7 * u + i * (s + gap), y, w: s, h: s }; });
    return out;
  },
  expandedRect: (t) => homeRect(t),
  spring: { stiffness: 170, damping: 26 },
  evidenceFont: (l) => (l === 'design' || l === 'business' ? 'sans' : 'mono'),
};

export const shaped: Variant = {
  id: 'shaped',
  name: 'Shaped · reshape and icons',
  description: 'Each lens reshapes the tile and brings its own icons, words and one accent colour; density follows the reader.',
  expression: shapedExpression,
  ui: {
    SheetPanel: ShapedPanel,
    Legend: ShapedLegend,
    tabLabel: (v) => TAB[v] ?? null,
  },
};
export default shaped;
