'use client';
// The lens panel in the feature sheet, shaped variant. Every panel carries its lens's icon (the same
// paths the canvas draws). The chosen lens's panel takes that lens's outline (styles.css, via :has)
// and its edge marks as small absolutely placed elements, and its reading follows the reader: design
// is one plain sentence, development is a terse mono readout, the rest use the default rows.
import type { CSSProperties } from 'react';
import type { Feature, LensId } from '@/lib/data';
import { DefaultLensPanel } from '@/components/sheet/LensPanel';
import { SHEET } from '@/lib/model';
import type { SheetPanelProps } from '../types';
import { ICONS, iconFor, type IconId } from './icons';

export function LensIcon({ id, size = 18, title }: { id: IconId; size?: number; title?: string }) {
  const d: { s: string; f?: string } = ICONS[id];
  return (
    <svg className="shp-ic" width={size} height={size} viewBox="0 0 16 16" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={d.s} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {d.f && <path d={d.f} fill="currentColor" />}
    </svg>
  );
}

const LENS_NAME: Record<LensId, string> = { business: 'Business', design: 'Design', development: 'Development', operations: 'Operations', security: 'Security', quality: 'Quality' };
const DWORD: Record<string, string> = { none: 'No design yet', sketch: 'A sketch so far', wireframe: 'Wireframed', 'hi-fi': 'Hi-fi mock ready', implemented: 'Built to the design', polished: 'Built and polished', 'n/a': 'No interface to design' };
const A11Y: Record<string, string> = { pass: 'passes accessibility', partial: 'partly accessible', fail: 'fails accessibility', unknown: 'accessibility not checked', 'n/a': '' };

/** Edge marks for the chosen panel: the same facts the tile's edges carry on the plan. */
function Edges({ lens, f, rollout }: { lens: LensId; f: Feature; rollout: number }) {
  switch (lens) {
    case 'operations': {
      const op = f.operations;
      if (op.environment === 'none') return null;
      const pc = op.environment === 'production' ? (op.flag ? rollout : 100) : op.environment === 'staging' ? 50 : 25;
      return <span className={'shp-gauge' + (op.environment === 'production' ? '' : ' dotted')} style={{ '--p': pc / 100 } as CSSProperties} />;
    }
    case 'development':
      return <><span className="shp-spine l" style={{ '--p': f.development.progressPct / 100 } as CSSProperties} /><span className="shp-spine r" style={{ '--p': f.development.aiAuthoredPct / 100 } as CSSProperties} /></>;
    case 'quality': {
      const q = f.quality, n = Math.min(q.e2eTests, 12), pass = q.e2eTests ? Math.round((n * q.e2ePassing) / q.e2eTests) : 0;
      return <span className="shp-comb">{Array.from({ length: n }, (_, i) => <i key={i} className={i < pass ? 'on' : q.status === 'failing' ? 'bad' : ''} />)}</span>;
    }
    case 'design':
      return f.design.status === 'none' || f.design.status === 'n/a' ? null : <span className={'shp-crops' + (f.design.status === 'sketch' || f.design.status === 'wireframe' ? ' dashed' : '')}><i /><i /><i /><i /></span>;
    default: return null;
  }
}

export function ShapedPanel(props: SheetPanelProps) {
  const { lens, f, expanded, density, model } = props;
  const id = iconFor(lens, f), rollout = model.sim.rolloutOf(f);
  const cls = ['shp', 'shp-' + lens, 'shp-' + density];
  if (lens === 'business') cls.push('shp-v' + f.business.value);
  if (lens === 'security') cls.push('shp-' + f.security.dataClass);
  const badge = <span className="shp-badge"><LensIcon id={id} size={expanded ? 20 : 17} /></span>;
  if (expanded && lens === 'design') {
    // the design reader gets one plain sentence and nothing to decode
    const de = f.design, sh = SHEET.design, a11y = A11Y[de.a11y];
    return (
      <div className={cls.join(' ')}>
        {badge}
        <Edges lens={lens} f={f} rollout={rollout} />
        <h5><span>{sh.no} · Design</span><span className="h">{de.health === 'bad' ? 'BAD' : de.health === 'watch' ? 'WATCH' : de.health === 'good' ? 'GOOD' : 'N/A'}</span></h5>
        <div className="shp-fact">{DWORD[de.status] ?? de.status}</div>
        {(a11y || de.specDrift) && <div className="shp-sub">{[a11y && a11y[0].toUpperCase() + a11y.slice(1), de.specDrift ? 'built off the design' : ''].filter(Boolean).join(' · ')}</div>}
      </div>
    );
  }
  return (
    <div className={cls.join(' ')} aria-label={LENS_NAME[lens]}>
      {badge}
      {expanded && <Edges lens={lens} f={f} rollout={rollout} />}
      <DefaultLensPanel {...props} />
    </div>
  );
}
