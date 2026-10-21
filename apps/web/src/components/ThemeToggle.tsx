'use client';
// Dark / light switch. The theme lives on <html data-theme>, set before paint by the layout script
// (`?theme=` wins, then localStorage). The canvas engine watches the attribute and re-rasters.
import { useState, useSyncExternalStore } from 'react';

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
/** Apply the theme and report whether the browser kept it: false when storage refuses the write (a private window,
 *  site data blocked), so the choice lasts for this visit only. The attribute is set either way. */
export function setTheme(t: ThemeMode): boolean {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('bp-theme', t); return true; } catch { return false; }
}

/** The toggle's name and tooltip. Once a write was refused it says so, in the morning watch's wording, and keeps saying it
 *  (one standing sentence, not a message per click). */
export const themeLabel = (next: ThemeMode, kept: boolean) => 'Switch to ' + next + ' theme' + (kept ? '' : '. This browser does not keep your choice, so it lasts for this visit only');

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const t = useTheme();
  const next: ThemeMode = t === 'dark' ? 'light' : 'dark';
  const [kept, setKept] = useState(true);
  const label = themeLabel(next, kept);
  return (
    <button type="button" className="theme-toggle" onClick={() => setKept(setTheme(next))} aria-label={label} title={label} suppressHydrationWarning>
      {t === 'dark' ? (
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 10.5A5.5 5.5 0 0 1 5.5 4.5a5.5 5.5 0 0 0 6 6z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.2" /></svg>
      )}
      {!compact && <span suppressHydrationWarning>{t === 'dark' ? 'Dark' : 'Light'}</span>}
    </button>
  );
}
