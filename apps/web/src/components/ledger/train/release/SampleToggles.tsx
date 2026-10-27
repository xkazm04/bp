// Kettle only: what the scan sim's sample release job runs into (ScanSim.trainToggles): gh logged in, a cherry-pick
// conflicts, a gate fails. Labelled sample; a live product has no such switches (its job is the real CLI).
import { useSyncExternalStore } from 'react';
import type { ScanCtx } from '@/lib/scan/actions';
import { SampleTag } from '../ui/Marks.tsx';

type Sim = NonNullable<ScanCtx['sim']>;
type Toggles = Sim['trainToggles'];

export function SampleToggles({ sim }: { sim: Sim }) {
  // the sim is the one source of truth: read through its own subscription, so a rebuilt sim or a reset elsewhere shows
  const t: Toggles = useSyncExternalStore(sim.subscribe, () => sim.trainToggles, () => sim.trainToggles);
  const set = (patch: Partial<Toggles>) => sim.setTrainToggles({ ...sim.trainToggles, ...patch });
  return (
    <div className="tr-rel-sim" role="group" aria-label="Sample job" title="The sample job runs in this page: nothing is sent">
      <SampleTag>Sample job · nothing is sent</SampleTag>
      <label><input type="checkbox" checked={!t.ghOff} onChange={(e) => set({ ghOff: !e.target.checked })} />gh logged in</label>
      <label><input type="checkbox" checked={t.conflict} onChange={(e) => set({ conflict: e.target.checked })} />a cherry-pick conflicts</label>
      <label><input type="checkbox" checked={t.gateFails} onChange={(e) => set({ gateFails: e.target.checked })} />a gate fails</label>
    </div>
  );
}
