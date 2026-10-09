// Bold's secondary accents: one per lens, used for marks, ornaments, evidence text and the panel accent,
// never as a tile fill. Hues avoid the status colours (red = trouble, amber = watch, mint = agents) so a
// lens accent never reads as a verdict. Light values are darkened for paper.
import type { LensId } from '@/lib/data';

export const ACCENT: Record<LensId, { dark: string; light: string }> = {
  business: { dark: '#b4e27e', light: '#3d7413' }, // banknote green (ledger)
  design: { dark: '#f4a6e4', light: '#a3358d' }, // marker magenta (artboard)
  development: { dark: '#8fd0ff', light: '#1b64a8' }, // phosphor blue (terminal, survey)
  operations: { dark: '#6fe6dc', light: '#0b7a72' }, // gauge teal (control room)
  security: { dark: '#b8a2ff', light: '#5a3dbd' }, // seal violet (perimeter)
  quality: { dark: '#e9d5a1', light: '#7a5a12' }, // manila (inspection tags)
};

/** Sheet number and the reader's name for each lens (tab sub-label, title blocks). */
export const LENS_NAME: Record<LensId, { no: string; nm: string; title: string }> = {
  business: { no: 'B-101', nm: 'Ledger', title: 'LEDGER' },
  design: { no: 'D-201', nm: 'Artboard', title: 'ARTBOARD' },
  development: { no: 'S-301', nm: 'Terminal', title: 'TERMINAL' },
  operations: { no: 'M-401', nm: 'Control', title: 'CONTROL ROOM' },
  security: { no: 'F-501', nm: 'Perimeter', title: 'PERIMETER' },
  quality: { no: 'Q-601', nm: 'Inspection', title: 'INSPECTION' },
};
