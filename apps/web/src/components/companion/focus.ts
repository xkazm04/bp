// Focus commands on the page: the companion shows the person a place by calling the same Engine methods a click would.
// `planFocus` is the pure half (scripts/check-companion-web.ts pins the table): a command for another product becomes a
// notice with a link (it never navigates on its own), a command seen before is skipped, and every kind maps to steps.
// `runFocus` performs the steps on the Engine and the ledger's module store, and `targetRect` reads where the place ended
// up on screen (viewport px) for the skin's `target`: the feature's box from the camera once it has arrived, or the opened
// panel's DOM rect. No rect is ever guessed: a place that cannot be measured is left without one.
//   feature        -> setPage('plan'), flyToFeature(id)
//   room | wing    -> the hash route restoreHash reads (#at=<id>, lens and time kept), which flies the camera
//   decision       -> setPage('plan'), openDecision(id)
//   wave           -> setPage('ledger', 'triage') + the ledger store's showWave(id) (backlog scope)
//   release        -> setPage('ledger', 'release') + the ledger store's focus
//   ledger-row     -> setPage('ledger', 'triage') + the ledger store's focus, filters cleared so the row shows
//   lens           -> setView(id), the Header's lens setter
import type { FocusCommand, FocusKind } from '@bp/core/companion/contract';
import type { Engine } from '@/engine/Engine';
import type { LedgerUi, SetUi } from '../ledger/useLedger';

export type FocusStep =
  | { op: 'page'; page: 'plan' | 'ledger'; lv?: 'triage' | 'release' }
  | { op: 'flyToFeature'; id: string }
  | { op: 'place'; kind: 'room' | 'wing'; id: string }
  | { op: 'openDecision'; id: string }
  | { op: 'wave'; id: string }
  | { op: 'ledgerFocus'; id: string; clear: boolean }
  | { op: 'lens'; id: string };
export type RectSource = { from: 'feature'; id: string } | { from: 'place'; kind: 'room' | 'wing'; id: string } | { from: 'dom'; selector: string };

export type FocusPlan =
  | { kind: 'run'; steps: FocusStep[]; rect?: RectSource }
  | { kind: 'elsewhere'; product: string; text: string }
  | { kind: 'skip' };

