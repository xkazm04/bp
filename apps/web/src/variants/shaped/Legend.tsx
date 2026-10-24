'use client';
// The Plan-tab legend, shaped variant. General explains the stage swatches and the lens icons set into
// each fixture's top edge. A lens explains its outline (drawn here with the same proportions as on the
// plan) and its icon vocabulary, all in that lens's accent; each icon row counts its state on the plan and finds it.
import type { ViewId } from '@bp/core/data';
import { isBuiltinLens, type BuiltinLens } from '../base/legacy';
import { Legend, TroubleKey } from '@/components/Legend';
import { useRef } from 'react';
import { useBp, useEngine } from '@/components/hooks';
import { swallow } from '@/components/rail/wide/shell';
import { lensOf } from '@bp/core/model/lens';
import { Mark, StageSym } from '@/components/Symbols';
import { LensIcon } from './Panel';
import { LENS_ICON } from './icons';
import { goNext, legendRows } from './legend-model';
import { GENERAL } from '@bp/core/data/types';

const W = 46, H = 28;
const S = { fill: 'none', stroke: 'var(--ink)', strokeWidth: 1.3 } as const;
const A = { fill: 'none', stroke: 'var(--shp-lens)', strokeWidth: 1.8 } as const;

/** A specimen of the lens outline with its edge marks (strong = deepest form of the shape). */
function Outline({ lens, strong }: { lens: BuiltinLens; strong: boolean }) {
  let body: React.ReactNode;
  switch (lens) {
    case 'business': {
      const d = strong ? 5.5 : 2;
      body = <><path {...S} d={`M1 1H45V${14 - 7}Q${45 - 2 * d} 14 45 ${14 + 7}V27H1V21Q${1 + 2 * d} 14 1 7Z`} /><path {...A} d={`M${45 - 3} 8.5Q${45 - 2 * d - 3} 14 ${45 - 3} 19.5M4 8.5Q${4 + 2 * d} 14 4 19.5`} /></>;
      break;
    }
    case 'security': {
      const c = strong ? 9 : 6.5;
      body = strong
        ? <><path {...S} d={`M1 1H${45 - c}L45 ${1 + c}V${27 - c}L${45 - c} 27H${1 + c * 0.62}L1 ${27 - c * 0.62}Z`} /><path {...A} d={`M${45 - c - 4} 1L45 ${c + 5}M45 ${27 - c - 4}L${45 - c - 4} 27M${1 + c * 0.62 + 4} 27L1 ${27 - c * 0.62 - 4}`} /></>
        : <><path {...S} d={`M1 1H${45 - c}L45 ${1 + c}V${27 - c}L${45 - c} 27H1Z`} /><path {...A} strokeDasharray="3 2" d={`M${45 - c - 4} 1L45 ${c + 5}M45 ${27 - c - 4}L${45 - c - 4} 27`} /></>;
      break;
    }
    case 'operations':
      body = <><rect {...S} x={1} y={1} width={44} height={26} rx={10} /><path d="M8 23.5H38" stroke="var(--shp-lens)" strokeOpacity={0.25} strokeWidth={3} /><path d={`M8 23.5H${8 + (strong ? 30 : 9)}`} stroke="var(--shp-lens)" strokeWidth={3} /></>;
      break;
    case 'development':
      body = <><path {...S} d="M1 1H45V7H41V21H45V27H1V21H5V7H1Z" /><path d={`M3 ${21 - (strong ? 14 : 6)}V21`} stroke="var(--shp-lens)" strokeWidth={2.5} /><path d={`M43 ${21 - (strong ? 11 : 3)}V21`} stroke="var(--shp-lens)" strokeWidth={2.5} strokeOpacity={0.6} /></>;
      break;
    case 'quality': {
      const n = 4, on = strong ? 4 : 2;
      const notch = Array.from({ length: n }, (_, i) => 6 + i * 5);
      body = <><path {...S} d={`M1 1H45V27H1${notch.slice().reverse().map((y) => `V${y + 3}H5V${y}H1`).join('')}Z`} />{notch.map((y, i) => <rect key={i} x={1.6} y={y + 0.6} width={2.8} height={1.8} fill={i < on ? 'var(--shp-lens)' : 'none'} stroke="var(--shp-lens)" strokeWidth={0.8} />)}</>;
      break;
    }
    default:
      body = <><rect {...S} x={4} y={4} width={38} height={20} /><path {...A} strokeWidth={1.3} strokeDasharray={strong ? undefined : '2.5 2'} d="M2 4H-2M4 2V-2M44 4H48M42 2V-2M2 24H-2M4 26V30M44 24H48M42 26V30" /></>;
  }
  return <svg width={W + 4} height={H + 4} viewBox={`-2 -2 ${W + 4} ${H + 4}`} aria-hidden="true" style={{ overflow: 'visible' }}>{body}</svg>;
}

