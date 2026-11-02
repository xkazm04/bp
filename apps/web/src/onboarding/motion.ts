'use client';
// prefers-reduced-motion as React state: the build-up lab and the onboarding screen hand it to the build-up.
import { useEffect, useState } from 'react';

export function useReducedMotion(): boolean {
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
