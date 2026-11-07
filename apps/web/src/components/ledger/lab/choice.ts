// The ledger lab's switch: which design direction the Backlog stage shows. A per-viewer convenience, so it lives in this
// browser only (localStorage, wrapped: a private window just starts on the shipping page). Opt-in: nobody lands in the lab unasked. `?lx=schedule|site|line|current`
// opens one directly; the engine's hash writer never touches the query, so the link survives. Prototype code: when a
// direction wins, this switch goes and the winner replaces the Backlog scope.
import { useSyncExternalStore } from 'react';

export const LAB_CHOICES = ['schedule', 'site', 'line', 'current'] as const;
export type LabChoice = (typeof LAB_CHOICES)[number];
export const LAB_NAMES: Record<LabChoice, { key: string; name: string; hint: string }> = {
  schedule: { key: 'A', name: 'Schedule', hint: 'A · Schedule: a drawing schedule beside a permanent wave dock. Read fast, press 1-9' },
  site: { key: 'B', name: 'Site plan', hint: 'B · Site plan: findings pinned on the building. Lasso a room into a wave' },
  line: { key: 'C', name: 'Line', hint: 'C · Line: one board from intake through waves to shipped. Carry tickets along it' },
  current: { key: '–', name: 'Current', hint: 'The ledger as it ships today' },
};

const KEY = 'bp.ledger.lab';
const isChoice = (v: string | null): v is LabChoice => !!v && (LAB_CHOICES as readonly string[]).includes(v);
const listeners = new Set<() => void>();
let current: LabChoice | null = null;

function read(): LabChoice {
  if (current) return current;
  let saved: string | null = null;
  try { saved = new URLSearchParams(location.search).get('lx') ?? localStorage.getItem(KEY); } catch { saved = null; }
  current = isChoice(saved) ? saved : 'current';
  return current;
}

export function setLabChoice(c: LabChoice): void {
  current = c;
  try { localStorage.setItem(KEY, c); } catch { /* a private window: the choice lasts this page */ }
  for (const f of listeners) f();
}

export function useLabChoice(): LabChoice {
  return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, read, () => 'current');
}
