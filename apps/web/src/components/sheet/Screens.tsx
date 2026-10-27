'use client';
// The feature sheet's Screens strip (live products only): the scan's screenshots of this feature,
// one thumbnail per size and theme (the latest run that has it), with a badge when the harness
// report of that shot records console errors. A thumbnail opens the viewer under the strip: run A
// and run B (default: the latest two runs with that size and theme), side by side or as a swipe.
// Kettle has no store, so no strip. Images come from the shots route; nothing is drawn on the canvas.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feature } from '@bp/core/data';
import { baseId, shotErrors, shotUrl, shotsByRun } from '@bp/core/model';
import type { Run, Shot } from '@bp/core/scan/types';
import { useLive, type LiveInfo } from '../hooks';

interface Take { run: Run | null; runId: string; shot: Shot }
const keyOf = (s: Shot) => (s.size ?? 'any size') + ' · ' + (s.theme ?? 'any theme');
const runLabel = (t: Take) => (t.run ? t.run.started_at.slice(0, 10) + ' ' + t.run.started_at.slice(11, 16) : t.shot.captured_at.slice(0, 16).replace('T', ' ')) + ' · ' + t.runId;

// One scan image. A file gone from the store (the route answers 404) is stated, not left as an empty frame.
function Shot({ src, alt, label = alt, style }: { src: string; alt: string; label?: string; style?: React.CSSProperties }) {
  const [bad, setBad] = useState(false);
  if (bad) return <span className="miss" role="img" aria-label={label + ': missing from the store'} style={style}>Screenshot missing from the store</span>;
  return <img src={src} alt={alt} style={style} loading="lazy" decoding="async" onError={() => setBad(true)} />;
}

function Img({ slug, t, alt }: { slug: string; t: Take; alt: string }) {
  const n = shotErrors(t.shot);
  return (
    <figure className="shot">
      <Shot key={t.shot.id} src={shotUrl(slug, t.shot)} alt={alt} />
      <figcaption>{runLabel(t)}{n ? <span className="err" title="Console errors in the harness report">{n} console error{n > 1 ? 's' : ''}</span> : null}</figcaption>
    </figure>
  );
}

// The viewer holds the run the reader CHOSE (its id), not a position in the list: the list is rebuilt on every scan poll, so a
// position would point past the end when runs are pruned and at a different run when a newer one arrives. A chosen run that
// is gone, and a reader who has not chosen, fall back to the default position (A: the second newest, B: the newest).
export function pickRun(takes: Take[], id: string | null, dflt: number): number {
  const i = id === null ? -1 : takes.findIndex((t) => t.runId === id);
  return i >= 0 ? i : Math.max(0, Math.min(dflt, takes.length - 1));
}

export function Viewer({ slug, k, takes, name, close }: { slug: string; k: string; takes: Take[]; name: string; close: () => void }) {
  const [aId, setAId] = useState<string | null>(null), [bId, setBId] = useState<string | null>(null);
  const a = pickRun(takes, aId, 1), b = pickRun(takes, bId, 0);
  const [mode, setMode] = useState<'side' | 'swipe'>('side'), [cut, setCut] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  // reduced motion: the viewer jumps into view instead of travelling (docs/blueprint-ui.md). Read at the
  // moment of the scroll, as the engine does (Engine.ts:153): motion's useReducedMotion is false on the
  // first render, which is exactly the render this effect runs after.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  const A = takes[a], B = takes[b], two = takes.length > 1;
  const pick = (v: number, set: (id: string) => void, label: string) => (
    <label>{label}<select value={v} onChange={(e) => set(takes[+e.target.value].runId)}>{takes.map((t, i) => <option key={t.shot.id} value={i}>{runLabel(t)}</option>)}</select></label>
  );
  return (
    <div className="shotv" ref={ref} tabIndex={-1} data-keys="own" role="region" aria-label={'Screens of ' + name + ', ' + k}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <div className="bar">
        <b>{k}</b>
        {two ? <>{pick(a, setAId, 'A')}{pick(b, setBId, 'B')}
          <span className="seg" role="group" aria-label="Compare">
            <button type="button" aria-pressed={mode === 'side'} onClick={() => setMode('side')}>Side by side</button>
            <button type="button" aria-pressed={mode === 'swipe'} onClick={() => setMode('swipe')}>Swipe</button>
          </span></> : <span className="hint">One run has this screen: compare needs two.</span>}
        <button type="button" className="bt" onClick={close}>Close · Esc</button>
      </div>
      {!two || mode === 'side' ? (
        <div className={two ? 'pair' : 'one'}>
          {two && <Img slug={slug} t={A} alt={name + ', run A'} />}
          <Img slug={slug} t={B} alt={name + (two ? ', run B' : '')} />
        </div>
      ) : (
        <div className="swipe">
          <div className="stack">
            <Shot key={A.shot.id} src={shotUrl(slug, A.shot)} alt={name + ', run A'} />
            <Shot key={B.shot.id} src={shotUrl(slug, B.shot)} alt={name + ', run B'} style={{ clipPath: `inset(0 0 0 ${cut}%)` }} />
            <i className="cut" style={{ left: cut + '%' }} />
          </div>
          <input type="range" min={0} max={100} value={cut} onChange={(e) => setCut(+e.target.value)} aria-label="Swipe between run A (left) and run B (right)" />
          <div className="ends"><span>A · {runLabel(A)}</span><span>B · {runLabel(B)}</span></div>
        </div>
      )}
    </div>
  );
}

