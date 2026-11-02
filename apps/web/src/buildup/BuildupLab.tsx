'use client';
// The build-up lab: picks a product and a source, loads the product's plan, and hands the build-up a source. The
// build-up is variant B of the blueprint-buildup contest ("the outline becomes the building", owner's winner 2026-11-02;
// A and E were removed). It fills the window; the lab's own controls are one small bar at the bottom right (hidden with `h`).
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useTheme } from '@/components/ThemeToggle';
import type { BuildupPlan, BuildupSource, BuildupVariantProps } from './contract';
import { fetchBuildupPlan } from './plan';
import { presetSource, type PresetMode } from './preset';
import { liveSource } from './live';
import { useReducedMotion } from '@/onboarding/motion';
import styles from './lab.module.css';

const loading = () => <div className={styles.note}>Loading the build-up…</div>;
const Buildup: ComponentType<BuildupVariantProps> = dynamic(() => import('./b-outline'), { ssr: false, loading });

function useQuery() {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => {
    const read = () => setQ(new URLSearchParams(location.search));
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(location.search);
    n.set(k, v);
    history.replaceState(null, '', '?' + n.toString());
    setQ(n);
  };
  return [q, set] as const;
}

export function BuildupLab() {
  const [q, set] = useQuery();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const product = q?.get('product') ?? 'kettle';
  const mode: PresetMode = q?.get('source') === 'real' ? 'real' : 'demo';
  /** `?source=live&feed=<origin>`: a running onboarding's event feed (scripts/buildup/onboard-live.mjs). */
  const feed = q?.get('source') === 'live' ? q.get('feed') : null;
  const speed = Math.max(0.25, Math.min(8, Number(q?.get('speed') ?? '1') || 1));
  const [plan, setPlan] = useState<BuildupPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<string[]>(['kettle']);
  const [bar, setBar] = useState(true);

  useEffect(() => {
    fetch('/api/products', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { slug: string }[]) => setProducts(['kettle', ...list.map((p) => p.slug).filter((s) => s !== 'kettle')]))
      .catch(() => {});
    const key = (e: KeyboardEvent) => { if (e.key === 'h' && !(e.target instanceof HTMLInputElement)) setBar((b) => !b); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    if (!q || feed) return;
    const ac = new AbortController();
    setPlan(null); setError(null);
    fetchBuildupPlan(product, ac.signal).then(setPlan, (e: Error) => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [q, product, feed]);

  const source: BuildupSource | null = useMemo(() => (feed ? liveSource(feed) : plan ? presetSource(plan, mode, speed) : null), [feed, plan, mode, speed]);
  useEffect(() => {
    if (!source) return;
    // the variant subscribes during its own effect; start on the next tick so `begin` is never missed
    const t = setTimeout(() => source.start(), 0);
    return () => { clearTimeout(t); source.dispose(); };
  }, [source]);

  return (
    <div className={styles.lab}>
      {error ? <div className={styles.note}>No plan for {product}: {error}</div>
        : source ? <Buildup key={(feed ?? product) + mode + speed} source={source} reducedMotion={reduced} theme={theme} />
          : <div className={styles.note}>Reading {product}…</div>}
      {bar && (
        <div className={styles.bar} role="toolbar" aria-label="Build-up lab">
          <select aria-label="Product" value={product} onChange={(e) => set('product', e.target.value)}>
            {products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select aria-label="Source" value={mode} onChange={(e) => set('source', e.target.value)}>
            <option value="demo">Preset · demo pace</option>
            <option value="real">Preset · real-run shape</option>
          </select>
          <select aria-label="Speed" value={String(speed)} onChange={(e) => set('speed', e.target.value)}>
            {['0.5', '1', '2', '4', '8'].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
          <button type="button" onClick={() => source?.replay()} disabled={!source}>Replay</button>
        </div>
      )}
    </div>
  );
}
