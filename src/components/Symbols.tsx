// Small SVG symbols shared by the legend, lists and the sheet (stage swatches, swarm marks).
import type { Stage } from '@/lib/data';

export function PatternDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <pattern id="lhS" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink)" strokeWidth="1" opacity=".7" /></pattern>
        <pattern id="lhX" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4M0 0H4" stroke="var(--ink)" strokeWidth=".8" opacity=".7" /></pattern>
      </defs>
    </svg>
  );
}

/** A stage swatch: the same encoding the plan uses for a tile's base fill and outline. */
export function StageSym({ st, w = 22, h = 14 }: { st: Stage | null; w?: number; h?: number }) {
  const r = { x: 0, y: 0, width: w, height: h, fill: 'none', stroke: 'var(--ink)', strokeWidth: 1.3 };
  let body: React.ReactNode;
  if (st === 'live') body = <><rect width={w} height={h} fill="var(--ink)" fillOpacity={0.3} /><rect {...r} /></>;
  else if (st === 'flagged') body = <><rect width={w * 0.45} height={h} fill="var(--ink)" fillOpacity={0.34} /><rect {...r} /></>;
  else if (st === 'in-review') body = <><rect width={w} height={h} fill="url(#lhX)" /><rect {...r} /></>;
  else if (st === 'in-dev') body = <><rect width={w} height={h} fill="url(#lhS)" /><rect y={h - 3} width={w * 0.6} height={3} fill="var(--ink)" /><rect {...r} /></>;
  else if (st === 'specified') body = <rect {...r} strokeDasharray="4 2.5" />;
  else if (st === 'idea') body = <rect {...r} strokeDasharray="1 2.4" opacity={0.75} />;
  else if (st === 'deprecated') body = <><rect {...r} /><path d={`M0 0L${w} ${h}M${w} 0L0 ${h}`} stroke="var(--ink)" strokeWidth={1.1} /></>;
  else body = <rect {...r} strokeDasharray="1 3" opacity={0.4} />;
  return <svg width={w + 2} height={h + 2} viewBox={`-1 -1 ${w + 2} ${h + 2}`} aria-hidden="true">{body}</svg>;
}

type MarkKind = 'cloud' | 'tick' | 'delta' | 'dia' | 'work' | 'wait' | 'block' | 'fail' | 'pin' | 'ord' | 'paused';
export function Mark({ k, w = 28, h = 19 }: { k: MarkKind; w?: number; h?: number }) {
  let inner: React.ReactNode = null;
  switch (k) {
    case 'cloud': inner = <path d="M2 2 q3 -3 6 0 q3 -3 6 0 q3 -3 6 0 q3 -3 4 0 q3 3 0 6 q3 3 0 6 q-1 3 -4 2 q-3 3 -6 0 q-3 3 -6 0 q-3 3 -6 -1 q-3 -3 0 -6 q-3 -3 0 -7z" fill="none" stroke="var(--red)" strokeWidth="1.3" />; break;
    case 'tick': inner = <><rect x="3" y="5" width="20" height="11" fill="none" stroke="var(--ink)" strokeWidth="1" opacity=".5" /><path d="M14 4 l3 -4 M18 4 l3 -4" stroke="var(--amber)" strokeWidth="1.8" strokeLinecap="round" /></>; break;
    case 'delta': inner = <path d="M13 2 l8 13 h-16z" fill="var(--delta)" />; break;
    case 'dia': inner = <path d="M13 2 l5 7 l-5 7 l-5 -7z" fill="none" stroke="var(--ink)" strokeWidth="1.2" />; break;
    case 'work': inner = <><circle cx="13" cy="9" r="4.5" fill="var(--mint)" stroke="var(--glyph-edge)" strokeWidth="1.2" /><path d="M13 1.5v2.2M13 14.3v2.2M5.5 9h2.2M18.3 9h2.2" stroke="var(--mint)" strokeWidth="1.3" /></>; break;
    case 'wait': inner = <><circle cx="13" cy="9" r="5" fill="none" stroke="var(--amber)" strokeWidth="2" /><circle cx="13" cy="9" r="1.6" fill="var(--amber)" /></>; break;
    case 'paused': inner = <><circle cx="13" cy="9" r="5" fill="none" stroke="var(--ink)" strokeWidth="1.6" /><path d="M11.4 6.5v5M14.6 6.5v5" stroke="var(--ink)" strokeWidth="1.4" /></>; break;
    case 'block': inner = <><rect x="8" y="4" width="10" height="10" fill="var(--red)" stroke="var(--glyph-edge)" strokeWidth="1.2" /><path d="M10.5 9h5" stroke="var(--glyph-edge)" strokeWidth="1.6" /></>; break;
    case 'fail': inner = <><circle cx="13" cy="9" r="5" fill="none" stroke="var(--red)" strokeWidth="2" /><path d="M10.5 6.5l5 5M15.5 6.5l-5 5" stroke="var(--red)" strokeWidth="1.8" /></>; break;
    case 'pin': inner = <><path d="M9 16V2" stroke="var(--amber)" strokeWidth="2" /><path d="M9 2l9 3-9 3z" fill="var(--amber)" /></>; break;
    case 'ord': inner = <><circle cx="13" cy="9" r="7" fill="none" stroke="var(--amber)" strokeWidth="1.6" strokeDasharray="3 2" /><path d="M10.6 9a2.4 2.6 0 1 0 4.8 0a2.4 2.6 0 1 0 -4.8 0" fill="none" stroke="var(--amber)" strokeWidth="1.3" /></>; break;
  }
  return <svg width={w} height={h} viewBox="-1 -1 28 19" aria-hidden="true">{inner}</svg>;
}

export function agentMark(st: string): MarkKind {
  return st === 'working' ? 'work' : st === 'waiting' ? 'wait' : st === 'blocked' ? 'block' : st === 'failed' ? 'fail' : 'paused';
}
