// Variant 3, "bold: decoration, content and density". Each lens becomes unmistakable through decoration
// around the plan (decor.ts), a secondary accent for its marks, an instrument and an outline per tile
// (channels.ts), richer words, and a feature-sheet panel laid out for its reader (panels.tsx). General
// stays the calm composition: six health cells per fixture, no decoration. See NOTES.md.
import type { LensId } from '@/lib/data';
import { LENSES } from '@/lib/data';
import { baseExpression, LENS_ORDER } from '../base';
import type { LensChannel, LensExpression, Rect, Variant } from '../types';
import { CHANNELS, instrumentRect } from './channels';
import { makeDecor } from './decor';
import { LENS_NAME } from './palette';
import { BoldPanel } from './panels';
import { queueNote } from './words';
import './styles.css';

const channels = Object.fromEntries(LENSES.map((l) => [l, { ...CHANNELS[l], decor: makeDecor(l) } satisfies LensChannel])) as Record<LensId, LensChannel>;

export const boldExpression: LensExpression = {
  ...baseExpression,
  id: 'bold',
  name: 'Bold',
  channels,
  composeGeneral(tile) {
    // General: six health cells along the top edge, each capped with its lens's accent hairline;
    // ribbons stay calm (no cells) so L0 reads like the drawing set
    if (tile.form !== 'tile' || tile.strip.w < 60 * tile.u) return {};
    const s = tile.strip, gap = 2 * tile.u, w = (s.w - gap * 5) / 6, out: Partial<Record<LensId, Rect>> = {};
    LENS_ORDER.forEach((l, i) => { out[l] = { x: s.x + i * (w + gap), y: s.y, w, h: s.h }; });
    return out;
  },
  expandedRect: (tile) => instrumentRect(tile),
  spring: { stiffness: 160, damping: 25 },
  evidenceFont: (l) => (l === 'business' || l === 'design' ? 'sans' : 'mono'),
};

export const bold: Variant = {
  id: 'bold',
  name: 'Bold · decoration and content',
  description: 'Each lens brings its own decoration, accent, words and reader: an artboard-simple design sheet, a terminal-dense development sheet, a plain-money ledger.',
  expression: boldExpression,
  ui: {
    SheetPanel: BoldPanel,
    tabLabel: (v) => (v === 'general' ? 'General' : LENS_NAME[v].nm),
    queueNote,
  },
};
export default bold;
