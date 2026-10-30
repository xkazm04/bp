'use client';
// The plan's empty state: a live product whose map has loaded with no features draws a blank sheet, which reads as a
// plan that failed to draw. Say what it is and what makes one (/adopt-bp writes the product tree), with the project
// switcher beside it to open another product. The Kettle sample is never empty, so it never shows there.
import { useEngine, useLive, useScanCtx } from './hooks';

export function EmptyPlan() {
  const E = useEngine(), ctx = useScanCtx();
  useLive(); // a newer map refreshes the model in place: re-read the count on every live update
  if (!ctx.slug || E.M.P.base.features.length > 0) return null;
  // the header's project switcher: the same menu its own button opens
  const projects = () => document.querySelector<HTMLButtonElement>('.projsw-btn')?.click();
  return (
    <div className="bp-empty" role="status">
      <b>Nothing mapped yet</b>
      <span>This product&apos;s map has no features. Run <code>/adopt-bp</code> in its checkout to write the product tree; the plan fills in when the map arrives.</span>
      <button type="button" className="bt" onClick={projects}>Projects</button>
    </div>
  );
}
