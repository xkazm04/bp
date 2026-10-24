// Where a pending steer preview is shown: the one rule. A preview (Engine.preview / previewLive) is a consent gate -
// NOT ISSUED YET, then Commit - and Enter commits it whenever focus is off a control, so it must always be on screen.
// With the rail's Agents, Orders or Steer workbench open (and the rail shown), the panel holds it: the row of that
// panel which owns it, or - when no row does, or the reader has moved off it - the Workbench's own pending bar.
// Otherwise the selection bar holds it. The selection bar, the Workbench and the three panels all read this, and none
// of them reads the preview's kind or order to decide (check:rail-keys rule 11). Pure; checked by check:preview-seat.
import type { DockTab } from '../../engine/state';

/** The preview's facts the seat reads (a sample steer's Preview, a live product's LivePlan). */
export interface SeatInput {
  prev: { kind: string; order?: string } | null;
  lprev: { verb: string } | null;
  dtab: DockTab | null;
  hidden: boolean;
  tgtN: number;
}
/**
 * `row`: the panel row that owns the preview (null is a panel's overview row); undefined = no row owns it, so the
 * Workbench's pending bar shows it.
 */
export interface PreviewSeat { surface: 'none' | 'selbar' | 'panel'; row?: string | null }

/** The workbenches that carry the selection's steering and its preview, so the selection bar steps aside for them. */
export const SEAT_TABS: readonly DockTab[] = ['swarm', 'orders', 'steer'];

/** Steer's two presets and the standing order each rests on (a preset's preview carries that order). */
export const STEER_PRESET_ORDER = { ga: 'O-4', research: 'O-7' } as const;
/** Steer's row for steering the selection; Orders' row for writing one. */
export const STEER_HERE = 'here', ORDERS_WRITE = 'write';

const STEERS = new Set(['push', 'pause', 'resume']);

/** The panel row that owns a preview, per workbench; undefined = none of its rows does. */
function owner(i: SeatInput): string | null | undefined {
  const p = i.prev;
  if (i.dtab === 'swarm') return i.lprev || (p && !p.order && (STEERS.has(p.kind) || p.kind === 'order')) ? null : undefined;
  if (!p) return undefined;   // a live steer belongs to Agents alone (Steer and Orders move the sample swarm)
  if (i.dtab === 'steer') {
    if (p.order) return (Object.keys(STEER_PRESET_ORDER) as (keyof typeof STEER_PRESET_ORDER)[]).find((k) => STEER_PRESET_ORDER[k] === p.order);
    return STEERS.has(p.kind) && i.tgtN > 0 ? STEER_HERE : undefined;
  }
  if (i.dtab === 'orders') return p.kind === 'order' && !p.order && i.tgtN > 0 ? ORDERS_WRITE : undefined;
  return undefined;
}

/** Whether a seat workbench is open over the plan. */
export const seatPanelOpen = (dtab: DockTab | null, hidden: boolean) => !hidden && !!dtab && SEAT_TABS.includes(dtab);

export function previewSeat(i: SeatInput): PreviewSeat {
  if (!i.prev && !i.lprev) return { surface: 'none' };
  if (!seatPanelOpen(i.dtab, i.hidden)) return { surface: 'selbar' };
  return { surface: 'panel', row: owner(i) };
}

/** The selection bar steps aside: for a preview, exactly when the panel holds it; for a bare selection, when a seat workbench is open (it carries the same controls). */
export function selbarStepsAside(i: SeatInput): boolean {
  if (i.prev || i.lprev) return previewSeat(i).surface === 'panel';
  return seatPanelOpen(i.dtab, i.hidden);
}

/** The panel row `row` shows the preview in its detail. */
export const seatHere = (s: PreviewSeat, row: string | null) => s.surface === 'panel' && s.row === row;
/** The Workbench's pending bar shows it: the panel holds it but the row on screen is not its owner. */
export const seatBar = (s: PreviewSeat, row: string | null) => s.surface === 'panel' && s.row !== row;
