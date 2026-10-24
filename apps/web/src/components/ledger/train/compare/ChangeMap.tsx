// The change map's overlay: one rect per grid cell where a pixel moved (opacity grows with the largest channel change in
// the cell), and the dashed box around every moved pixel, drawn as an SVG over the after screen. The grid comes from
// useChangeMap (the worker); this only draws it.
// The svg's viewBox has the CAPTURE's aspect ratio (grid.w / grid.h) and is fitted with `meet`, exactly as the frame fits
// the image (`object-fit: contain`, ShotFigure.css), so a cell lands over the pixels it describes at any capture size:
// a stretched 16:9 viewBox (`preserveAspectRatio="none"`) put a 1280x800 capture's cells 5 % of the frame off.
import { memo } from 'react';
import { GRID_H, GRID_W, bboxCells, type FocusCrop, type PixGrid } from '@bp/core/train/pixels';
import './Screens.css';

/** The overlay's viewBox width in grid-row units (its height is GRID_H) and the width of one cell in them. */
export function mapView(grid: Pick<PixGrid, 'w' | 'h'>): { vw: number; cw: number } {
  const vw = grid.w > 0 && grid.h > 0 ? (GRID_H * grid.w) / grid.h : GRID_W;
  return { vw, cw: vw / GRID_W };
}

/** `crop` (the changed-area mode, focusCrop) narrows the viewBox to that rect of the capture, so the cells stay over
 *  the pixels they describe in a frame that shows only the crop; the dashed box keeps its on-screen weight. */
export const ChangeMap = memo(function ChangeMap({ grid, crop }: { grid: PixGrid; crop?: FocusCrop }) {
  const box = bboxCells(grid), { vw, cw } = mapView(grid), k = crop ? crop.w : 1;
  const vb = crop ? `${crop.x * vw} ${crop.y * GRID_H} ${crop.w * vw} ${crop.h * GRID_H}` : `0 0 ${vw} ${GRID_H}`;
  const line = crop ? { strokeWidth: 0.08 * k, strokeDasharray: `${0.3 * k} ${0.2 * k}` } : undefined;
  return (
    <svg className="tr-heat" viewBox={vb} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {grid.cells.map((d, i) => d ? <rect key={i} x={(i % GRID_W) * cw} y={Math.floor(i / GRID_W)} width={cw} height="1" opacity={Math.min(1, 0.35 + d / 160).toFixed(2)} /> : null)}
      {box ? <rect className="bb" x={box.x * cw} y={box.y} width={box.w * cw} height={box.h} style={line} /> : null}
    </svg>
  );
});
