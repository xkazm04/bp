'use client';
// The legend. General lists the stage encoding and the shared marks. A lens draws live specimens with
// the variant's own channel (so every variant's legend matches its plan without extra work): a few
// sample features whose evidence differs, each drawn as a small tile with that lens alone.
import { useEffect, useRef } from 'react';
import { LENSES, type Feature, type LensId, type ViewId } from '@/lib/data';
import { readTheme } from '@/engine/theme';
import type { TileGeom } from '@/engine/lens/contract';
import { stageFill } from '@/engine/render/glyphs';
import { Mark, StageSym } from './Symbols';
import { useEngine, useVariant } from './hooks';
import { useTheme } from './ThemeToggle';

function Specimen({ lens, f }: { lens: LensId; f: Feature }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const V = useVariant(), E = useEngine(), mode = useTheme();
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = 46, H = 28;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d')!, th = readTheme(dpr).theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const x = 1, y = 1, w = W - 2, h = H - 2, u = 1;
    const g: TileGeom = { x, y, w, h, form: 'ribbon', u, k: 0.3, strip: { x, y, w, h: 3 }, body: { x: x + 1, y: y + 1, w: w - 2, h: h - 2 }, text: false };
    const live = E.live(f);
    ctx.fillStyle = th.tileBase; ctx.fillRect(x, y, w, h);
    stageFill(ctx, th, f.stage, x, y, w, h, live.rolloutPct, live.progressPct, true);
    const ch = V.expression.channels[lens], r = V.expression.expandedRect ? V.expression.expandedRect(g, lens) : g.body;
    const shape = ch.shape ? new Path2D() : null;
    if (shape) ch.shape!(shape, g, f, 1);
    ctx.save();
    const a = ch.accent ? ch.accent[th.mode] : th.ink;
    ch.marks({ ctx, r, tile: g, f, w: 1, x: 1, compact: false, th, stage: f.stage, now: true, live, accent: a });
    ctx.restore();
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1;
    if (shape) ctx.stroke(shape); else ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }, [lens, f, V, E, mode]);
  return <canvas ref={ref} style={{ width: 46, height: 28 }} aria-hidden="true" />;
}

function samples(fs: readonly Feature[], lens: LensId, key: (f: Feature) => string, n = 6): { f: Feature; label: string }[] {
  const seen = new Map<string, Feature>();
  for (const f of fs) { const k = key(f); if (k && !seen.has(k)) seen.set(k, f); if (seen.size >= n) break; }
  return [...seen.entries()].map(([label, f]) => ({ f, label }));
  void lens;
}

export function Legend({ view }: { view: ViewId }) {
  const E = useEngine(), V = useVariant(), fs = E.M.P.base.features;
  if (view === 'general') {
    return (
      <div className="lg">
        <div><StageSym st="live" w={24} h={15} /><span>Built · live</span></div>
        <div><StageSym st="flagged" w={24} h={15} /><span>Partly open</span></div>
        <div><StageSym st="in-review" w={24} h={15} /><span>Inspection</span></div>
        <div><StageSym st="in-dev" w={24} h={15} /><span>Construction</span></div>
        <div><StageSym st="specified" w={24} h={15} /><span>Proposed</span></div>
        <div><StageSym st="idea" w={24} h={15} /><span>Future idea</span></div>
        <div><Mark k="cloud" /><span>Trouble</span></div>
        <div><Mark k="tick" /><span>Watch</span></div>
        <div><Mark k="delta" /><span>Changed</span></div>
        <div><Mark k="dia" /><span>Unreviewed</span></div>
        <div><Mark k="work" /><span>Agent working</span></div>
        <div><Mark k="wait" /><span>Waiting for a person</span></div>
        <div><Mark k="block" /><span>Blocked</span></div>
        <div><Mark k="fail" /><span>Failed</span></div>
        <div><Mark k="pin" /><span>A question (RFI)</span></div>
        <div><Mark k="ord" /><span>Standing order</span></div>
        <div style={{ gridColumn: '1/3', color: 'var(--ink-2)', fontSize: 13 }}>Tile colour is always the stage. Each lens adds its own marks; in General all six lenses show at once.</div>
      </div>
    );
  }
  const ch = V.expression.channels[view];
  const items = samples(fs, view, (f) => ch.content(f, E.live(f)).parts[0] ?? '');
  return (
    <div className="lg">
      {items.map(({ f, label }) => <div key={label}><Specimen lens={view} f={f} /><span>{label.toLowerCase()}</span></div>)}
      <div><Mark k="cloud" /><span>{view} bad</span></div>
      <div><Mark k="tick" /><span>Watch</span></div>
    </div>
  );
}

export { LENSES };