/** What stands where the screens would be when the lens expected shots and there are none: whether to wait, retry or
 *  stop. null for Kettle, which has no store to ask. Only the status and the scan are read, never a lens id. */
export function noScreensWhy(live: LiveInfo | null): string | null {
  if (!live) return null;
  const { status, error, scan } = live.product;
  if (status === 'missing') return 'No scan store for this product, so there are no screens to show.';
  if (status === 'error') return 'The scan could not be read' + (error ? ' (' + error + ')' : '') + ', so its screens are not available.';
  if (status === 'loading') return 'Loading the live scan, screens will appear here if it has any.';
  if (status === 'offline') return 'The live scan is offline and reconnecting; ' + (scan ? 'its data so far has no screens of this feature.' : 'its screens will appear once it is back.');
  return scan ? 'No screens of this feature in this scan.' : 'The scan has not arrived yet.';
}

/** `expected`: the lens measures through the harness, so a missing strip would hide missing evidence: say why instead. */
export function ScreensStrip({ f, expected = false }: { f: Feature; expected?: boolean }) {
  const live = useLive(), [open, setOpen] = useState<string | null>(null), scan = live?.product.scan, fid = baseId(f.id);
  // grouped by what it reads: the scan and the feature (a re-render for any other reason regroups nothing)
  const g = useMemo(() => {
    if (!scan) return null;
    const groups = shotsByRun(scan, fid);
    if (!groups.length) return null;
    // per size and theme: every run's take of it, newest run first
    const by = new Map<string, Take[]>();
    for (const g of groups) for (const s of g.shots) { const k = keyOf(s); let a = by.get(k); if (!a) by.set(k, (a = [])); if (!a.some((t) => t.runId === g.runId)) a.push({ run: g.run, runId: g.runId, shot: s }); }
    return { groups, by, keys: [...by.keys()].sort() };
  }, [scan, fid]);
  if (!live) return null;
  if (!g) { const why = expected ? noScreensWhy(live) : null; return why ? <p className="pg-unscr" role="status">{why}</p> : null; }
  const { groups, by, keys } = g;
  return (
    <div className="dsec scr">
      <h4>Screens · {keys.length} · {groups.length} run{groups.length > 1 ? 's' : ''}</h4>
      <div className="thumbs">
        {keys.map((k) => {
          const t = by.get(k)![0], n = shotErrors(t.shot);
          return (
            <button key={k} type="button" className={'thumb' + (open === k ? ' on' : '')} aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} title={'Open ' + k + (by.get(k)!.length > 1 ? ' and compare runs' : '')}>
              <Shot key={t.shot.id} src={shotUrl(live.slug, t.shot)} alt="" label={'Screenshot ' + k} />
              <span>{k}</span>
              {n ? <em title="Console errors in the harness report">{n}</em> : null}
            </button>
          );
        })}
      </div>
      {open && by.has(open) && <Viewer key={open} slug={live.slug} k={open} takes={by.get(open)!} name={f.name} close={() => setOpen(null)} />}
    </div>
  );
}
