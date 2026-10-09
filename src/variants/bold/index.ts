// Variant 3, "bold: decoration, content and density". Each lens becomes unmistakable through decoration
// around the plan (decor.ts), a secondary accent for its marks, an instrument and an outline per tile
// (channels.ts), richer words, and a feature-sheet panel laid out for its reader (panels.tsx). General
// stays the calm composition: six health cells per fixture, no decoration. See NOTES.md.
import { baseExpression } from '../base';
import { manifestChannel } from '../subtle/expression';
import type { LensChannel, LensExpression, Rect, Variant } from '../types';
import { CHANNELS, instrumentRect } from './channels';
import { makeDecor } from './decor';
import { LENS_NAME } from './palette';
import { BoldPanel } from './panels';
import { queueNote } from './words';
import { isBuiltinLens } from '../base/legacy';
import './styles.css';

// bold knows the six built-in lenses; any other lens falls back to the manifest-driven subtle channel
const channels: Record<string, LensChannel> = Object.fromEntries((Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]).map((l) => [l, { ...CHANNELS[l], decor: makeDecor(l) } satisfies LensChannel]));

export const boldExpression: LensExpression = {
  ...baseExpression,
  id: 'bold',
  name: 'Bold',
  channels,
  fallback: manifestChannel,
  composeGeneral(tile, ids) {
    // General: one health cell per enabled lens along the top edge, each capped with its lens's accent
    // hairline; ribbons stay calm (no cells) so L0 reads like the drawing set
    if (tile.form !== 'tile' || tile.strip.w < 60 * tile.u || !ids.length) return {};
    const n = ids.length, s = tile.strip, gap = 2 * tile.u, w = (s.w - gap * (n - 1)) / n, out: Record<string, Rect> = {};
    ids.forEach((l, i) => { out[l] = { x: s.x + i * (w + gap), y: s.y, w, h: s.h }; });
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
    tabLabel: (v) => (v === 'general' ? 'General' : isBuiltinLens(v) ? LENS_NAME[v].nm : null),
    queueNote,
  },
};
export default bold;
