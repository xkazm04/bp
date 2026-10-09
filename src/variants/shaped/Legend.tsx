'use client';
// The Plan-tab legend, shaped variant. General explains the stage swatches and the six icons set into
// each fixture's top edge. A lens explains its outline (drawn here with the same proportions as on the
// plan) and its icon vocabulary, all in that lens's accent.
import type { LensId, ViewId } from '@/lib/data';
import { LENSES } from '@/lib/data';
import { Mark, StageSym } from '@/components/Symbols';
import { LensIcon } from './Panel';
import { LENS_ICON, type IconId } from './icons';

const W = 46, H = 28;
const S = { fill: 'none', stroke: 'var(--ink)', strokeWidth: 1.3 } as const;
const A = { fill: 'none', stroke: 'var(--shp-lens)', strokeWidth: 1.8 } as const;

/** A specimen of the lens outline with its edge marks (strong = deepest form of the shape). */
function Outline({ lens, strong }: { lens: LensId; strong: boolean }) {
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

const SHAPE_WORDS: Record<LensId, [string, string]> = {
  business: ['Ticket, deep bites: high value', 'Shallow bites: low value'],
  design: ['Artboard, crop marks: designed', 'Dashed crops: sketch or wireframe'],
  development: ['Brackets, left spine: progress', 'Right spine: written by agents'],
  operations: ['Pill, gauge: rollout in production', 'Short gauge: partly rolled out'],
  security: ['Three cuts: card data', 'Two dashed cuts: personal, unreviewed'],
  quality: ['Checklist edge: tests passing', 'Hollow boxes: tests not passing'],
};
const VOCAB: Record<LensId, [IconId, string][]> = {
  business: [['ticketHi', 'High value (4 or 5)'], ['ticket', 'Value 1 to 3']],
  design: [['board', 'Has a design'], ['boardNone', 'No design yet']],
  development: [['code', 'Code reviewed by a person'], ['codeUnrev', 'No human review']],
  operations: [['dial', 'Needle: how far it is rolled out'], ['dialOff', 'Live without alerting']],
  security: [['lockCard', 'Card data, reviewed'], ['lockCardOpen', 'Card data, not reviewed'], ['lock', 'Reviewed or not needed'], ['lockOpen', 'Review pending']],
  quality: [['check', 'Tests pass'], ['checkPart', 'Partly passing'], ['checkFail', 'Failing'], ['checkNone', 'Untested']],
};
const ICON_TITLE: Record<LensId, string> = { business: 'Business', design: 'Design', development: 'Development', operations: 'Operations', security: 'Security', quality: 'Quality' };

export function ShapedLegend({ view }: { view: ViewId }) {
  if (view === 'general') {
    return (
      <div className="lg shp-lg">
        <div><StageSym st="live" w={24} h={15} /><span>Built · live</span></div>
        <div><StageSym st="flagged" w={24} h={15} /><span>Partly open</span></div>
        <div><StageSym st="in-review" w={24} h={15} /><span>Inspection</span></div>
        <div><StageSym st="in-dev" w={24} h={15} /><span>Construction</span></div>
        <div><StageSym st="specified" w={24} h={15} /><span>Proposed</span></div>
        <div><StageSym st="idea" w={24} h={15} /><span>Future idea</span></div>
        <div><Mark k="cloud" /><span>Trouble</span></div>
        <div><Mark k="tick" /><span>Watch</span></div>
        <div><Mark k="delta" /><span>Changed</span></div>
        <div><Mark k="work" /><span>Agent working</span></div>
        <div><Mark k="wait" /><span>Waiting for a person</span></div>
        <div><Mark k="pin" /><span>A question (RFI)</span></div>
        <div className="shp-row">{LENSES.map((l) => <span key={l} title={ICON_TITLE[l]}><LensIcon id={LENS_ICON[l]} size={18} title={ICON_TITLE[l]} /></span>)}</div>
        <div className="shp-cap">Tile colour is always the stage. The six icons on each fixture&apos;s top edge are the six lenses, in tab order; red or amber means that lens is in trouble. Pick a lens and only its icon stays, and the tile takes its shape.</div>
      </div>
    );
  }
  const [s1, s2] = SHAPE_WORDS[view];
  return (
    <div className="lg shp-lg shp-lens">
      <div><Outline lens={view} strong /><span>{s1}</span></div>
      <div><Outline lens={view} strong={false} /><span>{s2}</span></div>
      {VOCAB[view].map(([id, t]) => <div key={id}><span className="shp-lic"><LensIcon id={id} size={18} /></span><span>{t}</span></div>)}
      <div><Mark k="cloud" /><span>{ICON_TITLE[view]} trouble</span></div>
      <div><Mark k="tick" /><span>Watch</span></div>
    </div>
  );
}
