// One performance row's range strip: the baseline median's noise band, a dot per baseline run, the after as a marker,
// and the target and warn lines, on one 0..max scale (src/lib/train/perf.ts rangeScale). Positions are percentages
// on absolutely placed spans: no layout read, no canvas.
import { memo } from 'react';
import { rangeScale, type PerfFigures } from '@bp/core/train/perf';
import { num } from '../ui/tables';
import './PerfTable.css';

export const PerfRange = memo(function PerfRange({ f, unit, target, warn }: { f: PerfFigures; unit: string; target?: number; warn?: number }) {
  const s = rangeScale(f, target, warn), lo = Math.max(0, f.median - f.noise), hi = Math.min(s.max, f.median + f.noise);
  const label = `baseline runs ${f.runs.map(num).join(', ')} ${unit}` + (f.after !== undefined ? `, after ${num(f.after)} ${unit}` : '') + (target !== undefined ? `, target ${num(target)} ${unit}` : '');
  return (
    <div className="tr-pr" role="img" aria-label={label}>
      <span className="tr-pr-band" style={{ left: s.x(lo), width: `calc(${s.x(hi)} - ${s.x(lo)})` }} title={`noise: ±${num(f.noise)} ${unit} around the baseline median`} />
      {target !== undefined ? <span className="tr-pr-t" style={{ left: s.x(target) }} title={`target ${num(target)} ${unit}`}><b>target</b></span> : null}
      {warn !== undefined ? <span className="tr-pr-t warn" style={{ left: s.x(warn) }} title={`warn at ${num(warn)} ${unit}`}><b>warn</b></span> : null}
      {f.runs.map((v, i) => <span key={i} className="tr-pr-run" style={{ left: s.x(v) }} title={`baseline run: ${num(v)} ${unit}`} />)}
      {f.after !== undefined ? <span className="tr-pr-after" style={{ left: s.x(f.after) }} title={`after: ${num(f.after)} ${unit}`} /> : null}
    </div>
  );
});
