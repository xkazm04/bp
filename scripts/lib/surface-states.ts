// A store patch that opens each surface of apps/web/src/engine/surfaces.ts SURFACES on a given model, for the checks
// that drive Engine.goUp over them (check-surfaces, check-engine-harness). A SURFACES row with no entry here fails
// check:surfaces, so a new surface cannot join the stack untested.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Every surface closed: the base the opening patches are applied over. */
export const ALL_CLOSED: Record<string, unknown> = {
  morning: false, dec: null, open: null, dtab: null, tl: false, menu: null, whoMenu: false, info: false, page: 'plan', track: null,
  prev: null, lprev: null, tgt: { ids: {}, n: 0, label: '' }, key: null, blast: null, ga: false, scope: null, cmpA: null, hlOpt: null,
};

export function openStates(M: Any): Record<string, Record<string, unknown>> {
  const f0 = Object.keys(M.P.F)[0];
  const dec0 = Object.values(M.sim.DEC as Record<string, Any>).find((d) => d.open)?.id ?? null;
  const tgt = { ids: { [f0]: 1 }, n: 1, label: 'one place' };
  return {
    menu: { menu: { x: 1, y: 1, chain: [], tile: null } },
    morning: { morning: true },
    whoMenu: { whoMenu: true },
    tl: { tl: true },
    dtab: { dtab: 'view' },
    ledger: { page: 'ledger' },
    open: { open: f0 },
    dec: { dec: dec0 },
    track: { track: 'T1' },
    info: { info: true, tgt },
    prev: { prev: { verb: 'pause', lines: [] }, tgt },
    tgt: { tgt },
    blast: { blast: f0 },
    ga: { ga: true, scope: { kind: 'all', id: '', label: 'all', ids: [f0] } },
    key: { key: 'x' },
    cmpA: { cmpA: M.P.asOf },
  };
}
