// The lamp skins: how the companion LOOKS (shape, rest position, motion, name). The host (CompanionHost) owns behaviour and
// derives the state; a skin only draws what it is given, so a skin can be swapped without touching the turn stream.
// `?lamp=<name>` picks one; `?lamp-fixture=1` drives a scripted timeline through every state with no server.
import type { ComponentType } from 'react';
import type { Card, LampState } from '@bp/core/companion/contract';

export interface LampProps {
  state: LampState;
  /** The line the lamp is saying or last said (streamed text while speaking). */
  caption?: string;
  /** Where the lamp should point, in viewport px, while `state` is 'pointing'. */
  target?: { x: number; y: number; w: number; h: number };
  /** Cards waiting for the person (GATED tool calls). */
  cards: Card[];
  onSubmit(text: string): void;
  onCard(id: string, decision: 'approve' | 'decline'): void;
}

export interface LampSkin {
  /** The URL key, kebab-case. */
  key: string;
  /** The lamp's own name, as the person sees it. */
  name: string;
  Component: ComponentType<LampProps>;
}

/** Registered skins; the first is the default. The contest's variants register here; the winner stays. */
export const LAMPS: LampSkin[] = [];

export function lampFor(key: string | null): LampSkin | undefined {
  return (key && LAMPS.find((l) => l.key === key)) || LAMPS[0];
}
