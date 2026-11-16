'use client';
// The feature page's "Changed since" section while the plan compares two dates (A pinned with the A key, B the
// travelled date): both values with the day each was read, first observations labelled as such, the stage on each
// date. The words are core's (compareLines); this renders them and re-renders only when the comparison is rebuilt.
import type { Feature } from '@bp/core/data';
import { STAGE_WORD } from '@bp/core/model';
import { compareLines, endpointWord } from '@bp/core/model/compare';
import { useBp, useEngine } from '../hooks';

export function CompareSection({ f }: { f: Feature }) {
  const E = useEngine(), P = E.M.P;
  useBp((s) => s.cmpV); // the comparison was rebuilt (an endpoint or the data moved)
  const c = E.cmp;
  if (!c) return null;
  const e = c.byId.get(f.id), A = endpointWord(c.a, P.asOf), B = endpointWord(c.b, P.asOf);
  const lines = e ? compareLines(e, (id) => P.LENS[id]?.name ?? id, (s) => STAGE_WORD[s], c.a, c.b, P.asOf) : [];
  return (
    <div className="pg-cmp" role="group" aria-label={'Changed between ' + A + ' and ' + B}>
      <h4 className="pg-h">Changed between {A} and {B}</h4>
      {lines.length
        ? <ul>{lines.map((l, i) => <li key={i} className={l.kind}>{l.text}</li>)}</ul>
        : <p className="pg-nr">Nothing recorded changed on this feature between these dates.</p>}
      <button type="button" className="btn" onClick={() => E.setCompare(null)}>Stop comparing · A</button>
    </div>
  );
}
