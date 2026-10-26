'use client';
// The companion's host in the chrome (desktop only): picks the lamp skin (`?lamp=<key>`), derives its state and hands it
// LampProps. P0b: only the fixture path (`?lamp-fixture=1`, fixture.ts) is built; the live path (the companion stream,
// focus commands, cards with the human token) is P4's. With no skin registered, or neither path active, it renders nothing.
import { useEffect, useMemo, useState } from 'react';
import { frameAt } from './fixture';
import { lampFor, type LampProps } from './lamps';

function useFixtureProps(on: boolean): LampProps | null {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t0 = performance.now();
    const id = window.setInterval(() => setT(performance.now() - t0), 250);
    return () => window.clearInterval(id);
  }, [on]);
  return useMemo(() => {
    if (!on) return null;
    const f = frameAt(t);
    const vw = window.innerWidth, vh = window.innerHeight;
    return {
      state: f.state,
      caption: f.caption,
      target: f.target && { x: f.target.x * vw, y: f.target.y * vh, w: f.target.w * vw, h: f.target.h * vh },
      cards: f.cards ?? [],
      onSubmit: () => {},
      onCard: () => {},
    };
  }, [on, t]);
}

export function CompanionHost() {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams(location.search)); }, []);
  const skin = q ? lampFor(q.get('lamp')) : undefined;
  const props = useFixtureProps(!!q && q.get('lamp-fixture') === '1');
  if (!skin || !props) return null;
  return <skin.Component {...props} />;
}
