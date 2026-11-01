'use client';
// Build-up variant: Axonometric Raise. STUB - the port of the contest prototype replaces this file (spark project-onboarding).
import { useEffect, useState } from 'react';
import type { BuildupEvent, BuildupVariantProps } from '../contract';

export default function Variant({ source }: BuildupVariantProps) {
  const [log, setLog] = useState<BuildupEvent[]>([]);
  useEffect(() => source.subscribe((e) => setLog((l) => (e.type === 'begin' ? [e] : [...l, e]))), [source]);
  return (
    <pre style={{ padding: 24, color: 'var(--ink)', font: '13px var(--font-mono)' }}>
      {'Axonometric Raise (stub)\n'}{log.map((e) => e.at + ' ' + e.type + ('phase' in e ? ' ' + e.phase : '') + ('state' in e ? ' ' + e.state : '')).join('\n')}
    </pre>
  );
}
