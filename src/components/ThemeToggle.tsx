'use client';
// Dark / light switch. The theme lives on <html data-theme>, set before paint by the layout script
// (`?theme=` wins, then localStorage). The canvas engine watches the attribute and re-rasters.
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'dark' | 'light';

function subscribe(fn: () => void) {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
const read = (): ThemeMode => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function useTheme(): ThemeMode {
  return useSyncExternalStore(subscribe, read, () => 'dark');
}
export function setTheme(t: ThemeMode) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('bp-theme', t); } catch { /* storage may be blocked */ }
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const t = useTheme();
  const next: ThemeMode = t === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme(next)} aria-label={'Switch to ' + next + ' theme'} title={'Switch to ' + next + ' theme'} suppressHydrationWarning>
      {t === 'dark' ? (
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 10.5A5.5 5.5 0 0 1 5.5 4.5a5.5 5.5 0 0 0 6 6z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.2" /></svg>
      )}
      {!compact && <span suppressHydrationWarning>{t === 'dark' ? 'Dark' : 'Light'}</span>}
    </button>
  );
}
