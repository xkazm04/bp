'use client';
// The feature page's entrance: sections that enter in sequence (fade and an 8 px rise, 50 ms apart,
// stat tiles first) on open and on every tab switch, and numbers that count up to their value. Both
// are off under prefers-reduced-motion (everything is simply there). Counting writes the text node
// directly, so a counting number never re-renders React.
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useReducedMotion, type Variants } from 'motion/react';

/** The page's memory of what each number last showed, so a tab switch counts on from there. One per opened page. */
export const CountMemo = createContext<Map<string, number>>(new Map());
/** Seconds to wait before the first section enters (the morph's length on open, 0 on a tab switch). */
export const EnterDelay = createContext(0);

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * A number that counts from its last shown value (0 the first time on this page) to `v` over ~600 ms.
 * `k` identifies the number on the page; `fmt` formats any in-between value as the final one would be.
 */
export function Count({ k, v, fmt }: { k: string; v: number; fmt: (n: number) => string }) {
  const memo = useContext(CountMemo), reduce = useReducedMotion(), delay = useContext(EnterDelay);
  const ref = useRef<HTMLSpanElement>(null);
  const [from] = useState(() => (reduce ? v : memo.get(k) ?? 0));
  const shown = useRef(from);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const a = shown.current;
    memo.set(k, v);
    if (reduce || a === v || !Number.isFinite(v)) { shown.current = v; el.textContent = fmt(v); return; }
    const c = animate(a, v, { duration: 0.6, delay, ease: EASE, onUpdate: (n) => { shown.current = n; el.textContent = fmt(n); } });
    return () => c.stop();
    // fmt is recreated by callers every render; the value and key decide
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, v, reduce]);
  return <span ref={ref} className="cnt">{fmt(from)}</span>;
}

const ITEM: Variants = { hide: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } } };

/** A column of sections that enter one after the other. Children that are `Sec` take part. */
export function Stagger({ className, children, gap = 0.05 }: { className?: string; children: ReactNode; gap?: number }) {
  const reduce = useReducedMotion(), delay = useContext(EnterDelay);
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial="hide" animate="show" variants={{ hide: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }}>
      {children}
    </motion.div>
  );
}

/** One section of a staggered column. */
export function Sec({ className, children, as = 'section', label }: { className?: string; children: ReactNode; as?: 'section' | 'div'; label?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return as === 'div' ? <div className={className}>{children}</div> : <section className={className} aria-label={label}>{children}</section>;
  const M = as === 'div' ? motion.div : motion.section;
  return <M className={className} variants={ITEM} aria-label={label}>{children}</M>;
}
