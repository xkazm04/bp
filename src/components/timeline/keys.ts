// The time sliders' keyboard map, shared by the strip's hairline (timeline/Strip.tsx) and the panel's revisions chart
// (BaseBar.tsx). One table: the keys a slider handles are exactly the keys it claims, so the two sliders cannot drift
// apart and a key the slider does nothing with still reaches the engine's shortcuts. Pinned by check-keys.ts.
// No React and no '@/' imports: Node loads this file as-is for the check.
import { HOUR } from '../../lib/model/constants.ts';

/** The slice of the engine a time slider drives (Engine satisfies it; the check passes a recorder). */
export interface TimeSliderEngine {
  stepWeek(dir: number): void;
  setTime(d: string): void;
  setTimeline(on?: boolean): void;
  seek(t: number): void;
  readonly M: { readonly sim: { readonly t: number }; readonly P: { readonly weeks: readonly string[]; readonly asOf: string } };
}
/** The fields of a keyboard event the map reads (React's and the DOM's both have them). */
export interface KeyLike { readonly key: string; readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly altKey: boolean }

/** PageUp or Shift+ArrowRight skip the simulated hour ahead by 5 minutes. Forward only, like the pointer (the sim
 *  replays events and cannot rewind). Returns true when the key was ours. */
export function hourSeekKey(e: KeyLike, E: Pick<TimeSliderEngine, 'seek' | 'M'>, hour: boolean): boolean {
  if (!hour || !(e.key === 'PageUp' || (e.shiftKey && e.key === 'ArrowRight'))) return false;
  E.seek(Math.min(HOUR, E.M.sim.t + 300));
  return true;
}

/** One key on a time slider. True = the slider's key: the caller prevents its default and stops it reaching the engine
 *  with nativeEvent.stopImmediatePropagation (React and the engine both listen on document, so stopPropagation does
 *  not). `escape` is the slider's own Escape. Enter is claimed and does nothing: from a slider it must not reach the
 *  engine, which would accept an open decision. Every other key passes through to the engine's shortcuts. */
export function timeSliderKey(e: KeyLike, E: TimeSliderEngine, hour: boolean, escape: () => void): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (hourSeekKey(e, E, hour)) return true;
  switch (e.key) {
    case 'ArrowLeft': case 'ArrowDown': E.stepWeek(-1); return true;
    case 'ArrowRight': case 'ArrowUp': E.stepWeek(1); return true;
    case 'Home': E.setTime(E.M.P.weeks[0]); return true;
    case 'End': E.setTime(E.M.P.asOf); return true;
    case 't': case 'T': E.setTimeline(); return true;
    case 'Escape': escape(); return true;
    case 'Enter': return true;
    default: return false;
  }
}
