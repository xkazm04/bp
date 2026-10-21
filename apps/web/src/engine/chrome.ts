// The chrome the canvas fits around: the right-hand rail and the bottom bar. Their collapsed sizes set the
// plan's safe area (Engine.layoutChrome); anything that expands on click overlays the plan instead of
// moving it (spatial stability).
import type { UIState } from './state';

/** Screen px the right-hand rail takes, including its margins (rail 64 + 14 edge + 8 gap). Its flyouts overlay the plan. Hidden rail = 12 px margin only. */
export function railWidth(S: Pick<UIState, 'dockHidden' | 'compact'>): number {
  return S.dockHidden ? 12 : 86;
}
/** Screen px the bottom timeline takes when collapsed: the strip, its bottom margin and a 6 px gap. */
export function baseHeight(S: Pick<UIState, 'compact'>): number {
  return S.compact ? 36 : 42;
}
/** Screen px a classic rail flyout covers (rail.css #flyout width). It overlays the plan, so plan overlays such as the hover card keep clear of it. */
export const FLYOUT_W = 340;
let flyoutW = FLYOUT_W;
/** The open flyout's measured width (Dock.tsx): a wide flyout (rail/wide) covers up to three times the classic one. */
export function setFlyoutWidth(px: number) { flyoutW = px > 0 ? px : FLYOUT_W; }
/** Screen px from the right edge that the rail plus any open flyout cover. */
export function overlayRight(S: Pick<UIState, 'dockHidden' | 'compact' | 'dtab'>): number {
  return railWidth(S) + (S.dtab ? flyoutW : 0);
}
/**
 * The blast-radius / GA / info callout (blueprint.css `#callout`, box-sizing: border-box) sits just left of
 * the rail region and overlays the plan. Its width used to be written out three times in three languages -
 * 330 in the CSS, 340 in the overlay that positions it, 370 in the engine's fit - so moving it meant finding
 * all three. The CSS owns the width; these two derive from it, and scripts/check-chrome-sizes.mjs keeps the
 * CSS and this file in step the way it already does for the rail and the flyout.
 */
export const CALLOUT_W = 330;
/** Screen px left of the rail region an open callout covers: its width plus the 10 px it keeps off the rail. */
export const CALLOUT_OVER = CALLOUT_W + 10;
/** Right pad a mode's fit keeps so its own callout never covers the features it frames (Engine.setMode). */
export const CALLOUT_PAD = CALLOUT_OVER + 30;
