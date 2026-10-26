'use client';
// The companion's host in the chrome (desktop only: Chrome renders nothing on a phone). This shell is all the main chunk
// carries: after mount it loads CompanionLive (the skins, the stream, focus and cards) as a chunk of its own, so nothing of
// the companion loads before the plan is up. CompanionLive picks the skin (`?lamp=<key>`, else the first registered),
// plays the fixture timeline on `?lamp-fixture=1` with no server, and otherwise runs the live path.
import { lazy, Suspense, useEffect, useState } from 'react';

const Live = lazy(() => import('./CompanionLive'));

export function CompanionHost() {
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(true); }, []);
  return on ? <Suspense fallback={null}><Live /></Suspense> : null;
}
