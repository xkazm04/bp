'use client';
// The build-up lab: picks a variant, a product and a source, loads the product's plan, and hands the variant a source.
// The variant fills the window; the lab's own controls are one small bar at the bottom right (hidden with `h`).
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useTheme } from '@/components/ThemeToggle';
import type { BuildupPlan, BuildupSource, BuildupVariantProps } from './contract';
import { fetchBuildupPlan } from './plan';
import { presetSource, type PresetMode } from './preset';
import styles from './lab.module.css';

const loading = () => <div className={styles.note}>Loading variant…</div>;
const VARIANTS: Record<string, { name: string; C: ComponentType<BuildupVariantProps> }> = {
  a: { name: 'A · Axonometric raise', C: dynamic(() => import('./a-axonometric'), { ssr: false, loading }) },
  b: { name: 'B · Outline becomes the building', C: dynamic(() => import('./b-outline'), { ssr: false, loading }) },
  e: { name: 'E · Bubble diagram', C: dynamic(() => import('./e-bubble'), { ssr: false, loading }) },
};

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

function useReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setR(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return r;
}

export function BuildupLab() {
  const [q, set] = useQuery();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const v = q?.get('v') ?? 'a';
  const product = q?.get('product') ?? 'kettle';
  const mode: PresetMode = q?.get('source') === 'real' ? 'real' : 'demo';
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
    if (!q) return;
    const ac = new AbortController();
    setPlan(null); setError(null);
    fetchBuildupPlan(product, ac.signal).then(setPlan, (e: Error) => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [q, product]);

  const source: BuildupSource | null = useMemo(() => (plan ? presetSource(plan, mode, speed) : null), [plan, mode, speed]);
  useEffect(() => {
    if (!source) return;
    // the variant subscribes during its own effect; start on the next tick so `begin` is never missed
    const t = setTimeout(() => source.start(), 0);
    return () => { clearTimeout(t); source.dispose(); };
  }, [source]);

  const V = VARIANTS[v] ?? VARIANTS.a;
  return (
    <div className={styles.lab}>
      {error ? <div className={styles.note}>No plan for {product}: {error}</div>
        : source ? <V.C key={v + product + mode + speed} source={source} reducedMotion={reduced} theme={theme} />
          : <div className={styles.note}>Reading {product}…</div>}
      {bar && (
        <div className={styles.bar} role="toolbar" aria-label="Build-up lab">
          <select aria-label="Variant" value={v} onChange={(e) => set('v', e.target.value)}>
            {Object.entries(VARIANTS).map(([k, x]) => <option key={k} value={k}>{x.name}</option>)}
          </select>
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
