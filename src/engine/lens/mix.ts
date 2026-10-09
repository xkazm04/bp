// The lens mix: seven weights tweened with interruptible springs (motion values keep their velocity
// when a new target arrives), plus the derived per-lens quantities every drawing pass uses.
import { animate, motionValue, type MotionValue } from 'motion';
import { LENSES, type LensId, type ViewId } from '@/lib/data';

export type LensMix = { general: number } & Record<LensId, number>;

export function mixTarget(v: ViewId): LensMix {
  const m = { general: v === 'general' ? 1 : 0 } as LensMix;
  for (const l of LENSES) m[l] = v === 'general' || v === l ? 1 : 0;
  return m;
}

/**
 * Derived values, recomputed once per frame from the raw mix:
 *  - presence p[l] = mix[l]                      draw the channel at all (alpha)
 *  - expansion x[l] = mix[l] * (1 - general)     compact General form (0) -> lone lens (1)
 *  - dominance d[l] = clamp(x[l] - sum others)   exclusive things: shape, content, accent, decor.
 * Dominance is 0 for every lens in General and at the midpoint of a lens->lens switch, so exclusive
 * expressions always pass through the shared base and never cut from one lens to another.
 */
export interface MixState {
  general: number;
  p: Record<LensId, number>;
  x: Record<LensId, number>;
  d: Record<LensId, number>;
  /** The lens with the highest dominance (null when none > 0). */
  top: LensId | null;
  /** Its dominance. */
  topD: number;
  /** True while any weight is moving. */
  moving: boolean;
}

export function deriveMix(m: LensMix, out?: MixState): MixState {
  const s: MixState = out ?? { general: 0, p: {} as Record<LensId, number>, x: {} as Record<LensId, number>, d: {} as Record<LensId, number>, top: null, topD: 0, moving: false };
  s.general = m.general;
  let sum = 0;
  for (const l of LENSES) { s.p[l] = m[l]; s.x[l] = m[l] * (1 - m.general); sum += s.x[l]; }
  s.top = null; s.topD = 0;
  for (const l of LENSES) {
    const d = Math.max(0, Math.min(1, s.x[l] - (sum - s.x[l])));
    s.d[l] = d;
    if (d > s.topD) { s.topD = d; s.top = l; }
  }
  return s;
}

export class MixDriver {
  readonly values: { general: MotionValue<number> } & Record<LensId, MotionValue<number>>;
  readonly mix: LensMix;
  readonly state: MixState;
  private static KEYS = ['general', ...LENSES] as const;
  constructor(view: ViewId, private onChange: () => void, private spring = { stiffness: 170, damping: 26 }) {
    const t = mixTarget(view);
    this.mix = { ...t };
    const vals = { general: motionValue(t.general) } as MixDriver['values'];
    for (const l of LENSES) vals[l] = motionValue(t[l]);
    this.values = vals;
    this.state = deriveMix(this.mix);
    for (const k of MixDriver.KEYS) {
      vals[k].on('change', (v) => { this.mix[k] = Math.max(0, Math.min(1, v)); deriveMix(this.mix, this.state); this.state.moving = true; this.onChange(); });
      vals[k].on('animationComplete', () => { this.state.moving = this.moving; this.onChange(); });
    }
  }
  /** Any weight still springing (interrupted animations hand over to the new one, velocity kept). */
  get moving(): boolean { return MixDriver.KEYS.some((k) => this.values[k].isAnimating()); }
  to(view: ViewId, instant = false) {
    const t = mixTarget(view);
    for (const k of MixDriver.KEYS) {
      const mv = this.values[k];
      if (instant) { mv.jump(t[k]); continue; }
      if (Math.abs(mv.get() - t[k]) < 1e-4 && !mv.isAnimating()) continue;
      animate(mv, t[k], { type: 'spring', stiffness: this.spring.stiffness, damping: this.spring.damping, restDelta: 0.002, restSpeed: 0.01 });
    }
    if (instant) { for (const k of MixDriver.KEYS) this.mix[k] = t[k]; deriveMix(this.mix, this.state); this.state.moving = false; this.onChange(); }
  }
  destroy() { for (const k of ['general', ...LENSES] as const) { this.values[k].stop(); this.values[k].destroy(); } }
}