const attr = (name: string, v: string) => '[' + name + '="' + v.replace(/["\\]/g, '\\$&') + '"]';

/** Every target kind's steps and where its rect is read. */
export const FOCUS_TABLE: Record<FocusKind, (id: string) => { steps: FocusStep[]; rect?: RectSource }> = {
  feature: (id) => ({ steps: [{ op: 'page', page: 'plan' }, { op: 'flyToFeature', id }], rect: { from: 'feature', id } }),
  room: (id) => ({ steps: [{ op: 'place', kind: 'room', id }], rect: { from: 'place', kind: 'room', id } }),
  wing: (id) => ({ steps: [{ op: 'place', kind: 'wing', id }], rect: { from: 'place', kind: 'wing', id } }),
  decision: (id) => ({ steps: [{ op: 'page', page: 'plan' }, { op: 'openDecision', id }], rect: { from: 'dom', selector: '#dcard' } }),
  wave: (id) => ({ steps: [{ op: 'page', page: 'ledger', lv: 'triage' }, { op: 'wave', id }], rect: { from: 'dom', selector: attr('data-wave', id) } }),
  release: (id) => ({ steps: [{ op: 'page', page: 'ledger', lv: 'release' }, { op: 'ledgerFocus', id, clear: false }], rect: { from: 'dom', selector: attr('data-fid', id) } }),
  'ledger-row': (id) => ({ steps: [{ op: 'page', page: 'ledger', lv: 'triage' }, { op: 'ledgerFocus', id, clear: true }], rect: { from: 'dom', selector: attr('data-fid', id) } }),
  lens: (id) => ({ steps: [{ op: 'lens', id }] }),
};

/** What to do with a command on the page showing `here` (a slug, or 'kettle'), given the ids already honoured. */
export function planFocus(cmd: FocusCommand, here: string, seen: ReadonlySet<string>): FocusPlan {
  if (seen.has(cmd.id)) return { kind: 'skip' };
  if (cmd.product !== here) return { kind: 'elsewhere', product: cmd.product, text: (cmd.say || cmd.target.kind + ' ' + cmd.target.id) + ' - in ' + cmd.product };
  const row = FOCUS_TABLE[cmd.target.kind];
  return row ? { kind: 'run', ...row(cmd.target.id) } : { kind: 'skip' };
}

/** The hash `restoreHash` reads for a place: the current one with `at` set and the open feature and ledger page dropped. */
export function placeHash(current: string, id: string): string {
  const keep = current.replace(/^#/, '').split('&').filter((kv) => kv && !/^(at|open|page|lv)=/.test(kv));
  return '#' + [...keep, 'at=' + encodeURIComponent(id)].join('&');
}

/** The plan's tile id for a feature slug: itself, else line one's (at ?scale > 1 a tile id carries the line suffix). */
function tileId(E: Engine, id: string): string | null {
  const T = E.M.L.TILE;
  if (T[id]) return id;
  const sf = E.M.P.buildings[0]?.sf;
  return sf && T[id + sf] ? id + sf : null;
}

/** Perform the steps. Returns why it could not (the place is not on this plan), or null. */
export function runFocus(E: Engine, steps: readonly FocusStep[], setLedger: SetUi): string | null {
  for (const s of steps) {
    switch (s.op) {
      case 'page': E.setPage(s.page, s.lv); break;
      case 'flyToFeature': { const id = tileId(E, s.id); if (!id) return s.id + ' is not on this plan'; E.flyToFeature(id); break; }
      case 'place': {
        if (!E.placeById(s.kind, s.id)) return s.kind + ' ' + s.id + ' is not on this plan';
        const h = placeHash(location.hash, s.id);
        if (h !== location.hash) location.hash = h; // hashchange -> restoreHash flies there
        break;
      }
      case 'openDecision': { if (!E.M.sim.DEC[s.id]?.open) return 'that decision is not open on this plan'; E.openDecision(s.id); break; }
      case 'wave': setLedger((u) => (u.wave === s.id && u.scope === 'backlog' ? u : { ...u, scope: 'backlog', wave: s.id, focus: null })); break;
      case 'ledgerFocus': setLedger((u): LedgerUi => (s.clear ? { ...u, focus: s.id, wave: null, q: '', lens: new Set(), status: new Set(), feat: new Set() } : { ...u, focus: s.id })); break;
      case 'lens': E.setView(s.id); break;
    }
  }
  return null;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Where the place is on screen once the camera has arrived (at most `waitMs`), or null. */
export function targetRect(E: Engine, src: RectSource | undefined, waitMs = 2000): Promise<Rect | null> {
  if (!src) return Promise.resolve(null);
  const read = (): Rect | null => {
    if (src.from === 'feature') { const id = tileId(E, src.id); const r = id ? E.featureRect(id) : null; return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null; }
    if (src.from === 'place') { // the room's or wing's world box at the arrived camera (the canvas fills the page)
      const n = E.placeById(src.kind, src.id), c = E.cam;
      return n ? { x: c.sx(n.x), y: c.sy(n.y), w: n.w * c.k, h: n.h * c.k } : null;
    }
    const el = document.querySelector(src.selector), b = el?.getBoundingClientRect();
    return b && b.width && b.height ? { x: b.left, y: b.top, w: b.width, h: b.height } : null;
  };
  const t0 = performance.now();
  return new Promise((done) => {
    const tick = () => {
      if (!E.cam.flying && performance.now() - t0 > 120) { done(read()); return; } // a DOM panel mounts and lays out in a frame or two
      if (performance.now() - t0 > waitMs) { done(read()); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
