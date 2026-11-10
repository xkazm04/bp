// Where the person is when they speak (G1, 2026-11-11): the turn's `surface` (contract.ts TurnSurface), validated, and the
// headset's legacy prefix lifted out of the person's words. Until 2026-11-11 the VR app put its surface rules INSIDE the
// text (apps/vr/Source/bp/BpTalk.cpp: "(Spoken aloud at the VR table; it shows <place>[ [<target>]] on <slug>. Answer in at
// most two short spoken sentences, ...) <heard words>"), which mixed what the surface wants with what the person said. The
// prompt now carries the surface in its own "Where we are" block; a text that still starts with that prefix has it lifted
// into a surface (kind vr, spoken, its place, target and product) and only the heard words stay the person's.
// Pure: no Node, no DOM.

import type { TurnSurface } from './contract.ts';

export const SURFACE_KEYS = ['kind', 'place', 'target', 'product', 'spoken'] as const;
export const PLACE_MAX = 160;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** A target id: a proposal, room, feature, wing or page id (no spaces, no fence characters). */
export const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;

/** The surface a request body sent, or why it is refused. */
export function readSurface(v: unknown): { surface: TurnSurface } | { error: string } {
  const shape = `surface must be { kind: vr | web, place? (<= ${PLACE_MAX} chars), target? (an id), product? (a slug), spoken? (boolean) }`;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: shape };
  const s = v as Record<string, unknown>;
  if (Object.keys(s).some((k) => !(SURFACE_KEYS as readonly string[]).includes(k))) return { error: shape };
  if (s.kind !== 'vr' && s.kind !== 'web') return { error: shape };
  if (s.place !== undefined && (typeof s.place !== 'string' || s.place.length > PLACE_MAX)) return { error: shape };
  if (s.target !== undefined && (typeof s.target !== 'string' || !TARGET_ID.test(s.target))) return { error: shape };
  if (s.product !== undefined && (typeof s.product !== 'string' || !SLUG.test(s.product))) return { error: shape };
  if (s.spoken !== undefined && typeof s.spoken !== 'boolean') return { error: shape };
  return { surface: { kind: s.kind, ...(typeof s.place === 'string' && s.place.trim() ? { place: s.place.trim() } : {}), ...(typeof s.target === 'string' ? { target: s.target } : {}), ...(typeof s.product === 'string' ? { product: s.product } : {}), ...(typeof s.spoken === 'boolean' ? { spoken: s.spoken } : {}) } };
}

const LEGACY = /^\s*\(Spoken aloud at the VR table; it shows ([\s\S]*?)(?: \[([^\]\s]{1,120})\])? on ([a-z0-9][a-z0-9-]{0,62})\. Answer in [^)]*\)\s*/;

/** Lifts the headset's legacy prefix: `{ surface, text }` with the heard words only, or null when the text has none. A
 *  target `site` (the whole plan) is no target. */
export function liftLegacySurface(text: string): { surface: TurnSurface; text: string } | null {
  const m = LEGACY.exec(text);
  if (!m) return null;
  const place = m[1].trim().slice(0, PLACE_MAX), target = m[2] && m[2] !== 'site' && TARGET_ID.test(m[2]) ? m[2] : undefined;
  return { surface: { kind: 'vr', spoken: true, ...(place ? { place } : {}), ...(target ? { target } : {}), product: m[3] }, text: text.slice(m[0].length).trim() };
}
