'use client';
// The rail's wide flyouts: every panel but Find is a workbench, a list on the left and the selected item read in full
// on the right (shell.tsx). The panels take no props; each reads the engine itself. Kept from three prototypes on
// 2026-10-15 (the board and the table were dropped).
import type { ReactNode } from 'react';
import type { DockTab } from '@/engine/state';
import { Agents } from './agents';
import { Orders } from './orders';
import { Plan } from './plan';
import { Review } from './review';
import { Steer } from './steer';
import { View } from './view';
import './workbench.css';

const WIDE: Partial<Record<DockTab, () => ReactNode>> = { asks: Review, swarm: Agents, orders: Orders, steer: Steer, plan: Plan, view: View };
/** The rail items that open a wide flyout; Find stays the classic 340 px search. */
export const isWide = (k: DockTab | null): k is DockTab => !!k && k in WIDE;

export function WideBody({ k }: { k: DockTab }) {
  const P = WIDE[k];
  return P ? <P /> : null;
}
