'use client';
// A pack's own row in the triage table (contest A/1's `.pk`), sticky under the table head while its items scroll: a
// checkbox that selects every shown item of the pack, the lens glyph and the pack id, the branch, base commit, item
// count and state, a SAMPLE tag on Kettle's sample packs, then one progress mark per item and "n/m decided".
import { memo } from 'react';
import type { Pack, ProposalStatus } from '@/lib/scan/types';
import { WAITING } from '@/lib/train/rules';
import { useEngine } from '../../hooks';
import { lensMeta } from '../useLedger';
import { LensGlyph } from '../variants/bits';
import { SampleTag, StateMark } from './ui/Marks.tsx';

export interface PackRowProps {
  pack: Pack;
  /** Every item of the pack (the progress), id and status. */
  items: readonly { id: string; status: ProposalStatus }[];
  /** The pack's shown items are all selected (the checkbox), some are (indeterminate). */
  all: boolean;
  some: boolean;
  /** Kettle's sample train. */
  sample: boolean;
  /** Select (or, all selected, deselect) the pack's shown items. */
  onSelect(packId: string): void;
}

const short = (sha: string) => sha.slice(0, 7);

export const PackRow = memo(function PackRow({ pack, items, all, some, sample, onSelect }: PackRowProps) {
  const l = lensMeta(useEngine().M.P, pack.lens);
  const decided = items.filter((x) => !WAITING.has(x.status)).length, n = items.length;
  return (
    <div className={'tr-pk' + (pack.status === 'closed' ? ' closed' : '')} data-role="tr-pack" data-pack={pack.id}>
      <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} onChange={() => onSelect(pack.id)}
        aria-label={'Select every shown item of ' + pack.id} tabIndex={-1} />
      <h3 data-role="tr-pack-title" title={l.name}><LensGlyph g={l.glyph} px={15} />{pack.id}</h3>
      <span className="meta"><code>{pack.branch}</code> · base <code>{short(pack.base_sha)}</code> · {n} item{n === 1 ? '' : 's'} · stacked · {pack.status}</span>
      {sample ? <SampleTag /> : null}
      <span className="prog" aria-label={decided + ' of ' + n + ' decided'}>
        {items.map((x) => <StateMark key={x.id} status={x.status} form="box" title={x.id + ' · ' + x.status} />)}
        <em>{decided}/{n} decided</em>
      </span>
    </div>
  );
});
