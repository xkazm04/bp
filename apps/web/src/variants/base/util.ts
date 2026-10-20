// The two helpers every variant used to carry its own copy of.
import type { Feature } from '@/lib/data';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export function count(fs: readonly Feature[], fn: (f: Feature) => boolean) { let n = 0; for (const f of fs) if (fn(f)) n++; return n; }
