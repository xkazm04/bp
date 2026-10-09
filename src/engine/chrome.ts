// The chrome the canvas fits around: the right-hand rail and the bottom bar. Their collapsed sizes set the
// plan's safe area (Engine.layoutChrome); anything that expands on click overlays the plan instead of
// moving it (spatial stability).
import type { UIState } from './state';

/** Screen px the right-hand dock takes, including its margin. Hidden dock = 12 px margin only. */
export function railWidth(S: Pick<UIState, 'dockHidden' | 'compact'>): number {
  return S.dockHidden ? 12 : 352;
}
/** Screen px the bottom bar takes (its collapsed height). */
export function baseHeight(S: Pick<UIState, 'compact'>): number {
  return S.compact ? 84 : 116;
}
