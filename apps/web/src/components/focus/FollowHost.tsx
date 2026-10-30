'use client';
// The page as one reader of the shared focus (packages/core/src/session/focus.ts, client in src/lib/focus/shared.ts):
// it publishes where the person is looking once the camera rests, and - when following - flies to the place another surface
// published, with the same Engine paths a click takes (a feature: flyToFeature; a room, wing or bay: the hash route
// restoreHash animates; the site: goHome). A place in another product opens that product (the reader id lives in the tab,
// the follow in the record, so the new page picks the place up and flies in from the site). The chip says it plainly:
// "Following Web, 2 s ago" with one-tap Stop, or a quiet Follow, and who follows this page.
// `?follow=1` starts following on load (the second window, the phone).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FocusPlace } from '@bp/core/session/focus';
import type { Engine } from '@/engine/Engine';
import { switchProduct } from '@/lib/scan/projects';
import { sharedFocus } from '@/lib/focus/shared';
import { useBp, useEngine, shallowEqual } from '../hooks';
import { arrived, placeOf } from '../crossing/place';
import { placeHash } from '../companion/focus';
import './focus.css';

/** The tile for a feature slug (at ?scale > 1 a tile id carries the line suffix). */
function tileOf(E: Engine, id: string): string | null {
  const T = E.M.L.TILE;
  if (T[id]) return id;
  const sf = E.M.P.buildings[0]?.sf;
  return sf && T[id + sf] ? id + sf : null;
}

/** Fly this page to a place on its own product. Returns why it could not, or null. */
export function flyToPlace(E: Engine, p: FocusPlace): string | null {
  const L = E.M.L, t = p.target, here = (id: string) => !!(L.ROOM[id] || L.WING[id] || L.BAY[id] || E.placeById('bld', id));
  if (E.S.page !== 'plan') E.setPage('plan');
  if (t?.kind === 'feature') { const id = tileOf(E, t.id); if (id) { E.flyToFeature(id); return null; } }
  const at = p.hash ? new URLSearchParams(p.hash.replace(/^#/, '')).get('at') : null;
  const id = at && here(at) ? at : t && t.kind !== 'site' && t.kind !== 'feature' && here(t.id) ? t.id : null;
  if (id) { const h = placeHash(location.hash, id); if (h !== location.hash) location.hash = h; return null; }
  if (!t || t.kind === 'site') { if (E.S.open) E.closeFeature(false); E.goHome(); return null; }
  return `${t.kind} ${t.id} is not on this plan`;
}

/** Go to a place: fly on this product, or open the product it is in, in place (keeping every other parameter). */
export function goToPlace(E: Engine, p: FocusPlace, extra?: Record<string, string>): string | null {
  const here = E.M.live?.slug ?? 'kettle';
  if (p.product !== here) { switchProduct(p.product === 'kettle' ? null : p.product, extra); return null; }
  return flyToPlace(E, p);
}

/** The place this page shows, as the shared focus carries it. */
export function placeHere(E: Engine): FocusPlace {
  const c = placeOf(E);
  return { product: c.product, level: `L${c.level}` as FocusPlace['level'], ...(c.target.kind !== 'site' ? { target: c.target } : {}), ...(location.hash && location.hash !== '#' ? { hash: location.hash.slice(0, 400) } : {}) };
}

const SETTLE_MS = 1200;

export function FollowHost({ phone = false }: { phone?: boolean }) {
  const E = useEngine(), fx = sharedFocus();
  const st = useSyncExternalStore(fx.subscribe, fx.get, fx.get);
  const s = useBp((s) => ({ open: s.open, place: s.place }), shallowEqual);
  const [, tick] = useState(0);
  const [arrive, setArrive] = useState(0);
  const born = useRef(0);

  useEffect(() => {
    born.current = performance.now();
    const q = new URLSearchParams(location.search);
    fx.start({ surface: phone ? 'phone' : 'web', label: phone ? 'Phone' : 'Web', viaLamp: !phone && q.get('lamp-fixture') !== '1', follow: q.get('follow') === '1' });
    // a place in another product: the product opens in place and this host mounts again on its engine, where it lands here
    const landing = fx.takeArrival(E.M.live?.slug ?? 'kettle');
    if (landing) { fx.hush(4000); setTimeout(() => { flyToPlace(E, landing); setArrive((n) => n + 1); void arrived(E).then(() => fx.hush(900)); }, 120); }
    const off = fx.onApply((p) => {
      if (p.product !== (E.M.live?.slug ?? 'kettle')) fx.arrive(p);
      const why = goToPlace(E, p);
      if (why) return;
      setArrive((n) => n + 1);
      fx.hush(4000);
      void arrived(E).then(() => fx.hush(900));
    });
    const t = setInterval(() => tick((n) => n + 1), 1000); // the chip's "2 s ago"
    return () => { off(); clearInterval(t); };
  }, [E, fx, phone]);

  // publish where this page rests: not in its first moments (opening a follower must not steal the shared place)
  useEffect(() => {
    if (performance.now() - born.current < SETTLE_MS) return;
    let dead = false;
    const go = () => { if (dead) return; if (E.cam.flying) { setTimeout(go, 200); return; } fx.publish(placeHere(E)); };
    const t = setTimeout(go, 150);
    return () => { dead = true; clearTimeout(t); };
  }, [s.open, s.place, E, fx]);

  const words = fx.words(), followers = fx.followers();
  // what the leader said with the place (a Morning card's headline): every following screen shows the line being read
  const say = st.view?.shared && st.view.shared.reader !== fx.me ? st.view.shared.place.say : undefined;
  if (!st.view && !st.follows) return null;
  return (
    <div id="fx-chip" className={st.follows ? 'on' : ''} role="status" aria-live="polite" data-keys="own">
      {st.follows ? (
        <>
          <i key={arrive} className="dot" aria-hidden="true" />
          <span className="w">{words}</span>
          <button type="button" className="fx-bt" onClick={() => void fx.unfollow()} title="Stop following: this screen stays where it is">Stop</button>
        </>
      ) : (
        <>
          <button type="button" className="fx-bt" onClick={() => void fx.follow('*')} title="Follow: this screen flies wherever you look on another screen">Follow</button>
          {followers.length ? <span className="w muted">{followers.length === 1 ? followers[0].label + ' follows' : followers.map((f) => f.label).join(', ') + ' follow'}</span> : null}
        </>
      )}
      {!st.online && <span className="w muted" title="The shared focus is not reachable right now">offline</span>}
      {st.follows && say && <span key={st.view?.rev} className="say">{say}</span>}
    </div>
  );
}