const SHAPE_WORDS: Record<BuiltinLens, [string, string]> = {
  business: ['Ticket, deep bites: high value', 'Shallow bites: low value'],
  design: ['Artboard, crop marks: designed', 'Dashed crops: sketch or wireframe'],
  development: ['Brackets, left spine: progress', 'Right spine: written by agents'],
  operations: ['Pill, gauge: rollout in production', 'Short gauge: partly rolled out'],
  security: ['Three cuts: card data', 'Two dashed cuts: personal, unreviewed'],
  quality: ['Checklist edge: tests passing', 'Hollow boxes: tests not passing'],
};
/**
 * The lens's icon key as a finder: each row counts the features on this plan in that state and, pressed (click, Enter,
 * Space), flies to the next one with the highlight; pressed again, the one after. A row with none is aria-disabled.
 * Keyed by the view, so the cursor starts over on a lens switch.
 */
function Finder({ lens }: { lens: BuiltinLens }) {
  const E = useEngine(), M = E.M;
  useBp((s) => s.t);   // the counts speak of the plan as drawn now: a date change re-reads them
  const rows = legendRows(lens, M.P.features.filter((f) => M.L.TILE[f.id]));
  const cur = useRef<string | null>(null);
  return (
    <>
      {rows.map((r) => {
        const n = r.ids.length, go = () => { cur.current = goNext(E, r.ids, cur.current); };
        return (
          <button key={r.key} type="button" className="shp-fd" aria-disabled={n ? undefined : true} aria-label={`${r.words}: ${n} on this plan${n ? ', go to next' : ''}`}
            onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { swallow(e); go(); } }}>
            <span className="shp-lic">{r.icon ? <LensIcon id={r.icon} size={18} /> : <b className="shp-q" aria-hidden="true">{r.key === 'na' ? '–' : '?'}</b>}</span>
            <span>{r.words}</span><span className="shp-n">{n}</span>
          </button>
        );
      })}
    </>
  );
}
export function ShapedLegend({ view }: { view: ViewId }) {
  // the enabled lenses, in registry order: the same list composeGeneral lays chips out for, so the key
  // follows `?lenses=` and a product with more (or fewer) lenses than the six built-ins
  const P = useEngine().M.P;
  const name = (id: string) => lensOf(P, id)?.name ?? id;
  if (view === GENERAL) {
    const shown = P.lenses.filter((l) => isBuiltinLens(l.id)), rest = P.lenses.length - shown.length;
    return (
      <div className="lg shp-lg">
        <div><StageSym st="live" w={24} h={15} /><span>Built · live</span></div>
        <div><StageSym st="flagged" w={24} h={15} /><span>Partly open</span></div>
        <div><StageSym st="in-review" w={24} h={15} /><span>Inspection</span></div>
        <div><StageSym st="in-dev" w={24} h={15} /><span>Construction</span></div>
        <div><StageSym st="specified" w={24} h={15} /><span>Proposed</span></div>
        <div><StageSym st="idea" w={24} h={15} /><span>Future idea</span></div>
        <TroubleKey />
        <div><Mark k="cloud" /><span>Trouble</span></div>
        <div><Mark k="tick" /><span>Watch</span></div>
        <div><Mark k="delta" /><span>Changed</span></div>
        <div><Mark k="work" /><span>Agent working</span></div>
        <div><Mark k="wait" /><span>Waiting for a person</span></div>
        <div><Mark k="pin" /><span>A question (RFI)</span></div>
        <div className="shp-row">{shown.map((l) => <span key={l.id} title={l.name}><LensIcon id={LENS_ICON[l.id as BuiltinLens]} size={18} title={l.name} /></span>)}</div>
        <div className="shp-cap">Tile colour is always the stage. The icons on each fixture&apos;s top edge are the {P.lenses.length} enabled lenses, one each, in tab order; red or amber means that lens is in trouble. Pick a lens and only its icon stays, and the tile takes its shape.{rest > 0 ? ` The other ${rest} draw their manifest glyph instead of an icon of their own.` : ''}</div>
      </div>
    );
  }
  // a lens other than the six built-ins: the shared legend (specimens drawn by its manifest channel)
  if (!isBuiltinLens(view)) return <Legend view={view} />;
  const [s1, s2] = SHAPE_WORDS[view];
  return (
    <div className="lg shp-lg shp-lens">
      <div><Outline lens={view} strong /><span>{s1}</span></div>
      <div><Outline lens={view} strong={false} /><span>{s2}</span></div>
      <Finder key={view} lens={view} />
      <div><Mark k="cloud" /><span>{name(view)} trouble</span></div>
      <div><Mark k="tick" /><span>Watch</span></div>
    </div>
  );
}
