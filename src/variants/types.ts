// The variant seam. A variant is a lens expression for the canvas plus optional UI overrides for the
// React chrome. Everything a variant author may change is reachable from their own folder through
// this interface; the engine and the components consult it and fall back to the defaults.
import type { ComponentType } from 'react';
import type { Feature, LensId, ViewId } from '@/lib/data';
import type { Model, SimDecision } from '@/lib/model';
import type { Density, LensExpression } from '@/engine/lens/contract';

export type VariantId = 'subtle' | 'shaped' | 'bold';
export type { LensExpression, LensChannel, MarkArgs, TileGeom, Rect, Density, ChannelContent, ChannelAggregate, FeatureLive, Viewport } from '@/engine/lens/contract';
export type { Theme } from '@/engine/theme';

/** Props for a lens panel in the feature sheet (one per lens; six in General). */
export interface SheetPanelProps {
  lens: LensId;
  f: Feature;
  model: Model;
  /** The reader's density for this lens (from the channel, or the UI override). */
  density: Density;
  /** True when this lens stands alone (the sheet is in that lens); false in General or when collapsed. */
  expanded: boolean;
  /** The current view. */
  view: ViewId;
}

export interface VariantUI {
  /** Replace the lens panel in the feature sheet (wrap `DefaultLensPanel` from '@/components/sheet/LensPanel' to extend it). */
  SheetPanel?: ComponentType<SheetPanelProps>;
  /** Replace the legend shown in the Plan tab for a view. */
  Legend?: ComponentType<{ view: ViewId }>;
  /** Density the UI uses for a lens (sheet rows, queue detail). Default: the channel's density. */
  density?(lens: LensId): Density;
  /** An extra line under a queue card, e.g. a lens-specific hint. Return null for none. */
  queueNote?(d: SimDecision, view: ViewId, model: Model): string | null;
  /** Sub-label under a lens tab (default: the sheet's short name). */
  tabLabel?(view: ViewId): string | null;
}

export interface Variant {
  id: VariantId;
  /** Shown on the index page. */
  name: string;
  /** One line for the index page. */
  description: string;
  expression: LensExpression;
  ui?: VariantUI;
}
