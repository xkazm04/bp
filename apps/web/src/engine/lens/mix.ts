// The lens mix: one weight for General plus one per enabled lens (the registry, in file order), tweened
// with interruptible springs (motion values keep their velocity when a new target arrives), plus the
// derived per-lens quantities every drawing pass uses. Lens ids are strings; the set is fixed per
// engine (it comes from the map and the session's `?lenses=` toggle).
import { animate, motionValue, type MotionValue } from 'motion';
import type { ViewId } from '@/lib/data';

/** `general` plus one weight per registry lens id, each 0..1. */
export type LensMix = { general: number } & Record<string, number>;

export function mixTarget(ids: readonly string[], v: ViewId): LensMix {
  const m: LensMix = { general: v === 'general' ? 1 : 0 };
  for (const l of ids) m[l] = v === 'general' || v === l ? 1 : 0;
  return m;
}

/**
 * Derived values, recomputed from the raw mix on every weight change (so once per moving weight per frame
 * during a tween, up to 1 + lenses times; each pass is O(lenses)):
 *  - presence p[l] = mix[l]                      draw the channel at all (alpha)
 *  - expansion x[l] = mix[l] * (1 - general)     compact General form (0) -> lone lens (1)
 *  - dominance d[l] = clamp(x[l] - sum others)   exclusive things: shape, content, accent, decor.
 * Dominance is 0 for every lens in General and at the midpoint of a lens->lens switch, so exclusive
 * expressions always pass through the shared base and never cut from one lens to another.
 */
export interface MixState {
  /** The registry order the records below are keyed by. */
  ids: readonly string[];
  general: number;
  p: Record<string, number>;
  x: Record<string, number>;
  d: Record<string, number>;
  /** The lens with the highest dominance (null when none > 0). */
  top: string | null;
  /** Its dominance. */
  topD: number;
  /** True while any weight is moving. */
  moving: boolean;
}

export function deriveMix(ids: readonly string[], m: LensMix, out?: MixState): MixState {
  const s: MixState = out ?? { ids, general: 0, p: {}, x: {}, d: {}, top: null, topD: 0, moving: false };
  s.general = m.general;
  let sum = 0;
  for (const l of ids) { s.p[l] = m[l]; s.x[l] = m[l] * (1 - m.general); sum += s.x[l]; }
  s.top = null; s.topD = 0;
  for (const l of ids) {
    const d = Math.max(0, Math.min(1, s.x[l] - (sum - s.x[l])));
    s.d[l] = d;
    if (d > s.topD) { s.topD = d; s.top = l; }
  }
  return s;
}

export class MixDriver {
  readonly values: Record<string, MotionValue<number>>;
  readonly mix: LensMix;
  readonly state: MixState;
  private readonly keys: readonly string[];
  private readonly ids: readonly string[];
  private onChange: () => void;
  private spring: { stiffness: number; damping: number };
  // Plain fields, not parameter properties: Node's type stripping (how scripts/*.ts run) cannot load those.
  constructor(ids: readonly string[], view: ViewId, onChange: () => void, spring = { stiffness: 170, damping: 26 }) {
    this.ids = ids; this.onChange = onChange; this.spring = spring;
    this.keys = ['general', ...ids];
    const t = mixTarget(ids, view);
    this.mix = { ...t };
    const vals: Record<string, MotionValue<number>> = {};
    for (const k of this.keys) vals[k] = motionValue(t[k]);
    this.values = vals;
    this.state = deriveMix(ids, this.mix);
    for (const k of this.keys) {
      vals[k].on('change', (v) => { this.mix[k] = Math.max(0, Math.min(1, v)); deriveMix(ids, this.mix, this.state); this.state.moving = true; this.onChange(); });
      vals[k].on('animationComplete', () => { this.state.moving = this.moving; this.onChange(); });
    }
  }
  /** Any weight still springing (interrupted animations hand over to the new one, velocity kept). */
  get moving(): boolean { return this.keys.some((k) => this.values[k].isAnimating()); }
  to(view: ViewId, instant = false) {
    const t = mixTarget(this.ids, view);
    for (const k of this.keys) {
      const mv = this.values[k];
      if (instant) { mv.jump(t[k]); continue; }
      if (Math.abs(mv.get() - t[k]) < 1e-4 && !mv.isAnimating()) continue;
      animate(mv, t[k], { type: 'spring', stiffness: this.spring.stiffness, damping: this.spring.damping, restDelta: 0.002, restSpeed: 0.01 });
    }
    if (instant) { for (const k of this.keys) this.mix[k] = t[k]; deriveMix(this.ids, this.mix, this.state); this.state.moving = false; this.onChange(); }
  }
  destroy() { for (const k of this.keys) { this.values[k].stop(); this.values[k].destroy(); } }
}
