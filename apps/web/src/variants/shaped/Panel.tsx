'use client';
// The lens panel in the feature sheet, shaped variant. Every panel carries its lens's icon (the same
// paths the canvas draws). The chosen lens's panel takes that lens's outline (styles.css, via :has)
// and its edge marks as small absolutely placed elements, and its reading follows the reader: design
// is one plain sentence, development is a terse mono readout, the rest use the default rows.
import type { CSSProperties } from 'react';
import type { Feature } from '@bp/core/data';
import { bl, isBuiltinLens, type BuiltinLens } from '../base/legacy';
import { DefaultLensPanel, hmark } from '@/components/sheet/LensPanel';
import type { SheetPanelProps } from '../types';
import { ICONS, dialNeedle, iconFor, type IconId } from './icons';
import { CROP } from './shapes';

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

const DWORD: Record<string, string> = { none: 'No design yet', sketch: 'A sketch so far', wireframe: 'Wireframed', 'hi-fi': 'Hi-fi mock ready', implemented: 'Built to the design', polished: 'Built and polished', 'n/a': 'No interface to design' };
const A11Y: Record<string, string> = { pass: 'passes accessibility', partial: 'partly accessible', fail: 'fails accessibility', unknown: 'accessibility not checked', 'n/a': '' };

/** Edge marks for the chosen panel: the same facts the tile's edges carry on the plan. */
function Edges({ lens, f, rollout }: { lens: BuiltinLens; f: Feature; rollout: number }) {
  switch (lens) {
    case 'operations': {
      const op = bl(f).operations;
      // only an environment the canvas draws a needle for gets a gauge here: 'none', and an unmeasured or
      // not-applicable facet (bl gives ''), have no rollout to report and must not read as a quarter of one
      if (dialNeedle(f, rollout) == null) return null;
      const pc = op.environment === 'production' ? (op.flag ? rollout : 100) : op.environment === 'staging' ? 50 : 25;
      return <span className={'shp-gauge' + (op.environment === 'production' ? '' : ' dotted')} style={{ '--p': pc / 100 } as CSSProperties} />;
    }
    case 'development':
      return <><span className="shp-spine l" style={{ '--p': bl(f).development.progressPct / 100 } as CSSProperties} /><span className="shp-spine r" style={{ '--p': bl(f).development.aiAuthoredPct / 100 } as CSSProperties} /></>;
    case 'quality': {
      const q = bl(f).quality, n = Math.min(q.e2eTests, 12), pass = q.e2eTests ? Math.round((n * q.e2ePassing) / q.e2eTests) : 0;
      return <span className="shp-comb">{Array.from({ length: n }, (_, i) => <i key={i} className={i < pass ? 'on' : q.status === 'failing' ? 'bad' : ''} />)}</span>;
    }
    case 'design': {
      // the statuses shapes.ts draws crops for, read from that table: an unmeasured facet gets none here too
      const st = bl(f).design.status;
      return CROP[st] ? <span className={'shp-crops' + (st === 'sketch' || st === 'wireframe' ? ' dashed' : '')} /> : null;
    }
    default: return null;
  }
}

export function ShapedPanel(props: SheetPanelProps) {
  const { lens, f, expanded, density, model } = props;
  // a lens other than the six built-ins: the default, manifest-driven panel
  if (!isBuiltinLens(lens)) return <DefaultLensPanel {...props} />;
  const id = iconFor(lens, f), rollout = model.sim.rolloutOf(f);
  const cls = ['shp', 'shp-' + lens, 'shp-' + density];
  // the shape classes carry a measured value only: value 0 and data class '' are what bl() gives a feature
  // with no facet, and styles.css has no rule for either, so --shp-n would fall back to its 8 px default
  // (the depth of value 3) and .shp- would leave the security clip-path with --a/--b/--c unset
  if (lens === 'business' && bl(f).business.value > 0) cls.push('shp-v' + bl(f).business.value);
  if (lens === 'security' && bl(f).security.dataClass) cls.push('shp-' + bl(f).security.dataClass);
  const badge = <span className="shp-badge"><LensIcon id={id} size={expanded ? 20 : 17} /></span>;
  // a design status this reader has a sentence for; otherwise the default rows, which word the state
  if (expanded && lens === 'design' && DWORD[bl(f).design.status]) {
    // the design reader gets one plain sentence and nothing to decode
    const de = bl(f).design, a11y = A11Y[de.a11y];
    return (
      <div className={cls.join(' ')}>
        {badge}
        <Edges lens={lens} f={f} rollout={rollout} />
        <h5><span>{props.def.short} · Design</span><span className="h">{hmark(de.health)}</span></h5>
        <div className="shp-fact">{DWORD[de.status]}</div>
        {(a11y || de.specDrift) && <div className="shp-sub">{[a11y && a11y[0].toUpperCase() + a11y.slice(1), de.specDrift ? 'built off the design' : ''].filter(Boolean).join(' · ')}</div>}
      </div>
    );
  }
  return (
    <div className={cls.join(' ')} role="group" aria-label={props.def.name}>
      {badge}
      {expanded && <Edges lens={lens} f={f} rollout={rollout} />}
      <DefaultLensPanel {...props} />
    </div>
  );
}
