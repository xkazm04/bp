// The change map's overlay: one rect per grid cell where a pixel moved (opacity grows with the largest channel change in
// the cell), and the dashed box around every moved pixel, drawn as an SVG over the after screen. The grid comes from
// useChangeMap (the worker); this only draws it.
import { memo } from 'react';
import { GRID_H, GRID_W, bboxCells, type PixGrid } from '@bp/core/train/pixels';
import './Screens.css';

export const ChangeMap = memo(function ChangeMap({ grid }: { grid: PixGrid }) {
  const box = bboxCells(grid);
  return (
    <svg className="tr-heat" viewBox={`0 0 ${GRID_W} ${GRID_H}`} preserveAspectRatio="none" aria-hidden="true">
      {grid.cells.map((d, i) => d ? <rect key={i} x={i % GRID_W} y={Math.floor(i / GRID_W)} width="1" height="1" opacity={Math.min(1, 0.35 + d / 160).toFixed(2)} /> : null)}
      {box ? <rect className="bb" x={box.x} y={box.y} width={box.w} height={box.h} /> : null}
    </svg>
  );
});
