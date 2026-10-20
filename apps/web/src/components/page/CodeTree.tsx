'use client';
// "Lives in code": the contexts a feature belongs to, each with its group and the files it covers. The
// contexts come from the map itself (the live product's structure, else Kettle's): the loaded model keeps
// only the names. Hidden when the feature has no context.
import { useMemo, useState } from 'react';
import type { Feature } from '@/lib/data';
import type { Context } from '@/lib/standard/types';
import { useEngine, useLive } from '../hooks';

const SHOWN = 6;

function Ctx({ name, c }: { name: string; c: Context | undefined }) {
  const [all, setAll] = useState(false);
  const paths = c?.file_paths ?? [], shown = all ? paths : paths.slice(0, SHOWN), more = paths.length - shown.length;
  return (
    <div className="pg-ctx">
      <div className="hd"><b>{name}</b>{c?.group ? <span className="ag">{c.group}</span> : null}{c?.category ? <em>{c.category}</em> : null}</div>
      {paths.length ? (
        <ul>
          {shown.map((p) => <li key={p} title={p}>{p}</li>)}
          {more > 0 || (all && paths.length > SHOWN)
            ? <li className="more"><button type="button" className="btn" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : more + ' more'}</button></li>
            : null}
        </ul>
      ) : <p className="none">No file paths recorded for this context.</p>}
    </div>
  );
}

export function CodeTree({ f }: { f: Feature }) {
  const E = useEngine(), live = useLive(), ctxs = live?.product.structure?.contexts as Context[] | undefined;
  // Kettle's contexts come from the model (the sample module keeps the JSON out of live bundles); they are the map's full objects
  const by = useMemo(() => new Map(((E.M.live ? ctxs : E.M.kettleContexts as Context[] | undefined) ?? []).map((c) => [c.name, c])), [E, ctxs]);
  if (!f.contexts.length) return null;
  return (
    <>
      <h4 className="pg-h">Lives in code · {f.contexts.length} context{f.contexts.length > 1 ? 's' : ''}</h4>
      <div className="pg-code">{f.contexts.map((n) => <Ctx key={n} name={n} c={by.get(n)} />)}</div>
    </>
  );
}
