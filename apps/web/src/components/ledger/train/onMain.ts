'use client';
// Where the pack items already on the base branch stand: each one's track (scan/track.ts trackOf, with what git says
// landed: TrainData.landed), read once per change of the train's data. The In packs chips (Held / Short / Not measured
// since), their filter, R's prefilled rework note and the compare panel's "Main now" line all read these tracks, so
// the confirm rule has one owner. Unread or unknown landings land nothing: an accepted item then reads as before.
import { useMemo } from 'react';
import { mainOutcome, shortNote, trackOf, type MainOutcome, type Track, type TrackOpts } from '@bp/core/scan/track';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { useTrain, type TrainData } from './data';

/** The chips in order, with the words they show and say on hover. */
export const MAIN_CHIPS: readonly { outcome: MainOutcome; label: string; hint: string }[] = [
  { outcome: 'held', label: 'Held', hint: 'a reading taken after it landed meets the expected value' },
  { outcome: 'short', label: 'Short', hint: 'the reading after it landed falls short of the expected value' },
  { outcome: 'unmeasured', label: 'Not measured since', hint: 'no reading of the product since it landed' },
  { outcome: 'no-target', label: 'No expected value', hint: 'no expected value to judge it by' },
];

type Scan = Pick<ScanSnapshot, 'proposals' | 'measurements' | 'packs' | 'releases'>;
/** The train's tables as trackOf reads them (it only reads). */
export const scanOfTrain = (T: Pick<TrainData, 'proposals' | 'measurements' | 'packs' | 'releases'>): Scan =>
  ({ proposals: [...T.proposals], measurements: [...T.measurements], packs: [...T.packs], releases: [...T.releases] });
/** The landings as trackOf takes them: none until git answered and knew. */
export const landedOpts = (T: Pick<TrainData, 'landed'>): TrackOpts => (T.landed?.state === 'known' ? { landed: T.landed.items } : {});

export interface OnMain {
  /** Pack item id -> its outcome on the base branch (only the items on it). */
  outcome: ReadonlyMap<string, MainOutcome>;
  /** The base branch's name (git's ref), when git answered. */
  base: string | null;
  /** The track of one item, judged with the landings (any item, on main or not). */
  track(id: string): Track | null;
  /** The rework note a short landed item starts from (track.ts shortNote), else undefined. */
  note(id: string): string | undefined;
}

export function onMainOf(T: Pick<TrainData, 'proposals' | 'measurements' | 'packs' | 'releases' | 'landed'>): OnMain {
  const scan = scanOfTrain(T), opts = landedOpts(T), base = T.landed?.state === 'known' ? T.landed.ref : null;
  const outcome = new Map<string, MainOutcome>(), tracks = new Map<string, Track | null>();
  const track = (id: string) => { let t = tracks.get(id); if (t === undefined) tracks.set(id, (t = trackOf(scan, id, opts))); return t; };
  for (const p of T.proposals) {
    if (!p.pack_id || (p.status !== 'accepted' && p.status !== 'released')) continue;
    const t = track(p.id), o = t && mainOutcome(t);
    if (o) outcome.set(p.id, o);
  }
  return { outcome, base, track, note: (id) => noteOf(track(id), base) };
}

const noteOf = (t: Track | null, base: string | null): string | undefined => (t && base && shortNote(t, base)) || undefined;
/** The rework note one item starts from (track.ts shortNote: short of expected on the base branch), else undefined. */
export function reworkDraft(T: Pick<TrainData, 'proposals' | 'measurements' | 'packs' | 'releases' | 'landed'>, id: string): string | undefined {
  return T.landed?.state === 'known' ? noteOf(trackOf(scanOfTrain(T), id, landedOpts(T)), T.landed.ref) : undefined;
}

/** The pack items' standing on the base branch, recomputed when the train's data changes. */
export function useOnMain(): OnMain {
  const T = useTrain();
  return useMemo(() => onMainOf(T), [T]);
}
