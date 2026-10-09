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
